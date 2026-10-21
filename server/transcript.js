'use strict';
// ClaudeSession 이벤트 → 화면에 그릴 항목(items)으로 변환.
// item 종류: user | assistant(blocks: text/tool) | notice | perm | run
const { newId } = require('./claude');

function toolLabel(name, input) {
  input = input || {};
  const short = (s, n = 48) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  switch (name) {
    case 'Bash': case 'PowerShell': return `${name}: ${short(input.command)}`;
    case 'Read': return `읽기: ${base(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `수정: ${base(input.file_path)}`;
    case 'Write': return `작성: ${base(input.file_path)}`;
    case 'Glob': return `찾기: ${short(input.pattern, 32)}`;
    case 'Grep': return `검색: ${short(input.pattern, 32)}`;
    case 'WebSearch': return `웹 검색: ${short(input.query, 32)}`;
    case 'WebFetch': return `웹 열기: ${short(input.url, 36)}`;
    case 'Task': case 'Agent': return `서브에이전트: ${short(input.description || input.subagent_type, 30)}`;
    case 'TodoWrite': return '할 일 정리';
    default: return name;
  }
}

class Transcript {
  /** @param {(type:string, payload:object)=>void} emit */
  constructor(emit) {
    this.items = [];
    this.emit = emit;
    this.live = null; // 현재 스트리밍 중인 assistant item
    this.toolIndex = new Map(); // toolUseId → {item, block}
  }

  push(item) {
    item.id = item.id || newId('it');
    item.ts = item.ts || Date.now();
    this.items.push(item);
    this.emit('upsert', item);
    return item;
  }

  update(item) { this.emit('upsert', item); }

  addUser(text) { return this.push({ type: 'user', text }); }
  addNotice(text, tone = 'info') { return this.push({ type: 'notice', text, tone }); }

  ensureLive() {
    if (!this.live) this.live = this.push({ type: 'assistant', blocks: [] });
    return this.live;
  }

  /** 세션 이벤트 처리. 화면용 상태 변화를 반환(사무실 애니메이션용). */
  onEvent(ev) {
    switch (ev.kind) {
      case 'message_start':
        this.ensureLive();
        return { state: 'thinking', bubble: '생각 중…' };
      case 'thinking_start':
        return { state: 'thinking', bubble: '생각 중…' };
      case 'text_start': {
        const it = this.ensureLive();
        it.blocks.push({ type: 'text', text: '' });
        this.update(it);
        return { state: 'working', bubble: '작성 중' };
      }
      case 'text_delta': {
        const it = this.ensureLive();
        let last = it.blocks[it.blocks.length - 1];
        if (!last || last.type !== 'text') {
          it.blocks.push({ type: 'text', text: ev.text });
          this.update(it);
          return null;
        }
        last.text += ev.text;
        this.emit('delta', { itemId: it.id, blockIndex: it.blocks.length - 1, text: ev.text });
        return null;
      }
      case 'tool_start': {
        const it = this.ensureLive();
        const block = { type: 'tool', id: ev.id, name: ev.name, input: null, result: null, isError: false, label: ev.name };
        it.blocks.push(block);
        this.toolIndex.set(ev.id, { item: it, block });
        this.update(it);
        return { state: 'working', bubble: ev.name };
      }
      case 'assistant': {
        // 스트리밍으로 이미 받은 메시지는 도구 입력만 보강, 아니면 통째로 추가
        if (ev.streamed) {
          let changed = null;
          for (const c of ev.content) {
            if (c.type === 'tool_use') {
              const ref = this.toolIndex.get(c.id);
              if (ref) { ref.block.input = c.input; ref.block.label = toolLabel(c.name, c.input); changed = ref; }
            }
          }
          if (changed) { this.update(changed.item); return { state: 'working', bubble: changed.block.label }; }
          return null;
        }
        const it = this.ensureLive();
        let bubble = null;
        for (const c of ev.content) {
          if (c.type === 'text' && c.text) it.blocks.push({ type: 'text', text: c.text });
          if (c.type === 'tool_use') {
            const block = { type: 'tool', id: c.id, name: c.name, input: c.input, result: null, isError: false, label: toolLabel(c.name, c.input) };
            it.blocks.push(block);
            this.toolIndex.set(c.id, { item: it, block });
            bubble = block.label;
          }
        }
        this.update(it);
        return bubble ? { state: 'working', bubble } : null;
      }
      case 'tool_result': {
        const ref = this.toolIndex.get(ev.toolUseId);
        if (ref) {
          ref.block.result = ev.text;
          ref.block.isError = ev.isError;
          this.update(ref.item);
        }
        // 도구 결과 뒤에 이어지는 응답은 새 말풍선이 아니라 같은 턴으로 이어 붙인다
        return null;
      }
      case 'result': {
        const it = this.live;
        this.live = null;
        if (it) {
          it.done = true;
          it.meta = { costUsd: ev.costUsd, durationMs: ev.durationMs, numTurns: ev.numTurns, isError: ev.isError };
          if (ev.isError && ev.text && !it.blocks.some((b) => b.type === 'text' && b.text.includes(ev.text))) {
            it.blocks.push({ type: 'text', text: ev.text });
          }
          this.update(it);
        } else if (ev.isError) {
          this.addNotice(ev.text || '오류로 종료됨', 'error');
        }
        if (ev.permissionDenials && ev.permissionDenials.length) {
          const names = [...new Set(ev.permissionDenials.map((d) => d.tool_name))].join(', ');
          this.addNotice(`거부된 도구 사용: ${names}. 필요하면 설정에서 허용 규칙을 추가하거나 다시 요청하세요.`, 'warn');
        }
        return { state: ev.isError ? 'failed' : 'done', bubble: ev.isError ? '오류' : '완료' };
      }
      case 'permission':
        return { state: 'waiting', bubble: '승인 필요' };
      case 'error':
        this.addNotice(ev.text, 'error');
        return { state: 'failed', bubble: '오류' };
      default:
        return null;
    }
  }
}

module.exports = { Transcript, toolLabel };
