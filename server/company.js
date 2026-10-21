'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ClaudeSession, newId } = require('./claude');
const { Transcript, toolLabel } = require('./transcript');
const { Run } = require('./pipeline');
const { ROLES, PROMPTS } = require('./roles');
const { readJson, writeFile } = require('./util');

const SAFE_BASH = [
  'Bash(npm test *)', 'Bash(npm run *)', 'Bash(npx tsc *)', 'Bash(npx vitest *)', 'Bash(npx jest *)',
  'Bash(pnpm test *)', 'Bash(pnpm run *)', 'Bash(yarn test *)', 'Bash(yarn run *)',
  'Bash(pytest *)', 'Bash(python -m pytest *)', 'Bash(go test *)', 'Bash(cargo test *)', 'Bash(cargo build *)',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(ls *)', 'Bash(dir *)',
];

const DEFAULT_SETTINGS = {
  claudePath: 'claude',
  maxQaRounds: 3,
  autoCommit: true,
  forceMode: 'auto', // auto | solo | team
  idleCloseMinutes: 20,
  roles: {
    ceo: { model: 'sonnet', effort: 'low', permissionMode: 'manual', allowedTools: [] },
    planner: { model: 'opus', effort: 'high', permissionMode: 'manual', allowedTools: [] },
    dev: { model: 'opus', effort: 'high', permissionMode: 'acceptEdits', allowedTools: SAFE_BASH },
    qa: { model: 'opus', effort: 'high', permissionMode: 'manual', allowedTools: SAFE_BASH, tools: ['Read', 'Glob', 'Grep', 'Bash'] },
  },
  direct: { model: '', effort: '', permissionMode: 'acceptEdits' },
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

class Company {
  constructor({ appDir, demo }) {
    this.appDir = appDir;
    this.dataDir = path.join(appDir, 'data');
    this.demo = !!demo;
    const saved = readJson(path.join(this.dataDir, 'settings.json'), {});
    this.settings = deepMerge(DEFAULT_SETTINGS, saved.settings || {});
    this.recent = saved.recent || [];
    this.projectPath = null;
    this.clients = new Set();
    this.agents = {};
    for (const id of Object.keys(ROLES)) this.agents[id] = { id, state: 'idle', bubble: null, at: Date.now() };
    this.agentTimers = {};
    this.convs = new Map();
    this.runs = new Map();
    this.runTranscripts = new Map();
    this.perms = new Map();
    this.feedLog = [];
    this.activeRun = null;
    if (this.demo) this.settings.claudePath = path.join(appDir, 'tools', 'mock-claude.js');
    if (saved.lastProject && fs.existsSync(saved.lastProject)) this.openProject(saved.lastProject);
  }

  // ───────── 공용 ─────────
  saveAppState() {
    const settings = { ...this.settings };
    if (this.demo) delete settings.claudePath;
    writeFile(path.join(this.dataDir, 'settings.json'), JSON.stringify({ settings, recent: this.recent, lastProject: this.projectPath }, null, 2));
  }

  broadcast(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) { try { res.write(payload); } catch { /* noop */ } }
  }

  feed(text, agent = null, tone = 'info') {
    const e = { id: newId('f'), ts: Date.now(), text, agent, tone };
    this.feedLog.push(e);
    if (this.feedLog.length > 200) this.feedLog.shift();
    this.broadcast('feed', e);
  }

  setAgent(id, state, bubble) {
    const a = this.agents[id];
    if (!a) return;
    a.state = state; a.bubble = bubble; a.at = Date.now();
    this.broadcast('agent', a);
    clearTimeout(this.agentTimers[id]);
    if (state === 'done' || state === 'failed') {
      this.agentTimers[id] = setTimeout(() => { if (this.agents[id].state === state) this.setAgent(id, 'idle', null); }, 6000);
    }
  }

  handoff(from, to) { this.broadcast('fx', { kind: 'handoff', from, to }); }
  gather(ids) { this.broadcast('fx', { kind: 'gather', ids }); }
  disperse(ids) { this.broadcast('fx', { kind: 'disperse', ids }); }

  roleSettings(agentId) { return this.settings.roles[agentId] || {}; }

  // ───────── 프로젝트 ─────────
  openProject(p) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('폴더를 찾을 수 없습니다');
    if (this.activeRun && ['running', 'review'].includes(this.activeRun.state.status)) throw new Error('진행 중인 업무가 끝난 뒤 프로젝트를 바꿀 수 있습니다');
    for (const c of this.convs.values()) if (c.session) c.session.close();
    this.projectPath = abs;
    this.recent = [abs, ...this.recent.filter((x) => x !== abs)].slice(0, 8);
    this.convs = new Map();
    this.runs = new Map();
    this.runTranscripts = new Map();
    this.loadProjectData();
    this.saveAppState();
    this.broadcast('reload', {});
  }

  loadProjectData() {
    const chatDir = path.join(this.projectPath, '.company', 'chats');
    if (fs.existsSync(chatDir)) {
      for (const f of fs.readdirSync(chatDir).filter((x) => x.endsWith('.json'))) {
        const d = readJson(path.join(chatDir, f), null);
        if (!d || !d.id) continue;
        const conv = this.makeConv(d.id, d.title, d.createdAt);
        conv.sessionId = d.sessionId || null;
        conv.transcript.items = d.items || [];
        this.convs.set(conv.id, conv);
      }
    }
    const runDir = path.join(this.projectPath, '.company', 'runs');
    if (fs.existsSync(runDir)) {
      for (const f of fs.readdirSync(runDir).filter((x) => x.endsWith('.json'))) {
        const st = readJson(path.join(runDir, f), null);
        if (!st || !st.id) continue;
        if (['running', 'review'].includes(st.status)) st.status = 'cancelled'; // 서버 재시작으로 끊긴 업무
        this.runs.set(st.id, { state: st, archived: true });
      }
    }
  }

  // ───────── 세션 생성 ─────────
  createSession(agentId, opt = {}) {
    const role = { ...this.roleSettings(agentId), ...(opt.override || {}) };
    const sess = new ClaudeSession({
      cwd: this.projectPath,
      claudePath: this.settings.claudePath,
      model: opt.model !== undefined ? opt.model : role.model,
      effort: opt.effort !== undefined ? opt.effort : role.effort,
      permissionMode: opt.permissionMode || role.permissionMode,
      tools: opt.tools,
      allowedTools: role.allowedTools,
      disallowedTools: opt.tools ? [] : (role.disallowedTools || []),
      appendSystemPrompt: opt.systemPrompt,
      jsonSchema: opt.schema,
      resume: opt.resume || undefined,
      name: opt.name,
    });
    const transcript = opt.convId ? this.convs.get(opt.convId).transcript : this.agentTranscript(opt.runId, agentId);
    sess.on('event', (ev) => {
      if (ev.kind === 'permission') {
        this.addPermission({ ev, sess, agentId, runId: opt.runId, convId: opt.convId });
      } else if (ev.kind === 'permission_cancel') {
        for (const p of this.perms.values()) if (p.session === sess && p.requestId === ev.requestId) this.resolvePermissionEntry(p, 'cancelled');
      }
      if (ev.kind === 'stderr' && /error|fail/i.test(ev.text) && !/warn/i.test(ev.text)) {
        this.broadcast('log', { agentId, text: ev.text.slice(0, 500) });
      }
      if (ev.kind === 'init' && opt.convId) {
        const c = this.convs.get(opt.convId);
        if (c) { c.sessionId = ev.sessionId; this.saveConv(c); }
      }
      const change = transcript.onEvent(ev);
      if (change) this.setAgent(agentId, change.state, change.bubble);
      if (ev.kind === 'exit') {
        for (const p of this.perms.values()) if (p.session === sess && p.status === 'pending') this.resolvePermissionEntry(p, 'cancelled');
      }
    });
    sess.start();
    this.setAgent(agentId, 'thinking', '준비 중');
    return sess;
  }

  agentTranscript(runId, agentId) {
    const key = `${runId}:${agentId}`;
    let t = this.runTranscripts.get(key);
    if (!t) {
      t = new Transcript((op, payload) => {
        if (op === 'upsert') this.broadcast('transcript', { runId, agentId, op, item: payload });
        else this.broadcast('transcript', { runId, agentId, op, ...payload });
      });
      this.runTranscripts.set(key, t);
    }
    return t;
  }

  // ───────── 권한 승인 ─────────
  addPermission({ ev, sess, agentId, runId, convId }) {
    const p = {
      id: newId('perm'), session: sess, requestId: ev.requestId, agentId, runId: runId || null, convId: convId || null,
      toolName: ev.toolName, input: ev.input, suggestions: ev.suggestions, reason: ev.reason,
      toolUseId: ev.toolUseId, label: toolLabel(ev.toolName, ev.input), suppressAlways: ev.suppressAlways, defaultToNo: ev.defaultToNo,
      status: 'pending', at: Date.now(),
    };
    this.perms.set(p.id, p);
    this.broadcast('perm', this.publicPerm(p));
    this.feed(`${ROLES[agentId].name}: ${p.label} 승인 요청`, agentId, 'warn');
  }

  publicPerm(p) {
    const { session, ...rest } = p;
    return rest;
  }

  respondPermission(permId, decision, message) {
    const p = this.perms.get(permId);
    if (!p || p.status !== 'pending') throw new Error('이미 처리된 요청입니다');
    if (decision === 'deny') {
      p.session.respondPermission(p.requestId, { behavior: 'deny', message: message || '사용자가 이 도구 사용을 거부했습니다. 다른 방법을 찾거나 이유를 설명하고 멈추세요.', toolUseID: p.toolUseId });
    } else {
      const res = { behavior: 'allow', updatedInput: p.input };
      if (decision === 'always' && !p.suppressAlways && p.suggestions && p.suggestions.length) res.updatedPermissions = p.suggestions;
      p.session.respondPermission(p.requestId, res);
    }
    this.resolvePermissionEntry(p, decision === 'deny' ? 'denied' : 'allowed');
    this.setAgent(p.agentId, 'working', p.label);
  }

  resolvePermissionEntry(p, status) {
    p.status = status;
    this.broadcast('perm', this.publicPerm(p));
    this.perms.delete(p.id);
  }

  // ───────── 대화(직접 작업) ─────────
  makeConv(id, title, createdAt) {
    const conv = { id, title: title || '새 대화', createdAt: createdAt || Date.now(), sessionId: null, session: null, busy: false, idleTimer: null };
    conv.transcript = new Transcript((op, payload) => {
      if (op === 'upsert') this.broadcast('chat', { convId: id, op, item: payload });
      else this.broadcast('chat', { convId: id, op, ...payload });
      if (op === 'upsert' && (payload.done || payload.type !== 'assistant')) this.saveConv(conv);
    });
    return conv;
  }

  newConv() {
    const conv = this.makeConv(newId('conv'));
    this.convs.set(conv.id, conv);
    this.broadcast('convs', this.convList());
    return conv;
  }

  convList() {
    return [...this.convs.values()].sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, busy: c.busy }));
  }

  saveConv(conv) {
    if (!this.projectPath) return;
    try {
      const gi = path.join(this.projectPath, '.company', '.gitignore');
      if (!fs.existsSync(gi)) writeFile(gi, '# 대화 기록과 실행 로그는 커밋하지 않습니다\nchats/\nruns/\n');
      writeFile(path.join(this.projectPath, '.company', 'chats', `${conv.id}.json`),
        JSON.stringify({ id: conv.id, title: conv.title, createdAt: conv.createdAt, sessionId: conv.sessionId, items: conv.transcript.items }, null, 1));
    } catch { /* noop */ }
  }

  requireProject() { if (!this.projectPath) throw new Error('먼저 작업할 프로젝트 폴더를 여세요'); }

  async sendMessage({ convId, text, mode, permissionMode, model }) {
    this.requireProject();
    text = String(text || '').trim();
    if (!text) throw new Error('보낼 내용이 없습니다');
    let conv = convId && this.convs.get(convId);
    if (!conv) conv = this.newConv();
    if (conv.busy) throw new Error('이 대화는 아직 응답 중입니다');
    if (conv.title === '새 대화') { conv.title = text.split('\n')[0].slice(0, 30); this.broadcast('convs', this.convList()); }

    if (mode === 'company') {
      if (this.activeRun && ['running', 'review'].includes(this.activeRun.state.status)) throw new Error('이미 진행 중인 업무가 있습니다. 끝나거나 중지한 뒤 맡겨주세요');
      conv.transcript.addUser(text);
      const run = new Run(this, { request: text, convId: conv.id });
      this.runs.set(run.id, run);
      this.activeRun = run;
      conv.transcript.push({ type: 'run', runId: run.id });
      this.emitRun(run);
      run.start();
      return { convId: conv.id, runId: run.id };
    }

    if (this.activeRun && this.activeRun.state.status === 'running') throw new Error('회사가 업무 중이라 직접 작업은 잠시 막아뒀습니다(같은 파일을 동시에 고치지 않도록). 업무가 검토 단계에 오면 다시 시도하세요');
    conv.transcript.addUser(text);
    const d = this.settings.direct;
    const pm = permissionMode || d.permissionMode;
    const md = model !== undefined ? model : d.model;
    if (!conv.session || conv.session.closed) {
      conv.session = this.createSession('dev', {
        convId: conv.id, systemPrompt: PROMPTS.direct, resume: conv.sessionId, permissionMode: pm, model: md, effort: d.effort,
        name: `직접 · ${conv.title}`,
      });
      conv.pm = pm; conv.model = md;
    } else {
      if (conv.pm !== pm) { conv.session.setPermissionMode(pm); conv.pm = pm; }
      if (conv.model !== md) { conv.session.setModel(md); conv.model = md; }
    }
    conv.busy = true;
    clearTimeout(conv.idleTimer);
    this.broadcast('convs', this.convList());
    conv.session.send(text).catch((e) => conv.transcript.addNotice(e.message, 'error')).finally(() => {
      conv.busy = false;
      this.broadcast('convs', this.convList());
      this.saveConv(conv);
      const mins = Number(this.settings.idleCloseMinutes) || 20;
      conv.idleTimer = setTimeout(() => { if (!conv.busy && conv.session) { conv.session.close(); conv.session = null; } }, mins * 60000);
    });
    return { convId: conv.id };
  }

  stop({ convId, runId }) {
    if (runId) { const r = this.runs.get(runId); if (r && r.cancel) r.cancel(); return; }
    const c = convId && this.convs.get(convId);
    if (c && c.session) c.session.interrupt();
  }

  deleteConv(convId) {
    const c = this.convs.get(convId);
    if (!c) return;
    if (c.session) c.session.close();
    this.convs.delete(convId);
    try { fs.unlinkSync(path.join(this.projectPath, '.company', 'chats', `${convId}.json`)); } catch { /* noop */ }
    this.broadcast('convs', this.convList());
  }

  // ───────── 업무(run) ─────────
  emitRun(run) { this.broadcast('run', run.state); }

  onRunFinished(run) {
    if (this.activeRun === run) this.activeRun = null;
    const conv = this.convs.get(run.state.convId);
    if (conv) this.saveConv(conv);
  }

  getRun(runId) { const r = this.runs.get(runId); if (!r) throw new Error('업무를 찾을 수 없습니다'); return r; }

  runTranscriptItems(runId) {
    const out = {};
    for (const [k, t] of this.runTranscripts) {
      const [rid, agentId] = k.split(':');
      if (rid === runId) out[agentId] = t.items;
    }
    return out;
  }

  // ───────── 스냅샷 ─────────
  snapshot() {
    const convs = {};
    for (const c of this.convs.values()) convs[c.id] = { id: c.id, title: c.title, createdAt: c.createdAt, busy: c.busy, items: c.transcript.items };
    const runs = {};
    for (const r of this.runs.values()) runs[r.state.id] = r.state;
    return {
      demo: this.demo,
      projectPath: this.projectPath,
      isGit: !!(this.projectPath && fs.existsSync(path.join(this.projectPath, '.git'))),
      recent: this.recent,
      settings: this.settings,
      roles: ROLES,
      agents: this.agents,
      convs,
      convList: this.convList(),
      runs,
      activeRunId: this.activeRun ? this.activeRun.id : null,
      perms: [...this.perms.values()].map((p) => this.publicPerm(p)),
      feed: this.feedLog.slice(-60),
      home: os.homedir(),
      platform: process.platform,
    };
  }

  updateSettings(patch) {
    this.settings = deepMerge(this.settings, patch || {});
    if (this.demo) this.settings.claudePath = path.join(this.appDir, 'tools', 'mock-claude.js');
    this.saveAppState();
    this.broadcast('settings', this.settings);
  }
}

module.exports = { Company, DEFAULT_SETTINGS };
