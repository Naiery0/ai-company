#!/usr/bin/env node
'use strict';
// 데모/테스트용 가짜 claude. 실제 claude.exe와 같은 stream-json 프로토콜을 흉내 낸다.
// 사용량을 쓰지 않고 UI와 파이프라인 흐름을 확인할 때 쓴다(npm run demo).
const crypto = require('crypto');
const readline = require('readline');

const argv = process.argv.slice(2);
if (argv.includes('--version')) { console.log('0.0.0 (mock claude · 데모)'); process.exit(0); }
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const schema = arg('--json-schema') ? JSON.parse(arg('--json-schema')) : null;
const sys = arg('--append-system-prompt') || '';
const sessionId = arg('--resume') || crypto.randomUUID();
let initSent = false;
let pending = new Map();
let aborted = false;
let turn = 0;

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => 'msg_' + crypto.randomBytes(6).toString('hex');

function props() { return schema && schema.properties ? Object.keys(schema.properties) : []; }

function structured(prompt) {
  const p = props();
  if (p.includes('route')) {
    const m = (prompt.match(/<메시지>([\s\S]*?)<\/메시지>/) || [, prompt])[1];
    if (/\?|뭐|어디|왜|설명|알려/.test(m)) return { route: 'chat', title: '질문', reason: '설명을 구하는 질문이라 대화로 바로 답하면 됩니다.' };
    if (/오타|한 줄|작은|간단|버그|고쳐/.test(m)) return { route: 'solo', title: '간단 수정', reason: '범위가 한정된 수정이라 개발자 단독 처리로 충분합니다.' };
    return { route: 'team', title: '할 일 앱 만들기', reason: '여러 기능이 필요한 신규 구축이라 명세와 독립 검증이 품질을 좌우합니다.' };
  }
  if (p.includes('features')) {
    return {
      title: '할 일 관리 앱', summary: '사용자가 할 일을 추가·완료·삭제하고, 새로고침 후에도 목록이 유지되는 간단한 웹 앱입니다.', stackNotes: '빈 저장소. 별도 프레임워크 없이 HTML/JS로 시작합니다.',
      features: [
        { id: 'F1', title: '할 일 추가', description: '입력창에서 할 일을 추가한다.', acceptance: ['엔터로 추가된다', '빈 입력은 추가되지 않는다'] },
        { id: 'F2', title: '완료 표시', description: '체크로 완료 상태를 토글한다.', acceptance: ['완료 항목은 취소선으로 표시된다'] },
        { id: 'F3', title: '저장 유지', description: '새로고침 후에도 목록이 유지된다.', acceptance: ['새로고침 후 같은 목록이 보인다'] },
      ],
      outOfScope: ['로그인', '서버 동기화'],
    };
  }
  if (p.includes('items')) {
    return { testCommand: 'npm test', items: [
      { featureId: 'F1', approach: 'form submit 핸들러에서 trim 후 추가', verification: ['단위 테스트: 빈 문자열 거부'] },
      { featureId: 'F2', approach: 'checkbox change 이벤트로 done 토글', verification: ['DOM 테스트: 클래스 토글 확인'] },
      { featureId: 'F3', approach: 'localStorage 직렬화', verification: ['저장/복원 함수 단위 테스트'] },
    ] };
  }
  if (p.includes('criteria')) {
    return { notes: '개발자 제안에 빈 입력 공백 문자열 케이스를 추가했습니다.', criteria: [
      { id: 'C1', featureId: 'F1', check: '엔터로 할 일이 추가된다', how: '테스트 실행 및 코드 확인' },
      { id: 'C2', featureId: 'F1', check: '공백만 있는 입력은 거부된다', how: '단위 테스트' },
      { id: 'C3', featureId: 'F2', check: '완료 토글 시 취소선 클래스가 붙는다', how: 'DOM 테스트' },
      { id: 'C4', featureId: 'F3', check: '저장 후 복원 시 같은 목록이 나온다', how: '단위 테스트' },
    ] };
  }
  if (p.includes('results')) {
    const first = /라운드 1/.test(prompt);
    return first
      ? { pass: false, summary: '핵심 흐름은 동작하지만 공백 입력이 그대로 추가됩니다.', results: [
          { id: 'C1', status: 'pass', finding: 'npm test: add() 테스트 통과' },
          { id: 'C2', status: 'fail', finding: "src/todo.js:12 에서 trim 없이 길이만 검사해 '   '가 추가됨" },
          { id: 'C3', status: 'pass', finding: 'toggle 테스트 통과' },
          { id: 'C4', status: 'pass', finding: 'storage 테스트 통과' },
        ] }
      : { pass: true, summary: '모든 체크리스트 항목을 실제 테스트로 확인했습니다.', results: [
          { id: 'C1', status: 'pass', finding: 'npm test 통과' }, { id: 'C2', status: 'pass', finding: '공백 입력 거부 테스트 추가 및 통과' },
          { id: 'C3', status: 'pass', finding: 'toggle 테스트 통과' }, { id: 'C4', status: 'pass', finding: 'storage 테스트 통과' },
        ] };
  }
  return null;
}

async function streamText(text) {
  const id = rid();
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } }, parent_tool_use_id: null, session_id: sessionId });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, parent_tool_use_id: null, session_id: sessionId });
  for (const w of text.match(/\S+\s*|\s+/g) || []) {
    if (aborted) break;
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } }, parent_tool_use_id: null, session_id: sessionId });
    await sleep(35);
  }
  out({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: sessionId });
}

async function tool(name, input, result, needPermission) {
  if (aborted) return;
  const id = rid();
  const tid = 'toolu_' + crypto.randomBytes(6).toString('hex');
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } }, parent_tool_use_id: null, session_id: sessionId });
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: tid, name, input: {} } }, parent_tool_use_id: null, session_id: sessionId });
  await sleep(300);
  out({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, parent_tool_use_id: null, session_id: sessionId });
  let allowed = true;
  if (needPermission) {
    const reqId = 'req_' + crypto.randomBytes(4).toString('hex');
    out({ type: 'control_request', request_id: reqId, request: { subtype: 'can_use_tool', tool_name: name, input, tool_use_id: tid,
      permission_suggestions: [{ type: 'addRules', rules: [{ toolName: name, ruleContent: input.command }], behavior: 'allow', destination: 'session' }],
      decision_reason: '허용 목록에 없는 명령입니다' } });
    const resp = await new Promise((resolve) => pending.set(reqId, resolve));
    allowed = resp && resp.behavior === 'allow';
  } else {
    await sleep(600 + Math.random() * 600);
  }
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: allowed ? result : '사용자가 거부했습니다', is_error: !allowed }] }, parent_tool_use_id: null, session_id: sessionId });
  await sleep(250);
}

async function handleTurn(prompt) {
  turn += 1;
  aborted = false;
  const started = Date.now();
  if (!initSent) {
    initSent = true;
    out({ type: 'system', subtype: 'init', session_id: sessionId, model: arg('--model') || 'mock', permissionMode: arg('--permission-mode') || 'manual', cwd: process.cwd(), tools: ['Read', 'Edit', 'Bash'] });
  }
  const data = structured(prompt);
  const isDev = /유일한 코드 작성자|대화"로 처리/.test(sys) && !schema;
  const isQa = data && 'pass' in data;
  if (data) {
    await tool('Read', { file_path: 'README.md' }, '# project', false);
    if (isQa) await tool('Bash', { command: 'npm test' }, '4 passing', false);
    await streamText(isQa ? (data.pass ? '모든 항목을 확인했습니다.' : '실패 항목이 있어 반려합니다.') : '검토를 마쳤습니다. 결과를 정리했습니다.');
  } else if (isDev) {
    await streamText('요청을 확인했습니다. 관련 파일을 살펴보고 작업하겠습니다.\n');
    await tool('Glob', { pattern: 'src/**/*.js' }, 'src/todo.js\nsrc/storage.js', false);
    await tool('Read', { file_path: 'src/todo.js' }, '// todo', false);
    await tool('Edit', { file_path: 'src/todo.js', old_string: 'a', new_string: 'b' }, '수정 완료', false);
    await tool('Bash', { command: 'npm test -- --watch=false' }, '  4 passing (12ms)', true);
    await streamText('**변경 요약**\n\n- `src/todo.js`: 입력값을 `trim()` 한 뒤 비어 있으면 추가하지 않도록 수정\n- 테스트 4개 통과 확인\n\n```js\nif (!text.trim()) return;\n```\n');
  } else {
    await streamText('(데모 모드) 실제 claude 대신 모의 응답을 보내고 있습니다.');
  }
  const result = {
    type: 'result', subtype: aborted ? 'error_during_execution' : 'success', is_error: aborted, result: aborted ? '중단됨' : '완료했습니다.',
    session_id: sessionId, total_cost_usd: 0, duration_ms: Date.now() - started, num_turns: 3, permission_denials: [],
  };
  if (data && !aborted) result.structured_output = data;
  out(result);
}

const rl = readline.createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'control_request') {
    if (m.request.subtype === 'interrupt') { aborted = true; for (const [k, r] of pending) { pending.delete(k); r({ behavior: 'deny' }); } }
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
    return;
  }
  if (m.type === 'control_response') {
    const r = pending.get(m.response.request_id);
    if (r) { pending.delete(m.response.request_id); r(m.response.response); }
    return;
  }
  if (m.type === 'user') {
    const text = (m.message.content || []).map((c) => c.text || '').join('\n');
    queue = queue.then(() => handleTurn(text));
  }
});
rl.on('close', () => queue.then(() => process.exit(0)));
