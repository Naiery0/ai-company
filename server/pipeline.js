'use strict';
// 회사 업무 파이프라인(결정론적 상태 기계). 계획은 LLM이 아니라 이 코드가 쥔다.
// triage(대표) → solo: build → review
//              → team: plan → contract(개발 제안 + QA 확정) → [build → qa]×N → review
const path = require('path');
const fs = require('fs');
const { PROMPTS, SCHEMAS, READ_ONLY_TOOLS } = require('./roles');
const { spawn } = require('child_process');
const { structuredFrom, writeFile, appendFile, git, runShell, detectCheckCommand, specToMarkdown, contractToMarkdown, qaToMarkdown } = require('./util');
const { newId } = require('./claude');

const STAGES = [
  { key: 'triage', label: '접수', agent: 'ceo' },
  { key: 'plan', label: '기획', agent: 'planner' },
  { key: 'contract', label: '완료 기준', agent: 'qa' },
  { key: 'build', label: '개발', agent: 'dev' },
  { key: 'qa', label: 'QA', agent: 'qa' },
  { key: 'review', label: '검토', agent: null },
];

class CancelledError extends Error { constructor() { super('작업이 중지되었습니다'); this.cancelled = true; } }

class Run {
  constructor(company, { request, convId, triage }) {
    this.presetTriage = triage || null;
    this.company = company;
    this.cwd = company.projectPath;
    this.dir = path.join(this.cwd, '.company');
    this.state = {
      id: newId('run'),
      title: request.split('\n')[0].slice(0, 40),
      request,
      convId,
      createdAt: Date.now(),
      status: 'running',
      mode: null,
      stage: 'triage',
      round: 0,
      stages: STAGES.map((s) => ({ key: s.key, label: s.label, agent: s.agent, status: 'pending' })),
      triage: null,
      plan: null,
      contract: null,
      qa: [],
      cost: 0,
      costByAgent: {}, // 역할별 사용량(환산 비용)
      check: null, // 단독 업무: 코드가 직접 돌린 확인 명령 결과
      checking: false,
      error: null,
      baseCommit: null,
      baseTree: null, // 업무 시작 시점 작업 폴더 스냅샷(이 업무가 바꾼 파일만 커밋/폐기하는 기준)
      isGit: false,
      lastDevSummary: '',
    };
    this.current = null; // 진행 중 ClaudeSession
    this.devSession = null;
    this.cancelled = false;
    this.reviewWaiter = null;
    this.checkProc = null; // 실행 중인 확인 명령
    this.lastQaTree = null; // 직전 QA가 검사한 시점의 스냅샷(다음 라운드는 그 이후 변경만 알려준다)
  }

  get id() { return this.state.id; }

  addCost(agentId, usd) {
    if (!usd) return;
    this.state.cost += usd;
    this.state.costByAgent[agentId] = (this.state.costByAgent[agentId] || 0) + usd;
  }

  emit() { this.company.emitRun(this); }

  log(text, agent = null, tone = 'info') {
    this.company.feed(text, agent, tone);
  }

  setStage(key, status) {
    const s = this.state.stages.find((x) => x.key === key);
    if (s) s.status = status;
    if (status === 'active') this.state.stage = key;
    this.emit();
  }

  saveState() {
    try { writeFile(path.join(this.dir, 'runs', `${this.id}.json`), JSON.stringify(this.state, null, 2)); } catch { /* noop */ }
  }

  check() { if (this.cancelled) throw new CancelledError(); }

  /** 한 번의 에이전트 턴 실행. */
  async ask(agentId, { prompt, systemKey, schema, tools, keep = false, session = null, label }) {
    this.check();
    const sess = session || this.company.createSession(agentId, {
      systemPrompt: PROMPTS[systemKey],
      schema,
      tools,
      runId: this.id,
      name: `회사 ${label || agentId} · ${this.state.title}`,
    });
    this.current = sess;
    this.company.agentTranscript(this.id, agentId).addNotice(`${label || ''} 시작`, 'stage');
    try {
      const result = await sess.send(prompt);
      this.addCost(agentId, result.costUsd);
      this.check();
      if (result.isError) throw new Error(result.text || `${label} 실패`);
      return { result, session: sess };
    } finally {
      this.current = null;
      if (!keep) sess.close();
    }
  }

  async start() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const gi = path.join(this.dir, '.gitignore');
      if (!fs.existsSync(gi)) writeFile(gi, '# 대화 기록과 실행 로그는 커밋하지 않습니다\nchats/\nruns/\n');
      this.state.isGit = await git.isRepo(this.cwd);
      if (this.state.isGit) {
        this.state.baseCommit = await git.head(this.cwd);
        // 회사 문서를 만들기 전에 찍어, 처음 생기는 decisions.md 등도 이 업무의 변경으로 커밋되게 한다
        try { this.state.baseTree = await git.snapshot(this.cwd); } catch (e) { this.log(`시작 시점 기록 실패(승인 시 커밋·폐기 불가): ${e.message}`, 'ceo', 'warn'); }
      }
      for (const f of ['decisions.md', 'progress.md']) {
        const p = path.join(this.dir, f);
        if (!fs.existsSync(p)) writeFile(p, f === 'decisions.md' ? '# 결정 로그\n\n모든 직원이 따라야 하는 기술 결정을 한 줄씩 기록합니다.\n\n' : '# 진행 기록\n\n');
      }
      appendFile(path.join(this.dir, 'progress.md'), `\n## ${new Date().toLocaleString('ko-KR')} 새 작업\n요청: ${this.state.request.replace(/\n/g, ' ').slice(0, 300)}\n`);
      this.emit();

      this.applyTriage(this.presetTriage || { route: 'team', title: this.state.title, reason: '판단 정보가 없어 팀으로 진행' });
      if (this.state.mode === 'solo') {
        for (const k of ['plan', 'contract', 'qa']) this.setStage(k, 'skipped');
        await this.soloLoop(1);
      } else {
        await this.plan();
        await this.makeContract();
        await this.buildQaLoop(1);
      }
      await this.reviewLoop();
    } catch (e) {
      if (e.cancelled) {
        this.state.status = 'cancelled';
        this.log('작업이 중지되었습니다', 'ceo', 'warn');
      } else {
        this.state.status = 'failed';
        this.state.error = e.message;
        const active = this.state.stages.find((s) => s.status === 'active');
        if (active) active.status = 'failed';
        this.log(`작업 실패: ${e.message}`, 'ceo', 'error');
      }
    } finally {
      if (this.devSession) { this.devSession.close(); this.devSession = null; }
      this.company.setAgent('ceo', 'idle', null);
      this.saveState();
      this.emit();
      this.company.onRunFinished(this);
    }
  }

  /** 대표의 판단(회사 차원에서 이미 내려짐)을 업무에 반영한다. */
  applyTriage(t) {
    const mode = t.route === 'team' ? 'team' : 'solo';
    this.state.triage = t;
    this.state.mode = mode;
    this.addCost('ceo', t.costUsd);
    if (t.title) this.state.title = t.title.slice(0, 40);
    this.setStage('triage', 'done');
    this.company.handoff('ceo', mode === 'solo' ? 'dev' : 'planner');
  }

  async plan() {
    this.setStage('plan', 'active');
    this.log('명세서를 작성합니다', 'planner');
    const { result } = await this.ask('planner', {
      label: '기획',
      systemKey: 'planner',
      schema: SCHEMAS.plan,
      tools: READ_ONLY_TOOLS,
      prompt: `다음 요청을 제품 명세로 확장하세요. 필요하면 저장소를 읽어 기존 구조를 파악하세요.\n\n<요청>\n${this.state.request}\n</요청>`,
    });
    const plan = structuredFrom(result);
    if (!plan || !Array.isArray(plan.features) || !plan.features.length) throw new Error('기획자가 명세를 만들지 못했습니다');
    this.state.plan = plan;
    writeFile(path.join(this.dir, 'spec.json'), JSON.stringify(plan, null, 2));
    writeFile(path.join(this.dir, 'spec.md'), specToMarkdown(plan));
    this.setStage('plan', 'done');
    this.log(`명세 완료: 기능 ${plan.features.length}개`, 'planner');
    this.company.handoff('planner', 'dev');
  }

  async makeContract() {
    this.setStage('contract', 'active');
    this.company.gather(['dev', 'qa']);
    this.log('개발 팀장과 QA가 완료 기준을 협상합니다', 'qa');
    const { result: pr } = await this.ask('dev', {
      label: '구현 제안',
      systemKey: 'devPropose',
      schema: SCHEMAS.proposal,
      tools: READ_ONLY_TOOLS,
      prompt: '명세(.company/spec.md)를 읽고 구현 방식과 완료 증명 방법을 제안하세요.',
    });
    const proposal = structuredFrom(pr) || { items: [] };
    // 명세와 제안을 대조하는 일이라 저장소를 탐색할 필요가 없다: 명세를 직접 넣고 도구 없이 한 턴으로 끝낸다
    const { result: cr } = await this.ask('qa', {
      label: '완료 기준 확정',
      systemKey: 'qaContract',
      schema: SCHEMAS.contract,
      tools: [],
      prompt: `<명세>\n${specToMarkdown(this.state.plan)}</명세>\n\n개발자의 제안입니다:\n\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\`\n\n명세와 대조해 최종 체크리스트를 확정하세요.`,
    });
    const contract = structuredFrom(cr);
    if (!contract || !Array.isArray(contract.criteria) || !contract.criteria.length) throw new Error('완료 기준을 확정하지 못했습니다');
    this.state.contract = { ...contract, testCommand: proposal.testCommand || '' };
    writeFile(path.join(this.dir, 'contract.json'), JSON.stringify(this.state.contract, null, 2));
    writeFile(path.join(this.dir, 'contract.md'), contractToMarkdown(contract, proposal));
    this.company.disperse(['dev', 'qa']);
    this.setStage('contract', 'done');
    this.log(`완료 기준 ${contract.criteria.length}개 합의`, 'qa');
  }

  devPrompt(round, feedback) {
    if (this.state.mode === 'solo' && round === 1) {
      return `다음 요청을 처리하세요. 소규모 작업으로 판단되어 별도 명세/QA 없이 바로 진행합니다. 완료 후 직접 검증하고 결과를 보고하세요.\n\n<요청>\n${this.state.request}\n</요청>`;
    }
    if (round === 1) return '명세(.company/spec.md)와 완료 기준(.company/contract.md)에 따라 구현을 시작하세요.';
    const parts = [`수정 라운드 ${round}입니다.`];
    const lastQa = this.state.qa[this.state.qa.length - 1];
    if (lastQa && !lastQa.pass) {
      const fails = (lastQa.results || []).filter((r) => r.status !== 'pass');
      parts.push(`QA가 반려했습니다(.company/qa/round-${lastQa.round}.md). 아래 항목을 모두 해결하세요:`);
      for (const f of fails) parts.push(`- ${f.id} [${f.status}] ${f.finding}`);
    }
    const chk = this.state.check;
    if (chk && chk.ok === false && chk.round === round - 1) {
      parts.push(`회사가 직접 실행한 확인 명령 \`${chk.command}\`이 실패했습니다(종료 코드 ${chk.code}). 출력 끝부분:`, '```', chk.output.slice(-2500), '```', '원인을 고치고 이 명령이 통과하는지 직접 확인하세요.');
    }
    if (feedback) parts.push('', `사용자(대표님) 피드백:\n${feedback}`);
    return parts.join('\n');
  }

  /** 단독 업무: 개발 → 코드가 확인 명령 실행(토큰 0) → 실패하면 출력을 들고 다시 개발. 독립 평가는 사람의 결재가 맡는다. */
  async soloLoop(startRound, feedback = '') {
    const max = Math.max(1, Number(this.company.settings.maxQaRounds) || 3);
    let round = startRound;
    let fb = feedback;
    for (;;) {
      await this.build(round, fb);
      fb = '';
      const ok = await this.runCheck(round);
      if (ok !== false) return; // 통과했거나 확인 명령이 없음
      if (round - startRound + 1 >= max) {
        this.log(`확인 명령이 ${max}번 실패했습니다. 결과를 보고 판단해 주세요`, 'ceo', 'warn');
        return;
      }
      round += 1;
    }
  }

  /** 확인 명령을 실행한다. 통과 true, 실패 false, 명령 없음 null. */
  async runCheck(round) {
    const cmd = String(this.company.settings.checkCommand || '').trim() || detectCheckCommand(this.cwd);
    if (!cmd) {
      this.state.check = { command: '', ok: null, round };
      this.log('확인 명령을 찾지 못해 자동 확인을 건너뜁니다(설정에서 지정할 수 있습니다)');
      this.emit();
      return null;
    }
    this.check();
    this.log(`확인 명령 실행: ${cmd}`);
    this.state.checking = true; // 사무실 서버실 표시용
    this.emit();
    const r = await runShell(cmd, this.cwd, { onSpawn: (c) => { this.checkProc = c; } });
    this.checkProc = null;
    this.state.checking = false;
    this.check();
    this.state.check = { command: cmd, ok: r.ok, code: r.code, output: r.output, durationMs: r.durationMs, round };
    this.log(r.ok ? `확인 명령 통과 (${(r.durationMs / 1000).toFixed(1)}초)` : `확인 명령 실패 (종료 코드 ${r.code})`, null, r.ok ? 'good' : 'warn');
    this.emit();
    return r.ok;
  }

  async build(round, feedback = '') {
    this.state.round = round;
    this.setStage('build', 'active');
    this.log(round === 1 ? '구현을 시작합니다' : `라운드 ${round}: 수정 작업`, 'dev');
    if (!this.devSession || this.devSession.closed) {
      this.devSession = this.company.createSession('dev', {
        systemPrompt: PROMPTS.dev,
        runId: this.id,
        resume: this.devSession && this.devSession.sessionId,
        name: `회사 개발 · ${this.state.title}`,
      });
    }
    const { result } = await this.ask('dev', { label: `개발 R${round}`, session: this.devSession, keep: true, prompt: this.devPrompt(round, feedback) });
    this.state.lastDevSummary = (result.text || '').slice(0, 4000);
    this.setStage('build', 'done');
    this.log('구현 완료, 검토로 넘깁니다', 'dev');
    this.company.handoff('dev', this.state.mode === 'solo' ? 'ceo' : 'qa');
  }

  /**
   * QA의 "파일 수정 금지"를 코드로 확인한다. 검사 전후 스냅샷이 다르면 검사 전 상태로 되돌린다.
   * 기존 파일을 고쳤다면 그 판정은 믿을 수 없다(고쳐서 통과시켰을 수 있음) → 'tampered'.
   * 새 파일만 생겼다면 테스트 부산물일 가능성이 커서 지우기만 한다 → 'artifacts'.
   */
  async qaGuard(before) {
    if (!before) return null;
    const changed = await git.restoreTo(this.cwd, before);
    if (!changed.length) return null;
    const edited = changed.filter((c) => c.status !== 'A');
    return { kind: edited.length ? 'tampered' : 'artifacts', files: (edited.length ? edited : changed).map((c) => c.path) };
  }

  /**
   * QA가 어디를 볼지 알려주는 안내(탐색 토큰 절약). 개발 과정은 주지 않고 결과물의 변경 범위만 준다.
   * - 프롬프트에는 바뀐 파일 목록(stat)만, 전체 diff는 파일로 두고 필요할 때만 읽게 한다.
   * - 2라운드부터: 지난 QA 이후 고친 것만 알려주고, 실패 항목·관련 항목만 깊게 다시 보게 한다.
   */
  async qaFocus(round) {
    const lastQa = this.state.qa[this.state.qa.length - 1];
    const since = round > 1 && this.lastQaTree ? this.lastQaTree : this.state.baseTree;
    const parts = [];
    if (since) {
      try {
        const d = await git.diffSince(this.cwd, since);
        const rel = `.company/runs/${this.id}-qa-r${round}.diff`; // runs/는 git 제외
        writeFile(path.join(this.cwd, rel), d.diff);
        const stat = d.stat.trim().split('\n');
        const statText = stat.length > 40 ? [...stat.slice(0, 39), `… (${stat.length - 40}줄 생략)`, stat[stat.length - 1]].join('\n') : stat.join('\n');
        parts.push(`${round > 1 && this.lastQaTree ? '지난 QA 이후 바뀐 파일' : '이 업무에서 바뀐 파일'}(.company 제외):`, '```', statText || '(없음)', '```',
          `전체 변경 내용은 ${rel} 에 있습니다. 필요할 때만 읽으세요. 변경 범위 밖의 수정이나 기존 기능을 깨뜨리는 변경도 찾아보세요.`);
      } catch { /* 안내 없이 진행 */ }
    }
    if (round > 1 && lastQa) {
      const fails = (lastQa.results || []).filter((r) => r.status !== 'pass').map((r) => r.id);
      parts.push(`재검사 라운드입니다. 지난 라운드(R${lastQa.round}) 실패·보류 항목: ${fails.length ? fails.join(', ') : '없음(사용자 피드백 반영 라운드)'}`,
        '- 실패·보류했던 항목과, 위 변경과 관련된 항목은 처음처럼 꼼꼼히 다시 검사하세요.',
        `- 그 밖에 지난 라운드에 통과한 항목은 전체 확인 명령을 한 번 실행해 회귀가 없으면 통과로 두고, 근거에 "R${lastQa.round} 통과, 회귀 확인: <명령> 통과"라고 적으세요. 확인 명령이 없거나 실패하면 그 항목도 다시 검사하세요.`,
        '- 결과에는 모든 체크리스트 항목을 빠짐없이 적으세요.');
    }
    return parts.length ? '\n\n' + parts.join('\n') : '';
  }

  async qa(round) {
    this.setStage('qa', 'active');
    this.log(`QA 라운드 ${round} 검사 시작`, 'qa');
    const qaRole = this.company.roleSettings('qa');
    const focus = await this.qaFocus(round);
    let qa = null;
    let note = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let before = null;
      if (this.state.baseTree) { try { before = await git.snapshot(this.cwd); } catch { /* 확인 생략 */ } }
      const { result } = await this.ask('qa', {
        label: `QA R${round}`,
        systemKey: 'qa',
        schema: SCHEMAS.qa,
        tools: qaRole.tools && qaRole.tools.length ? qaRole.tools : ['Read', 'Glob', 'Grep', 'Bash'],
        prompt: `라운드 ${round} 검사입니다. 명세(.company/spec.md)와 체크리스트(.company/contract.md)를 기준으로 현재 저장소의 결과물을 검사하세요.${this.state.contract && this.state.contract.testCommand ? `\n개발자가 제안한 전체 확인 명령: ${this.state.contract.testCommand}` : ''}${focus}${attempt > 1 ? '\n\n주의: 직전 검사가 저장소 파일을 수정해 무효 처리되었습니다. 파일을 절대 수정하지 말고 검사만 하세요.' : ''}`,
      });
      qa = structuredFrom(result);
      if (!qa || typeof qa.pass !== 'boolean') qa = { pass: false, summary: 'QA 결과를 해석하지 못했습니다. 원문: ' + (result.text || '').slice(0, 500), results: [] };
      let guard = null;
      try { guard = await this.qaGuard(before); } catch (e) { this.log(`QA 전후 비교 실패: ${e.message}`, 'qa', 'warn'); }
      if (before) this.lastQaTree = before; // 되돌린 뒤의 상태 = QA가 검사한 상태
      if (!guard) break;
      const list = guard.files.slice(0, 5).join(', ') + (guard.files.length > 5 ? ` 외 ${guard.files.length - 5}개` : '');
      if (guard.kind === 'artifacts') {
        note = `검사 중 생긴 새 파일을 지웠습니다: ${list}`;
        this.log(note, 'qa', 'warn');
        break;
      }
      this.log(`QA가 파일을 수정해 되돌렸습니다: ${list}`, 'qa', 'warn');
      if (attempt === 2) {
        qa = { pass: false, summary: 'QA가 두 번 연속 저장소 파일을 수정해 판정을 무효로 처리했습니다(수정은 되돌림). 사람의 확인이 필요합니다.', results: [{ id: 'QA', status: 'fail', finding: `QA가 검사 중 수정한 파일(되돌림): ${list}` }] };
      } else {
        this.log('판정을 무효로 하고 QA를 다시 진행합니다', 'qa', 'warn');
      }
    }
    if (note) qa.summary = `${qa.summary || ''} (${note})`.trim();
    const fails = (qa.results || []).filter((r) => r.status === 'fail').length;
    if (fails > 0) qa.pass = false; // 실패 항목이 있으면 통과 불가(일관성 강제)
    qa.round = round;
    this.state.qa.push(qa);
    writeFile(path.join(this.dir, 'qa', `round-${round}.json`), JSON.stringify(qa, null, 2));
    writeFile(path.join(this.dir, 'qa', `round-${round}.md`), qaToMarkdown(qa, round));
    this.setStage('qa', qa.pass ? 'done' : 'failed');
    this.company.setAgent('qa', qa.pass ? 'done' : 'failed', qa.pass ? '통과' : `반려 ${fails}건`);
    this.log(qa.pass ? 'QA 통과' : `QA 반려: 실패 ${fails}건`, 'qa', qa.pass ? 'good' : 'warn');
    this.company.handoff('qa', qa.pass ? 'ceo' : 'dev');
    return qa.pass;
  }

  async buildQaLoop(startRound, feedback = '') {
    const max = Math.max(1, Number(this.company.settings.maxQaRounds) || 3);
    let round = startRound;
    let fb = feedback;
    for (;;) {
      await this.build(round, fb);
      fb = '';
      const pass = await this.qa(round);
      if (pass) return true;
      if (round - startRound + 1 >= max) {
        this.log(`QA ${max}회 반려, 사람의 판단이 필요합니다`, 'ceo', 'warn');
        return false;
      }
      round += 1;
    }
  }

  async reviewLoop() {
    for (;;) {
      this.setStage('review', 'active');
      this.state.status = 'review';
      this.company.setAgent('ceo', 'waiting', '결재 대기');
      this.log('결과물 검토를 기다립니다', 'ceo');
      this.saveState();
      this.emit();
      const decision = await new Promise((resolve, reject) => { this.reviewWaiter = { resolve, reject }; });
      this.reviewWaiter = null;
      this.check();
      if (decision.discard) {
        this.state.status = 'running';
        this.setStage('review', 'skipped');
        await this.company.discardChanges(this);
        return;
      }
      if (decision.approve) {
        this.state.status = 'running';
        this.setStage('review', 'done');
        appendFile(path.join(this.dir, 'progress.md'), `- 승인 완료: ${this.state.title}\n`); // 커밋에 함께 들어가도록 먼저 기록
        if (this.state.isGit && this.company.settings.autoCommit) {
          // 이 업무가 바꾼 파일만 커밋한다(사용자가 따로 고치던 파일은 그대로 둠)
          let msg;
          if (!this.state.baseTree) msg = '승인됨(시작 시점 기록이 없어 커밋 생략)';
          else {
            try {
              const r = await git.commitChanges(this.cwd, this.state.baseTree, `[ai-company] ${this.state.title}`);
              msg = r.ok ? `승인됨, 이 업무가 바꾼 파일 ${r.files}개(회사 문서 포함)를 커밋했습니다` : `승인됨(커밋 생략: ${r.reason})`;
            } catch (e) { msg = `승인됨(커밋 실패: ${e.message})`; }
          }
          this.log(msg, 'ceo', 'good');
        } else {
          this.log('승인됨', 'ceo', 'good');
        }
        this.state.status = 'done';
        this.state.stage = 'done';
        this.company.setAgent('ceo', 'done', '승인');
        return;
      }
      // 반려 → 피드백을 들고 다시 개발(팀이면 QA까지)
      this.state.status = 'running';
      this.setStage('review', 'pending');
      this.log('반려됨, 피드백을 전달합니다', 'ceo', 'warn');
      this.company.handoff('ceo', 'dev');
      const next = this.state.round + 1;
      if (this.state.mode === 'solo') await this.soloLoop(next, decision.feedback);
      else await this.buildQaLoop(next, decision.feedback);
    }
  }

  approve() { if (this.reviewWaiter) this.reviewWaiter.resolve({ approve: true }); }
  discard() { if (this.reviewWaiter) this.reviewWaiter.resolve({ discard: true }); }
  reject(feedback) { if (this.reviewWaiter) this.reviewWaiter.resolve({ approve: false, feedback: feedback || '' }); }

  cancel() {
    this.cancelled = true;
    if (this.current) this.current.interrupt();
    if (this.devSession) this.devSession.interrupt();
    if (this.checkProc) {
      const pid = this.checkProc.pid;
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
        else this.checkProc.kill('SIGTERM');
      } catch { /* noop */ }
    }
    if (this.reviewWaiter) this.reviewWaiter.reject(new CancelledError());
  }
}

module.exports = { Run, STAGES };
