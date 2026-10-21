/* global Office, MD */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = MD.esc;
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };

  const S = {
    snap: null, convId: null, tab: 'chat', agent: 'dev', viewRunId: null,
    runTx: {}, // runId → {agentId: items}
    itemEls: new Map(), pendingRender: new Set(), fileRel: null,
  };

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    const r = await fetch(path, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`);
    return data;
  }
  function toast(msg, tone = 'error') {
    const box = $('#messages');
    box.append(h('div', { class: 'msg-notice', 'data-tone': tone }, msg));
    box.scrollTop = box.scrollHeight;
  }

  // ───────── 초기화 ─────────
  async function load() {
    S.snap = await api('/api/state');
    const snap = S.snap;
    Office.setRoles(snap.roles);
    Office.setAgents(snap.agents);
    Office.setActive(!!snap.projectPath);
    if (!S.convId || !snap.convs[S.convId]) S.convId = snap.convList[0] ? snap.convList[0].id : null;
    S.viewRunId = snap.activeRunId || latestRunId();
    Office.setRun(S.viewRunId ? snap.runs[S.viewRunId] : null);
    $('#permMode').value = snap.settings.direct.permissionMode || 'acceptEdits';
    renderAll();
  }

  function latestRunId() {
    const runs = Object.values(S.snap.runs || {}).sort((a, b) => b.createdAt - a.createdAt);
    return runs[0] ? runs[0].id : null;
  }

  function renderAll() {
    renderTop();
    renderConvSelect();
    renderMessages();
    renderStage();
    renderFeed();
    renderPerms();
    renderComposer();
    if (S.tab === 'agent') renderAgentPane();
    if (S.tab === 'files') renderFiles();
    if (S.tab === 'settings') renderSettings();
  }

  // ───────── 상단 바 ─────────
  function renderTop() {
    const p = S.snap.projectPath;
    const short = p ? (() => { const parts = p.split(/[\\/]/).filter(Boolean); return parts.length > 3 ? '…' + (p.includes('\\') ? '\\' : '/') + parts.slice(-2).join(p.includes('\\') ? '\\' : '/') : p; })() : null;
    $('#projectName').textContent = short || '프로젝트 열기';
    $('#projectBtn').title = p ? `${p}\n다른 폴더 열기` : '작업할 프로젝트 폴더 열기';
    $('#officeEmpty').hidden = !!p;
    let cost = 0;
    for (const r of Object.values(S.snap.runs)) cost += r.cost || 0;
    for (const c of Object.values(S.snap.convs)) for (const it of c.items) if (it.meta && it.meta.costUsd) cost += it.meta.costUsd;
    $('#costMeter').textContent = `사용량 $${cost.toFixed(2)}`;
  }

  async function checkHealth() {
    const el = $('#cliStatus');
    el.dataset.state = 'checking'; el.textContent = 'claude 확인 중';
    try {
      const r = await api('/api/health');
      if (r.ok) { el.dataset.state = 'ok'; el.textContent = r.demo ? '데모 모드' : `claude ${r.version.split(' ')[0]}`; el.title = r.version; }
      else { el.dataset.state = 'error'; el.textContent = 'claude를 찾지 못함'; el.title = `${r.error || ''}\n설정 탭에서 claude 경로를 지정하세요.`; }
    } catch (e) { el.dataset.state = 'error'; el.textContent = '서버 연결 끊김'; }
  }

  // ───────── 대화 ─────────
  function renderConvSelect() {
    const sel = $('#convSelect');
    sel.innerHTML = '';
    if (!S.snap.convList.length) sel.append(h('option', { value: '' }, '대화 없음'));
    for (const c of S.snap.convList) {
      const d = new Date(c.createdAt);
      sel.append(h('option', { value: c.id, selected: c.id === S.convId }, `${c.busy ? '● ' : ''}${c.title} · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`));
    }
    sel.disabled = !S.snap.projectPath;
    $('#newConvBtn').disabled = !S.snap.projectPath;
  }

  function lastRoute(conv) {
    if (!conv || !conv.items) return null;
    for (let i = conv.items.length - 1; i >= 0; i--) { const x = conv.items[i]; if (x.type === 'route') return x.route; if (x.type === 'run') return 'run'; }
    return null;
  }

  function currentConv() { return S.convId ? S.snap.convs[S.convId] : null; }

  function renderMessages() {
    const box = $('#messages');
    box.innerHTML = '';
    S.itemEls.clear();
    if (!S.snap.projectPath) {
      box.append(h('div', { class: 'empty-note' }, h('b', {}, '먼저 프로젝트 폴더를 여세요'), '직원들이 이 폴더에서 일합니다. 회사 문서는 폴더 안 .company/ 에 쌓입니다.',
        h('p', {}, h('button', { class: 'btn primary', type: 'button', onclick: openFolderDlg }, '폴더 열기'))));
      return;
    }
    const conv = currentConv();
    if (!conv || !conv.items.length) {
      const note = h('div', { class: 'empty-note' },
        h('b', {}, '무엇을 만들까요?'),
        h('p', {}, '질문이나 작은 수정은 개발자와 바로 대화로, 범위가 정해진 구현은 개발자 단독으로, 큰 일은 기획 → 완료 기준 합의 → 개발 → 독립 QA를 거치는 팀으로 처리합니다.'),
        h('p', {}, '어떤 방식으로 할지는 대표가 메시지마다 판단합니다.'));
      if (!S.snap.isGit) {
        note.append(h('p', {}, '이 폴더는 git 저장소가 아니라서 변경사항 비교와 자동 커밋을 쓸 수 없습니다. ',
          h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('/api/project/git-init', {}); await load(); } catch (e) { toast(e.message); } } }, 'git 초기화')));
      }
      box.append(note);
      return;
    }
    for (const it of conv.items) box.append(renderItem(it, 'chat'));
    box.scrollTop = box.scrollHeight;
  }

  function renderItem(it, scope) {
    let el;
    if (it.type === 'user') el = h('div', { class: 'msg-user' }, it.text);
    else if (it.type === 'notice') el = h('div', { class: 'msg-notice', 'data-tone': it.tone || 'info' }, it.text);
    else if (it.type === 'run') el = renderRunCard(it.runId);
    else if (it.type === 'route') el = h('div', { class: 'msg-route', 'data-route': it.route },
      h('span', { class: 'route-tag' }, it.forced ? '' : '대표 판단 · ', ROUTE_TEXT[it.route] || it.route), h('span', {}, it.reason || ''));
    else el = renderAssistant(it);
    el.dataset.itemId = it.id;
    S.itemEls.set(`${scope}:${it.id}`, el);
    return el;
  }

  function toolInputPreview(b) {
    const i = b.input || {};
    if (b.name === 'Bash' || b.name === 'PowerShell') return i.command || '';
    if (b.name === 'Edit' || b.name === 'MultiEdit') return `${i.file_path || ''}\n- ${(i.old_string || '').slice(0, 400)}\n+ ${(i.new_string || '').slice(0, 400)}`;
    if (b.name === 'Write') return `${i.file_path || ''}\n${(i.content || '').slice(0, 800)}`;
    try { return JSON.stringify(i, null, 2); } catch { return ''; }
  }

  function renderAssistant(it) {
    const wrap = h('div', { class: 'msg-assistant' });
    const blocks = it.blocks || [];
    blocks.forEach((b, idx) => {
      if (b.type === 'text') {
        if (!b.text) return;
        const isLast = idx === blocks.length - 1 && !it.done;
        wrap.append(h('div', { class: 'md' + (isLast ? ' cursor' : ''), html: MD.render(b.text) }));
      } else if (b.type === 'tool') {
        const st = b.result === null || b.result === undefined ? (it.done ? 'done' : 'running') : b.isError ? 'error' : 'done';
        const det = h('details', { class: 'tool', 'data-state': st },
          h('summary', {}, h('span', { class: 'tname' }, b.label || b.name), h('span', { class: 'tstate' }, st === 'running' ? '실행 중' : st === 'error' ? '실패' : '완료')),
          h('pre', {}, toolInputPreview(b) + (b.result ? `\n\n── 결과 ──\n${b.result}` : '')));
        wrap.append(det);
      }
    });
    if (!blocks.length && !it.done) wrap.append(h('div', { class: 'md cursor' }));
    if (it.done && it.meta) {
      const m = it.meta;
      const parts = [];
      if (m.durationMs) parts.push(`${(m.durationMs / 1000).toFixed(1)}초`);
      if (m.numTurns) parts.push(`${m.numTurns}턴`);
      if (m.costUsd) parts.push(`$${m.costUsd.toFixed(3)}`);
      if (parts.length) wrap.append(h('div', { class: 'msg-meta' }, parts.join('  ')));
    }
    return wrap;
  }

  function scheduleItemRender(scope, item) {
    S.pendingRender.add(`${scope}:${item.id}`);
    if (S.renderQueued) return;
    S.renderQueued = true;
    requestAnimationFrame(() => {
      S.renderQueued = false;
      for (const key of S.pendingRender) {
        const old = S.itemEls.get(key);
        const [scope2, id] = key.split(/:(.+)/);
        const it = findItem(scope2, id);
        if (!old || !it) continue;
        const box = old.parentElement;
        const nearBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        // 열려 있던 도구 상세는 그대로 유지
        const openIdx = $$('details.tool', old).map((d, i) => (d.open ? i : -1)).filter((i) => i >= 0);
        const neu = renderItem(it, scope2);
        $$('details.tool', neu).forEach((d, i) => { if (openIdx.includes(i)) d.open = true; });
        old.replaceWith(neu);
        if (box && nearBottom) box.scrollTop = box.scrollHeight;
      }
      S.pendingRender.clear();
    });
  }

  function findItem(scope, id) {
    if (scope === 'chat') { const c = currentConv(); return c && c.items.find((x) => x.id === id); }
    const [runId, agentId] = scope.split('|');
    const tx = S.runTx[runId] && S.runTx[runId][agentId];
    return tx && tx.find((x) => x.id === id);
  }

  function upsertInto(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    return i < 0;
  }

  function onChat(e) {
    let conv = S.snap.convs[e.convId];
    if (!conv) { conv = S.snap.convs[e.convId] = { id: e.convId, title: '새 대화', items: [], createdAt: Date.now() }; }
    if (e.op === 'upsert') {
      const isNew = upsertInto(conv.items, e.item);
      if (e.convId !== S.convId) return;
      if (isNew) {
        const box = $('#messages');
        if (box.querySelector('.empty-note')) box.innerHTML = '';
        box.append(renderItem(e.item, 'chat'));
        box.scrollTop = box.scrollHeight;
      } else scheduleItemRender('chat', e.item);
      if (e.item.meta) renderTop();
    } else if (e.op === 'delta') {
      const it = conv.items.find((x) => x.id === e.itemId);
      if (!it) return;
      const b = it.blocks[e.blockIndex];
      if (b && b.type === 'text') b.text += e.text; // 서버와 동일하게 누적(서버는 이미 반영된 상태를 보냄)
      if (e.convId === S.convId) scheduleItemRender('chat', it);
    }
  }

  // ───────── 업무 카드 ─────────
  const ROUTE_TEXT = { chat: '대화로 처리', solo: '개발자 단독', team: '팀 업무' };
  const STATUS_TEXT = { running: '진행 중', review: '결재 대기', done: '완료', failed: '실패', cancelled: '중지됨' };
  const STATUS_TONE = { running: 'lamp', review: 'lamp', done: 'good', failed: 'bad', cancelled: '' };

  function renderRunCard(runId) {
    const r = S.snap.runs[runId];
    const card = h('article', { class: 'run-card', 'data-run-id': runId });
    if (!r) { card.append(h('div', { class: 'run-body' }, '업무 정보를 불러오는 중')); return card; }
    const qaLast = r.qa && r.qa[r.qa.length - 1];
    card.append(h('header', {},
      h('span', { class: 'rtitle' }, r.title),
      r.mode ? h('span', { class: 'badge' }, r.mode === 'solo' ? '단독' : '팀') : null,
      h('span', { class: 'badge', 'data-tone': STATUS_TONE[r.status] }, STATUS_TEXT[r.status] || r.status)));
    const body = h('div', { class: 'run-body' });
    body.append(h('ol', { class: 'run-steps' }, r.stages.map((s) => h('li', { 'data-status': s.status }, s.label + (s.key === 'build' && r.round > 1 ? ` R${r.round}` : '')))));
    if (r.plan) body.append(h('div', {}, `명세: 기능 ${r.plan.features.length}개`, r.contract ? ` · 완료 기준 ${r.contract.criteria.length}개` : ''));
    if (qaLast) {
      body.append(h('div', {}, h('strong', {}, `QA 라운드 ${qaLast.round}: ${qaLast.pass ? '통과' : '반려'}`), ' ', qaLast.summary || ''));
      const fails = (qaLast.results || []).filter((x) => x.status !== 'pass');
      const show = qaLast.pass ? (qaLast.results || []).slice(0, 6) : fails;
      if (show.length) body.append(h('ul', { class: 'qa-list' }, show.map((x) => h('li', {}, h('span', { class: 'qid' }, x.id), h('span', { class: 'qst', 'data-s': x.status }, x.status === 'pass' ? '통과' : x.status === 'fail' ? '실패' : '보류'), h('span', {}, x.finding)))));
    }
    if (r.status === 'review' && r.mode === 'solo' && r.lastDevSummary) body.append(h('div', { class: 'md', html: MD.render(r.lastDevSummary.slice(0, 1500)) }));
    if (r.error) body.append(h('div', { class: 'run-error' }, r.error));
    const actions = h('div', { class: 'run-actions' });
    actions.append(h('button', { class: 'btn small', type: 'button', onclick: () => { S.viewRunId = runId; Office.setRun(r); switchTab('agent'); } }, '직원 작업 보기'));
    if (S.snap.isGit) actions.append(h('button', { class: 'btn small', type: 'button', onclick: () => { S.viewRunId = runId; switchTab('files'); showDiff(); } }, '변경사항'));
    if (r.status === 'review') {
      actions.append(h('button', { class: 'btn small good', type: 'button', onclick: () => api('/api/run/approve', { runId }).catch((e) => toast(e.message)) }, S.snap.isGit && S.snap.settings.autoCommit ? '승인하고 커밋' : '승인'));
      actions.append(h('button', { class: 'btn small', type: 'button', onclick: () => openReject(runId) }, '반려'));
    }
    if (r.status === 'running' || r.status === 'review') actions.append(h('button', { class: 'btn small danger', type: 'button', onclick: () => api('/api/stop', { runId }).catch((e) => toast(e.message)) }, '중지'));
    body.append(actions);
    card.append(body);
    return card;
  }

  function onRun(run) {
    S.snap.runs[run.id] = run;
    if (run.status === 'running' || run.status === 'review') { S.snap.activeRunId = run.id; S.viewRunId = run.id; }
    else if (S.snap.activeRunId === run.id) S.snap.activeRunId = null;
    if (S.viewRunId === run.id) Office.setRun(run);
    const box = $('#messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    $$(`[data-run-id="${run.id}"]`).forEach((el) => { const neu = renderRunCard(run.id); neu.dataset.itemId = el.dataset.itemId; el.replaceWith(neu); S.itemEls.set(`chat:${neu.dataset.itemId}`, neu); });
    if (nearBottom) box.scrollTop = box.scrollHeight;
    renderStage();
    renderTop();
    renderComposer();
  }

  let rejectRunId = null;
  function openReject(runId) { rejectRunId = runId; $('#rejectText').value = ''; $('#rejectDlg').showModal(); $('#rejectText').focus(); }
  $('#rejectSend').addEventListener('click', async () => {
    const fb = $('#rejectText').value.trim();
    if (!fb) { $('#rejectText').focus(); return; }
    $('#rejectDlg').close();
    try { await api('/api/run/reject', { runId: rejectRunId, feedback: fb }); } catch (e) { toast(e.message); }
  });

  // ───────── 하단 단계/피드 ─────────
  function renderStage() {
    const ol = $('#stageSteps');
    ol.innerHTML = '';
    const r = S.viewRunId && S.snap.runs[S.viewRunId];
    if (!r || !['running', 'review'].includes(r.status)) return;
    for (const s of r.stages) ol.append(h('li', { 'data-status': s.status }, s.label, s.key === 'build' && r.round > 1 ? h('span', { class: 'round' }, `R${r.round}`) : null));
  }

  function renderFeed() {
    const ul = $('#feed');
    ul.innerHTML = '';
    const list = (S.snap.feed || []).slice(-3);
    if (!list.length) { ul.append(h('li', {}, S.snap.projectPath ? '직원들이 업무를 기다리고 있습니다' : '프로젝트를 열면 업무 기록이 여기에 흐릅니다')); return; }
    for (const f of list) {
      const who = f.agent && S.snap.roles[f.agent] ? S.snap.roles[f.agent].name : '';
      ul.append(h('li', { 'data-tone': f.tone }, who ? h('span', { class: 'who' }, who) : null, f.text));
    }
  }

  // ───────── 권한 승인 ─────────
  function renderPerms() {
    const tray = $('#permTray');
    tray.innerHTML = '';
    for (const p of S.snap.perms) {
      const who = S.snap.roles[p.agentId] ? S.snap.roles[p.agentId].name : p.agentId;
      const canAlways = !p.suppressAlways && p.suggestions && p.suggestions.length;
      tray.append(h('div', { class: 'perm' },
        h('div', { class: 'perm-head' }, h('span', { class: 'who' }, who), `${p.toolName} 사용 승인`),
        h('pre', {}, toolInputPreview({ name: p.toolName, input: p.input })),
        p.reason ? h('div', { class: 'reason' }, p.reason.replace(/\x1b\[[0-9;]*m/g, '')) : null,
        h('div', { class: 'perm-actions' },
          h('button', { class: 'btn small' + (p.defaultToNo ? '' : ' primary'), type: 'button', onclick: () => answerPerm(p.id, 'allow') }, '이번만 허용'),
          canAlways ? h('button', { class: 'btn small', type: 'button', onclick: () => answerPerm(p.id, 'always') }, '이 세션 동안 허용') : null,
          h('button', { class: 'btn small danger', type: 'button', onclick: () => answerPerm(p.id, 'deny') }, '거부'))));
    }
  }
  async function answerPerm(permId, decision) {
    try { await api('/api/permission', { permId, decision }); } catch (e) { toast(e.message); }
  }
  function onPerm(p) {
    S.snap.perms = S.snap.perms.filter((x) => x.id !== p.id);
    if (p.status === 'pending') S.snap.perms.push(p);
    renderPerms();
    if (p.status === 'pending') document.title = '승인 필요 · 가상 회사'; else if (!S.snap.perms.length) document.title = '가상 회사';
  }

  // ───────── 입력창 ─────────
  function renderComposer() {
    const has = !!S.snap.projectPath;
    const conv = currentConv();
    const convBusy = !!(conv && S.snap.convList.find((c) => c.id === conv.id && c.busy));
    const run = S.snap.activeRunId && S.snap.runs[S.snap.activeRunId];
    const runBusy = run && run.status === 'running';
    $('#input').disabled = !has;
    const following = conv && conv.items && conv.items.some((x) => x.type === 'route' && x.route === 'chat') && lastRoute(conv) === 'chat';
    let hint = following ? '이어지는 메시지는 개발자에게 바로 전달됩니다' : '';
    let block = !has;
    if (runBusy) { hint = '회사 업무 중입니다. 끝나면 보낼 수 있습니다'; block = true; }
    else if (convBusy) { hint = lastRoute(conv) ? '응답 중입니다' : '대표가 처리 방식을 판단하는 중입니다'; block = true; }
    else if (run && run.status === 'review') hint = '결재 대기 중에는 대화로만 처리됩니다';
    $('#composerHint').textContent = hint;
    $('#sendBtn').disabled = block;
    $('#stopBtn').hidden = !(convBusy || (run && run.convId === S.convId && ['running', 'review'].includes(run.status)));
  }

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#input').value.trim();
    if (!text || $('#sendBtn').disabled) return;
    $('#sendBtn').disabled = true;
    try {
      const r = await api('/api/chat/send', { convId: S.convId, text, permissionMode: $('#permMode').value });
      $('#input').value = '';
      if (r.convId !== S.convId) { S.convId = r.convId; if (!S.snap.convs[r.convId]) S.snap.convs[r.convId] = { id: r.convId, items: [], title: text.slice(0, 30) }; renderMessages(); }
    } catch (err) { toast(err.message); }
    renderComposer();
  });
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#stopBtn').addEventListener('click', () => {
    const run = S.snap.activeRunId && S.snap.runs[S.snap.activeRunId];
    if (run && run.convId === S.convId && ['running', 'review'].includes(run.status)) api('/api/stop', { runId: run.id }).catch((e) => toast(e.message));
    else api('/api/stop', { convId: S.convId }).catch((e) => toast(e.message));
  });
  $('#convSelect').addEventListener('change', (e) => { S.convId = e.target.value || null; renderMessages(); renderComposer(); });
  $('#newConvBtn').addEventListener('click', async () => {
    try { const r = await api('/api/chat/new', {}); S.convId = r.convId; S.snap.convs[r.convId] = { id: r.convId, items: [], title: '새 대화', createdAt: Date.now() }; renderMessages(); renderComposer(); $('#input').focus(); } catch (e) { toast(e.message); }
  });

  // ───────── 탭 ─────────
  function switchTab(tab) {
    S.tab = tab;
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    $$('.pane').forEach((p) => { p.hidden = p.id !== `pane-${tab}`; });
    if (tab === 'agent') renderAgentPane();
    if (tab === 'files') renderFiles();
    if (tab === 'settings') renderSettings();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // ───────── 직원 탭 ─────────
  const STATE_TEXT = { idle: '대기', thinking: '생각 중', working: '작업 중', waiting: '승인 대기', done: '완료', failed: '문제' };
  function selectAgent(id) {
    S.agent = id; Office.select(id);
    if (S.tab !== 'agent') switchTab('agent'); else renderAgentPane();
  }
  function renderChips() {
    const box = $('#agentChips');
    box.innerHTML = '';
    for (const [id, role] of Object.entries(S.snap.roles)) {
      const a = S.snap.agents[id] || {};
      box.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.agent === id), style: `--c:${role.color}`, onclick: () => selectAgent(id) },
        h('span', { class: 'dot' }), role.name, h('span', { class: 'st' }, STATE_TEXT[a.state] || '')));
    }
  }
  async function renderAgentPane() {
    renderChips();
    Office.select(S.agent);
    const role = S.snap.roles[S.agent];
    const log = $('#agentLog');
    const head = $('#agentHead');
    log.innerHTML = '';
    const runId = S.viewRunId;
    const r = runId && S.snap.runs[runId];
    head.textContent = r ? `${role.name} · ${role.title} — 업무 "${r.title}"의 작업 기록` : `${role.name} · ${role.title}`;
    if (!r) {
      log.append(h('div', { class: 'empty-note' }, h('b', {}, '아직 맡은 업무가 없습니다'), S.agent === 'dev' ? '대화로 처리한 작업은 대화 탭에서 볼 수 있습니다.' : '팀이나 단독 업무가 생기면 이 직원의 작업 과정이 여기에 실시간으로 쌓입니다.'));
      return;
    }
    if (!S.runTx[runId]) {
      try { S.runTx[runId] = await api(`/api/run/transcripts?runId=${encodeURIComponent(runId)}`); } catch { S.runTx[runId] = {}; }
      if (S.tab !== 'agent' || S.viewRunId !== runId) return;
    }
    const items = (S.runTx[runId] && S.runTx[runId][S.agent]) || [];
    if (!items.length) {
      log.append(h('div', { class: 'empty-note' }, h('b', {}, '이 업무에서 아직 한 일이 없습니다'), r.archived ? '' : '차례가 오면 작업 과정이 실시간으로 표시됩니다.'));
      return;
    }
    for (const it of items) log.append(renderItem(it, `${runId}|${S.agent}`));
    log.scrollTop = log.scrollHeight;
  }

  function onTranscript(e) {
    if (!S.runTx[e.runId]) S.runTx[e.runId] = {};
    const list = S.runTx[e.runId][e.agentId] || (S.runTx[e.runId][e.agentId] = []);
    const scope = `${e.runId}|${e.agentId}`;
    const visible = S.tab === 'agent' && S.viewRunId === e.runId && S.agent === e.agentId;
    if (e.op === 'upsert') {
      const isNew = upsertInto(list, e.item);
      if (!visible) return;
      if (isNew) {
        const log = $('#agentLog');
        if (log.querySelector('.empty-note')) log.innerHTML = '';
        log.append(renderItem(e.item, scope));
        log.scrollTop = log.scrollHeight;
      } else scheduleItemRender(scope, e.item);
    } else if (e.op === 'delta') {
      const it = list.find((x) => x.id === e.itemId);
      if (!it) return;
      const b = it.blocks[e.blockIndex];
      if (b && b.type === 'text') b.text += e.text;
      if (visible) scheduleItemRender(scope, it);
    }
  }

  // ───────── 산출물 탭 ─────────
  async function renderFiles() {
    const ul = $('#fileList');
    ul.innerHTML = '';
    if (!S.snap.projectPath) { $('#fileView').innerHTML = ''; ul.append(h('li', { class: 'hint', style: 'padding:6px 14px' }, '프로젝트를 열면 회사 문서가 표시됩니다')); return; }
    let files = [];
    try { files = await api('/api/files'); } catch (e) { toast(e.message); }
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    if (!files.length) ul.append(h('li', { class: 'hint', style: 'padding:6px 14px' }, '아직 문서가 없습니다. 회사에 일을 맡기면 명세·완료 기준·QA 보고서가 생깁니다.'));
    for (const f of files) {
      ul.append(h('li', {}, h('button', { type: 'button', 'aria-current': String(S.fileRel === f.rel), onclick: () => showFile(f.rel) },
        h('span', {}, f.rel), h('span', { class: 'fsize' }, f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`))));
    }
  }
  async function showFile(rel) {
    S.fileRel = rel;
    $$('#fileList button').forEach((b) => b.setAttribute('aria-current', String(b.firstChild.textContent === rel)));
    const view = $('#fileView');
    try {
      const r = await api(`/api/file?rel=${encodeURIComponent(rel)}`);
      view.innerHTML = '';
      if (rel.endsWith('.md')) view.append(h('div', { class: 'md', html: MD.render(r.content) }));
      else view.append(h('pre', { class: 'diff' }, r.content));
    } catch (e) { view.textContent = e.message; }
  }
  async function showDiff() {
    const view = $('#fileView');
    view.innerHTML = '<p class="hint">변경사항을 불러오는 중</p>';
    try {
      const r = await api(`/api/diff${S.viewRunId ? `?runId=${encodeURIComponent(S.viewRunId)}` : ''}`);
      view.innerHTML = '';
      if (!r.isGit) { view.append(h('p', { class: 'hint' }, 'git 저장소가 아니라서 변경사항을 비교할 수 없습니다.')); return; }
      view.append(h('p', { class: 'hint' }, r.base ? `업무 시작 시점(${r.base.slice(0, 7)}) 이후 변경` : '마지막 커밋 이후 변경'));
      if (r.untracked && r.untracked.length) view.append(h('p', { class: 'hint' }, `새 파일(추적 안 됨): ${r.untracked.join(', ')}`));
      if (!r.diff.trim()) { view.append(h('p', {}, '변경된 내용이 없습니다.')); return; }
      const pre = h('pre', { class: 'diff' });
      for (const line of r.diff.split('\n')) {
        const cls = line.startsWith('diff --git') ? 'fileh' : line.startsWith('@@') ? 'hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : '';
        pre.append(cls ? h('span', { class: cls }, line) : document.createTextNode(line + '\n'));
      }
      view.append(pre);
    } catch (e) { view.textContent = e.message; }
  }
  $('#refreshFiles').addEventListener('click', renderFiles);
  $('#showDiff').addEventListener('click', showDiff);

  // ───────── 설정 탭 ─────────
  const MODELS = [['', '계정 기본값'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];
  const EFFORTS = [['', '기본'], ['low', '낮음'], ['medium', '보통'], ['high', '높음'], ['xhigh', '매우 높음'], ['max', '최대']];
  const PMODES = [['manual', '매번 묻기'], ['acceptEdits', '파일 수정 자동 허용'], ['auto', '자동 판단'], ['dontAsk', '묻지 않고 거부'], ['plan', '계획만'], ['bypassPermissions', '모두 허용(주의)']];
  const sel = (name, opts, val, label) => h('select', { name, 'aria-label': label || null }, opts.map(([v, l]) => h('option', { value: v, selected: v === (val || '') }, l)));

  function renderSettings() {
    const s = S.snap.settings;
    const f = $('#settingsForm');
    f.innerHTML = '';
    f.append(h('fieldset', {}, h('legend', {}, '실행'),
      h('label', { class: 'field' }, h('span', {}, 'claude 실행 파일 경로'),
        h('input', { type: 'text', name: 'claudePath', value: s.claudePath, disabled: S.snap.demo, spellcheck: 'false' }),
        h('small', {}, S.snap.demo ? '데모 모드에서는 모의 직원을 씁니다.' : 'PATH에 있으면 claude 그대로 두세요. 못 찾으면 claude.exe 전체 경로를 적습니다.')),
      h('label', { class: 'field' }, h('span', {}, '업무 처리 방식'), sel('forceMode', [['auto', '대표가 판단'], ['chat', '항상 대화'], ['solo', '항상 개발자 단독'], ['team', '항상 팀 업무']], s.forceMode),
        h('small', {}, '보통은 대표에게 맡겨두세요. 고정하면 판단 단계를 건너뜁니다.')),
      h('label', { class: 'field' }, h('span', {}, 'QA 최대 반려 횟수'), h('input', { type: 'number', name: 'maxQaRounds', min: '1', max: '10', value: s.maxQaRounds })),
      h('label', { class: 'field' }, h('span', {}, '승인 시 자동 커밋'), sel('autoCommit', [['true', '켜기'], ['false', '끄기']], String(s.autoCommit)))));

    const roleFs = h('fieldset', {}, h('legend', {}, '직원별 설정'),
      h('div', { class: 'row3 col-heads', 'aria-hidden': 'true' }, h('span', {}, '모델'), h('span', {}, '생각 강도'), h('span', {}, '도구 승인')));
    for (const [id, role] of Object.entries(S.snap.roles)) {
      const r = s.roles[id] || {};
      roleFs.append(h('div', { class: 'field' }, h('span', {}, `${role.name} · ${role.title}`),
        h('div', { class: 'row3' }, sel(`roles.${id}.model`, MODELS, r.model, `${role.name} 모델`), sel(`roles.${id}.effort`, EFFORTS, r.effort, `${role.name} 생각 강도`), sel(`roles.${id}.permissionMode`, PMODES, r.permissionMode, `${role.name} 도구 승인`)),
        id === 'dev' || id === 'qa' ? h('textarea', { name: `roles.${id}.allowedTools`, rows: '4', 'aria-label': `${role.name} 자동 허용 규칙` }, (r.allowedTools || []).join('\n')) : null,
        id === 'dev' || id === 'qa' ? h('small', {}, '승인 없이 허용할 도구 규칙(한 줄에 하나, 예: Bash(npm test *)). 목록 밖 명령은 승인 요청이 뜹니다.') : null));
    }
    f.append(roleFs);

    f.append(h('fieldset', {}, h('legend', {}, '대화로 처리할 때 기본값'),
      h('div', { class: 'row3 col-heads', 'aria-hidden': 'true' }, h('span', {}, '모델'), h('span', {}, '생각 강도'), h('span', {}, '도구 승인')),
      h('div', { class: 'row3' }, sel('direct.model', MODELS, s.direct.model), sel('direct.effort', EFFORTS, s.direct.effort), sel('direct.permissionMode', PMODES, s.direct.permissionMode))));

    const status = h('span', { class: 'hint' });
    f.append(h('div', { class: 'save-row' }, h('button', { class: 'btn primary', type: 'submit' }, '설정 저장'), status));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const patch = { roles: {}, direct: {} };
      for (const el of f.elements) {
        if (!el.name) continue;
        let v = el.value;
        if (el.name === 'maxQaRounds') v = Number(v) || 3;
        if (el.name === 'autoCommit') v = v === 'true';
        if (el.name.endsWith('.allowedTools')) v = v.split('\n').map((x) => x.trim()).filter(Boolean);
        const parts = el.name.split('.');
        let o = patch;
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
        o[parts[parts.length - 1]] = v;
      }
      if (S.snap.demo) delete patch.claudePath;
      try { S.snap.settings = await api('/api/settings', patch); status.textContent = '저장했습니다. 다음 작업부터 적용됩니다.'; checkHealth(); }
      catch (err) { status.textContent = err.message; }
    };
  }

  // ───────── 폴더 열기 ─────────
  async function browse(p) {
    const list = $('#folderList');
    list.innerHTML = '';
    try {
      const r = await api(`/api/fs?path=${encodeURIComponent(p || '')}`);
      $('#folderPath').value = r.path;
      $('#folderNote').textContent = r.path ? (r.isGit ? 'git 저장소입니다.' : 'git 저장소가 아닙니다(열고 나서 초기화할 수 있습니다).') : '드라이브를 고르세요.';
      if (r.parent !== null && r.parent !== undefined) list.append(h('li', {}, h('button', { type: 'button', onclick: () => browse(r.parent) }, '.. 상위 폴더')));
      for (const d of r.dirs) list.append(h('li', {}, h('button', { type: 'button', ondblclick: () => openProject(d.path), onclick: () => browse(d.path) }, d.name)));
    } catch (e) { $('#folderNote').textContent = e.message; }
  }
  function openFolderDlg() {
    const rec = $('#recentList');
    rec.innerHTML = '';
    for (const p of S.snap.recent || []) rec.append(h('button', { type: 'button', title: p, onclick: () => openProject(p) }, p));
    $('#folderDlg').showModal();
    browse(S.snap.projectPath || S.snap.home);
  }
  async function openProject(p) {
    try { await api('/api/project', { path: p }); $('#folderDlg').close(); S.convId = null; S.runTx = {}; await load(); }
    catch (e) { $('#folderNote').textContent = e.message; }
  }
  $('#projectBtn').addEventListener('click', openFolderDlg);
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="open-folder"]')) openFolderDlg(); });
  $('#folderGo').addEventListener('click', () => browse($('#folderPath').value));
  $('#folderPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); browse($('#folderPath').value); } });
  $('#folderOpen').addEventListener('click', () => openProject($('#folderPath').value));

  // ───────── 실시간 이벤트 ─────────
  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('agent', (e) => {
      const a = JSON.parse(e.data);
      S.snap.agents[a.id] = a; Office.setAgent(a);
      if (S.tab === 'agent') renderChips();
    });
    es.addEventListener('chat', (e) => onChat(JSON.parse(e.data)));
    es.addEventListener('convs', (e) => { S.snap.convList = JSON.parse(e.data); renderConvSelect(); renderComposer(); });
    es.addEventListener('run', (e) => onRun(JSON.parse(e.data)));
    es.addEventListener('transcript', (e) => onTranscript(JSON.parse(e.data)));
    es.addEventListener('perm', (e) => onPerm(JSON.parse(e.data)));
    es.addEventListener('feed', (e) => { S.snap.feed.push(JSON.parse(e.data)); S.snap.feed = S.snap.feed.slice(-60); renderFeed(); });
    es.addEventListener('fx', (e) => Office.fx(JSON.parse(e.data)));
    es.addEventListener('settings', (e) => { S.snap.settings = JSON.parse(e.data); });
    es.addEventListener('log', (e) => console.warn('[claude stderr]', JSON.parse(e.data)));
    es.addEventListener('reload', () => load());
    es.onerror = () => { $('#cliStatus').dataset.state = 'error'; $('#cliStatus').textContent = '서버 연결 끊김'; };
    es.onopen = () => { if (S.snap) { load(); checkHealth(); } };
  }

  Office.init($('#office'), { onSelect: selectAgent });
  load().then(() => { connect(); checkHealth(); }).catch((e) => { document.body.prepend(h('p', { style: 'color:#fff;padding:12px' }, `서버에 연결하지 못했습니다: ${e.message}`)); });
})();
