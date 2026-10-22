'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ClaudeSession, probeInit, newId } = require('./claude');
const { Transcript, toolLabel } = require('./transcript');
const { Run } = require('./pipeline');
const { ROLES, PROMPTS, SCHEMAS, READ_ONLY_TOOLS } = require('./roles');
const { readJson, writeFile, appendFile, structuredFrom, git } = require('./util');

const SAFE_BASH = [
  'Bash(npm test *)', 'Bash(npm run *)', 'Bash(npx tsc *)', 'Bash(npx vitest *)', 'Bash(npx jest *)',
  'Bash(pnpm test *)', 'Bash(pnpm run *)', 'Bash(yarn test *)', 'Bash(yarn run *)',
  'Bash(pytest *)', 'Bash(python -m pytest *)', 'Bash(go test *)', 'Bash(cargo test *)', 'Bash(cargo build *)',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(ls *)', 'Bash(dir *)',
];

const DEFAULT_SETTINGS = {
  claudePath: 'claude',
  maxQaRounds: 3,
  checkCommand: '', // 단독 업무 후 코드가 직접 돌릴 확인 명령. 비우면 package.json의 test 스크립트를 찾아 씀
  autoCommit: true,
  forceMode: 'auto', // auto(대표 판단) | chat | solo | team
  idleCloseMinutes: 20,
  roles: {
    ceo: { model: 'sonnet', effort: 'low', permissionMode: 'manual', allowedTools: [] }, // 판단은 빠르고 가볍게
    planner: { model: 'opus', effort: 'high', permissionMode: 'manual', allowedTools: [] },
    dev: { model: 'opus', effort: 'high', permissionMode: 'auto', allowedTools: SAFE_BASH },
    qa: { model: 'opus', effort: 'high', permissionMode: 'auto', allowedTools: SAFE_BASH, tools: ['Read', 'Glob', 'Grep', 'Bash'] },
  },
  direct: { model: '', effort: '', permissionMode: 'auto' }, // 자동 판단: 평소 Claude Code 기본값과 같게(위험해 보이는 것만 묻는다)
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
    this.subs = new Map(); // 진행 중인 서브에이전트(사무실의 임시 직원)
    this.commands = []; // Claude Code 슬래시 명령 목록(입력창 자동 완성)
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
    this.flushSaves();
    for (const c of this.convs.values()) if (c.session) c.session.close();
    this.projectPath = abs;
    this.recent = [abs, ...this.recent.filter((x) => x !== abs)].slice(0, 8);
    this.convs = new Map();
    this.runs = new Map();
    this.runTranscripts = new Map();
    this.loadProjectData();
    this.saveAppState();
    this.refreshCommands().catch(() => {});
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
        conv.route = d.route || null;
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
      if (ev.kind === 'init_info') this.setCommands(ev.info);
      if (ev.kind === 'init' && opt.convId) {
        const c = this.convs.get(opt.convId);
        if (c) { c.sessionId = ev.sessionId; this.saveConv(c); }
      }
      const change = transcript.onEvent(ev);
      if (change) this.setAgent(agentId, change.state, change.bubble);
      this.trackSubagents(ev, sess, agentId);
      if (ev.kind === 'exit') {
        for (const p of this.perms.values()) if (p.session === sess && p.status === 'pending') this.resolvePermissionEntry(p, 'cancelled');
      }
    });
    sess.start();
    this.setAgent(agentId, 'thinking', '준비 중');
    return sess;
  }

  /** 서브에이전트(Agent/Task 도구) 시작·끝을 사무실에 알린다(임시 직원으로 표시). */
  trackSubagents(ev, sess, agentId) {
    const end = (id) => { this.subs.delete(id); this.broadcast('fx', { kind: 'sub-end', id }); };
    if (ev.kind === 'assistant') {
      for (const b of ev.content || []) {
        if (b.type !== 'tool_use' || !['Agent', 'Task'].includes(b.name) || this.subs.has(b.id)) continue;
        const input = b.input || {};
        const sub = { id: b.id, agentId, label: String(input.description || input.subagent_type || '조사').slice(0, 24), session: sess };
        this.subs.set(b.id, sub);
        this.broadcast('fx', { kind: 'sub-start', id: sub.id, agentId, label: sub.label });
      }
    } else if (ev.kind === 'tool_result' && this.subs.has(ev.toolUseId)) {
      end(ev.toolUseId);
    } else if (ev.kind === 'exit') {
      for (const s of [...this.subs.values()]) if (s.session === sess) end(s.id);
    }
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

  // ───────── 대화 ─────────
  makeConv(id, title, createdAt) {
    const conv = { id, title: title || '새 대화', createdAt: createdAt || Date.now(), sessionId: null, session: null, busy: false, idleTimer: null, queue: [] };
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

  /** 대화 저장은 0.4초 묶어서 쓴다(스트리밍 중 항목마다 전체 파일을 다시 쓰지 않게). */
  saveConv(conv) {
    if (!this.projectPath) return;
    const dir = this.projectPath; // 그 사이 프로젝트가 바뀌어도 원래 프로젝트에 쓴다
    clearTimeout(conv.saveTimer);
    conv.saveFlush = () => { clearTimeout(conv.saveTimer); conv.saveFlush = null; this.writeConv(conv, dir); };
    conv.saveTimer = setTimeout(conv.saveFlush, 400);
  }

  writeConv(conv, dir) {
    try {
      const gi = path.join(dir, '.company', '.gitignore');
      if (!fs.existsSync(gi)) writeFile(gi, '# 대화 기록과 실행 로그는 커밋하지 않습니다\nchats/\nruns/\n');
      writeFile(path.join(dir, '.company', 'chats', `${conv.id}.json`),
        JSON.stringify({ id: conv.id, title: conv.title, createdAt: conv.createdAt, sessionId: conv.sessionId, route: conv.route || null, items: conv.transcript.items }, null, 1));
    } catch { /* noop */ }
  }

  /** 아직 쓰지 않은 대화 저장을 바로 쓴다(프로젝트 전환·서버 종료 시). */
  flushSaves() {
    for (const c of this.convs.values()) if (c.saveFlush) c.saveFlush();
  }

  requireProject() { if (!this.projectPath) throw new Error('먼저 작업할 프로젝트 폴더를 여세요'); }

  /** 실패한 마지막 메시지를 다시 보낸다(원인을 고친 뒤 같은 요청을 다시 입력하지 않아도 되게). */
  retryLast(convId) {
    const conv = this.convs.get(convId);
    if (!conv) throw new Error('대화를 찾을 수 없습니다');
    if (conv.busy) throw new Error('이 대화는 아직 응답 중입니다');
    const last = [...conv.transcript.items].reverse().find((x) => x.type === 'user');
    if (!last) throw new Error('다시 보낼 메시지가 없습니다');
    conv.transcript.addNotice('다시 보냅니다', 'info');
    return this.sendMessage({ convId, text: last.text, retry: true });
  }

  /** 진행 중이거나 사람의 결재를 기다리는 일이 있는가(서버 자동 종료 판단용). */
  isBusy() {
    if (this.activeRun && ['running', 'review'].includes(this.activeRun.state.status)) return true;
    for (const c of this.convs.values()) if (c.busy) return true;
    return false;
  }

  // ───────── 슬래시 명령 ─────────
  isSlashCommand(text) {
    const m = /^\/([\w:.-]+)(\s|$)/.exec(text);
    return !!(m && this.commands.some((c) => c.name === m[1]));
  }

  /** 지금 프로젝트에서 쓸 수 있는 Claude Code 명령 목록을 받아 온다(initialize만 보내므로 사용량 0). */
  async refreshCommands() {
    if (!this.projectPath) return;
    const seq = (this.cmdSeq = (this.cmdSeq || 0) + 1);
    const info = await probeInit({ claudePath: this.settings.claudePath, cwd: this.projectPath });
    if (seq !== this.cmdSeq) return; // 그 사이 프로젝트·경로가 바뀜
    this.setCommands(info);
  }

  setCommands(info) {
    if (!info || !Array.isArray(info.commands)) return;
    this.commands = info.commands
      .filter((c) => c && c.name && !/^__/.test(c.name) && !/^\(removed\)|^Renamed/.test(c.description || ''))
      .map((c) => ({ name: c.name, hint: c.argumentHint || '', description: String(c.description || '').slice(0, 140) }));
    this.broadcast('commands', this.commands);
  }

  /**
   * 입력창은 하나. 대표가 메시지마다 처리 방식을 정한다.
   * - chat: 개발자와 대화(평소 Claude Code처럼). 이어지는 메시지는 판단 없이 같은 세션으로 보낸다.
   * - solo / team: 회사 업무(run)로 진행.
   */
  async sendMessage({ convId, text, permissionMode, model, retry = false }) {
    this.requireProject();
    text = String(text || '').trim();
    if (!text) throw new Error('보낼 내용이 없습니다');
    let conv = convId && this.convs.get(convId);
    if (!conv) conv = this.newConv();
    const isCommand = this.isSlashCommand(text);
    if (conv.busy) {
      // 개발자와 대화 중이면 막지 않고 대기열에 넣었다가 응답이 끝나면 이어서 보낸다
      if (conv.route === 'chat' && conv.session && !conv.triageSession) {
        conv.transcript.addUser(text);
        conv.queue.push({ text, opts: { permissionMode, model } });
        return { convId: conv.id, queued: true };
      }
      throw new Error('이 대화는 아직 응답 중입니다');
    }
    const run = this.activeRun;
    if (run && run.state.status === 'running') throw new Error('회사가 업무를 처리하는 중입니다. 같은 파일을 동시에 고치지 않도록 끝날 때까지 기다리거나 업무를 중지하세요');
    if (conv.title === '새 대화') { conv.title = text.split('\n')[0].slice(0, 30); this.broadcast('convs', this.convList()); }
    if (!retry) conv.transcript.addUser(text);
    const opts = { permissionMode, model };

    // 대화 중인 흐름이면 판단 없이 이어서 보낸다(“아니 그거 말고”에 대표가 끼어들지 않게).
    // 세션이 한 번도 실제로 시작되지 못했으면(실행 실패 등) 다시 판단한다.
    const chatAlive = conv.sessionId || (conv.session && !conv.session.closed);
    if (conv.route === 'chat' && chatAlive) { this.sendChat(conv, text, opts); return { convId: conv.id }; }
    // Claude Code 슬래시 명령은 판단 없이 개발자 세션에 그대로 전달한다
    if (isCommand) {
      if (conv.route !== 'chat') conv.transcript.push({ type: 'route', route: 'chat', reason: '명령어는 개발 팀장 세션에 바로 전달합니다', forced: true });
      conv.route = 'chat';
      this.sendChat(conv, text, opts);
      return { convId: conv.id };
    }
    // 결재 대기 중에는 회사 업무를 새로 열 수 없으므로 대화로 처리(결과물을 함께 다듬는 용도)
    if (run && run.state.status === 'review') {
      conv.transcript.push({ type: 'route', route: 'chat', reason: '결재 대기 중인 업무가 있어 대화로 처리합니다', forced: true });
      this.sendChat(conv, text, opts);
      return { convId: conv.id };
    }

    conv.busy = true;
    this.broadcast('convs', this.convList());
    (async () => {
      let t;
      const forced = this.settings.forceMode;
      if (['chat', 'solo', 'team'].includes(forced)) t = { route: forced, title: text.split('\n')[0].slice(0, 20), reason: '설정에서 처리 방식을 고정해 두었습니다', forced: true };
      else t = await this.triage(conv, text);
      conv.busy = false;
      if (conv.cancelTriage) { conv.cancelTriage = false; conv.transcript.addNotice('중지했습니다', 'warn'); this.broadcast('convs', this.convList()); return; }
      conv.route = t.route;
      // 판단 비용: 대화로 가면 여기에, 업무로 가면 업무의 역할별 비용(대표)에 기록한다
      conv.transcript.push({ type: 'route', route: t.route, reason: t.reason, forced: !!t.forced, costUsd: t.route === 'chat' ? t.costUsd || 0 : 0 });
      this.feed(`처리 방식: ${t.route === 'chat' ? '대화' : t.route === 'solo' ? '단독' : '팀'} · ${t.reason}`, 'ceo');
      if (t.route === 'chat') { this.sendChat(conv, text, opts); return; }
      if (this.activeRun && ['running', 'review'].includes(this.activeRun.state.status)) {
        conv.transcript.addNotice('다른 업무가 진행 중이라 시작하지 못했습니다. 끝난 뒤 다시 보내주세요', 'error');
        this.broadcast('convs', this.convList());
        return;
      }
      const r = new Run(this, { request: text, convId: conv.id, triage: t });
      this.runs.set(r.id, r);
      this.activeRun = r;
      conv.transcript.push({ type: 'run', runId: r.id });
      this.broadcast('convs', this.convList());
      this.emitRun(r);
      r.start();
    })().catch((e) => { conv.busy = false; conv.transcript.addNotice(e.message, 'error'); this.broadcast('convs', this.convList()); });
    return { convId: conv.id };
  }

  /** 대표의 처리 방식 판단. 실패하면 가장 가벼운 '대화'로 진행한다. */
  async triage(conv, text) {
    const sess = this.createSession('ceo', {
      systemPrompt: PROMPTS.ceo, schema: SCHEMAS.triage, tools: READ_ONLY_TOOLS, runId: 'triage', name: `대표 판단 · ${conv.title}`,
    });
    conv.triageSession = sess;
    this.agentTranscript('triage', 'ceo').addNotice('처리 방식 판단', 'stage');
    try {
      const r = await sess.send(`다음 메시지의 처리 방식을 정하세요.\n\n<메시지>\n${text}\n</메시지>`);
      const t = structuredFrom(r);
      if (!t || !['chat', 'solo', 'team'].includes(t.route)) throw new Error('판단 결과를 읽지 못함');
      this.setAgent('ceo', 'done', t.route === 'chat' ? '대화로' : t.route === 'solo' ? '단독으로' : '팀으로');
      return { route: t.route, title: t.title || text.slice(0, 20), reason: t.reason || '', costUsd: r.costUsd || 0 };
    } catch (e) {
      this.setAgent('ceo', 'idle', null);
      return { route: 'chat', title: text.slice(0, 20), reason: `판단에 실패해 대화로 진행합니다(${e.message})` };
    } finally {
      conv.triageSession = null;
      sess.close();
    }
  }

  sendChat(conv, text, { permissionMode, model } = {}) {
    const d = this.settings.direct;
    const pm = permissionMode || d.permissionMode;
    const md = model !== undefined ? model : d.model;
    if (!conv.session || conv.session.closed) {
      conv.session = this.createSession('dev', {
        convId: conv.id, systemPrompt: PROMPTS.direct, resume: conv.sessionId, permissionMode: pm, model: md, effort: d.effort,
        name: `대화 · ${conv.title}`,
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
      const next = conv.queue.shift();
      if (next) {
        const run = this.activeRun;
        if (run && run.state.status === 'running') {
          conv.transcript.addNotice(`회사 업무가 시작되어 대기 중이던 메시지 ${conv.queue.length + 1}개를 보내지 않았습니다`, 'warn');
          conv.queue = [];
        } else { this.sendChat(conv, next.text, next.opts); return; }
      }
      this.broadcast('convs', this.convList());
      this.saveConv(conv);
      const mins = Number(this.settings.idleCloseMinutes) || 20;
      conv.idleTimer = setTimeout(() => { if (!conv.busy && conv.session) { conv.session.close(); conv.session = null; } }, mins * 60000);
    });
  }

  stop({ convId, runId }) {
    if (runId) { const r = this.runs.get(runId); if (r && r.cancel) r.cancel(); return; }
    const c = convId && this.convs.get(convId);
    if (!c) return;
    if (c.triageSession) { c.cancelTriage = true; c.triageSession.interrupt(); return; }
    if (c.queue.length) { c.transcript.addNotice(`대기 중이던 메시지 ${c.queue.length}개를 보내지 않았습니다`, 'warn'); c.queue = []; }
    if (c.session) c.session.interrupt();
  }

  deleteConv(convId) {
    const c = this.convs.get(convId);
    if (!c) return;
    clearTimeout(c.saveTimer);
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

  /** 업무를 폐기: 업무 시작 이후 바뀐 파일을 시작 시점으로 되돌린다. 결재 대기 중이거나, 실패·중지된 마지막 업무만. */
  async discardRun(runId) {
    const r = this.getRun(runId);
    const st = r.state;
    if (!st.baseTree) throw new Error('업무 시작 시점 기록이 없어 되돌릴 수 없습니다');
    if (st.status === 'review') { r.discard(); return; }
    if (!['failed', 'cancelled'].includes(st.status)) throw new Error('진행 중이거나 이미 끝난 업무는 폐기할 수 없습니다');
    const latest = [...this.runs.values()].sort((a, b) => b.state.createdAt - a.state.createdAt)[0];
    if (latest !== r) throw new Error('이후에 진행한 업무가 있어 되돌릴 수 없습니다');
    await this.discardChanges(r);
  }

  async discardChanges(run) {
    const st = run.state;
    const changed = await git.restoreTo(this.projectPath, st.baseTree);
    const n = changed.filter((c) => !c.path.split('/').includes('.company')).length; // 회사 문서는 빼고 센다
    st.status = 'discarded';
    st.stage = 'done';
    const dir = path.join(this.projectPath, '.company');
    appendFile(path.join(dir, 'progress.md'), `- 폐기: ${st.title} (바뀐 파일 ${n}개를 시작 전으로 되돌림)\n`);
    writeFile(path.join(dir, 'runs', `${st.id}.json`), JSON.stringify(st, null, 2));
    this.feed(`폐기했습니다. 바뀐 파일 ${n}개를 업무 시작 전으로 되돌렸습니다`, 'ceo', 'warn');
    this.emitRun(run);
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
      subs: [...this.subs.values()].map(({ session, ...s }) => s),
      commands: this.commands,
      feed: this.feedLog.slice(-60),
      home: os.homedir(),
      platform: process.platform,
    };
  }

  updateSettings(patch) {
    const prevPath = this.settings.claudePath;
    this.settings = deepMerge(this.settings, patch || {});
    if (this.demo) this.settings.claudePath = path.join(this.appDir, 'tools', 'mock-claude.js');
    this.saveAppState();
    this.broadcast('settings', this.settings);
    if (this.settings.claudePath !== prevPath) this.refreshCommands().catch(() => {});
  }
}

module.exports = { Company, DEFAULT_SETTINGS };
