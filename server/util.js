'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) { try { return JSON.parse(c); } catch { /* next */ } }
  return null;
}

/** result 이벤트에서 구조화 출력을 꺼낸다(--json-schema 미지원 시 텍스트에서 추출). */
function structuredFrom(result) {
  if (result && result.structured && typeof result.structured === 'object') return result.structured;
  return extractJson(result && result.text);
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 도중 꺼져도 반쪽짜리 파일이 남지 않게 한다.
function writeFile(p, content) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, p); } catch {
    // Windows에서 다른 프로그램이 파일을 열고 있으면 rename이 실패할 수 있다
    fs.writeFileSync(p, content, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* noop */ }
  }
}

function appendFile(p, content) { ensureDir(path.dirname(p)); fs.appendFileSync(p, content, 'utf8'); }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function run(cmd, args, cwd, timeout = 20000, { env, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/**
 * 셸 명령 한 줄을 실행한다(테스트·빌드 확인용, 토큰 0). 출력은 끝부분만 남긴다.
 * onSpawn(child)로 프로세스를 넘겨 중지할 수 있게 한다.
 */
function runShell(command, cwd, { timeout = 10 * 60000, onSpawn } = {}) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const started = Date.now();
    const child = exec(command, { cwd, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1' } }, (err, stdout, stderr) => {
      const output = (String(stdout || '') + (stderr ? '\n' + String(stderr) : '')).trim();
      resolve({
        ok: !err, code: err ? (err.killed ? 'timeout' : err.code ?? 1) : 0,
        output: output.length > 4000 ? '…' + output.slice(-4000) : output, durationMs: Date.now() - started,
      });
    });
    if (onSpawn) onSpawn(child);
  });
}

/** 프로젝트의 확인 명령을 추측한다. package.json에 실제 test 스크립트가 있을 때만 npm test. */
function detectCheckCommand(cwd) {
  const pkg = readJson(path.join(cwd, 'package.json'), null);
  const t = pkg && pkg.scripts && pkg.scripts.test;
  if (t && !/no test specified/.test(t)) return 'npm test';
  return '';
}

// ───────── 작업 폴더 스냅샷 ─────────
// 업무 시작 시점의 작업 폴더 전체(새 파일 포함, .gitignore 대상 제외)를 git 트리 객체로 찍어 둔다.
// 별도 index 파일을 쓰므로 사용자의 index·파일·브랜치는 건드리지 않는다.
// 이 기준점과 비교하면 "이 업무가 바꾼 파일"만 골라 커밋하거나 되돌릴 수 있다.
const SLOW = 120000;
const ZERO = '0'.repeat(40);

async function withTempIndex(cwd, fn, { copyReal = false } = {}) {
  const idx = path.join(os.tmpdir(), `ai-company-${crypto.randomBytes(6).toString('hex')}.idx`);
  try {
    if (copyReal) {
      // 실제 index를 복사해 시작하면 바뀌지 않은 파일은 다시 읽지 않아 빠르다
      const r = await run('git', ['rev-parse', '--git-path', 'index'], cwd);
      const real = r.ok ? path.resolve(cwd, r.stdout.trim()) : null;
      if (real && fs.existsSync(real)) fs.copyFileSync(real, idx);
    }
    return await fn((args, opt = {}) => run('git', args, cwd, SLOW, { ...opt, env: { GIT_INDEX_FILE: idx } }));
  } finally {
    try { fs.unlinkSync(idx); } catch { /* noop */ }
  }
}

// git이 주는 경로는 저장소 최상위 기준이라, 프로젝트가 하위 폴더여도 최상위에서 실행한다
async function toplevel(cwd) {
  const r = await run('git', ['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? path.resolve(r.stdout.trim()) : cwd;
}

function fail(r, what) { throw new Error(`${what}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`); }

async function snapshot(cwd) {
  return withTempIndex(cwd, async (g) => {
    let r = await g(['add', '-A']);
    if (!r.ok) fail(r, '스냅샷 실패');
    r = await g(['write-tree']);
    if (!r.ok) fail(r, '스냅샷 실패');
    return r.stdout.trim();
  }, { copyReal: true });
}

/** 두 트리 사이에 바뀐 파일. [{status:'A'|'M'|'D'|'T', path}] */
async function changedPaths(cwd, a, b) {
  if (a === b) return [];
  const r = await run('git', ['diff', '--no-renames', '--name-status', '-z', a, b], cwd, SLOW);
  if (!r.ok) fail(r, '변경 목록 확인 실패');
  const parts = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

/** 트리의 파일 목록: path → {mode, sha} */
async function treeEntries(cwd, tree) {
  const r = await run('git', ['ls-tree', '-r', '-z', '--full-tree', tree], cwd, SLOW);
  if (!r.ok) fail(r, '파일 목록 확인 실패');
  const map = new Map();
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, , sha] = rec.slice(0, tab).split(' ');
    map.set(rec.slice(tab + 1), { mode, sha });
  }
  return map;
}

/**
 * base 이후 바뀐 파일만 현재 HEAD 위에 커밋한다. 사용자가 따로 고치던 다른 파일은 커밋에 섞이지 않는다.
 * (같은 파일을 사용자도 고치고 있었다면 그 파일은 지금 내용 그대로 들어간다)
 */
async function commitChanges(cwd, base, message) {
  cwd = await toplevel(cwd);
  const tip = await snapshot(cwd);
  const changed = await changedPaths(cwd, base, tip);
  if (!changed.length) return { ok: false, reason: '바뀐 파일이 없음' };
  const entries = await treeEntries(cwd, tip);
  const info = changed.map((c) => {
    const e = entries.get(c.path);
    return e ? `${e.mode} ${e.sha}\t${c.path}` : `0 ${ZERO}\t${c.path}`; // 모드 0 = index에서 제거
  }).join('\0') + '\0';
  const headR = await run('git', ['rev-parse', '--verify', '-q', 'HEAD'], cwd);
  const head = headR.ok ? headR.stdout.trim() : null;
  const tree = await withTempIndex(cwd, async (g) => {
    let r = await g(head ? ['read-tree', head] : ['read-tree', '--empty']);
    if (!r.ok) fail(r, '커밋 준비 실패');
    r = await g(['update-index', '-z', '--index-info'], { input: info });
    if (!r.ok) fail(r, '커밋 준비 실패');
    r = await g(['write-tree']);
    if (!r.ok) fail(r, '커밋 준비 실패');
    return r.stdout.trim();
  });
  const args = ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', message];
  let c = await run('git', args, cwd);
  // git 사용자 정보가 설정되지 않았으면 중립적인 이름으로 커밋
  if (!c.ok) c = await run('git', ['-c', 'user.name=AI Company', '-c', 'user.email=ai-company@localhost', ...args], cwd);
  if (!c.ok) fail(c, '커밋 실패');
  const commit = c.stdout.trim();
  const u = await run('git', ['update-ref', '-m', `ai-company: ${message}`, 'HEAD', commit, ...(head ? [head] : [])], cwd);
  if (!u.ok) fail(u, '커밋 실패');
  // 실제 index도 커밋한 내용으로 맞춰, 커밋된 파일이 "변경됨"으로 남지 않게 한다
  await run('git', ['update-index', '-z', '--index-info'], cwd, SLOW, { input: info });
  await run('git', ['update-index', '-q', '--refresh'], cwd, SLOW);
  return { ok: true, commit, files: changed.length };
}

/** base 이후 바뀐 파일을 base 상태로 되돌린다(새로 생긴 파일은 지운다). 되돌린 목록을 돌려준다. */
async function restoreTo(cwd, base) {
  cwd = await toplevel(cwd);
  const now = await snapshot(cwd);
  const changed = await changedPaths(cwd, base, now);
  const restore = changed.filter((c) => c.status !== 'A').map((c) => c.path);
  if (restore.length) {
    await withTempIndex(cwd, async (g) => {
      let r = await g(['read-tree', base]);
      if (!r.ok) fail(r, '되돌리기 실패');
      r = await g(['checkout-index', '-f', '-z', '--stdin'], { input: restore.join('\0') + '\0' });
      if (!r.ok) fail(r, '되돌리기 실패');
    });
    // 줄바꿈 변환(autocrlf) 때문에 내용은 같아도 "수정됨"으로 보일 수 있다. 실제 index가 이미 같은 내용을
    // 가리키는 파일만 다시 add 해 표시를 정리한다(사용자의 스테이징 상태는 바뀌지 않음).
    const baseEntries = await treeEntries(cwd, base);
    const ls = await run('git', ['ls-files', '-s', '-z'], cwd, SLOW);
    const same = [];
    for (const rec of ls.stdout.split('\0')) {
      const tab = rec.indexOf('\t');
      if (tab < 0) continue;
      const p = rec.slice(tab + 1);
      const e = baseEntries.get(p);
      if (e && rec.slice(0, tab).split(' ')[1] === e.sha && restore.includes(p)) same.push(p);
    }
    if (same.length) await run('git', ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], cwd, SLOW, { input: same.join('\0') + '\0' });
  }
  const root = path.resolve(cwd);
  for (const c of changed.filter((x) => x.status === 'A')) {
    const full = path.resolve(root, c.path);
    try { fs.rmSync(full, { force: true }); } catch { /* noop */ }
    // 비게 된 상위 폴더 정리
    for (let d = path.dirname(full); d.startsWith(root + path.sep); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
  return changed;
}

const git = {
  async isRepo(cwd) { const r = await run('git', ['rev-parse', '--is-inside-work-tree'], cwd); return r.ok && r.stdout.trim() === 'true'; },
  async head(cwd) { const r = await run('git', ['rev-parse', 'HEAD'], cwd); return r.ok ? r.stdout.trim() : null; },
  async diff(cwd, base) {
    const args = base ? ['diff', base, '--', '.', ':(exclude).company'] : ['diff', 'HEAD', '--', '.', ':(exclude).company'];
    const d = await run('git', args, cwd);
    const st = await run('git', ['status', '--porcelain', '--', '.', ':(exclude).company'], cwd);
    const untracked = st.stdout.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim()).filter(Boolean);
    return { diff: d.stdout, untracked, status: st.stdout };
  },
  snapshot,
  changedPaths,
  commitChanges,
  restoreTo,
  /** 스냅샷 트리 기준 변경(새 파일 포함). .company는 제외 */
  async diffSince(cwd, base) {
    const now = await snapshot(cwd);
    const spec = ['--', '.', ':(exclude).company'];
    const d = await run('git', ['diff', base, now, ...spec], cwd, SLOW);
    const stat = await run('git', ['diff', '--stat', base, now, ...spec], cwd, SLOW);
    return { diff: d.stdout, stat: stat.stdout, untracked: [] };
  },
  async init(cwd) { return run('git', ['init'], cwd); },
};

function specToMarkdown(plan) {
  const lines = [`# ${plan.title}`, '', plan.summary || '', ''];
  if (plan.stackNotes) lines.push('## 기존 스택/관례', '', plan.stackNotes, '');
  lines.push('## 기능');
  for (const f of plan.features || []) {
    lines.push('', `### ${f.id}. ${f.title}`, '', f.description || '', '', '수용 기준:');
    for (const a of f.acceptance || []) lines.push(`- ${a}`);
  }
  if (plan.outOfScope && plan.outOfScope.length) {
    lines.push('', '## 범위 밖');
    for (const o of plan.outOfScope) lines.push(`- ${o}`);
  }
  return lines.join('\n') + '\n';
}

function contractToMarkdown(contract, proposal) {
  const lines = ['# 완료 기준 계약', '', '개발 완료 후 QA가 이 체크리스트로 검사합니다. 개발자는 모든 항목을 만족시켜야 합니다.', ''];
  if (proposal && proposal.testCommand) lines.push(`전체 확인 명령: \`${proposal.testCommand}\``, '');
  if (contract.notes) lines.push(contract.notes, '');
  lines.push('| id | 기능 | 통과 조건 | 확인 방법 |', '| --- | --- | --- | --- |');
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const c of contract.criteria || []) lines.push(`| ${esc(c.id)} | ${esc(c.featureId)} | ${esc(c.check)} | ${esc(c.how)} |`);
  if (proposal && proposal.items && proposal.items.length) {
    lines.push('', '## 개발자 구현 제안(참고)');
    for (const p of proposal.items) lines.push(`- ${p.featureId}: ${p.approach}`);
  }
  return lines.join('\n') + '\n';
}

function qaToMarkdown(qa, round) {
  const icon = { pass: '통과', fail: '실패', skip: '보류' };
  const lines = [`# QA 보고서 (라운드 ${round})`, '', `판정: ${qa.pass ? '통과' : '반려'}`, '', qa.summary || '', '', '| id | 결과 | 근거 |', '| --- | --- | --- |'];
  const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const r of qa.results || []) lines.push(`| ${esc(r.id)} | ${icon[r.status] || r.status} | ${esc(r.finding)} |`);
  return lines.join('\n') + '\n';
}

module.exports = { extractJson, structuredFrom, ensureDir, writeFile, appendFile, readJson, run, runShell, detectCheckCommand, git, specToMarkdown, contractToMarkdown, qaToMarkdown };
