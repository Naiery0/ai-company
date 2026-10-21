'use strict';
// claude.exe(Claude Code CLI)를 headless 모드로 띄우고 stream-json 프로토콜로 대화하는 래퍼.
// - 입력: --input-format stream-json (stdin으로 user 메시지/control 메시지)
// - 출력: --output-format stream-json (stdout NDJSON)
// - 도구 승인: --permission-prompt-tool stdio → control_request(can_use_tool)로 호스트(이 서버)에 질문

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const crypto = require('crypto');

let reqCounter = 0;
const nextReqId = () => `host_${Date.now().toString(36)}_${++reqCounter}`;

function quoteForCmd(arg) {
  // .cmd/.bat 실행 시(shell:true) 최소한의 인용 처리
  if (arg === '') return '""';
  if (!/[\s"&|<>^%()]/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '\\"') + '"';
}

function resolveCommand(claudePath, args) {
  const p = claudePath || 'claude';
  const ext = path.extname(p).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return { cmd: process.execPath, args: [p, ...args], shell: false };
  }
  if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    return { cmd: quoteForCmd(p), args: args.map(quoteForCmd), shell: true };
  }
  return { cmd: p, args, shell: false };
}

class ClaudeSession extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.cwd 작업 폴더
   * @param {string} [o.claudePath]
   * @param {string} [o.model]
   * @param {string} [o.effort]
   * @param {string} [o.permissionMode]
   * @param {string[]} [o.tools] 사용 가능 도구 제한(예: ['Read','Glob','Grep'])
   * @param {string[]} [o.allowedTools] 승인 없이 허용할 규칙
   * @param {string[]} [o.disallowedTools]
   * @param {string} [o.appendSystemPrompt]
   * @param {object} [o.jsonSchema] 구조화 출력 스키마
   * @param {string} [o.resume] 이어갈 session_id
   * @param {string} [o.name] 세션 표시 이름
   */
  constructor(o) {
    super();
    this.o = o;
    this.proc = null;
    this.sessionId = o.resume || null;
    this.buf = '';
    this.pendingTurn = null; // {resolve,reject}
    this.closed = false;
    this.busy = false;
    this.streamedMsgIds = new Set();
    this.stderrTail = '';
  }

  buildArgs() {
    const o = this.o;
    const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio'];
    if (o.model) a.push('--model', o.model);
    if (o.effort) a.push('--effort', o.effort);
    if (o.permissionMode) a.push('--permission-mode', o.permissionMode);
    if (Array.isArray(o.tools)) {
      if (o.tools.length) a.push('--tools', o.tools.join(','));
      else a.push('--tools', ''); // 빈 배열 = 도구 없이 답만
    }
    if (o.appendSystemPrompt) a.push('--append-system-prompt', o.appendSystemPrompt);
    if (o.jsonSchema) a.push('--json-schema', JSON.stringify(o.jsonSchema));
    if (o.resume) a.push('--resume', o.resume);
    if (o.name) a.push('-n', o.name);
    if (o.disallowedTools && o.disallowedTools.length) a.push('--disallowedTools', ...o.disallowedTools);
    if (o.allowedTools && o.allowedTools.length) a.push('--allowedTools', ...o.allowedTools);
    return a;
  }

  start() {
    if (this.proc) return;
    const { cmd, args, shell } = resolveCommand(this.o.claudePath, this.buildArgs());
    const env = { ...process.env };
    // 이 도구는 구독 로그인(claude.exe 자체 인증)을 사용한다. 실수로 API 키가 쓰이지 않게 비운다.
    if (!this.o.keepApiKey) delete env.ANTHROPIC_API_KEY;
    // 서브에이전트를 포그라운드로: 백그라운드(2.1.x 기본)면 일이 끝나기 전에 result가 와서 다음 단계로 넘어가 버린다.
    env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
    this.proc = spawn(cmd, args, { cwd: this.o.cwd, env, shell, windowsHide: true });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this.onData(d));
    this.proc.stderr.on('data', (d) => {
      this.stderrTail = (this.stderrTail + d).slice(-4000);
      this.emit('event', { kind: 'stderr', text: d });
    });
    this.proc.on('error', (err) => {
      this.emit('event', { kind: 'error', text: `claude 실행 실패: ${err.message}` });
      this.failTurn(new Error(`claude 실행 실패 (${err.code || err.message}). 설정에서 claude 경로를 확인하세요.`));
    });
    this.proc.on('exit', (code, signal) => {
      this.closed = true;
      this.proc = null;
      this.emit('event', { kind: 'exit', code, signal });
      if (this.pendingTurn) {
        const tail = this.stderrTail.trim().split('\n').slice(-3).join(' / ');
        this.failTurn(new Error(`claude 프로세스가 응답 전에 종료됨 (code ${code})${tail ? ': ' + tail : ''}`));
      }
    });
    // SDK와 동일하게 initialize 를 먼저 보낸다.
    this.write({ type: 'control_request', request_id: nextReqId(), request: { subtype: 'initialize' } });
  }

  write(obj) {
    if (!this.proc || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  /** 사용자 턴을 보내고 result 이벤트까지 기다린다. */
  send(text) {
    if (this.closed) return Promise.reject(new Error('세션이 이미 종료됨'));
    if (!this.proc) this.start();
    if (this.pendingTurn) return Promise.reject(new Error('이전 턴이 아직 진행 중'));
    this.busy = true;
    return new Promise((resolve, reject) => {
      this.pendingTurn = { resolve, reject };
      this.write({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
        session_id: this.sessionId || '',
      });
    });
  }

  failTurn(err) {
    const t = this.pendingTurn;
    this.pendingTurn = null;
    this.busy = false;
    if (t) t.reject(err);
  }

  respondPermission(requestId, result) {
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: result } });
  }

  setPermissionMode(mode) {
    this.write({ type: 'control_request', request_id: nextReqId(), request: { subtype: 'set_permission_mode', mode } });
  }

  setModel(model) {
    this.write({ type: 'control_request', request_id: nextReqId(), request: { subtype: 'set_model', model: model || undefined } });
  }

  /** 진행 중인 턴을 중단. 응답이 없으면 프로세스를 종료한다. */
  interrupt() {
    if (!this.proc) return;
    this.write({ type: 'control_request', request_id: nextReqId(), request: { subtype: 'interrupt' } });
    const p = this.proc;
    setTimeout(() => { if (this.pendingTurn && this.proc === p) this.kill(); }, 4000);
  }

  kill() {
    if (!this.proc) return;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.proc.pid), '/t', '/f'], { windowsHide: true });
      else this.proc.kill('SIGTERM');
    } catch { /* noop */ }
  }

  close() {
    if (!this.proc) { this.closed = true; return; }
    try { this.proc.stdin.end(); } catch { /* noop */ }
    const p = this.proc;
    setTimeout(() => { if (this.proc === p) this.kill(); }, 3000);
  }

  onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.emit('event', { kind: 'stderr', text: line }); continue; }
      try { this.handle(msg); } catch (e) { this.emit('event', { kind: 'error', text: String(e && e.stack || e) }); }
    }
  }

  handle(m) {
    if (m.session_id && !this.sessionId) this.sessionId = m.session_id;
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.sessionId = m.session_id || this.sessionId;
          this.emit('event', { kind: 'init', sessionId: this.sessionId, model: m.model, permissionMode: m.permissionMode, cwd: m.cwd });
        }
        return;
      case 'stream_event': {
        if (m.parent_tool_use_id) return; // 서브에이전트 내부 스트림은 생략
        const ev = m.event || {};
        if (ev.type === 'message_start') {
          const id = ev.message && ev.message.id;
          if (id) this.streamedMsgIds.add(id);
          this.emit('event', { kind: 'message_start', messageId: id });
        } else if (ev.type === 'content_block_start') {
          const cb = ev.content_block || {};
          if (cb.type === 'tool_use') this.emit('event', { kind: 'tool_start', id: cb.id, name: cb.name, index: ev.index });
          else if (cb.type === 'text') this.emit('event', { kind: 'text_start', index: ev.index });
          else if (cb.type === 'thinking') this.emit('event', { kind: 'thinking_start' });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta || {};
          if (d.type === 'text_delta') this.emit('event', { kind: 'text_delta', text: d.text, index: ev.index });
        }
        return;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return;
        const msg = m.message || {};
        const streamed = msg.id && this.streamedMsgIds.has(msg.id);
        this.emit('event', { kind: 'assistant', messageId: msg.id, streamed, content: msg.content || [], model: msg.model });
        return;
      }
      case 'user': {
        if (m.parent_tool_use_id) return;
        const content = (m.message && m.message.content) || [];
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === 'tool_result') {
              let text = '';
              if (typeof c.content === 'string') text = c.content;
              else if (Array.isArray(c.content)) text = c.content.map((x) => (x.type === 'text' ? x.text : `[${x.type}]`)).join('\n');
              this.emit('event', { kind: 'tool_result', toolUseId: c.tool_use_id, text: text.slice(0, 6000), isError: !!c.is_error });
            }
          }
        }
        return;
      }
      case 'result': {
        this.busy = false;
        const r = {
          kind: 'result',
          subtype: m.subtype,
          isError: !!m.is_error,
          text: m.result || '',
          structured: m.structured_output,
          costUsd: m.total_cost_usd || 0,
          durationMs: m.duration_ms || 0,
          numTurns: m.num_turns || 0,
          usage: m.usage || null,
          permissionDenials: m.permission_denials || [],
          terminalReason: m.terminal_reason,
          sessionId: m.session_id || this.sessionId,
        };
        this.emit('event', r);
        const t = this.pendingTurn;
        this.pendingTurn = null;
        if (t) t.resolve(r);
        return;
      }
      case 'control_request': {
        const req = m.request || {};
        if (req.subtype === 'can_use_tool') {
          this.emit('event', {
            kind: 'permission',
            requestId: m.request_id,
            toolName: req.tool_name,
            input: req.input || {},
            suggestions: req.permission_suggestions || [],
            reason: req.decision_reason || '',
            title: req.title || '',
            toolUseId: req.tool_use_id,
            suppressAlways: !!req.suppress_always_allow_rule,
            defaultToNo: !!req.default_to_no,
          });
        } else {
          // 이 호스트가 지원하지 않는 요청은 오류로 응답(무한 대기 방지)
          this.write({ type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `unsupported: ${req.subtype}` } });
        }
        return;
      }
      case 'control_cancel_request':
        this.emit('event', { kind: 'permission_cancel', requestId: m.request_id });
        return;
      default:
        return; // control_response, keep_alive 등은 무시
    }
  }
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

module.exports = { ClaudeSession, resolveCommand, newId };
