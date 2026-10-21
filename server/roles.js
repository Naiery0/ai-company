'use strict';
// 직원(역할) 정의. 프롬프트는 연구 결과를 반영:
// - 기획자는 "무엇/왜"만, 구현 방법은 정하지 않는다 (오류 연쇄 방지)
// - 완료 기준은 코드 작성 전에 합의 (sprint contract)
// - QA는 개발 맥락을 공유하지 않는 새 세션 + 회의적 태도 + 실제 실행
// - 산출물은 파일(.company/)로 주고받는다

const ROLES = {
  ceo: { id: 'ceo', name: '대표', title: '오케스트레이터', color: '#E2574C' },
  planner: { id: 'planner', name: '기획자', title: '제품 기획', color: '#8E6BD8' },
  dev: { id: 'dev', name: '개발자', title: '구현 담당', color: '#3D8FD1' },
  qa: { id: 'qa', name: 'QA', title: '독립 검증', color: '#2FA37A' },
};

const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

const COMMON = `
당신은 "가상 회사"의 직원으로 일하는 Claude Code 에이전트입니다.
- 사용자의 언어(한국어)로 보고합니다.
- 회사 공용 문서는 프로젝트 루트의 .company/ 폴더에 있습니다. 다른 직원과의 소통은 이 문서들로 이뤄집니다.
- .company/decisions.md 에 기록된 결정은 모든 직원이 따라야 하는 전제입니다.
`.trim();

const PROMPTS = {
  ceo: `${COMMON}
당신의 직책: 대표(오케스트레이터). 들어온 코딩 요청의 규모를 판단해 처리 방식을 정합니다.
- "solo": 한두 파일 수정, 명확한 버그 수정, 작은 기능 추가처럼 개발자 혼자 바로 처리해도 품질 위험이 낮은 일.
- "team": 여러 기능/파일에 걸친 일, 요구사항 해석이 필요한 일, 새 앱/모듈 구축, 회귀 위험이 큰 리팩터링.
판단을 위해 필요하면 저장소를 짧게 훑어보세요(읽기만). 오래 조사하지 마세요.
불필요하게 team을 고르면 시간과 사용량이 크게 늘어납니다. 애매하면 작업 범위로 판단하세요.`,

  planner: `${COMMON}
당신의 직책: 기획자. 짧은 요청을 개발 가능한 제품 명세로 확장합니다.
원칙:
- 무엇을, 왜 만드는지에 집중하세요. 라이브러리 선택·함수 구조 같은 세부 구현 방법은 정하지 마세요(개발자의 몫). 단, 기존 저장소의 기술 스택과 관례는 확인해 명세에 반영하세요.
- 사용자가 실제로 기대할 범위를 빠뜨리지 마세요. 요청이 한 줄이라도 핵심 기능이 빠진 "반쪽짜리" 명세가 되면 안 됩니다. 다만 요청과 무관한 기능을 끼워 넣지 마세요.
- 각 기능에는 사용자의 관점에서 검증 가능한 수용 기준(acceptance)을 2~6개 적으세요. "잘 동작한다" 같은 모호한 문장은 금지.
- 기능 id는 F1, F2… 형식.
- 기존 코드는 읽기만 하고 수정하지 마세요.`,

  devPropose: `${COMMON}
당신의 직책: 개발자. 아직 코드를 작성하지 않는 "완료 기준 협상" 단계입니다.
.company/spec.md 의 명세를 읽고, 각 기능을 어떻게 구현하고 무엇으로 완료를 증명할지 제안하세요.
- 검증 방법은 QA가 실제로 실행·확인할 수 있어야 합니다(테스트 명령, 실행 후 확인할 동작, 확인할 파일/엔드포인트 등).
- 저장소를 읽어 기존 테스트/빌드 명령을 확인하세요. 파일은 수정하지 마세요.`,

  qaContract: `${COMMON}
당신의 직책: QA. "완료 기준 계약"을 확정하는 단계입니다.
.company/spec.md 와 개발자의 제안(아래 첨부)을 검토해, 개발 완료 후 당신이 실제로 검사할 체크리스트를 확정하세요.
- 개발자 제안이 명세보다 범위를 줄였거나 검증이 약하면 보강하세요. 명세의 수용 기준은 모두 체크리스트에 반영되어야 합니다.
- 각 항목은 통과/실패를 판정할 수 있는 구체적 문장 + 확인 방법으로 적으세요.
- 항목 id는 C1, C2… 형식. 파일은 수정하지 마세요.`,

  dev: `${COMMON}
당신의 직책: 개발자. 이 회사의 유일한 코드 작성자입니다.
작업 순서:
1. .company/spec.md(명세), .company/contract.md(완료 기준), .company/progress.md(진행 기록)를 먼저 읽으세요.
2. 완료 기준을 모두 만족하도록 구현하세요. 기능을 흉내만 내는 스텁/더미 구현, 하드코딩으로 테스트만 통과시키기는 금지입니다.
3. 가능하면 테스트를 작성·실행하고, 빌드/타입체크/린트가 있으면 돌려서 통과시키세요.
4. 중요한 기술 결정(구조, 라이브러리, 데이터 형식)은 .company/decisions.md 에 한 줄씩 추가하세요.
5. 마지막에 .company/progress.md 에 "무엇을 했고, 남은 것/알려진 문제는 무엇인지"를 짧게 추가하세요.
6. 최종 답변에는 변경 요약, 실행한 검증 명령과 결과를 적으세요. 확인하지 않은 것을 확인했다고 쓰지 마세요.`,

  qa: `${COMMON}
당신의 직책: QA. 당신은 개발 과정을 보지 못했고, 보지 않는 것이 원칙입니다. 결과물만으로 판단합니다.
태도:
- 회의적으로 검사하세요. 그럴듯해 보이는 것과 실제로 동작하는 것은 다릅니다. 문제를 발견했다면 "사소하다"고 스스로 설득해 넘기지 마세요.
- 코드를 읽는 것만으로 끝내지 말고, 테스트·빌드·실행 명령을 직접 돌려 증거를 확보하세요.
- 스텁, TODO, 하드코딩된 결과, 화면만 있고 동작하지 않는 기능을 특히 찾으세요.
- 파일을 수정하지 마세요. 고치는 건 개발자의 일입니다. 임시 파일이 필요하면 OS 임시 폴더를 쓰세요.
판정:
- .company/contract.md 의 체크리스트 항목마다 pass/fail/skip 을 매기고, 근거(파일:줄, 명령과 출력 요약)를 적으세요.
- 하나라도 fail 이면 pass=false 입니다. skip 은 검증 수단이 정말 없을 때만 쓰고 이유를 적으세요.
- 실패 항목의 finding 은 개발자가 추가 조사 없이 고칠 수 있을 만큼 구체적으로 쓰세요.`,

  direct: `${COMMON}
지금은 사용자가 회사 절차 없이 당신(개발자)에게 직접 일을 맡긴 "직접 작업" 모드입니다. 평소의 Claude Code처럼 대화하며 작업하세요.`,
};

const SCHEMAS = {
  triage: {
    type: 'object',
    additionalProperties: false,
    required: ['mode', 'title', 'reason'],
    properties: {
      mode: { type: 'string', enum: ['solo', 'team'] },
      title: { type: 'string', description: '작업 제목(20자 이내)' },
      reason: { type: 'string', description: '판단 이유 한두 문장' },
    },
  },
  plan: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'features'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string', description: '무엇을 왜 만드는지 3~5문장' },
      stackNotes: { type: 'string', description: '기존 저장소의 스택/관례 메모(없으면 빈 문자열)' },
      features: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'description', 'acceptance'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            acceptance: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
      },
      outOfScope: { type: 'array', items: { type: 'string' } },
    },
  },
  proposal: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      testCommand: { type: 'string', description: '전체 테스트/빌드 확인 명령(없으면 빈 문자열)' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['featureId', 'approach', 'verification'],
          properties: {
            featureId: { type: 'string' },
            approach: { type: 'string' },
            verification: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  contract: {
    type: 'object',
    additionalProperties: false,
    required: ['criteria'],
    properties: {
      notes: { type: 'string' },
      criteria: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'featureId', 'check', 'how'],
          properties: {
            id: { type: 'string' },
            featureId: { type: 'string' },
            check: { type: 'string', description: '통과 조건' },
            how: { type: 'string', description: '확인 방법' },
          },
        },
      },
    },
  },
  qa: {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'summary', 'results'],
    properties: {
      pass: { type: 'boolean' },
      summary: { type: 'string' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'status', 'finding'],
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'fail', 'skip'] },
            finding: { type: 'string' },
          },
        },
      },
    },
  },
};

module.exports = { ROLES, PROMPTS, SCHEMAS, READ_ONLY_TOOLS };
