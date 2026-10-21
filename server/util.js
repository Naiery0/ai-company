'use strict';
const fs = require('fs');
const path = require('path');
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

function writeFile(p, content) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content, 'utf8'); }

function appendFile(p, content) { ensureDir(path.dirname(p)); fs.appendFileSync(p, content, 'utf8'); }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function run(cmd, args, cwd, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
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
  async commitAll(cwd, message) {
    await run('git', ['add', '-A'], cwd);
    const r = await run('git', ['commit', '-m', message], cwd);
    return r;
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

module.exports = { extractJson, structuredFrom, ensureDir, writeFile, appendFile, readJson, run, git, specToMarkdown, contractToMarkdown, qaToMarkdown };
