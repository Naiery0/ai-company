'use strict';
// 회사 업무 파이프라인(결정론적 상태 기계). 계획은 LLM이 아니라 이 코드가 쥔다.
// triage(대표) → solo: build → review
//              → team: plan → contract(개발 제안 + QA 확정) → [build → qa]×N → review
const path = require('path');
const fs = require('fs');
const { PROMPTS, SCHEMAS, READ_ONLY_TOOLS } = require('./roles');
const { structuredFrom, writeFile, appendFile, git, specToMarkdown, contractToMarkdown, qaToMarkdown } = require('./util');
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
  constructor(company, { request, convId }) {
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
      error: null,
      baseCommit: null,
      isGit: false,
      lastDevSummary: '',
    };
    this.current = null; // 진행 중 ClaudeSession
    this.devSession = null;
    this.cancelled = false;
    this.reviewWaiter = null;
  }

  get id() { return this.state.id; }

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
      this.state.cost += result.costUsd || 0;
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
      for (const f of ['decisions.md', 'progress.md']) {
        const p = path.join(this.dir, f);
        if (!fs.existsSync(p)) writeFile(p, f === 'decisions.md' ? '# 결정 로그\n\n모든 직원이 따라야 하는 기술 결정을 한 줄씩 기록합니다.\n\n' : '# 진행 기록\n\n');
      }
      this.state.isGit = await git.isRepo(this.cwd);
      if (this.state.isGit) this.state.baseCommit = await git.head(this.cwd);
      appendFile(path.join(this.dir, 'progress.md'), `\n## ${new Date().toLocaleString('ko-KR')} 새 작업\n요청: ${this.state.request.replace(/\n/g, ' ').slice(0, 300)}\n`);
      this.emit();

      await this.triage();
      if (this.state.mode === 'solo') {
        for (const k of ['plan', 'contract', 'qa']) this.setStage(k, 'skipped');
        await this.build(1);
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

  async triage() {
    this.setStage('triage', 'active');
    this.log('새 업무 접수, 규모를 판단합니다', 'ceo');
    let t = null;
    try {
      const { result } = await this.ask('ceo', {
        label: '접수',
        systemKey: 'ceo',
        schema: SCHEMAS.triage,
        tools: READ_ONLY_TOOLS,
        prompt: `다음 코딩 요청의 처리 방식을 판단하세요.\n\n<요청>\n${this.state.request}\n</요청>`,
      });
      t = structuredFrom(result);
    } catch (e) {
      if (e.cancelled) throw e;
      this.log(`규모 판단 실패(${e.message}), 팀 모드로 진행합니다`, 'ceo', 'warn');
    }
    const forced = this.company.settings.forceMode;
    if (!t || !['solo', 'team'].includes(t.mode)) t = { mode: 'team', title: this.state.title, reason: '판단 결과를 읽지 못해 기본값(팀)으로 진행' };
    if (forced === 'solo' || forced === 'team') t = { ...t, mode: forced, reason: `설정에 따라 ${forced === 'solo' ? '단독' : '팀'} 모드로 고정` };
    this.state.triage = t;
    this.state.mode = t.mode;
    if (t.title) this.state.title = t.title.slice(0, 40);
    this.setStage('triage', 'done');
    this.log(t.mode === 'solo' ? `단독 처리로 결정: ${t.reason}` : `팀 프로젝트로 결정: ${t.reason}`, 'ceo');
    this.company.handoff('ceo', t.mode === 'solo' ? 'dev' : 'planner');
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
    this.log('개발자와 QA가 완료 기준을 협상합니다', 'qa');
    const { result: pr } = await this.ask('dev', {
      label: '구현 제안',
      systemKey: 'devPropose',
      schema: SCHEMAS.proposal,
      tools: READ_ONLY_TOOLS,
      prompt: '명세(.company/spec.md)를 읽고 구현 방식과 완료 증명 방법을 제안하세요.',
    });
    const proposal = structuredFrom(pr) || { items: [] };
    const { result: cr } = await this.ask('qa', {
      label: '완료 기준 확정',
      systemKey: 'qaContract',
      schema: SCHEMAS.contract,
      tools: READ_ONLY_TOOLS,
      prompt: `개발자의 제안입니다:\n\n\`\`\`json\n${JSON.stringify(proposal, null, 2)}\n\`\`\`\n\n명세(.company/spec.md)와 대조해 최종 체크리스트를 확정하세요.`,
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
    if (feedback) parts.push('', `사용자(대표님) 피드백:\n${feedback}`);
    return parts.join('\n');
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

  async qa(round) {
    this.setStage('qa', 'active');
    this.log(`QA 라운드 ${round} 검사 시작`, 'qa');
    const qaRole = this.company.roleSettings('qa');
    const { result } = await this.ask('qa', {
      label: `QA R${round}`,
      systemKey: 'qa',
      schema: SCHEMAS.qa,
      tools: qaRole.tools && qaRole.tools.length ? qaRole.tools : ['Read', 'Glob', 'Grep', 'Bash'],
      prompt: `라운드 ${round} 검사입니다. 명세(.company/spec.md)와 체크리스트(.company/contract.md)를 기준으로 현재 저장소의 결과물을 검사하세요.${this.state.contract && this.state.contract.testCommand ? `\n개발자가 제안한 전체 확인 명령: ${this.state.contract.testCommand}` : ''}`,
    });
    let qa = structuredFrom(result);
    if (!qa || typeof qa.pass !== 'boolean') qa = { pass: false, summary: 'QA 결과를 해석하지 못했습니다. 원문: ' + (result.text || '').slice(0, 500), results: [] };
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
      if (decision.approve) {
        this.state.status = 'running';
        this.setStage('review', 'done');
        if (this.state.isGit && this.company.settings.autoCommit) {
          const r = await git.commitAll(this.cwd, `[ai-company] ${this.state.title}`);
          this.log(r.ok ? '승인됨, 커밋했습니다' : `승인됨(커밋 생략: ${(r.stdout + r.stderr).trim().split('\n').pop()})`, 'ceo', 'good');
        } else {
          this.log('승인됨', 'ceo', 'good');
        }
        appendFile(path.join(this.dir, 'progress.md'), `- 승인 완료: ${this.state.title}\n`);
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
      if (this.state.mode === 'solo') await this.build(next, decision.feedback);
      else await this.buildQaLoop(next, decision.feedback);
    }
  }

  approve() { if (this.reviewWaiter) this.reviewWaiter.resolve({ approve: true }); }
  reject(feedback) { if (this.reviewWaiter) this.reviewWaiter.resolve({ approve: false, feedback: feedback || '' }); }

  cancel() {
    this.cancelled = true;
    if (this.current) this.current.interrupt();
    if (this.devSession) this.devSession.interrupt();
    if (this.reviewWaiter) this.reviewWaiter.reject(new CancelledError());
  }
}

module.exports = { Run, STAGES };
