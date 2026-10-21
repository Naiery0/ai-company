'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Company } = require('./company');
const { resolveCommand } = require('./claude');
const { git, run } = require('./util');

const APP_DIR = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP_DIR, 'public');
const PORT = Number(process.env.PORT) || 4317;
const HOST = '127.0.0.1';
const DEMO = process.argv.includes('--demo') || process.env.AI_COMPANY_DEMO === '1';

const company = new Company({ appDir: APP_DIR, demo: DEMO });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) { reject(new Error('요청이 너무 큽니다')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON 형식이 아닙니다')); } });
  });
}

// 로컬 전용 보호: 다른 웹사이트가 이 서버로 요청을 보내 claude를 실행시키지 못하게 막는다.
function allowed(req) {
  const host = String(req.headers.host || '');
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return false;
    if (!String(req.headers['content-type'] || '').includes('application/json')) return false;
  }
  return true;
}

function listDrives() {
  const out = [];
  for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { fs.accessSync(d); out.push(d); } catch { /* none */ } }
  return out;
}

function safeCompanyPath(rel) {
  if (!company.projectPath) throw new Error('프로젝트가 열려 있지 않습니다');
  const base = path.join(company.projectPath, '.company');
  const p = path.resolve(base, rel || '');
  if (!p.startsWith(base)) throw new Error('잘못된 경로');
  return p;
}

function walk(dir, base, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'chats') walk(full, base, out); }
    else out.push({ rel: path.relative(base, full).replace(/\\/g, '/'), size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs });
  }
  return out;
}

const routes = {
  'GET /api/state': async () => company.snapshot(),

  'GET /api/health': async () => {
    const { cmd, args, shell } = resolveCommand(company.settings.claudePath, ['--version']);
    return new Promise((resolve) => {
      const { execFile, exec } = require('child_process');
      const done = (err, stdout, stderr) => resolve({ ok: !err, version: String(stdout || '').trim(), error: err ? (String(stderr || '').trim() || err.message) : null, demo: DEMO });
      if (shell) exec([cmd, ...args].join(' '), { timeout: 15000, windowsHide: true }, done);
      else execFile(cmd, args, { timeout: 15000, windowsHide: true }, done);
    });
  },

  'POST /api/project': async (b) => { company.openProject(b.path); return { ok: true }; },

  'POST /api/project/git-init': async () => { company.requireProject(); const r = await git.init(company.projectPath); return { ok: r.ok, out: r.stdout + r.stderr }; },

  'GET /api/fs': async (_, q) => {
    let p = q.get('path');
    if (!p) {
      if (process.platform === 'win32') return { path: '', parent: null, dirs: listDrives().map((d) => ({ name: d, path: d })), home: os.homedir() };
      p = os.homedir();
    }
    const abs = path.resolve(p);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(abs) === abs ? (process.platform === 'win32' ? '' : null) : path.dirname(abs);
    return { path: abs, parent, dirs: entries, isGit: fs.existsSync(path.join(abs, '.git')), home: os.homedir() };
  },

  'POST /api/chat/send': async (b) => company.sendMessage(b),
  'POST /api/chat/new': async () => { const c = company.newConv(); return { convId: c.id }; },
  'POST /api/chat/delete': async (b) => { company.deleteConv(b.convId); return { ok: true }; },
  'POST /api/stop': async (b) => { company.stop(b); return { ok: true }; },
  'POST /api/permission': async (b) => { company.respondPermission(b.permId, b.decision, b.message); return { ok: true }; },

  'POST /api/run/approve': async (b) => { company.getRun(b.runId).approve(); return { ok: true }; },
  'POST /api/run/reject': async (b) => { company.getRun(b.runId).reject(b.feedback); return { ok: true }; },
  'POST /api/run/discard': async (b) => { await company.discardRun(b.runId); return { ok: true }; },
  'GET /api/run/transcripts': async (_, q) => company.runTranscriptItems(q.get('runId')),

  'GET /api/files': async () => (company.projectPath ? walk(path.join(company.projectPath, '.company'), path.join(company.projectPath, '.company')) : []),
  'GET /api/file': async (_, q) => {
    const p = safeCompanyPath(q.get('rel'));
    const st = fs.statSync(p);
    if (st.size > 1e6) return { rel: q.get('rel'), content: '(파일이 너무 커서 미리보기를 생략합니다)' };
    return { rel: q.get('rel'), content: fs.readFileSync(p, 'utf8') };
  },
  'GET /api/diff': async (_, q) => {
    company.requireProject();
    if (!(await git.isRepo(company.projectPath))) return { isGit: false };
    let base = null;
    const runId = q.get('runId');
    const st = runId && company.runs.get(runId) && company.runs.get(runId).state;
    // 업무 시작 시점 스냅샷이 있으면 그 이후 바뀐 것만(업무 전부터 있던 사용자 변경은 제외)
    if (st && st.baseTree) {
      const d = await git.diffSince(company.projectPath, st.baseTree);
      return { isGit: true, base: st.baseCommit, sinceStart: true, ...d, diff: d.diff.length > 400000 ? d.diff.slice(0, 400000) + '\n…(생략)' : d.diff };
    }
    if (st) base = st.baseCommit;
    const d = await git.diff(company.projectPath, base);
    const stat = await run('git', base ? ['diff', '--stat', base, '--', '.', ':(exclude).company'] : ['diff', '--stat', 'HEAD', '--', '.', ':(exclude).company'], company.projectPath);
    return { isGit: true, base, ...d, stat: stat.stdout, diff: d.diff.length > 400000 ? d.diff.slice(0, 400000) + '\n…(생략)' : d.diff };
  },

  'POST /api/settings': async (b) => { company.updateSettings(b); return company.settings; },
};

const server = http.createServer(async (req, res) => {
  if (!allowed(req)) return send(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    company.clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 20000);
    req.on('close', () => { clearInterval(ping); company.clients.delete(res); });
    return;
  }

  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : null;
      const out = await routes[key](body, url.searchParams);
      return send(res, 200, out);
    } catch (e) {
      return send(res, 400, { error: e.message || String(e) });
    }
  }

  if (req.method !== 'GET') return send(res, 404, { error: 'not found' });
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  if (process.argv.includes('--open')) {
    const url = `http://localhost:${PORT}`;
    const { spawn } = require('child_process');
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* noop */ }
  }
  console.log(`\n  가상 회사 사무실이 열렸습니다 → http://localhost:${PORT}${DEMO ? '   (데모 모드: 실제 claude 대신 모의 직원이 일합니다)' : ''}\n`);
});

process.on('SIGINT', () => {
  company.flushSaves();
  for (const c of company.convs.values()) if (c.session) c.session.kill();
  process.exit(0);
});
