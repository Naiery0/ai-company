// 쿼터뷰(아이소메트릭) 도트 사무실 렌더러.
// - 모든 그래픽은 코드로 그린 임시 도트(절차적 스프라이트)이며, /assets/manifest.json 에
//   이미지를 등록하면 해당 요소가 그 이미지로 교체된다(자세한 형식은 /assets/README.md).
// - 월드는 낮은 해상도 버퍼(W×H)에 그리고 정수배로 확대해 픽셀 느낌을 유지한다.
// - 이름표와 말풍선은 가독성을 위해 화면 해상도에서 도트 폰트로 그린다.
// - 방과 캐릭터는 모두 실제로 일어나는 일과 연결된다(토큰 0). 일하지 않는 장식용 직원은 두지 않는다.
(function () {
  const TW = 32, TH = 16;            // 타일 크기
  const GX = 18, GY = 15;            // 바닥 칸 수
  const WALL = 58;                   // 바깥 벽 높이
  const PART = 13;                   // 칸막이 높이(사람이 가려지지 않게 낮게)
  const PT = 0.16;                   // 칸막이 두께(타일)
  const OX = GY * 16 + 4;            // 원점(뒤쪽 모서리) x
  const OY = 66;                     // 원점 y
  const W = (GX + GY) * 16 + 8;      // 논리 해상도
  const H = OY + (GX + GY) * 8 + 10;
  const LOUNGE_AFTER = 15000;        // 이만큼 쉬면 라운지로 간다(ms)

  const P = {
    ink: '#141414', floorA: '#bdbdbd', floorB: '#b0b0b0',
    wallL: '#575757', wallR: '#666666', wallTop: '#333333', trim: '#474747',
    partX: '#8c8c8c', partY: '#7a7a7a', partTop: '#a9a9a9', lip: '#8a8a8a', lip2: '#7c7c7c',
    wood: '#c98d55', woodL: '#9e6738', woodR: '#b47844', woodTop2: '#d9a06a',
    monitor: '#2a2a2a', led: '#6b6b6b', lamp: '#f6c445', coral: '#e2574c', mint: '#2fa37a',
    skin: '#f1c7a4', skinS: '#d9a882', pants: '#2a2a2a', paper: '#f5f5f5', plant: '#3e9a62', plantD: '#2b6e46', pot: '#b9643c',
    sky: '#222222', star: '#fbe7a6', rug: '#d9c48c', rugD: '#c4ad72', metal: '#9a9a9a', metalL: '#7a7a7a', metalR: '#8a8a8a',
    rack: '#3a3a3a', rackL: '#262626', rackR: '#303030', leather: '#8a5a3c', leatherL: '#6b4330', leatherR: '#7a4e36',
  };

  const LOOKS = {
    ceo: { shirt: '#2f3a6b', shirtS: '#232c55', hair: '#2b2235', accent: '#e2574c', style: 'short', tie: true },
    planner: { shirt: '#8e6bd8', shirtS: '#7253b8', hair: '#6b4430', accent: '#f5f5f5', style: 'bob', collar: true },
    dev: { shirt: '#3d8fd1', shirtS: '#2c71aa', hair: '#1f1f2b', accent: '#141414', style: 'messy', headphones: true },
    qa: { shirt: '#2fa37a', shirtS: '#23825f', hair: '#d9b05a', accent: '#141414', style: 'short', glasses: true },
    sec: { shirt: '#e8e8e8', shirtS: '#c8c8c8', hair: '#3b2a20', accent: '#e2574c', style: 'bob', collar: true },
    temp: { shirt: '#8a8a8a', shirtS: '#6f6f6f', hair: '#2b2b2b', accent: '#f6c445', style: 'short', badge: true },
  };

  // ───────── 배치 ─────────
  // 방: 바닥 칸 범위 [x0,x1)×[y0,y1). name 이 있는 방만 이름표를 단다.
  const ROOMS = [
    { key: 'planner', name: '기획실', x0: 0, x1: 6, y0: 0, y1: 4, floor: ['#c6c6c6', '#bcbcbc'] },
    { key: 'meeting', name: '회의실', x0: 6, x1: 12, y0: 0, y1: 4, floor: ['#b2b2b2', '#aaaaaa'] },
    { key: 'ceo', name: '대표실', x0: 12, x1: 18, y0: 0, y1: 4, floor: ['#ccc6bc', '#c2bcb2'] },
    { key: 'hall', name: '복도', x0: 0, x1: 18, y0: 4, y1: 6, floor: ['#d8d8d8', '#d0d0d0'] },
    { key: 'dev', name: '개발실', x0: 0, x1: 6, y0: 6, y1: 10, floor: ['#bebebe', '#b3b3b3'] },
    { key: 'qa', name: 'QA실', x0: 6, x1: 11, y0: 6, y1: 10, floor: ['#c4c9c6', '#babfbc'] },
    { key: 'server', name: '서버실', x0: 11, x1: 16, y0: 6, y1: 10, floor: ['#8e8e8e', '#858585'] },
    { key: 'passage', x0: 16, x1: 18, y0: 6, y1: 10, floor: ['#d8d8d8', '#d0d0d0'] },
    { key: 'docs', name: '문서 보관실', x0: 0, x1: 5, y0: 10, y1: 15, floor: ['#c8c2b8', '#beb8ae'] },
    { key: 'lounge', name: '라운지', x0: 5, x1: 18, y0: 10, y1: 15, floor: ['#c9a27a', '#bf976e'] },
  ];
  // 칸막이: ['x', gy, gx0, gx1] = gy 선을 따라 gx0~gx1, ['y', gx, gy0, gy1] = gx 선을 따라. 빈 구간이 문.
  const WALLS = [
    ['x', 4, 0, 2], ['x', 4, 3, 8], ['x', 4, 10, 14], ['x', 4, 15, 18], // 윗줄 방 ↔ 복도 (문: 기획 2-3, 회의 8-10, 대표 14-15)
    ['y', 6, 0, 4], ['y', 12, 0, 4],
    ['x', 6, 0, 2], ['x', 6, 3, 8], ['x', 6, 9, 13], ['x', 6, 14, 16], // 복도 ↔ 가운데 줄 (문: 개발 2-3, QA 8-9, 서버 13-14)
    ['y', 6, 6, 10], ['y', 11, 6, 10], ['y', 16, 6, 10],
    ['x', 10, 0, 16],                                                   // 가운데 줄 ↔ 아랫줄 (통로 16-18로 라운지 연결)
    ['y', 5, 10, 12], ['y', 5, 13, 15],                                 // 문서실 ↔ 라운지 (문 12-13)
  ];

  const HOME = { ceo: { gx: 15.2, gy: 1.3 }, planner: { gx: 2.2, gy: 1.3 }, dev: { gx: 1.3, gy: 6.9 }, qa: { gx: 7.3, gy: 6.9 } };
  const TEMP_DESKS = [{ gx: 3.6, gy: 6.9 }, { gx: 1.3, gy: 8.6 }, { gx: 3.6, gy: 8.6 }];
  const TEMP_STAND = [{ gx: 2.7, gy: 9.5 }, { gx: 5.4, gy: 7.6 }, { gx: 5.4, gy: 9.4 }];
  const SEC_HOME = { gx: 4.6, gy: 4.35 };
  const RECEPTION = { gx: 5.35, gy: 4.85 };
  const SEC_SPOT = { planner: { gx: 3.5, gy: 1.0 }, ceo: { gx: 16.6, gy: 1.0 }, dev: { gx: 2.6, gy: 7.0 }, qa: { gx: 8.6, gy: 7.0 } };
  const MEET = [{ gx: 7.6, gy: 2.4 }, { gx: 10.4, gy: 2.0 }, { gx: 9.5, gy: 3.3 }, { gx: 8.4, gy: 3.3 }];
  const TABLE = { gx: 9, gy: 2 };
  const LOUNGE = { planner: { gx: 9.6, gy: 11.5 }, dev: { gx: 10.6, gy: 11.5 }, ceo: { gx: 11.6, gy: 11.5 }, qa: { gx: 14.3, gy: 11.8 } };
  const SOFA = { x0: 9.3, x1: 11.9, y0: 10.25, y1: 10.95 };
  const COFFEE = { gx: 14.4, gy: 10.6 };
  const COOLER = { gx: 13.4, gy: 10.6 };
  const LTABLE = { gx: 10.6, gy: 12.6 };
  const PLANTS = [{ gx: 5.5, gy: 0.5 }, { gx: 11.5, gy: 0.5 }, { gx: 17.5, gy: 0.5 }, { gx: 10.5, gy: 9.4 }, { gx: 5.6, gy: 14.4 }, { gx: 17.4, gy: 14.4 }, { gx: 4.5, gy: 10.5 }];
  const RACKS = [{ gx: 11.8, gy: 9.2 }, { gx: 12.8, gy: 9.2 }, { gx: 13.8, gy: 9.2 }, { gx: 14.8, gy: 9.2 }];
  const CONSOLE = { gx: 15.2, gy: 7.0 };
  const CABINETS = [{ gx: 0.55, gy: 10.9 }, { gx: 0.55, gy: 11.9 }, { gx: 0.55, gy: 12.9 }, { gx: 0.55, gy: 13.9 }];
  const SHREDDER = { gx: 3.9, gy: 14.3 };
  const QA_BOARD = { gx: 9.9, gy: 8.9 };
  const ENTRANCE = { gx: 0.35, gy: 5.0 };

  const iso = (gx, gy) => ({ x: OX + (gx - gy) * (TW / 2), y: OY + (gx + gy) * (TH / 2) });
  const up = (p, h) => ({ x: p.x, y: p.y - h });
  const roomAt = (gx, gy) => ROOMS.find((r) => gx >= r.x0 && gx < r.x1 && gy >= r.y0 && gy < r.y1);

  // ───────── 길 찾기(칸 단위 BFS, 칸막이는 막힌 변, 가구는 막힌 칸) ─────────
  const ckey = (x, y) => `${x},${y}`;
  const ekey = (a, b, c, d) => (a < c || (a === c && b < d) ? `${a},${b}|${c},${d}` : `${c},${d}|${a},${b}`);
  const wallEdges = new Set();
  for (const [ax, g, a, b] of WALLS) for (let i = a; i < b; i++) wallEdges.add(ax === 'x' ? ekey(i, g - 1, i, g) : ekey(g - 1, i, g, i));
  const blocked = new Set();
  const block = (p, dx = 0, dy = 0) => blocked.add(ckey(Math.floor(p.gx + dx), Math.floor(p.gy + dy)));
  for (const h of [...Object.values(HOME), ...TEMP_DESKS]) block(h, 0.62, 0.62);
  for (const p of [RECEPTION, COFFEE, COOLER, LTABLE, CONSOLE, SHREDDER, QA_BOARD, ...PLANTS, ...RACKS, ...CABINETS]) block(p);
  for (const [x, y] of [[8, 1], [9, 1], [8, 2], [9, 2], [9, 10], [10, 10], [11, 10]]) blocked.add(ckey(x, y));

  function findPath(sx, sy, tx, ty) {
    const clampX = (v) => Math.max(0, Math.min(GX - 1, Math.floor(v)));
    const clampY = (v) => Math.max(0, Math.min(GY - 1, Math.floor(v)));
    const s = [clampX(sx), clampY(sy)], g = [clampX(tx), clampY(ty)];
    const goal = ckey(g[0], g[1]);
    const prev = new Map([[ckey(s[0], s[1]), null]]);
    const q = [s];
    while (q.length) {
      const [x, y] = q.shift();
      if (ckey(x, y) === goal) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = ckey(nx, ny);
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY || prev.has(k)) continue;
        if (wallEdges.has(ekey(x, y, nx, ny))) continue;
        if (blocked.has(k) && k !== goal) continue;
        prev.set(k, [x, y]);
        q.push([nx, ny]);
      }
    }
    if (!prev.has(goal)) return [{ gx: tx, gy: ty }]; // 길이 없으면 곧장
    const cells = [];
    for (let c = g; c; c = prev.get(ckey(c[0], c[1]))) cells.unshift(c);
    const pts = cells.slice(1, -1).map(([x, y]) => ({ gx: x + 0.5, gy: y + 0.5 }));
    pts.push({ gx: tx, gy: ty });
    return pts;
  }

  // ───────── 에셋 ─────────
  const assets = { manifest: null, images: {} };
  async function loadAssets() {
    try {
      const r = await fetch('/assets/manifest.json', { cache: 'no-store' });
      if (!r.ok) return;
      const m = await r.json();
      assets.manifest = m;
      const sprites = m.sprites || {};
      await Promise.all(Object.entries(sprites).map(([key, spec]) => new Promise((res) => {
        if (!spec || !spec.src) return res();
        const img = new Image();
        img.onload = () => { assets.images[key] = { img, spec }; res(); };
        img.onerror = () => { console.warn('에셋을 불러오지 못함:', spec.src); res(); };
        img.src = '/assets/' + spec.src;
      })));
    } catch (e) { /* 매니페스트 없음 → 기본 도트 */ }
  }
  function drawAsset(ctx, key, x, y, anim, t) {
    const a = assets.images[key];
    if (!a) return false;
    const s = a.spec;
    const fw = s.frameW || a.img.width, fh = s.frameH || a.img.height;
    const frames = (s.anims && (s.anims[anim] || s.anims.idle)) || [0];
    const fps = s.fps || 6;
    const f = frames[Math.floor(t / 1000 * fps) % frames.length];
    const cols = Math.max(1, Math.floor(a.img.width / fw));
    const [ax, ay] = s.anchor || [fw / 2, fh];
    ctx.drawImage(a.img, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, Math.round(x - ax), Math.round(y - ay), fw, fh);
    return true;
  }

  // ───────── 기본 도형 ─────────
  const R = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  function poly(ctx, pts, c) {
    ctx.fillStyle = c; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(Math.round(p.x), Math.round(p.y)) : ctx.moveTo(Math.round(p.x), Math.round(p.y))));
    ctx.closePath(); ctx.fill();
  }
  function diamond(ctx, cx, cy, hw, hh, c) {
    poly(ctx, [{ x: cx, y: cy - hh }, { x: cx + hw, y: cy }, { x: cx, y: cy + hh }, { x: cx - hw, y: cy }], c);
  }
  // 바닥 위에 놓인 정사각 상자(아이소메트릭)
  function box(ctx, cx, cy, hw, hh, h, top, left, right) {
    poly(ctx, [{ x: cx - hw, y: cy }, { x: cx, y: cy + hh }, { x: cx, y: cy + hh - h }, { x: cx - hw, y: cy - h }], left);
    poly(ctx, [{ x: cx + hw, y: cy }, { x: cx, y: cy + hh }, { x: cx, y: cy + hh - h }, { x: cx + hw, y: cy - h }], right);
    diamond(ctx, cx, cy - h, hw, hh, top);
  }
  // 바닥 칸 좌표로 지정하는 직사각 상자
  function boxRect(ctx, x0, y0, x1, y1, h, top, left, right, z = 0) {
    const A = up(iso(x0, y0), z), B = up(iso(x1, y0), z), C = up(iso(x1, y1), z), D = up(iso(x0, y1), z);
    poly(ctx, [D, C, up(C, h), up(D, h)], left);
    poly(ctx, [B, C, up(C, h), up(B, h)], right);
    poly(ctx, [up(A, h), up(B, h), up(C, h), up(D, h)], top);
  }
  function floorRect(ctx, x0, y0, x1, y1, c) { poly(ctx, [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)], c); }
  // 바깥 벽면 위의 사각형. side='R'은 gy=0 벽(오른쪽 뒤), 'L'은 gx=0 벽(왼쪽 뒤)
  function wallQuad(side, a, b, h0, h1) {
    const p = (t, h) => { const q = side === 'R' ? iso(t, 0) : iso(0, t); return { x: q.x, y: q.y - h }; };
    return [p(a, h0), p(b, h0), p(b, h1), p(a, h1)];
  }
  const blink = (t, ms) => Math.floor(t / ms) % 2 === 0;

  // ───────── 상태 ─────────
  const state = {
    canvas: null, ctx: null, buf: null, bctx: null, scale: 1, offX: 0, offY: 0, dpr: 1,
    roles: {}, agents: {}, run: null, runStatus: {}, active: false, selected: null, hover: null, hoverRoom: null,
    chars: {}, fx: [], onSelect: null, onRoom: null, last: 0,
    perms: [], docs: 0, gathered: new Set(), shredUntil: 0,
  };

  function ensureChar(id, kind = 'role') {
    if (!state.chars[id]) {
      const h = HOME[id] || SEC_HOME;
      state.chars[id] = { id, kind, gx: h.gx, gy: h.gy, path: [], goal: null, walking: false, placed: kind !== 'role', idleSince: 0, huddleUntil: 0, jumpUntil: 0, desk: HOME[id] || null };
    }
    return state.chars[id];
  }

  function goTo(ch, p, key) {
    if (ch.goal === key) return;
    ch.goal = key;
    ch.path = findPath(ch.gx, ch.gy, p.gx, p.gy);
  }
  const arrived = (ch) => !ch.path.length;
  const near = (ch, p) => Math.hypot(ch.gx - p.gx, ch.gy - p.gy) < 0.1;

  // 역할 직원이 지금 있어야 할 곳
  function roleGoal(ch, t) {
    const id = ch.id;
    const a = state.agents[id] || { state: 'idle' };
    if (state.gathered.has(id)) { const i = [...state.gathered].indexOf(id); return [MEET[i % MEET.length], 'meet' + i]; }
    if (ch.huddleUntil > t) { const i = id === 'qa' ? 0 : 1; return [MEET[i], 'huddle' + i]; }
    if (a.state === 'idle' && t - ch.idleSince > LOUNGE_AFTER && LOUNGE[id]) return [LOUNGE[id], 'lounge'];
    return [HOME[id], 'home'];
  }

  function secGoal() {
    const p = state.perms.find((x) => SEC_SPOT[x.agentId]);
    if (p) return [SEC_SPOT[p.agentId], 'perm-' + p.agentId];
    return [SEC_HOME, 'home'];
  }

  // ───────── 임시 직원(서브에이전트) ─────────
  function spawnTemp(id, label, { atDesk = false } = {}) {
    const key = 'sub:' + id;
    if (state.chars[key]) return;
    const used = new Set(Object.values(state.chars).filter((c) => c.kind === 'temp').map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const desk = TEMP_DESKS[slot] || null;
    const spot = desk || TEMP_STAND[(slot - TEMP_DESKS.length) % TEMP_STAND.length];
    const start = atDesk ? spot : ENTRANCE;
    state.chars[key] = { id: key, kind: 'temp', label: label || '조사', slot, desk, spot, gx: start.gx, gy: start.gy, path: [], goal: null, walking: false, placed: true, leaving: false };
  }
  function endTemp(id) { const c = state.chars['sub:' + id]; if (c) c.leaving = true; }

  // ───────── 그리기: 방 ─────────
  function drawWalls(ctx, t) {
    poly(ctx, wallQuad('R', 0, GX, 0, WALL), P.wallR);
    poly(ctx, wallQuad('L', 0, GY, 0, WALL), P.wallL);
    poly(ctx, wallQuad('R', 0, GX, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('L', 0, GY, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('R', 0, GX, 0, 4), P.trim);
    poly(ctx, wallQuad('L', 0, GY, 0, 4), P.trim);

    // 기획실: 명세 보드(기능 수만큼 카드, 기획 중이면 다음 칸이 깜빡임)
    poly(ctx, wallQuad('R', 0.7, 5.0, 16, 46), P.trim);
    poly(ctx, wallQuad('R', 0.85, 4.85, 18, 44), '#f0f0f0');
    {
      const n = state.run && state.run.plan ? Math.min(8, state.run.plan.features.length) : 0;
      const writing = (state.agents.planner || {}).state === 'working' || (state.agents.planner || {}).state === 'thinking';
      for (let i = 0; i < 8; i++) {
        const q = iso(1.2 + (i % 4) * 0.95, 0);
        const row = Math.floor(i / 4);
        let c = '#dedede';
        if (i < n) c = ['#fbe7a6', '#cdeedf', '#f8d4cf', '#d9e8f7'][i % 4];
        else if (i === n && writing) c = blink(t, 400) ? P.lamp : '#dedede';
        R(ctx, q.x - 1, q.y - 40 + row * 11, 8, 7, c);
        if (i < n) R(ctx, q.x, q.y - 38 + row * 11, 5, 1, '#a6a6a6');
      }
    }
    // 회의실: 업무 단계 보드
    poly(ctx, wallQuad('R', 6.7, 11.3, 16, 46), P.trim);
    poly(ctx, wallQuad('R', 6.85, 11.15, 18, 44), '#f0f0f0');
    {
      const stages = state.run ? state.run.stages : null;
      for (let i = 0; i < 6; i++) {
        const q = iso(7.35 + i * 0.68, 0);
        let c = '#d4d4d4';
        if (stages && stages[i]) {
          const st = stages[i].status;
          c = st === 'done' ? P.mint : st === 'active' ? (blink(t, 400) ? P.lamp : '#e0a92b') : st === 'failed' ? P.coral : st === 'skipped' ? '#e6e6e6' : '#a6a6a6';
        }
        R(ctx, q.x - 2, q.y - 34, 6, 6, c);
        if (i < 5) R(ctx, q.x + 6, q.y - 31, 3, 1, '#a6a6a6');
      }
      const q = iso(7.2, 0); R(ctx, q.x, q.y - 41, 14, 1, '#a6a6a6'); R(ctx, q.x - 2, q.y - 39, 20, 1, '#d4d4d4');
    }
    // 대표실: 창문(밤하늘)과 시계
    for (const [a, b] of [[12.6, 14.3], [15.4, 17.3]]) {
      poly(ctx, wallQuad('R', a - 0.12, b + 0.12, 16, 50), P.trim);
      poly(ctx, wallQuad('R', a, b, 19, 47), P.sky);
      for (let i = 0; i < 4; i++) {
        const u = a + (b - a) * ((i * 0.27 + 0.13) % 1);
        const q = iso(u, 0);
        if (Math.sin(t / 700 + i * 2 + a) > -0.3) R(ctx, q.x, q.y - 24 - ((i * 7) % 18), 1, 1, P.star);
      }
      const m = iso((a + b) / 2, 0);
      R(ctx, m.x, m.y - 47, 1, 28, P.trim);
    }
    { const q = iso(16.3, 0); R(ctx, q.x - 1, q.y - 41, 4, 4, P.star); }
    { const q = iso(14.85, 0); R(ctx, q.x - 4, q.y - 44, 9, 9, P.paper); R(ctx, q.x - 4, q.y - 44, 9, 1, P.ink); R(ctx, q.x - 4, q.y - 36, 9, 1, P.ink); R(ctx, q.x - 4, q.y - 44, 1, 9, P.ink); R(ctx, q.x + 4, q.y - 44, 1, 9, P.ink);
      const ang = t / 6000; R(ctx, q.x, q.y - 40, 1, 1, P.ink); R(ctx, q.x + Math.round(Math.cos(ang) * 2), q.y - 40 + Math.round(Math.sin(ang) * 2), 1, 1, P.coral); }

    // 왼쪽 벽: 기획실 달력, 입구, 개발실 대형 화면
    poly(ctx, wallQuad('L', 1.0, 3.0, 22, 42), P.trim);
    poly(ctx, wallQuad('L', 1.1, 2.9, 23, 41), '#f0f0f0');
    for (let i = 0; i < 12; i++) { const q = iso(0, 1.3 + (i % 4) * 0.4); R(ctx, q.x - 1, q.y - 37 + Math.floor(i / 4) * 4, 2, 2, i === 5 ? P.coral : '#b8b8b8'); }
    poly(ctx, wallQuad('L', 4.25, 5.75, 0, 34), P.trim);
    poly(ctx, wallQuad('L', 4.4, 5.6, 0, 31), '#2b2b2b');
    { const q = iso(0, 5.0); R(ctx, q.x - 6, q.y - 44, 12, 5, P.mint); R(ctx, q.x - 4, q.y - 42, 8, 1, '#cdeedf'); } // 입구 표시등
    poly(ctx, wallQuad('L', 6.6, 9.4, 18, 46), P.trim);
    poly(ctx, wallQuad('L', 6.75, 9.25, 20, 44), '#1c1c1c');
    {
      const devBusy = ['working', 'thinking'].includes((state.agents.dev || {}).state);
      const shift = devBusy ? Math.floor(t / 220) : 0;
      const cols = ['#3d8fd1', '#2fa37a', '#f6c445', '#8e6bd8', '#9a9a9a'];
      for (let i = 0; i < 7; i++) {
        const k = (i + shift) % 11;
        const q = iso(0, 7.0 + (k % 3) * 0.12);
        const len = 6 + ((k * 7) % 14);
        R(ctx, q.x - 14 + (k % 3) * 2, q.y - 39 + i * 3, Math.min(len, 22), 1, devBusy ? cols[k % cols.length] : '#3a3a3a');
      }
    }
  }

  function drawFloor(ctx, t) {
    for (let gx = 0; gx < GX; gx++) {
      for (let gy = 0; gy < GY; gy++) {
        const c = iso(gx + 0.5, gy + 0.5);
        if (drawAsset(ctx, 'floor', c.x, c.y + TH / 2, 'idle', t)) continue;
        const r = roomAt(gx + 0.5, gy + 0.5);
        diamond(ctx, c.x, c.y, TW / 2, TH / 2, (gx + gy) % 2 ? r.floor[0] : r.floor[1]);
      }
    }
    // 앞쪽 바닥 테두리
    poly(ctx, [iso(0, GY), iso(GX, GY), up(iso(GX, GY), -4), up(iso(0, GY), -4)], P.lip);
    poly(ctx, [iso(GX, 0), iso(GX, GY), up(iso(GX, GY), -4), up(iso(GX, 0), -4)], P.lip2);
    // 깔개
    floorRect(ctx, 6.9, 0.7, 11.1, 3.5, '#9c9c9c'); floorRect(ctx, 7.05, 0.85, 10.95, 3.35, '#a6a6a6');
    floorRect(ctx, 8.7, 11.5, 12.6, 13.8, P.rugD); floorRect(ctx, 8.85, 11.65, 12.45, 13.65, P.rug);
    // 일하는 책상 아래 조명
    const glow = (p) => { const c = iso(p.gx + 0.6, p.gy + 0.6); ctx.globalAlpha = 0.22 + 0.06 * Math.sin(t / 300); diamond(ctx, c.x, c.y, 26, 13, P.lamp); ctx.globalAlpha = 1; };
    for (const id of Object.keys(HOME)) { const a = state.agents[id]; if (a && (a.state === 'working' || a.state === 'thinking') && near(state.chars[id] || {}, HOME[id])) glow(HOME[id]); }
    for (const c of Object.values(state.chars)) if (c.kind === 'temp' && c.desk && !c.leaving && near(c, c.desk)) glow(c.desk);
    // 서버실 바닥 케이블 라인
    for (let i = 0; i < 3; i++) floorRect(ctx, 11.3, 8.25 + i * 0.12, 15.6, 8.3 + i * 0.12, '#7a7a7a');
  }

  // ───────── 칸막이 ─────────
  function partPiece(ctx, ax, g, i, isEnd) {
    const h = PART;
    if (ax === 'x') {
      const a0 = iso(i, g - PT / 2), a1 = iso(i + 1, g - PT / 2), b0 = iso(i, g + PT / 2), b1 = iso(i + 1, g + PT / 2);
      poly(ctx, [b0, b1, up(b1, h), up(b0, h)], P.partX);
      if (isEnd) poly(ctx, [a1, b1, up(b1, h), up(a1, h)], P.partY);
      poly(ctx, [up(a0, h), up(a1, h), up(b1, h), up(b0, h)], P.partTop);
    } else {
      const a0 = iso(g - PT / 2, i), a1 = iso(g - PT / 2, i + 1), b0 = iso(g + PT / 2, i), b1 = iso(g + PT / 2, i + 1);
      poly(ctx, [b0, b1, up(b1, h), up(b0, h)], P.partY);
      if (isEnd) poly(ctx, [a1, b1, up(b1, h), up(a1, h)], P.partX);
      poly(ctx, [up(a0, h), up(a1, h), up(b1, h), up(b0, h)], P.partTop);
    }
  }

  // ───────── 그리기: 소품 ─────────
  function drawDesk(ctx, h, owner, t) {
    const c = iso(h.gx + 0.62, h.gy + 0.62);
    if (drawAsset(ctx, 'desk', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 15, 8, 10, P.wood, P.woodL, P.woodR);
    diamond(ctx, c.x, c.y - 10, 13, 6, P.woodTop2);
    const a = owner ? (state.agents[owner] || {}) : {};
    const busy = owner ? (a.state === 'working' || a.state === 'thinking') : false;
    R(ctx, c.x - 13, c.y - 22, 9, 8, P.monitor);
    R(ctx, c.x - 10, c.y - 14, 3, 2, P.monitor);
    R(ctx, c.x - 6, c.y - 20, 1, 1, busy ? (blink(t, 250) ? P.lamp : '#fff6c9') : a.state === 'waiting' ? P.coral : P.led);
    if (busy) { ctx.globalAlpha = 0.35; R(ctx, c.x - 14, c.y - 23, 1, 10, P.lamp); ctx.globalAlpha = 1; }
    if (owner) {
      R(ctx, c.x + 6, c.y - 15, 3, 3, owner === 'qa' ? P.mint : owner === 'ceo' ? P.coral : P.paper);
      R(ctx, c.x + 9, c.y - 14, 1, 1, P.ink);
    }
    if (owner === 'planner') { R(ctx, c.x + 1, c.y - 13, 5, 2, P.paper); R(ctx, c.x + 1, c.y - 13, 5, 1, '#d4d4d4'); }
    // 대표: 결재 대기 중이면 결재판이 깜빡인다
    if (owner === 'ceo') {
      const review = state.run && state.run.status === 'review';
      R(ctx, c.x - 1, c.y - 14, 7, 4, review ? (blink(t, 500) ? P.lamp : P.paper) : P.paper);
      R(ctx, c.x, c.y - 13, 5, 1, review ? P.coral : '#d4d4d4');
    }
  }

  // 임시 직원 책상(비어 있으면 모니터 꺼짐)
  function drawTempDesk(ctx, d, t) {
    const c = iso(d.gx + 0.62, d.gy + 0.62);
    if (drawAsset(ctx, 'desk', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 15, 8, 10, '#bdbdbd', '#8f8f8f', '#a3a3a3');
    diamond(ctx, c.x, c.y - 10, 13, 6, '#cfcfcf');
    const used = Object.values(state.chars).some((ch) => ch.kind === 'temp' && ch.desk === d && !ch.leaving && near(ch, d));
    R(ctx, c.x - 13, c.y - 22, 9, 8, P.monitor);
    R(ctx, c.x - 10, c.y - 14, 3, 2, P.monitor);
    if (used) { R(ctx, c.x - 12, c.y - 21, 7, 5, blink(t, 300) ? '#3d8fd1' : '#2c71aa'); }
  }

  function drawTable(ctx, t) {
    const c = iso(TABLE.gx, TABLE.gy);
    if (drawAsset(ctx, 'table', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 22, 11, 9, P.wood, P.woodL, P.woodR);
    diamond(ctx, c.x, c.y - 9, 19, 9, P.woodTop2);
    if (state.gathered.size || Object.values(state.chars).some((ch) => ch.huddleUntil > t)) {
      R(ctx, c.x - 5, c.y - 12, 6, 4, P.paper); R(ctx, c.x + 2, c.y - 11, 5, 4, P.paper);
      R(ctx, c.x - 4, c.y - 11, 4, 1, '#a6a6a6');
    }
  }

  function drawReception(ctx, t) {
    const c = iso(RECEPTION.gx, RECEPTION.gy);
    if (drawAsset(ctx, 'reception', c.x, c.y, 'idle', t)) return;
    boxRect(ctx, RECEPTION.gx - 0.55, RECEPTION.gy - 0.35, RECEPTION.gx + 0.55, RECEPTION.gy + 0.35, 11, '#e6e6e6', '#9a9a9a', '#b8b8b8');
    const pending = state.perms.length > 0;
    R(ctx, c.x - 2, c.y - 15, 4, 2, pending ? (blink(t, 350) ? P.coral : P.lamp) : P.led); // 호출 벨
    R(ctx, c.x + 4, c.y - 13, 5, 2, P.paper);
  }

  function drawPlant(ctx, p, t) {
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'plant', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 5, 3, 6, '#c97a4f', '#8f4a2a', P.pot);
    const sway = Math.round(Math.sin(t / 900 + p.gx) * 0.6);
    R(ctx, c.x - 4 + sway, c.y - 16, 8, 8, P.plant);
    R(ctx, c.x - 2 + sway, c.y - 20, 4, 4, P.plant);
    R(ctx, c.x - 5 + sway, c.y - 12, 3, 3, P.plantD);
    R(ctx, c.x + 2 + sway, c.y - 14, 3, 3, P.plantD);
  }

  function drawCooler(ctx, t) {
    const c = iso(COOLER.gx, COOLER.gy);
    if (drawAsset(ctx, 'cooler', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 5, 3, 14, '#e6e6e6', '#b3b3b3', '#d4d4d4');
    R(ctx, c.x - 3, c.y - 25, 6, 8, '#9fd0f2');
    R(ctx, c.x - 2, c.y - 24, 2, 5, '#cfe9fb');
  }

  function drawCoffee(ctx, t) {
    const c = iso(COFFEE.gx, COFFEE.gy);
    if (drawAsset(ctx, 'coffee', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 6, 3, 18, '#4a4a4a', '#2e2e2e', '#3a3a3a');
    R(ctx, c.x + 1, c.y - 12, 3, 3, P.paper);
    R(ctx, c.x - 4, c.y - 16, 2, 1, P.coral);
    const inLounge = Object.values(state.chars).some((ch) => ch.goal === 'lounge' && !ch.walking);
    if (inLounge) { const s = Math.floor(t / 300) % 3; R(ctx, c.x + 2, c.y - 16 - s, 1, 2, '#e6e6e6'); }
  }

  function drawSofa(ctx, t) {
    const c = iso((SOFA.x0 + SOFA.x1) / 2, (SOFA.y0 + SOFA.y1) / 2);
    if (drawAsset(ctx, 'sofa', c.x, c.y, 'idle', t)) return;
    boxRect(ctx, SOFA.x0, SOFA.y0, SOFA.x1, SOFA.y0 + 0.22, 15, P.leatherR, P.leatherL, P.leatherR); // 등받이
    boxRect(ctx, SOFA.x0, SOFA.y0 + 0.22, SOFA.x1, SOFA.y1, 7, P.leather, P.leatherL, P.leatherR);  // 방석
    boxRect(ctx, SOFA.x0, SOFA.y0, SOFA.x0 + 0.22, SOFA.y1, 11, P.leatherR, P.leatherL, P.leatherR); // 팔걸이
    boxRect(ctx, SOFA.x1 - 0.22, SOFA.y0, SOFA.x1, SOFA.y1, 11, P.leatherR, P.leatherL, P.leatherR);
  }

  function drawLoungeTable(ctx, t) {
    const c = iso(LTABLE.gx, LTABLE.gy);
    if (drawAsset(ctx, 'loungeTable', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 12, 6, 6, P.woodTop2, P.woodL, P.woodR);
    R(ctx, c.x - 4, c.y - 9, 3, 2, P.paper); R(ctx, c.x + 2, c.y - 8, 3, 2, P.coral);
  }

  // 서버실: 확인 명령·셸 명령이 돌면 랙이 바쁘게 깜빡이고, 마지막 확인 결과를 경광등으로 보여준다
  function serverBusy() {
    if (state.run && state.run.checking) return true;
    return Object.keys(HOME).some((id) => { const a = state.agents[id]; return a && a.state === 'working' && /^(Bash|PowerShell)/.test(a.bubble || ''); });
  }
  function checkTone() {
    const run = state.run;
    if (run && run.checking) return 'run';
    if (run && run.check && run.check.command) return run.check.ok ? 'ok' : 'fail';
    const qa = run && run.qa && run.qa[run.qa.length - 1];
    if (qa) return qa.pass ? 'ok' : 'fail';
    return 'none';
  }
  function drawRack(ctx, p, i, t, busy) {
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'rack', c.x, c.y, busy ? 'work' : 'idle', t)) return;
    box(ctx, c.x, c.y, 7, 3.5, 26, P.rack, P.rackL, P.rackR);
    for (let r = 0; r < 6; r++) {
      for (let k = 0; k < 2; k++) {
        const seed = (r * 7 + k * 3 + i * 11);
        let col = '#2f5a45';
        if (busy) col = ((Math.floor(t / 120) + seed) % 5 === 0) ? P.lamp : ((Math.floor(t / 90) + seed) % 3 ? '#5fd39f' : '#2f5a45');
        else if ((Math.floor(t / 1400) + seed) % 9 === 0) col = '#5fd39f';
        R(ctx, c.x - 5 + k * 3, c.y - 22 + r * 3.4 + k * 1.5, 1, 1, col);
      }
    }
    if (i === 0) {
      const tone = checkTone();
      const col = tone === 'run' ? (blink(t, 250) ? P.lamp : '#7a5d12') : tone === 'ok' ? P.mint : tone === 'fail' ? (blink(t, 700) ? P.coral : '#7a2a24') : '#555555';
      R(ctx, c.x - 2, c.y - 32, 4, 3, col);
      R(ctx, c.x - 1, c.y - 33, 2, 1, col);
    }
  }
  function drawConsole(ctx, t) {
    const c = iso(CONSOLE.gx, CONSOLE.gy);
    if (drawAsset(ctx, 'console', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 8, 4, 9, '#6a6a6a', '#4a4a4a', '#5a5a5a');
    R(ctx, c.x - 6, c.y - 21, 10, 8, P.monitor);
    const tone = checkTone();
    const col = tone === 'run' ? P.lamp : tone === 'ok' ? P.mint : tone === 'fail' ? P.coral : '#3a3a3a';
    for (let i = 0; i < 3; i++) R(ctx, c.x - 5, c.y - 20 + i * 2, tone === 'run' ? 2 + ((Math.floor(t / 150) + i) % 7) : 7 - i * 2, 1, col);
  }

  // 문서 보관실: 회사 문서가 쌓일수록 캐비닛 위 서류가 늘어난다. 폐기하면 파쇄기가 돈다.
  function drawCabinet(ctx, p, i, t) {
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'cabinet', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 8, 4, 22, '#a8a8a8', P.metalL, P.metalR);
    for (let k = 0; k < 3; k++) { R(ctx, c.x + 1, c.y - 17 + k * 6, 6, 1, '#6a6a6a'); R(ctx, c.x + 3, c.y - 15 + k * 6, 2, 1, '#d4d4d4'); }
    const stack = Math.max(0, Math.min(6, state.docs - i * 6)); // 문서 하나당 한 장, 캐비닛마다 6장까지
    for (let k = 0; k < stack; k++) R(ctx, c.x - 4 + (k % 2), c.y - 24 - k * 2, 8, 2, k % 2 ? P.paper : '#e6e6e6');
  }
  function drawShredder(ctx, t) {
    const c = iso(SHREDDER.gx, SHREDDER.gy);
    if (drawAsset(ctx, 'shredder', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 6, 3, 11, '#5a5a5a', '#3a3a3a', '#4a4a4a');
    R(ctx, c.x - 4, c.y - 14, 8, 1, P.ink);
    const on = state.shredUntil > t;
    R(ctx, c.x + 2, c.y - 9, 3, 2, on ? (blink(t, 120) ? P.coral : P.lamp) : '#2a5a40');
    if (on) {
      // 위에서 서류가 빨려 들어가고 옆으로 종이 조각이 흩날린다
      const k0 = Math.floor(t / 80);
      R(ctx, c.x - 3, c.y - 19 + (k0 % 5), 6, 4, P.paper);
      for (let k = 0; k < 6; k++) {
        const ph = (k0 + k * 3) % 10;
        R(ctx, c.x - 9 + k * 3 + (ph > 5 ? 1 : 0), c.y - 6 + ph, 1, 2, k % 2 ? P.paper : '#d4d4d4');
      }
    }
  }

  // QA실 칠판: 체크리스트 항목별 최근 판정
  function drawQaBoard(ctx, t) {
    const p = QA_BOARD;
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'board', c.x, c.y, 'idle', t)) return;
    const L = iso(p.gx - 0.7, p.gy), Rr = iso(p.gx + 0.7, p.gy);
    R(ctx, L.x + 3, L.y - 8, 1, 8, '#6a6a6a'); R(ctx, Rr.x - 4, Rr.y - 8, 1, 8, '#6a6a6a');
    poly(ctx, [up(L, 8), up(Rr, 8), up(Rr, 30), up(L, 30)], P.trim);
    poly(ctx, [up(L, 10), up(Rr, 10), up(Rr, 28), up(L, 28)], '#f0f0f0');
    const run = state.run;
    const crit = run && run.contract ? run.contract.criteria : [];
    const qa = run && run.qa && run.qa[run.qa.length - 1];
    const res = new Map(((qa && qa.results) || []).map((r) => [r.id, r.status]));
    const qaBusy = ['working', 'thinking'].includes((state.agents.qa || {}).state);
    const n = Math.min(12, crit.length);
    for (let i = 0; i < 12; i++) {
      const u = (i % 6) / 6 * 1.2 + 0.12;
      const q = iso(p.gx - 0.7 + u, p.gy);
      const row = Math.floor(i / 6);
      let col = '#dedede';
      if (i < n) {
        const st = res.get(crit[i].id);
        col = st === 'pass' ? P.mint : st === 'fail' ? P.coral : st === 'skip' ? P.lamp : qaBusy ? (blink(t + i * 90, 300) ? '#bdbdbd' : '#9a9a9a') : '#a6a6a6';
      }
      R(ctx, q.x, q.y - 25 + row * 7, 3, 3, col);
    }
  }

  // ───────── 그리기: 직원 ─────────
  function charState(ch) {
    if (ch.kind === 'role') return state.agents[ch.id] || { state: 'idle' };
    if (ch.kind === 'temp') return { state: !ch.leaving && near(ch, ch.spot) ? 'working' : 'idle', bubble: ch.label };
    // 비서: 승인 요청이 있는 직원 옆에 도착하면 손을 든다
    return { state: state.perms.length && ch.goal !== 'home' && !ch.walking ? 'waiting' : 'idle' };
  }
  function lookOf(ch) { return ch.kind === 'temp' ? LOOKS.temp : ch.kind === 'sec' ? LOOKS.sec : (LOOKS[ch.id] || LOOKS.dev); }

  function drawChar(ctx, ch, t) {
    const id = ch.id;
    const a = charState(ch);
    const p = iso(ch.gx, ch.gy);
    let x = Math.round(p.x), y = Math.round(p.y);
    const look = lookOf(ch);
    const anim = ch.walking ? 'walk' : a.state === 'working' ? 'work' : a.state === 'waiting' ? 'wait' : a.state === 'thinking' ? 'think' : 'idle';
    if (ch.jumpUntil > t) y -= Math.round(Math.sin((1 - (ch.jumpUntil - t) / 500) * Math.PI) * 4);

    if (state.selected === id || state.hover === id) {
      ctx.globalAlpha = state.selected === id ? 0.9 : 0.5;
      diamond(ctx, x, y, 10, 5, P.lamp);
      ctx.globalAlpha = 1;
      diamond(ctx, x, y, 7, 3.5, state.selected === id ? '#ffe9a3' : P.floorA);
    } else {
      ctx.globalAlpha = 0.25; diamond(ctx, x, y, 7, 3.5, P.ink); ctx.globalAlpha = 1;
    }
    const spriteKey = ch.kind === 'temp' ? 'char.temp' : ch.kind === 'sec' ? 'char.sec' : 'char.' + id;
    if (drawAsset(ctx, spriteKey, x, y, anim, t)) return;

    const bob = anim === 'work' ? (Math.floor(t / 180) % 2) : anim === 'idle' || anim === 'think' ? (Math.floor(t / 900) % 2) : 0;
    const by = y - bob;
    const step = ch.walking ? (Math.floor(t / 140) % 2) : 0;
    R(ctx, x - 4, y - 6 - (step ? 1 : 0), 3, 6 - (step ? 1 : 0), P.pants);
    R(ctx, x + 1, y - 6 - (step ? 0 : 1) * (ch.walking ? 1 : 0), 3, 6 - (ch.walking && !step ? 1 : 0), P.pants);
    R(ctx, x - 4, y - 1, 3, 1, P.ink); R(ctx, x + 1, y - 1, 3, 1, P.ink);
    R(ctx, x - 5, by - 14, 10, 8, look.shirt);
    R(ctx, x + 3, by - 14, 2, 8, look.shirtS);
    if (look.tie) { R(ctx, x - 1, by - 14, 2, 6, look.accent); R(ctx, x - 2, by - 14, 4, 1, P.paper); }
    if (look.collar) R(ctx, x - 3, by - 14, 6, 1, look.accent);
    if (look.badge) R(ctx, x - 4, by - 12, 2, 2, look.accent);
    if (anim === 'wait') {
      R(ctx, x + 5, by - 22, 2, 9, look.shirtS); R(ctx, x + 5, by - 24, 2, 2, P.skin);
      R(ctx, x - 7, by - 13, 2, 6, look.shirt); R(ctx, x - 7, by - 7, 2, 2, P.skin);
    } else if (anim === 'work') {
      const k = Math.floor(t / 120) % 2;
      R(ctx, x - 7, by - 13, 2, 5, look.shirt); R(ctx, x - 6, by - 8 - k, 3, 2, P.skin);
      R(ctx, x + 5, by - 13, 2, 5, look.shirtS); R(ctx, x + 3, by - 8 - (1 - k), 3, 2, P.skin);
    } else {
      R(ctx, x - 7, by - 13, 2, 6, look.shirt); R(ctx, x - 7, by - 7, 2, 2, P.skin);
      R(ctx, x + 5, by - 13, 2, 6, look.shirtS); R(ctx, x + 5, by - 7, 2, 2, P.skin);
      if (ch.goal === 'lounge' && !ch.walking && id === 'qa') R(ctx, x + 5, by - 10, 2, 3, P.paper); // 커피잔
    }
    R(ctx, x - 3, by - 21, 7, 7, P.skin);
    R(ctx, x + 3, by - 21, 1, 7, P.skinS);
    const blinkEye = Math.floor((t + id.length * 777) / 140) % 28 === 0;
    const eyeY = by - 18;
    if (!blinkEye) { R(ctx, x - 2, eyeY, 1, 2, P.ink); R(ctx, x + 1, eyeY, 1, 2, P.ink); }
    else { R(ctx, x - 2, eyeY + 1, 1, 1, P.ink); R(ctx, x + 1, eyeY + 1, 1, 1, P.ink); }
    if (look.glasses) { R(ctx, x - 3, eyeY - 1, 3, 1, P.ink); R(ctx, x + 0, eyeY - 1, 3, 1, P.ink); }
    R(ctx, x - 3, by - 22, 7, 2, look.hair);
    if (look.style === 'bob') { R(ctx, x - 4, by - 21, 1, 6, look.hair); R(ctx, x + 4, by - 21, 1, 6, look.hair); R(ctx, x - 4, by - 22, 9, 1, look.hair); }
    else if (look.style === 'messy') { R(ctx, x - 4, by - 21, 1, 3, look.hair); R(ctx, x - 1, by - 23, 2, 1, look.hair); R(ctx, x + 3, by - 23, 1, 1, look.hair); }
    else { R(ctx, x - 4, by - 21, 1, 2, look.hair); }
    if (look.headphones) { R(ctx, x - 4, by - 23, 9, 1, P.ink); R(ctx, x - 5, by - 19, 2, 3, P.coral); R(ctx, x + 4, by - 19, 2, 3, P.coral); }
  }

  // ───────── 효과(서류 전달 등) ─────────
  function charPos(id) { const c = state.chars[id]; return c ? iso(c.gx, c.gy) : iso(9, 5); }
  function drawFx(ctx, t) {
    state.fx = state.fx.filter((f) => t < f.start + f.dur);
    for (const f of state.fx) {
      if (t < f.start) continue;
      const k = Math.max(0, Math.min(1, (t - f.start) / f.dur));
      if (f.kind === 'paper') {
        const x = f.a.x + (f.b.x - f.a.x) * k;
        const y = f.a.y + (f.b.y - f.a.y) * k - Math.sin(k * Math.PI) * 36 - 18;
        R(ctx, x - 3, y - 4, 6, 7, P.paper);
        R(ctx, x - 2, y - 2, 4, 1, '#a6a6a6'); R(ctx, x - 2, y, 3, 1, '#a6a6a6');
        R(ctx, x - 3, y + 3, 6, 1, '#d4d4d4');
      }
    }
  }
  function paper(a, b, delay = 0) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    state.fx.push({ kind: 'paper', a, b, start: performance.now() + delay, dur: 700 + dist * 3 });
    return 700 + dist * 3;
  }

  // ───────── 화면 해상도 레이어(방 이름, 이름표, 말풍선) ─────────
  function toScreen(lx, ly) { return { x: state.offX + lx * state.scale, y: state.offY + ly * state.scale }; }
  function pixelBox(ctx, x, y, w, h, fill, border, bw) {
    ctx.fillStyle = border; ctx.fillRect(x - bw, y - bw, w + bw * 2, h + bw * 2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  }
  function drawRoomLabels(ctx) {
    const d = state.dpr;
    const fs = Math.max(9, Math.round(10 * d));
    ctx.font = `${fs}px Galmuri9, Galmuri11, monospace`;
    ctx.textBaseline = 'middle';
    for (const r of ROOMS) {
      if (!r.name || r.key === 'hall') continue;
      const p = iso(r.x0 + 0.35, r.y1 - 0.25);
      const s = toScreen(p.x, p.y);
      const tw = ctx.measureText(r.name).width;
      const hot = state.hoverRoom === r.key;
      ctx.globalAlpha = hot ? 0.95 : 0.72;
      ctx.fillStyle = hot ? '#f6c445' : '#141414';
      ctx.fillRect(Math.round(s.x - 2 * d), Math.round(s.y - fs / 2 - 3 * d), Math.round(tw + 8 * d), Math.round(fs + 6 * d));
      ctx.fillStyle = hot ? '#141414' : '#f5f5f5';
      ctx.fillText(r.name, Math.round(s.x + 2 * d), Math.round(s.y));
      ctx.globalAlpha = 1;
    }
  }
  function drawOverlay(ctx, t) {
    const d = state.dpr;
    // 화면이 좁아 사무실이 작게 그려지면 방 이름은 숨기고 글씨를 조금 줄여 겹침을 줄인다
    const cssScale = state.scale / d;
    if (cssScale >= 1.3) drawRoomLabels(ctx);
    const fs = Math.round(12 * d * Math.max(0.75, Math.min(1, cssScale / 1.6)));
    ctx.font = `${fs}px Galmuri11, Galmuri9, monospace`;
    ctx.textBaseline = 'middle';
    const order = Object.values(state.chars).sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
    for (const ch of order) {
      const id = ch.id;
      const a = charState(ch);
      const p = iso(ch.gx, ch.gy);
      const s = toScreen(p.x, p.y);
      const label = ch.kind === 'temp' ? '도우미' : ch.kind === 'sec' ? '비서' : (state.roles[id] || { name: id }).name;
      const tw = ctx.measureText(label).width;
      const pad = 4 * d;
      const atDesk = ch.desk && near(ch, ch.desk);
      // 책상 앞에 있으면 책상 아래쪽에 이름표(비서는 안내 데스크 뒤에 서 있어 바로 아래)
      const ny = s.y + (atDesk ? (ch.kind === 'sec' ? 8 : 20) : 4) * state.scale;
      const dim = ch.kind !== 'role';
      pixelBox(ctx, Math.round(s.x - tw / 2 - pad), Math.round(ny), Math.round(tw + pad * 2), Math.round(fs + 4 * d), state.selected === id ? '#f6c445' : dim ? '#4a4a4a' : '#141414', '#141414', Math.round(d));
      ctx.fillStyle = state.selected === id ? '#141414' : '#f5f5f5';
      ctx.fillText(label, Math.round(s.x - tw / 2), Math.round(ny + (fs + 4 * d) / 2 + d * 0.5));

      let text = null, tone = 'normal';
      if (ch.kind === 'sec') continue; // 비서는 손만 든다(말풍선은 승인을 요청한 직원이 띄움)
      if (a.state === 'thinking') text = '생각 중' + '.'.repeat(1 + (Math.floor(t / 400) % 3));
      else if (a.state === 'working') text = a.bubble || '작업 중';
      else if (a.state === 'waiting') { text = a.bubble || '승인 필요'; tone = 'alert'; }
      else if (a.state === 'done') { text = a.bubble || '완료'; tone = 'good'; }
      else if (a.state === 'failed') { text = a.bubble || '문제 발생'; tone = 'bad'; }
      if (!text) continue;
      if (text.length > 26) text = text.slice(0, 25) + '…';
      const bw = ctx.measureText(text).width + pad * 2;
      const bh = fs + 8 * d;
      const headTop = toScreen(p.x, p.y - 26 - (a.state === 'waiting' ? 4 : 0));
      let bx = Math.round(headTop.x - bw / 2);
      bx = Math.max(4 * d, Math.min(state.canvas.width - bw - 4 * d, bx));
      const byy = Math.round(headTop.y - bh - 6 * d);
      const blinkOff = tone === 'alert' && Math.floor(t / 450) % 2 === 0;
      const fill = tone === 'alert' ? (blinkOff ? '#fbe7a6' : '#f6c445') : tone === 'good' ? '#cdeedf' : tone === 'bad' ? '#f8d4cf' : '#ffffff';
      pixelBox(ctx, bx, byy, Math.round(bw), Math.round(bh), fill, '#141414', Math.round(2 * d));
      ctx.fillStyle = '#141414';
      const tx = Math.round(headTop.x);
      ctx.fillRect(tx - 3 * d, byy + bh + 2 * d, 6 * d, 2 * d);
      ctx.fillRect(tx - 1 * d, byy + bh + 4 * d, 2 * d, 2 * d);
      ctx.fillStyle = fill; ctx.fillRect(tx - 2 * d, byy + bh, 4 * d, 2 * d);
      ctx.fillStyle = '#141414';
      ctx.fillText(text, bx + pad, byy + bh / 2 + d * 0.5);
    }
  }

  // ───────── 업데이트/루프 ─────────
  function update(dt, t) {
    for (const ch of Object.values(state.chars)) {
      if (ch.kind === 'role' && ch.placed) { const [p, key] = roleGoal(ch, t); goTo(ch, p, key); }
      else if (ch.kind === 'sec') { const [p, key] = secGoal(); goTo(ch, p, key); }
      else if (ch.kind === 'temp') {
        if (ch.leaving) { goTo(ch, ENTRANCE, 'exit'); if (arrived(ch)) { delete state.chars[ch.id]; continue; } }
        else goTo(ch, ch.spot, 'desk');
      }
      const next = ch.path[0];
      if (!next) { ch.walking = false; continue; }
      const dx = next.gx - ch.gx, dy = next.gy - ch.gy;
      const dist = Math.hypot(dx, dy);
      const sp = 4.2 * dt;
      if (dist <= sp) { ch.gx = next.gx; ch.gy = next.gy; ch.path.shift(); }
      else { ch.gx += dx / dist * sp; ch.gy += dy / dist * sp; }
      ch.walking = ch.path.length > 0;
    }
  }

  function resize() {
    const c = state.canvas;
    const r = c.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    state.dpr = d;
    c.width = Math.max(1, Math.round(r.width * d));
    c.height = Math.max(1, Math.round(r.height * d));
    const fit = Math.min(c.width / W, c.height / H);
    state.scale = fit >= 2 ? Math.floor(fit) : fit; // 2배 이상은 정수배로 선명하게
    state.offX = Math.round((c.width - W * state.scale) / 2);
    state.offY = Math.round((c.height - H * state.scale) / 2);
  }

  function frame(now) {
    const t = now;
    const dt = Math.min(0.1, (now - (state.last || now)) / 1000);
    state.last = now;
    update(dt, t);
    const b = state.bctx;
    b.clearRect(0, 0, W, H);
    drawWalls(b, t);
    drawFloor(b, t);
    const items = [];
    const add = (d, draw) => items.push({ d, draw });
    for (const [ax, g, a, e] of WALLS) for (let i = a; i < e; i++) add(i + 0.5 + g + 0.01, () => partPiece(b, ax, g, i, i === e - 1));
    for (const id of Object.keys(HOME)) { const h = HOME[id]; add(h.gx + h.gy + 1.24, () => drawDesk(b, h, id, t)); }
    for (const dsk of TEMP_DESKS) add(dsk.gx + dsk.gy + 1.24, () => drawTempDesk(b, dsk, t));
    add(TABLE.gx + TABLE.gy, () => drawTable(b, t));
    add(RECEPTION.gx + RECEPTION.gy + 0.3, () => drawReception(b, t));
    for (const p of PLANTS) add(p.gx + p.gy, () => drawPlant(b, p, t));
    add(COOLER.gx + COOLER.gy, () => drawCooler(b, t));
    add(COFFEE.gx + COFFEE.gy, () => drawCoffee(b, t));
    add(SOFA.x1 + SOFA.y1 - 0.6, () => drawSofa(b, t));
    add(LTABLE.gx + LTABLE.gy, () => drawLoungeTable(b, t));
    const busy = serverBusy();
    RACKS.forEach((p, i) => add(p.gx + p.gy, () => drawRack(b, p, i, t, busy)));
    add(CONSOLE.gx + CONSOLE.gy, () => drawConsole(b, t));
    CABINETS.forEach((p, i) => add(p.gx + p.gy, () => drawCabinet(b, p, i, t)));
    add(SHREDDER.gx + SHREDDER.gy, () => drawShredder(b, t));
    add(QA_BOARD.gx + QA_BOARD.gy, () => drawQaBoard(b, t));
    for (const ch of Object.values(state.chars)) {
      const atTable = Math.hypot(ch.gx - TABLE.gx, ch.gy - TABLE.gy) < 1.6;
      add(ch.gx + ch.gy + (atTable ? 1.2 : 0), () => drawChar(b, ch, t));
    }
    items.sort((a, c) => a.d - c.d);
    for (const it of items) it.draw();
    drawFx(b, t);

    const ctx = state.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#262626';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
    if (!state.active) ctx.globalAlpha = 0.45;
    ctx.drawImage(state.buf, state.offX, state.offY, W * state.scale, H * state.scale);
    ctx.globalAlpha = 1;
    if (state.active) drawOverlay(ctx, t);
    requestAnimationFrame(frame);
  }

  function toLogical(ev) {
    const r = state.canvas.getBoundingClientRect();
    return { mx: (ev.clientX - r.left) * state.dpr, my: (ev.clientY - r.top) * state.dpr };
  }
  function hitChar(ev) {
    const { mx, my } = toLogical(ev);
    let best = null, bestD = Infinity;
    for (const ch of Object.values(state.chars)) {
      if (ch.kind !== 'role') continue;
      const p = iso(ch.gx, ch.gy);
      const s = toScreen(p.x, p.y - 12);
      const hw = 9 * state.scale, hh = 16 * state.scale;
      if (Math.abs(mx - s.x) < hw && Math.abs(my - s.y) < hh) {
        const dd = Math.abs(mx - s.x) + Math.abs(my - s.y);
        if (dd < bestD) { bestD = dd; best = ch.id; }
      }
    }
    return best;
  }
  // 눌러서 여는 방(문서 보관실 → 산출물)
  function hitRoom(ev) {
    const { mx, my } = toLogical(ev);
    const lx = (mx - state.offX) / state.scale, ly = (my - state.offY) / state.scale;
    const u = (lx - OX) / (TW / 2), v = (ly - OY) / (TH / 2);
    const gx = (u + v) / 2, gy = (v - u) / 2;
    const r = roomAt(gx, gy);
    return r && r.key === 'docs' ? r.key : null;
  }

  // ───────── 공개 API ─────────
  window.Office = {
    async init(canvas, { onSelect, onRoom } = {}) {
      state.canvas = canvas;
      state.ctx = canvas.getContext('2d');
      state.buf = document.createElement('canvas');
      state.buf.width = W; state.buf.height = H;
      state.bctx = state.buf.getContext('2d');
      state.onSelect = onSelect;
      state.onRoom = onRoom;
      for (const id of Object.keys(HOME)) ensureChar(id);
      const sec = ensureChar('sec', 'sec');
      sec.desk = SEC_HOME;
      new ResizeObserver(resize).observe(canvas);
      resize();
      canvas.addEventListener('mousemove', (e) => {
        const h = state.active ? hitChar(e) : null;
        const room = state.active && !h ? hitRoom(e) : null;
        state.hover = h; state.hoverRoom = room;
        canvas.style.cursor = h || room ? 'pointer' : 'default';
      });
      canvas.addEventListener('mouseleave', () => { state.hover = null; state.hoverRoom = null; });
      canvas.addEventListener('click', (e) => {
        if (!state.active) return;
        const h = hitChar(e);
        if (h && state.onSelect) return state.onSelect(h);
        const room = hitRoom(e);
        if (room && state.onRoom) state.onRoom(room);
      });
      await loadAssets();
      requestAnimationFrame(frame);
    },
    setRoles(roles) { state.roles = roles || {}; },
    setActive(on) { state.active = !!on; },
    setAgent(a) {
      const prev = state.agents[a.id];
      state.agents[a.id] = a;
      const ch = ensureChar(a.id);
      const now = performance.now();
      if (a.state === 'idle' && (!prev || prev.state !== 'idle')) ch.idleSince = prev ? now : now - LOUNGE_AFTER;
      if (!ch.placed) {
        // 처음 그릴 때: 쉬고 있으면 라운지에서, 일하는 중이면 자리에서 시작
        const spot = a.state === 'idle' && LOUNGE[a.id] ? LOUNGE[a.id] : HOME[a.id];
        if (spot) { ch.gx = spot.gx; ch.gy = spot.gy; }
        ch.goal = a.state === 'idle' ? 'lounge' : 'home';
        ch.placed = true;
      }
      if (a.state === 'done' && (!prev || prev.state !== 'done')) ch.jumpUntil = now + 500;
    },
    setAgents(map) { for (const a of Object.values(map || {})) this.setAgent(a); },
    setRun(run) {
      // 결재 결과를 사무실에 반영: 승인 → 서류를 문서 보관실로, 폐기 → 파쇄기
      if (run) {
        const prev = state.runStatus[run.id];
        if (prev && prev !== run.status) {
          if (run.status === 'done' && (prev === 'running' || prev === 'review')) {
            paper(charPos('ceo'), iso(CABINETS[0].gx, CABINETS[0].gy));
          } else if (run.status === 'discarded') {
            const dur = paper(charPos('ceo'), iso(SHREDDER.gx, SHREDDER.gy));
            state.shredUntil = performance.now() + dur + 1800;
          }
        }
        state.runStatus[run.id] = run.status;
      }
      state.run = run;
    },
    setPerms(list) { state.perms = (list || []).filter((p) => p.status === 'pending' || !p.status); },
    setDocs(n) { state.docs = n || 0; },
    setSubs(list) {
      for (const k of Object.keys(state.chars)) if (state.chars[k].kind === 'temp') delete state.chars[k];
      for (const s of list || []) spawnTemp(s.id, s.label, { atDesk: true });
    },
    select(id) { state.selected = id; },
    fx(e) {
      const now = performance.now();
      if (e.kind === 'handoff' && e.from && e.to && e.from !== e.to) {
        paper(charPos(e.from), charPos(e.to));
        // QA 반려: 개발자와 QA가 회의실에서 잠깐 이야기한다
        if (e.from === 'qa' && e.to === 'dev') for (const id of ['qa', 'dev']) ensureChar(id).huddleUntil = now + 4500;
      } else if (e.kind === 'gather') {
        for (const id of e.ids || []) state.gathered.add(id);
      } else if (e.kind === 'disperse') {
        for (const id of e.ids || []) state.gathered.delete(id);
      } else if (e.kind === 'sub-start') {
        spawnTemp(e.id, e.label);
      } else if (e.kind === 'sub-end') {
        endTemp(e.id);
      }
    },
  };
})();
