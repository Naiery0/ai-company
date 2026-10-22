// 쿼터뷰(아이소메트릭) 도트 사무실 렌더러.
// - 모든 그래픽은 코드로 그린 임시 도트(절차적 스프라이트)이며, /assets/manifest.json 에
//   이미지를 등록하면 해당 요소가 그 이미지로 교체된다(자세한 형식은 /assets/README.md).
// - 월드는 낮은 해상도 버퍼(W×H)에 그리고 정수배로 확대해 픽셀 느낌을 유지한다.
// - 이름표와 말풍선은 가독성을 위해 화면 해상도에서 도트 폰트로 그린다.
// - 방과 캐릭터는 모두 실제로 일어나는 일과 연결된다(토큰 0). 개발 팀원은 평소 자리를 지키다가
//   개발 팀장이 서브에이전트에게 일을 맡기면 그 일을 받아 일하는 모습으로 바뀐다.
(function () {
  const TW = 32, TH = 16;            // 타일 크기
  const GX = 18, GY = 15;            // 바닥 칸 수
  const WALL = 58;                   // 바깥 벽 높이
  const PART = 18;                   // 칸막이 높이(사람 머리·모니터는 넘겨 보일 만큼만)
  const PT = 0.16;                   // 칸막이 두께(타일)
  const OX = GY * 16 + 4;            // 원점(뒤쪽 모서리) x
  const OY = 66;                     // 원점 y
  const W = (GX + GY) * 16 + 8;      // 논리 해상도
  const H = OY + (GX + GY) * 8 + 10;
  const TILT = 1.25;                 // 세로로 늘려 그리는 배율(내려다보는 각도를 키워 건물이 세로로 깊어 보이게)

  const P = {
    ink: '#141414', floorA: '#bdbdbd', floorB: '#b0b0b0',
    wallL: '#d0d0d0', wallR: '#e0e0e0', wallTop: '#a8a8a8', trim: '#b8b8b8', frame: '#8a8a8a',
    partX: '#dadada', partY: '#c6c6c6', partTop: '#f3f3f3', lip: '#b4b4b4', lip2: '#a4a4a4',
    wood: '#c98d55', woodL: '#9e6738', woodR: '#b47844', woodTop2: '#d9a06a',
    monitor: '#2a2a2a', led: '#6b6b6b', lamp: '#f6c445', coral: '#e2574c', mint: '#2fa37a',
    skin: '#f1c7a4', skinS: '#d9a882', pants: '#2a2a2a', paper: '#f5f5f5', plant: '#3e9a62', plantD: '#2b6e46', pot: '#b9643c',
    star: '#fbe7a6', rug: '#d9c48c', rugD: '#c4ad72', metal: '#9a9a9a', metalL: '#7a7a7a', metalR: '#8a8a8a',
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
  // 개발 팀원(개발실 나머지 자리)
  const MEMBER_LOOKS = [
    { shirt: '#5b7fa8', shirtS: '#46668a', hair: '#3b2a20', accent: '#141414', style: 'short' },
    { shirt: '#c0765a', shirtS: '#a05e45', hair: '#1f1f2b', accent: '#141414', style: 'bob' },
    { shirt: '#6a9a5b', shirtS: '#557d48', hair: '#6b4430', accent: '#141414', style: 'messy' },
    { shirt: '#8a7ab8', shirtS: '#6f6199', hair: '#2b2b2b', accent: '#141414', style: 'short', glasses: true },
    { shirt: '#b89a4a', shirtS: '#9a7f38', hair: '#d9b05a', accent: '#141414', style: 'bob' },
  ];

  // ───────── 배치 ─────────
  // 방: 바닥 칸 범위 [x0,x1)×[y0,y1). name 이 있는 방만 이름표를 단다.
  // plate: 문패 위치(문 바로 옆 칸막이 위, 바닥 칸 좌표)
  const ROOMS = [
    { key: 'planner', name: '기획실', plate: [3.6, 4], x0: 0, x1: 6, y0: 0, y1: 4, floor: ['#ededed', '#e4e4e4'] },
    { key: 'docs', name: '문서 보관실', plate: [10.7, 4], x0: 6, x1: 12, y0: 0, y1: 4, floor: ['#ece6dc', '#e3ddd3'] },
    { key: 'ceo', name: '대표실', plate: [15.6, 4], x0: 12, x1: 18, y0: 0, y1: 4, floor: ['#eee8de', '#e5dfd5'] },
    { key: 'hall', name: '복도', x0: 0, x1: 18, y0: 4, y1: 6, floor: ['#f4f4f4', '#ececec'] },
    { key: 'dev', name: '개발실', plate: [5.6, 6], x0: 0, x1: 7, y0: 6, y1: 10, floor: ['#e9e9e9', '#e0e0e0'] },
    { key: 'hall2', x0: 7, x1: 9, y0: 6, y1: 15, floor: ['#f4f4f4', '#ececec'] },
    { key: 'qa', name: 'QA실', plate: [11.8, 6], x0: 9, x1: 13, y0: 6, y1: 10, floor: ['#e6ece8', '#dde3df'] },
    { key: 'server', name: '서버실', plate: [16.6, 6], x0: 13, x1: 18, y0: 6, y1: 10, floor: ['#d2d2d2', '#c9c9c9'] },
    { key: 'meeting', name: '회의실', plate: [7, 11.3], x0: 0, x1: 7, y0: 10, y1: 15, floor: ['#e2e2e2', '#dadada'] },
    { key: 'lounge', name: '라운지', plate: [9, 11.3], x0: 9, x1: 18, y0: 10, y1: 15, floor: ['#ddb990', '#d3af86'] },
  ];
  // 칸막이: ['x', gy, gx0, gx1] = gy 선을 따라 gx0~gx1, ['y', gx, gy0, gy1] = gx 선을 따라. 빈 구간이 문.
  // 가로 복도(gy 4-6)와 세로 복도(gx 7-9)가 T자로 이어져, 모든 방이 다른 방을 거치지 않고 복도에서 바로 들어간다.
  const WALLS = [
    ['x', 4, 0, 2], ['x', 4, 3, 8], ['x', 4, 10, 14], ['x', 4, 15, 18], // 윗줄 방 ↔ 복도 (문: 기획 2-3, 문서 8-10, 대표 14-15)
    ['y', 6, 0, 4], ['y', 12, 0, 4],
    ['x', 6, 0, 4], ['x', 6, 5, 7], ['x', 6, 9, 10], ['x', 6, 11, 15], ['x', 6, 16, 18], // 복도 ↔ 가운데 줄 (문: 개발 4-5, QA 10-11, 서버 15-16, 세로 복도 7-9)
    ['y', 13, 6, 10],
    ['x', 10, 0, 7], ['x', 10, 9, 18],                                   // 개발실 ↔ 회의실, QA·서버실 ↔ 라운지
    ['y', 7, 6, 12], ['y', 7, 13, 15], ['y', 9, 6, 12], ['y', 9, 13, 15], // 세로 복도 양옆 (문: 회의실 12-13, 라운지 12-13)
  ];

  // 자리 = 의자 위치. 직사각형 책상이 gx 방향으로 길게 놓이고, 직원은 긴 변 한가운데에 앉아 모니터를 정면으로 본다.
  // front: 화면 앞쪽(+gy)을 보고 앉는다(얼굴이 보이고 모니터는 뒷면). 아니면 뒷벽 쪽(-gy) 모니터를 보고 앉는다(뒷모습).
  const HOME = { ceo: { gx: 15, gy: 1.25, front: true }, planner: { gx: 2.3, gy: 0.5, front: true }, dev: { gx: 0.85, gy: 7.2 }, qa: { gx: 12.2, gy: 7.2 } };
  // 개발실: 왼쪽에 두 개씩 붙은 책상, 문(gx 4-5) 아래는 통로, 오른쪽에 하나. 윗줄은 복도 쪽 벽, 아랫줄은 회의실 쪽 벽에 붙이고 가운데는 통로.
  const TEMP_DESKS = [{ gx: 2.45, gy: 7.2 }, { gx: 6.2, gy: 7.2 }, { gx: 0.85, gy: 8.9, front: true }, { gx: 2.45, gy: 8.9, front: true }, { gx: 6.2, gy: 8.9, front: true }];
  // 책상 사이 가림막: [gx, gy0, gy1]
  const DIVIDERS = [[1.65, 6.08, 6.95], [3.22, 6.08, 6.95], [5.4, 6.08, 6.95], [1.65, 9.25, 9.92], [3.22, 9.25, 9.92], [5.4, 9.25, 9.92]]; // 묶음 사이·통로 양옆
  function deskGeom(h) {
    const s = h.front ? 1 : -1;
    return { x0: h.gx - 0.7, x1: h.gx + 0.7, y0: h.gy + (h.front ? 0.4 : -1.1), y1: h.gy + (h.front ? 1.1 : -0.4), g: h.gy + s * 0.95, a: h.gx - 0.35, b: h.gx + 0.35 };
  }
  const TEMP_STAND = [{ gx: 3.6, gy: 8.1 }, { gx: 4.5, gy: 8.5 }, { gx: 5.4, gy: 8.0 }];   // 두 줄 사이 통로
  const SEC_HOME = { gx: 16.4, gy: 1.4 };   // 비서는 따로 자리 없이 대표 옆(책장 반대쪽)에 서 있다
  const SEC_SPOT = { planner: { gx: 4.2, gy: 0.8 }, ceo: { gx: 14.0, gy: 1.2 }, dev: { gx: 1.6, gy: 8.0 }, qa: { gx: 10.4, gy: 7.6 } };
  const MEET = [{ gx: 1.6, gy: 12.4 }, { gx: 4.4, gy: 12.0 }, { gx: 3.5, gy: 13.3 }, { gx: 2.4, gy: 13.3 }];
  const TABLE = { gx: 3, gy: 12 };
  const STAGE_BOARD = { gx: 4.0, gy: 10.7 };
  const SOFA = { x0: 10.3, x1: 12.9, y0: 10.25, y1: 10.95 };
  const COFFEE = { gx: 15.4, gy: 10.6 };
  const COOLER = { gx: 14.4, gy: 10.6 };
  const LTABLE = { gx: 11.6, gy: 12.6 };
  const PLANTS = [{ gx: 5.5, gy: 0.5 }, { gx: 11.5, gy: 0.5 }, { gx: 17.5, gy: 0.5 }, { gx: 9.5, gy: 6.5 }, { gx: 5.6, gy: 14.4 }, { gx: 17.4, gy: 14.4 }, { gx: 6.4, gy: 10.5 }];
  const RACKS = [{ gx: 13.8, gy: 9.2 }, { gx: 14.8, gy: 9.2 }, { gx: 15.8, gy: 9.2 }, { gx: 16.8, gy: 9.2 }];
  const CONSOLE = { gx: 17.2, gy: 7.0 };
  const CABINETS = [{ gx: 6.9, gy: 0.55 }, { gx: 7.9, gy: 0.55 }, { gx: 8.9, gy: 0.55 }, { gx: 9.9, gy: 0.55 }];
  const SHREDDER = { gx: 11.3, gy: 2.6 };
  const QA_BOARD = { gx: 11.2, gy: 8.9 };
  const ENTRANCE = { gx: 0.35, gy: 5.0 };
  // 화면에만 있는 직원(사용량 0): 실제 일어나는 일에 맞춰 움직인다
  const STAFF = {
    lib: { label: '사서', home: { gx: 10.5, gy: 1.7 }, look: { shirt: '#8e6b4a', shirtS: '#74563b', hair: '#5a5a5a', accent: '#141414', style: 'bob', glasses: true } },
    eng: { label: '서버 엔지니어', home: { gx: 16.3, gy: 7.4 }, look: { shirt: '#2f4a6b', shirtS: '#243a55', hair: '#1f1f2b', accent: '#f6c445', style: 'short', badge: true } },
    barista: { label: '바리스타', home: { gx: 15.4, gy: 11.3 }, look: { shirt: '#f5f5f5', shirtS: '#d4d4d4', hair: '#3b2a20', accent: '#141414', style: 'messy', apron: true } },
  };
  const CAB_SPOT = { gx: 8.4, gy: 1.3 }, SHRED_SPOT = { gx: 10.6, gy: 2.7 }, RACK_SPOT = { gx: 15.0, gy: 8.5 };
  const SCRIBE_SPOT = { gx: 5.0, gy: 12.6 };
  const SOFA_SEAT = { gx: 11.6, gy: 10.75, front: true };   // 바리스타가 쉬는 자리(소파 가운데)
  const COFFEE_AFTER = 120000, COFFEE_AGAIN = 600000, CUP_STAYS = 60000;
  // 책장: side 'R' = 오른쪽(gx+) 면이 방 안을 본다
  const SHELVES = [{ x0: 12.05, x1: 12.4, y0: 0.3, y1: 1.4 }, { x0: 0.05, x1: 0.4, y0: 2.85, y1: 3.85 }];

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
  for (const h of [...Object.values(HOME), ...TEMP_DESKS]) {
    const d = deskGeom(h);
    for (let x = Math.floor(d.x0); x <= Math.floor(d.x1 - 0.01); x++) blocked.add(ckey(x, Math.floor((d.y0 + d.y1) / 2)));
  }
  for (const sh of SHELVES) for (let y = Math.floor(sh.y0); y <= Math.floor(sh.y1 - 0.01); y++) blocked.add(ckey(Math.floor(sh.x0), y));
  for (const p of [COFFEE, COOLER, LTABLE, CONSOLE, SHREDDER, QA_BOARD, STAGE_BOARD, ...PLANTS, ...RACKS, ...CABINETS]) block(p);
  for (const [x, y] of [[2, 11], [3, 11], [2, 12], [3, 12], [10, 10], [11, 10], [12, 10]]) blocked.add(ckey(x, y));

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
    if (right) poly(ctx, [B, C, up(C, h), up(B, h)], right); // right=null: 이어 붙는 조각의 안쪽 면은 생략
    poly(ctx, [up(A, h), up(B, h), up(C, h), up(D, h)], top);
  }
  function floorRect(ctx, x0, y0, x1, y1, c) { poly(ctx, [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)], c); }
  // 바깥 벽면 위의 사각형. side='R'은 gy=0 벽(오른쪽 뒤), 'L'은 gx=0 벽(왼쪽 뒤)
  function wallQuad(side, a, b, h0, h1) {
    const p = (t, h) => { const q = side === 'R' ? iso(t, 0) : iso(0, t); return { x: q.x, y: q.y - h }; };
    return [p(a, h0), p(b, h0), p(b, h1), p(a, h1)];
  }
  const blink = (t, ms) => Math.floor(t / ms) % 2 === 0;
  // 벽면 위 사각형: u 는 벽을 따라가는 칸 좌표, z 는 높이(px)
  const wallR = (ctx, side, u0, u1, z0, z1, c) => poly(ctx, wallQuad(side, u0, u1, z0, z1), c);
  // 벽면 위 타원(벽에 붙은 둥근 물건을 비스듬히 본 모양). ru 는 칸, rz 는 px 반지름
  function wallDisc(ctx, side, cu, cz, ru, rz, c) {
    for (let dz = -rz; dz < rz; dz++) {
      const k = (dz + 0.5) / rz, hw = ru * Math.sqrt(Math.max(0, 1 - k * k));
      if (hw > 0.01) wallR(ctx, side, cu - hw, cu + hw, cz + dz, cz + dz + 1, c);
    }
  }
  const wallDot = (ctx, side, u, z, c) => { const q = side === 'R' ? iso(u, 0) : iso(0, u); R(ctx, Math.round(q.x), Math.round(q.y - z), 1, 1, c); };

  // ───────── 상태 ─────────
  const state = {
    canvas: null, ctx: null, buf: null, bctx: null, scale: 1, scaleY: 1, offX: 0, offY: 0, dpr: 1,
    roles: {}, agents: {}, run: null, runStatus: {}, active: false, selected: null, hover: null, hoverRoom: null,
    chars: {}, fx: [], onSelect: null, onRoom: null, last: 0,
    perms: [], docs: 0, gathered: new Set(), shredUntil: 0,
    docsSeen: false, fileUntil: 0, lastTone: 'none', panicUntil: 0,
    workSince: {}, coffeeAt: {}, cupUntil: {}, coffee: null,
  };

  function ensureChar(id, kind = 'role') {
    if (!state.chars[id]) {
      const h = HOME[id] || SEC_HOME;
      state.chars[id] = { id, kind, gx: h.gx, gy: h.gy, path: [], goal: null, walking: false, placed: kind !== 'role', huddleUntil: 0, jumpUntil: 0, desk: HOME[id] || null };
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
    return [HOME[id], 'home'];
  }

  function secGoal() {
    const p = state.perms.find((x) => SEC_SPOT[x.agentId]);
    if (p) return [SEC_SPOT[p.agentId], 'perm-' + p.agentId];
    if (state.gathered.size) return [SCRIBE_SPOT, 'scribe'];   // 회의에서는 서기
    return [SEC_HOME, 'home'];
  }

  // ───────── 개발 팀원·임시 직원(서브에이전트) ─────────
  // 서브에이전트가 생기면 쉬고 있는 개발 팀원이 그 일을 맡는다. 팀원이 모두 바쁘면 임시 직원이 들어와 통로에 서서 일한다.
  const members = () => Object.values(state.chars).filter((c) => c.kind === 'member').sort((a, b) => a.slot - b.slot);
  function ensureMembers() {
    TEMP_DESKS.forEach((d, i) => {
      const key = 'mem:' + i;
      if (!state.chars[key]) state.chars[key] = { id: key, kind: 'member', slot: i, desk: d, spot: d, gx: d.gx, gy: d.gy, path: [], goal: null, walking: false, placed: true, sub: null, label: null };
    });
  }
  function spawnTemp(id, label, { atDesk = false } = {}) {
    if (members().some((m) => m.sub === id)) return;
    const free = members().find((m) => !m.sub);
    if (free) { free.sub = id; free.label = label || '조사'; return; }
    const key = 'sub:' + id;
    if (state.chars[key]) return;
    const used = new Set(Object.values(state.chars).filter((c) => c.kind === 'temp').map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const spot = TEMP_STAND[slot % TEMP_STAND.length];
    const start = atDesk ? spot : ENTRANCE;
    state.chars[key] = { id: key, kind: 'temp', label: label || '조사', slot, desk: null, spot, gx: start.gx, gy: start.gy, path: [], goal: null, walking: false, placed: true, leaving: false };
  }
  function endTemp(id) {
    for (const m of members()) if (m.sub === id) { m.sub = null; m.label = null; }
    const c = state.chars['sub:' + id]; if (c) c.leaving = true;
  }

  // ───────── 그리기: 방 ─────────
  function drawWalls(ctx, t) {
    poly(ctx, wallQuad('R', 0, GX, 0, WALL), P.wallR);
    poly(ctx, wallQuad('L', 0, GY, 0, WALL), P.wallL);
    poly(ctx, wallQuad('R', 0, GX, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('L', 0, GY, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('R', 0, GX, 0, 4), P.trim);
    poly(ctx, wallQuad('L', 0, GY, 0, 4), P.trim);

    // 기획실: 명세 보드(기능 수만큼 카드, 기획 중이면 다음 칸이 깜빡임)
    wallR(ctx, 'R', 0.7, 5.0, 16, 46, P.frame);
    wallR(ctx, 'R', 0.85, 4.85, 18, 44, '#f0f0f0');
    {
      const n = state.run && state.run.plan ? Math.min(8, state.run.plan.features.length) : 0;
      const writing = (state.agents.planner || {}).state === 'working' || (state.agents.planner || {}).state === 'thinking';
      for (let i = 0; i < 8; i++) {
        const u0 = 1.15 + (i % 4) * 0.92, z1 = 40 - Math.floor(i / 4) * 11;
        let c = '#dedede';
        if (i < n) c = ['#fbe7a6', '#cdeedf', '#f8d4cf', '#d9e8f7'][i % 4];
        else if (i === n && writing) c = blink(t, 400) ? P.lamp : '#dedede';
        wallR(ctx, 'R', u0, u0 + 0.55, z1 - 8, z1, c);
        if (i < n) { wallR(ctx, 'R', u0 + 0.08, u0 + 0.42, z1 - 3, z1 - 2, '#a6a6a6'); wallR(ctx, 'R', u0 + 0.08, u0 + 0.3, z1 - 5, z1 - 4, '#b8b8b8'); }
      }
    }
    // 대표실: 창문. 창밖은 실제 시각을 따른다(낮: 파란 하늘과 구름, 해질녘: 노을, 밤: 달과 별)
    {
      const now = new Date(), hr = now.getHours() + now.getMinutes() / 60;
      const phase = hr >= 7 && hr < 17 ? 'day' : (hr >= 17 && hr < 19) || (hr >= 5 && hr < 7) ? 'dusk' : 'night';
      for (const [a, b] of [[12.6, 14.3], [15.4, 17.3]]) {
        wallR(ctx, 'R', a - 0.12, b + 0.12, 16, 50, P.frame);
        if (phase === 'day') wallR(ctx, 'R', a, b, 19, 47, '#8fc3ea');
        else if (phase === 'dusk') { wallR(ctx, 'R', a, b, 19, 47, '#6b6aa3'); wallR(ctx, 'R', a, b, 19, 30, '#f3a66b'); wallR(ctx, 'R', a, b, 30, 34, '#c98a8f'); }
        else wallR(ctx, 'R', a, b, 19, 47, '#1e2433');
        if (phase === 'day') {
          // 구름이 천천히 흘러간다(창 안에서만)
          for (let k = 0; k < 2; k++) {
            const span = b - a - 0.6, u = a + 0.05 + (((t / 60000) + k * 0.47 + a) % 1) * span, z = 36 - k * 9;
            wallR(ctx, 'R', u, u + 0.5, z, z + 3, '#ffffff'); wallR(ctx, 'R', u + 0.12, u + 0.36, z + 3, z + 5, '#ffffff');
          }
        } else if (phase === 'night') {
          for (let i = 0; i < 5; i++) {
            const u = a + 0.1 + (b - a - 0.2) * ((i * 0.31 + 0.13) % 1);
            if (Math.sin(t / 700 + i * 2 + a) > -0.3) wallDot(ctx, 'R', u, 24 + ((i * 7) % 20), P.star);
          }
        }
        R(ctx, Math.round(iso((a + b) / 2, 0).x), Math.round(iso((a + b) / 2, 0).y - 47), 1, 28, P.frame); // 세로 창살
        wallR(ctx, 'R', a, b, 32, 33, P.frame);                                                              // 가로 창살
      }
      // 둥근 해·달(오른쪽 창). 달은 초승달 모양으로 한쪽을 하늘색으로 덮는다
      if (phase === 'night') { wallDisc(ctx, 'R', 16.7, 41, 0.22, 3, P.star); wallDisc(ctx, 'R', 16.79, 41.5, 0.17, 3, '#1e2433'); }
      else if (phase === 'day') wallDisc(ctx, 'R', 16.7, 42, 0.2, 3, '#ffe58a');
      else wallDisc(ctx, 'R', 16.6, 23, 0.24, 3, '#ffc07a');
    }
    // 대표실: 벽시계(실제 시각)
    {
      const cu = 14.85, cz = 40;
      wallDisc(ctx, 'R', cu, cz, 0.34, 6, P.ink);
      wallDisc(ctx, 'R', cu, cz, 0.27, 5, P.paper);
      const now = new Date();
      const hand = (ang, lenU, lenZ, c) => { for (let k = 1; k <= 4; k++) wallDot(ctx, 'R', cu + Math.sin(ang) * lenU * k / 4, cz + Math.cos(ang) * lenZ * k / 4, c); };
      hand((now.getHours() % 12 + now.getMinutes() / 60) / 12 * Math.PI * 2, 0.13, 2.5, P.ink);
      hand(now.getMinutes() / 60 * Math.PI * 2, 0.2, 4, P.ink);
      hand(now.getSeconds() / 60 * Math.PI * 2, 0.2, 4, P.coral);
    }

    // 왼쪽 벽: 기획실 달력, 입구, 개발실 대형 화면
    // 달력: 맨 위 띠, 날짜 칸 4×3(오늘은 빨간 칸)
    wallR(ctx, 'L', 1.0, 3.0, 22, 42, P.frame);
    wallR(ctx, 'L', 1.1, 2.9, 23, 41, '#f0f0f0');
    wallR(ctx, 'L', 1.1, 2.9, 37, 41, P.coral);
    for (let i = 0; i < 12; i++) {
      const u0 = 1.25 + (i % 4) * 0.42, z1 = 35 - Math.floor(i / 4) * 4;
      wallR(ctx, 'L', u0, u0 + 0.24, z1 - 2, z1, i === 5 ? P.coral : '#b8b8b8');
    }
    // 입구 문과 비상구 표시등(벽면을 따라, 달리는 사람과 화살표)
    wallR(ctx, 'L', 4.25, 5.75, 0, 34, P.frame);
    wallR(ctx, 'L', 4.4, 5.6, 0, 31, '#c4c4c4');
    wallR(ctx, 'L', 4.5, 4.58, 14, 16, '#6a6a6a');                    // 손잡이
    wallR(ctx, 'L', 4.45, 5.55, 37, 43, '#1f7a55');
    wallR(ctx, 'L', 4.52, 5.48, 38, 42, P.mint);
    wallR(ctx, 'L', 4.62, 4.72, 40, 41, '#f5f5f5');                   // 머리
    wallR(ctx, 'L', 4.66, 4.74, 38, 40, '#f5f5f5');                   // 몸
    wallR(ctx, 'L', 4.58, 4.66, 38, 39, '#f5f5f5'); wallR(ctx, 'L', 4.74, 4.82, 39, 40, '#f5f5f5'); // 팔다리
    wallR(ctx, 'L', 4.95, 5.3, 39, 40, '#f5f5f5');                    // 화살표
    wallR(ctx, 'L', 4.95, 5.03, 38, 41, '#f5f5f5');
    wallR(ctx, 'L', 6.6, 9.4, 18, 46, P.frame);
    wallR(ctx, 'L', 6.75, 9.25, 20, 44, '#1c1c1c');
    {
      const devBusy = ['working', 'thinking'].includes((state.agents.dev || {}).state);
      const shift = devBusy ? Math.floor(t / 220) : 0;
      const cols = ['#3d8fd1', '#2fa37a', '#f6c445', '#8e6bd8', '#9a9a9a'];
      for (let i = 0; i < 7; i++) {
        const k = (i + shift) % 11;
        const u0 = 6.95 + (k % 3) * 0.14, u1 = Math.min(9.05, u0 + (6 + ((k * 7) % 14)) / 16); // 코드 줄도 화면 기울기를 따른다
        wallR(ctx, 'L', u0, u1, 40 - i * 3, 41 - i * 3, devBusy ? cols[k % cols.length] : '#3a3a3a');
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
    floorRect(ctx, 0.9, 10.7, 5.1, 13.5, '#c8c8c8'); floorRect(ctx, 1.05, 10.85, 4.95, 13.35, '#d2d2d2');
    floorRect(ctx, 9.7, 11.5, 13.6, 13.8, P.rugD); floorRect(ctx, 9.85, 11.65, 13.45, 13.65, P.rug);
    // 일하는 책상 아래 조명
    const glow = (p) => { const d = deskGeom(p); const c = iso((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2); ctx.globalAlpha = 0.22 + 0.06 * Math.sin(t / 300); diamond(ctx, c.x, c.y, 26, 13, P.lamp); ctx.globalAlpha = 1; };
    for (const id of Object.keys(HOME)) { const a = state.agents[id]; if (a && (a.state === 'working' || a.state === 'thinking') && near(state.chars[id] || {}, HOME[id])) glow(HOME[id]); }
    for (const c of Object.values(state.chars)) if (c.kind === 'member' && c.sub && near(c, c.desk)) glow(c.desk);
    // 서버실 바닥 케이블 라인
    for (let i = 0; i < 3; i++) floorRect(ctx, 13.3, 8.25 + i * 0.12, 17.6, 8.3 + i * 0.12, '#b0b0b0');
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
  // gy 가 일정한 세로 면(책상 앞면과 같은 방향) 위의 사각형
  const faceQ = (ctx, a, b, g, z0, z1, col) => poly(ctx, [up(iso(a, g), z0), up(iso(b, g), z0), up(iso(b, g), z1), up(iso(a, g), z1)], col);

  // 모니터: 책상 가장자리에 서서 앉은 사람을 본다. 화면이 보이면 내용도 화면 기울기를 따른다.
  function drawMonitor(ctx, h, mode, t) {
    const d = deskGeom(h), g = d.g, a = d.a, b = d.b, m = (a + b) / 2;
    const s = h.front ? 1 : -1; // 사람 반대쪽으로 화면 몸체 두께를 준다
    const lo = Math.min(g, g + s * 0.07), hi = Math.max(g, g + s * 0.07);
    boxRect(ctx, m - 0.2, Math.min(g, g - s * 0.12), m + 0.2, Math.max(g, g - s * 0.12), 1, '#4a4a4a', '#4a4a4a', '#3a3a3a', 10); // 받침
    boxRect(ctx, m - 0.04, lo - 0.01, m + 0.04, hi - 0.03, 3, '#5a5a5a', '#5a5a5a', '#4a4a4a', 11);                               // 목
    if (h.front) {
      // 뒷면만 보인다. 일하는 중이면 위 가장자리로 화면 불빛이 샌다.
      boxRect(ctx, a, lo, b, hi, 8, '#2a2a2a', '#4a4a4a', '#3a3a3a', 13); // 얼굴이 가리지 않게 낮게
      faceQ(ctx, m - 0.04, m + 0.04, hi, 16, 18, '#6a6a6a');
      if (mode === 'work' || mode === 'think') { ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t / 250); faceQ(ctx, a, b, hi, 20, 21, '#bfe3ff'); ctx.globalAlpha = 1; }
      if (mode === 'alert') faceQ(ctx, a, b, hi, 20, 21, blink(t, 450) ? P.coral : '#5a2420');
      return;
    }
    boxRect(ctx, a, lo, b, hi, 12, '#2a2a2a', P.monitor, '#1f1f1f', 13);
    const A = a + 0.06, B = b - 0.06, z0 = 14, z1 = 24, L = B - A;
    const bg = mode === 'alert' ? (blink(t, 450) ? P.coral : '#5a2420') : mode === 'good' ? '#1f4a3a' : mode === 'off' ? '#262f38' : '#1c2733';
    faceQ(ctx, A, B, hi, z0, z1, bg);
    if (mode === 'work') {
      const cols = ['#3d8fd1', '#5fd39f', '#f6c445', '#c9c9c9'];
      const k = Math.floor(t / 200);
      for (let i = 0; i < 4; i++) {
        const n = (i + k) % 7, u0 = A + 0.04 + (n % 2) * 0.06, u1 = Math.min(B - 0.03, u0 + 0.15 + ((n * 5) % 8) * 0.045);
        faceQ(ctx, u0, u1, hi, z1 - 3 - i * 2, z1 - 2 - i * 2, cols[(i + k) % cols.length]);
      }
    } else if (mode === 'think') {
      for (let i = 0; i < 3; i++) { const u = A + L * (0.22 + i * 0.24); faceQ(ctx, u, u + 0.07, hi, 18, 20, Math.floor(t / 300) % 3 === i ? P.lamp : '#4a5866'); }
    } else if (mode === 'alert') {
      const u = A + L * 0.45; faceQ(ctx, u, u + 0.07, hi, 18, 22, P.paper); faceQ(ctx, u, u + 0.07, hi, 15, 16, P.paper);
    } else if (mode === 'good') {
      faceQ(ctx, A + L * 0.3, A + L * 0.42, hi, 17, 19, P.mint); faceQ(ctx, A + L * 0.42, A + L * 0.54, hi, 16, 18, P.mint); faceQ(ctx, A + L * 0.54, A + L * 0.66, hi, 18, 21, P.mint);
    } else {
      faceQ(ctx, A + 0.03, A + 0.18, hi, z1 - 2, z1 - 1, '#36424e');
    }
  }
  function screenMode(a) {
    if (!a) return 'off';
    return a.state === 'working' ? 'work' : a.state === 'thinking' ? 'think' : a.state === 'waiting' ? 'alert' : a.state === 'done' ? 'good' : a.state === 'failed' ? 'alert' : 'off';
  }

  function drawDesk(ctx, h, owner, t) {
    const d = deskGeom(h);
    const c = iso((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2);
    if (drawAsset(ctx, 'desk', c.x, c.y, 'idle', t)) return;
    const ceo = owner === 'ceo';
    boxRect(ctx, d.x0, d.y0, d.x1, d.y1, 10, ceo ? '#b8784a' : P.woodTop2, ceo ? '#7a4a28' : P.woodL, ceo ? '#8c5530' : P.woodR);
    poly(ctx, [up(iso(d.x0, d.y1), 10), up(iso(d.x1, d.y1), 10), up(iso(d.x1, d.y1), 9), up(iso(d.x0, d.y1), 9)], ceo ? '#a8693a' : P.wood); // 상판 모서리
    let mode = 'off';
    if (owner === 'temp') { const used = Object.values(state.chars).some((ch) => ch.kind === 'member' && ch.desk === h && ch.sub && near(ch, h)); mode = used ? 'work' : 'off'; }
    else { const ch = state.chars[owner]; mode = ch && near(ch, h) ? screenMode(state.agents[owner]) : 'off'; }
    // 책상 위 소품(모니터 옆 빈자리). 앞을 보는 책상은 모니터가 앞쪽에 있어 소품을 먼저 그린다.
    const q = up(iso(h.front ? h.gx + 0.5 : h.gx - 0.5, h.front ? h.gy + 0.7 : h.gy - 0.7), 10), X = Math.round(q.x), Y = Math.round(q.y);
    const props = () => {
      if (state.cupUntil[owner] > t) {                                   // 바리스타가 가져다준 커피(모니터를 피해 책상 빈자리에)
        const cq = up(iso(h.front ? h.gx + 0.45 : h.gx + 0.5, h.front ? h.gy + 0.5 : h.gy - 0.6), 10), cx = Math.round(cq.x), cy = Math.round(cq.y);
        R(ctx, cx - 1, cy - 3, 3, 3, P.paper); R(ctx, cx - 1, cy - 3, 3, 1, '#6b4430'); if (blink(t, 600)) R(ctx, cx, cy - 6, 1, 2, '#e6e6e6');
      }
      if (owner === 'planner') { R(ctx, X - 3, Y - 2, 6, 3, P.paper); R(ctx, X - 2, Y - 1, 4, 1, '#d4d4d4'); R(ctx, X + 3, Y - 3, 2, 3, P.coral); }
      if (owner === 'qa') { R(ctx, X - 2, Y - 5, 4, 5, '#8a6a4a'); R(ctx, X - 1, Y - 4, 2, 3, P.paper); R(ctx, X - 1, Y - 3, 1, 1, P.mint); }
      if (owner === 'dev') { R(ctx, X - 1, Y - 3, 3, 3, P.paper); R(ctx, X + 2, Y - 2, 1, 1, P.ink); }
      // 대표: 결재 대기 중이면 결재판이 깜빡인다
      if (ceo) {
        const review = state.run && state.run.status === 'review';
        R(ctx, X - 3, Y - 3, 7, 4, review ? (blink(t, 500) ? P.lamp : P.paper) : P.paper);
        R(ctx, X - 2, Y - 2, 5, 1, review ? P.coral : '#d4d4d4');
      }
    };
    if (h.front) { props(); drawMonitor(ctx, h, mode, t); }
    else { drawMonitor(ctx, h, mode, t); props(); }
  }

  // 사무용 의자: 사람과 같은 중심에 책상 쪽을 향해 놓인다. 방석은 사람보다 먼저, 등받이는 등 쪽 깊이에 그린다.
  function chairColors(owner) {
    const ceo = owner === 'ceo';
    return { back: ceo ? P.leatherR : '#3a3a3a', side: ceo ? P.leatherL : '#2e2e2e', edge: ceo ? P.leather : '#555555', bh: ceo ? 13 : 7 };
  }
  function drawChairSeat(ctx, h, owner, t) {
    const c = iso(h.gx, h.gy);
    if (drawAsset(ctx, 'chair', c.x, c.y, 'idle', t)) return;
    const k = chairColors(owner), x = Math.round(c.x), y = Math.round(c.y);
    R(ctx, x - 5, y - 1, 10, 1, '#4a4a4a');                                                   // 다리
    R(ctx, x - 6, y, 2, 1, P.ink); R(ctx, x + 4, y, 2, 1, P.ink); R(ctx, x - 1, y + 1, 2, 1, P.ink); // 바퀴
    R(ctx, x - 1, y - 3, 2, 3, '#5a5a5a');                                                   // 기둥
    boxRect(ctx, h.gx - 0.22, h.gy - 0.22, h.gx + 0.22, h.gy + 0.22, 2, k.edge, k.side, k.side, 3); // 방석
  }
  function drawChairBack(ctx, h, owner, t) {
    if (assets.images.chair) return;
    const k = chairColors(owner);
    const g0 = h.front ? h.gy - 0.26 : h.gy + 0.18;
    boxRect(ctx, h.gx - 0.22, g0, h.gx + 0.22, g0 + 0.08, k.bh, k.edge, k.back, k.side, 5);
  }

  // 책상 사이 가림막(낮은 칸막이 판)
  function drawDivider(ctx, dv) {
    const [gx, y0, y1] = dv;
    boxRect(ctx, gx - 0.04, y0, gx + 0.04, y1, 15, P.partTop, P.partY, P.partX);
  }

  // 책장: 칸막이나 벽에 붙어 오른쪽(gx+) 면이 방 안을 본다
  function drawShelf(ctx, sh, i, t) {
    const c = iso((sh.x0 + sh.x1) / 2, (sh.y0 + sh.y1) / 2);
    if (drawAsset(ctx, 'bookshelf', c.x, c.y, 'idle', t)) return;
    const H2 = 28;
    boxRect(ctx, sh.x0, sh.y0, sh.x1, sh.y1, H2, '#a46f43', P.woodL, '#7a4a28');
    const face = (b0, b1, z0, z1, col) => poly(ctx, [up(iso(sh.x1, b0), z0), up(iso(sh.x1, b1), z0), up(iso(sh.x1, b1), z1), up(iso(sh.x1, b0), z1)], col);
    const cols = ['#3d8fd1', '#e2574c', '#2fa37a', '#f6c445', '#8e6bd8', '#e6e6e6', '#9e6738'];
    for (let r = 0; r < 3; r++) {
      const z = 3 + r * 8;
      face(sh.y0 + 0.06, sh.y1 - 0.06, z, z + 7, '#5a3a22');                                    // 칸 안쪽(어두운 면)
      let u = sh.y0 + 0.08;
      for (let k = 0; u < sh.y1 - 0.12; k++) {
        const w = 0.07 + ((k * 3 + r + i) % 3) * 0.03, hgt = 4 + ((k + r * 2 + i) % 3);
        face(u, Math.min(sh.y1 - 0.08, u + w), z, z + hgt, cols[(k * 2 + r + i * 3) % cols.length]);
        u += w + 0.015;
      }
      face(sh.y0, sh.y1, z - 1, z, '#c98d55');                                                  // 선반 판
    }
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
    const { gx, gy } = COOLER;
    boxRect(ctx, gx - 0.16, gy - 0.16, gx + 0.16, gy + 0.16, 14, '#e6e6e6', '#b3b3b3', '#d4d4d4');
    faceQ(ctx, gx - 0.05, gx + 0.05, gy + 0.16, 7, 9, '#5a5a5a');                          // 꼭지
    faceQ(ctx, gx - 0.08, gx + 0.08, gy + 0.16, 2, 3, '#9a9a9a');                          // 물받이
    boxRect(ctx, gx - 0.11, gy - 0.11, gx + 0.11, gy + 0.11, 8, '#cfe9fb', '#9fd0f2', '#b6dcf5', 14); // 물통
  }
  function drawCoffee(ctx, t) {
    const c = iso(COFFEE.gx, COFFEE.gy);
    if (drawAsset(ctx, 'coffee', c.x, c.y, 'idle', t)) return;
    const { gx, gy } = COFFEE;
    boxRect(ctx, gx - 0.19, gy - 0.19, gx + 0.19, gy + 0.19, 18, '#4a4a4a', '#2e2e2e', '#3a3a3a');
    faceQ(ctx, gx - 0.13, gx + 0.03, gy + 0.19, 13, 15, P.coral);                         // 표시창
    faceQ(ctx, gx - 0.1, gx + 0.1, gy + 0.19, 4, 10, '#1f1f1f');                          // 추출구
    faceQ(ctx, gx - 0.04, gx + 0.04, gy + 0.19, 4, 7, P.paper);                           // 컵
  }

  // 소파는  // 소파는 1칸 폭 조각으로 나눠 그린다(조각마다 깊이를 따로 매겨 뒤쪽 칸막이엔 안 묻히고 앞사람은 안 가림)
  const SOFA_SLICES = [];
  for (let i = Math.floor(SOFA.x0); i < SOFA.x1; i++) SOFA_SLICES.push({ i, x0: Math.max(SOFA.x0, i), x1: Math.min(SOFA.x1, i + 1) });
  function drawSofaSlice(ctx, s, t) {
    if (assets.images.sofa) {
      if (s.i === SOFA_SLICES[0].i) { const c = iso((SOFA.x0 + SOFA.x1) / 2, (SOFA.y0 + SOFA.y1) / 2); drawAsset(ctx, 'sofa', c.x, c.y, 'idle', t); }
      return;
    }
    const last = s.x1 === SOFA.x1;
    const side = last ? P.leatherR : null;
    boxRect(ctx, s.x0, SOFA.y0, s.x1, SOFA.y0 + 0.22, 15, P.leatherR, P.leatherL, side); // 등받이
    boxRect(ctx, s.x0, SOFA.y0 + 0.22, s.x1, SOFA.y1, 7, P.leather, P.leatherL, side);  // 방석
    if (s.x0 === SOFA.x0) boxRect(ctx, SOFA.x0, SOFA.y0, SOFA.x0 + 0.22, SOFA.y1, 11, P.leatherR, P.leatherL, P.leatherR); // 팔걸이
    if (last) boxRect(ctx, SOFA.x1 - 0.22, SOFA.y0, SOFA.x1, SOFA.y1, 11, P.leatherR, P.leatherL, P.leatherR);
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
  // 서버실 콘솔: 책상처럼 한쪽 면에 화면이 붙어 앞(+gy)을 본다
  function drawConsole(ctx, t) {
    const c = iso(CONSOLE.gx, CONSOLE.gy);
    if (drawAsset(ctx, 'console', c.x, c.y, 'idle', t)) return;
    const { gx, gy } = CONSOLE;
    boxRect(ctx, gx - 0.4, gy - 0.3, gx + 0.4, gy + 0.3, 9, '#7a7a7a', '#4a4a4a', '#5a5a5a');
    boxRect(ctx, gx - 0.32, gy - 0.2, gx + 0.32, gy - 0.12, 11, '#2a2a2a', P.monitor, '#1f1f1f', 9);
    const tone = checkTone();
    const col = tone === 'run' ? P.lamp : tone === 'ok' ? P.mint : tone === 'fail' ? P.coral : '#3a3a3a';
    faceQ(ctx, gx - 0.27, gx + 0.27, gy - 0.12, 10, 19, '#141a20');
    for (let i = 0; i < 3; i++) {
      const len = tone === 'run' ? (2 + ((Math.floor(t / 150) + i) % 7)) / 16 : (7 - i * 2) / 16;
      faceQ(ctx, gx - 0.22, gx - 0.22 + len, gy - 0.12, 17 - i * 2, 18 - i * 2, col);
    }
    faceQ(ctx, gx - 0.25, gx + 0.15, gy + 0.3, 7, 8, '#3a3a3a');                          // 키보드 서랍
  }

  // 문서 보관실: 회사 문서가 쌓일수록 캐비닛 위 서류가 늘어난다. 폐기하면 파쇄기가 돈다.
  function drawCabinet(ctx, p, i, t) {
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'cabinet', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 8, 4, 22, '#a8a8a8', P.metalL, P.metalR);
    // 뒷벽을 따라 서 있으므로 서랍은 방 쪽(왼쪽 아래 면)을 본다. 면의 기울기(1/2)를 따라 서랍 줄을 긋는다.
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 6; i++) R(ctx, c.x - 7 + i, c.y - 16 + k * 6 + Math.floor((i + 1) / 2), 1, 1, '#6a6a6a');
      R(ctx, c.x - 5, c.y - 13 + k * 6, 2, 1, '#d4d4d4');
    }
    const lib = state.chars['staff:lib'];
    if (lib && lib.goal === 'cab-' + i && arrived(lib)) {
      // 사서가 앞에 서 있으면 가운데 서랍이 방 쪽으로 빠져나온다(면을 따라 u 0~1, 0.3칸 = 화면 (-5, +2.5))
      const fx = (u) => c.x - 7 + 6 * u, fy = (u, h) => c.y + 0.5 + 3 * u + h;
      const dx = -5, dy = 2.5, h0 = -10, h1 = -4;
      const at = (u, h, o) => ({ x: fx(u) + (o ? dx : 0), y: fy(u, h) + (o ? dy : 0) });
      poly(ctx, [at(0, h0), at(1, h0), at(1, h1), at(0, h1)], '#4a4a4a');                       // 빠진 자리
      poly(ctx, [at(0, h0), at(1, h0), at(1, h0, 1), at(0, h0, 1)], '#5a5a5a');                 // 서랍 속
      for (let k = 0; k < 3; k++) poly(ctx, [at(0.2 + k * 0.25, h0 - 2), at(0.35 + k * 0.25, h0 - 2), at(0.35 + k * 0.25, h0, 1), at(0.2 + k * 0.25, h0, 1)], k % 2 ? P.paper : '#e6e6e6'); // 서류철
      poly(ctx, [at(1, h0), at(1, h0, 1), at(1, h1, 1), at(1, h1)], P.metalR);                   // 옆면
      poly(ctx, [at(0, h0, 1), at(1, h0, 1), at(1, h1, 1), at(0, h1, 1)], '#a8a8a8');             // 앞판
      R(ctx, fx(0.4) + dx, fy(0.4, -7) + dy, 2, 1, '#d4d4d4');                                    // 손잡이
    }
    const stack = Math.max(0, Math.min(6, state.docs - i * 6)); // 문서 하나당 한 장, 캐비닛마다 6장까지
    for (let k = 0; k < stack; k++) R(ctx, c.x - 4 + (k % 2), c.y - 24 - k * 2, 8, 2, k % 2 ? P.paper : '#e6e6e6');
  }
  function drawShredder(ctx, t) {
    const c = iso(SHREDDER.gx, SHREDDER.gy);
    if (drawAsset(ctx, 'shredder', c.x, c.y, 'idle', t)) return;
    const { gx, gy } = SHREDDER;
    boxRect(ctx, gx - 0.19, gy - 0.19, gx + 0.19, gy + 0.19, 11, '#5a5a5a', '#3a3a3a', '#4a4a4a');
    poly(ctx, [up(iso(gx - 0.12, gy - 0.02), 11), up(iso(gx + 0.12, gy - 0.02), 11), up(iso(gx + 0.12, gy + 0.02), 11), up(iso(gx - 0.12, gy + 0.02), 11)], P.ink); // 투입구
    const on = state.shredUntil > t;
    faceQ(ctx, gx + 0.04, gx + 0.13, gy + 0.19, 7, 9, on ? (blink(t, 120) ? P.coral : P.lamp) : '#2a5a40');
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

  // 회의실 단계 보드(세우는 보드): 업무 단계별 상태
  function drawStageBoard(ctx, t) {
    const p = STAGE_BOARD;
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'stageBoard', c.x, c.y, 'idle', t)) return;
    const L = iso(p.gx - 0.8, p.gy), Rr = iso(p.gx + 0.8, p.gy);
    R(ctx, L.x + 3, L.y - 8, 1, 8, '#6a6a6a'); R(ctx, Rr.x - 4, Rr.y - 8, 1, 8, '#6a6a6a');
    poly(ctx, [up(L, 8), up(Rr, 8), up(Rr, 28), up(L, 28)], P.frame);
    poly(ctx, [up(L, 10), up(Rr, 10), up(Rr, 26), up(L, 26)], '#f0f0f0');
    const stages = state.run ? state.run.stages : null;
    for (let i = 0; i < 6; i++) {
      const u = p.gx - 0.66 + i * 0.22;
      let col = '#d4d4d4';
      if (stages && stages[i]) {
        const st = stages[i].status;
        col = st === 'done' ? P.mint : st === 'active' ? (blink(t, 400) ? P.lamp : '#e0a92b') : st === 'failed' ? P.coral : st === 'skipped' ? '#e6e6e6' : '#a6a6a6';
      }
      faceQ(ctx, u, u + 0.16, p.gy, 16, 20, col);
    }
  }

  // QA실 칠판: 체크리스트 항목별 최근 판정
  function drawQaBoard(ctx, t) {
    const p = QA_BOARD;
    const c = iso(p.gx, p.gy);
    if (drawAsset(ctx, 'board', c.x, c.y, 'idle', t)) return;
    const L = iso(p.gx - 0.7, p.gy), Rr = iso(p.gx + 0.7, p.gy);
    R(ctx, L.x + 3, L.y - 8, 1, 8, '#6a6a6a'); R(ctx, Rr.x - 4, Rr.y - 8, 1, 8, '#6a6a6a');
    poly(ctx, [up(L, 8), up(Rr, 8), up(Rr, 30), up(L, 30)], P.frame);
    poly(ctx, [up(L, 10), up(Rr, 10), up(Rr, 28), up(L, 28)], '#f0f0f0');
    const run = state.run;
    const crit = run && run.contract ? run.contract.criteria : [];
    const qa = run && run.qa && run.qa[run.qa.length - 1];
    const res = new Map(((qa && qa.results) || []).map((r) => [r.id, r.status]));
    const qaBusy = ['working', 'thinking'].includes((state.agents.qa || {}).state);
    const n = Math.min(12, crit.length);
    for (let i = 0; i < 12; i++) {
      const u = (i % 6) / 6 * 1.2 + 0.12;
      const row = Math.floor(i / 6);
      let col = '#dedede';
      if (i < n) {
        const st = res.get(crit[i].id);
        col = st === 'pass' ? P.mint : st === 'fail' ? P.coral : st === 'skip' ? P.lamp : qaBusy ? (blink(t + i * 90, 300) ? '#bdbdbd' : '#9a9a9a') : '#a6a6a6';
      }
      faceQ(ctx, p.gx - 0.7 + u, p.gx - 0.7 + u + 0.14, p.gy, 22 - row * 7, 25 - row * 7, col);
    }
  }

  // ───────── 그리기: 직원 ─────────
  function charState(ch) {
    if (ch.kind === 'role') return state.agents[ch.id] || { state: 'idle' };
    if (ch.kind === 'temp') return { state: !ch.leaving && near(ch, ch.spot) ? 'working' : 'idle', bubble: ch.label };
    if (ch.kind === 'member') return { state: ch.sub ? 'working' : 'idle', bubble: ch.label };
    if (ch.kind === 'staff') {
      const here = !ch.walking && !ch.path.length;
      if (!here) return { state: 'idle' };
      if (ch.goal === 'shred') return { state: 'working', bubble: '파쇄 중' };
      if (ch.goal === 'file') return { state: 'working', bubble: '서류 정리' };
      if (ch.goal === 'rack') return { state: 'working', bubble: '랙 점검' };
      if (ch.goal === 'panic') return { state: 'waiting', bubble: '확인 실패!' };
      if (ch.goal === 'brew') return { state: 'working', bubble: '커피 내리는 중' };
      if (ch.goal === 'refill') return { state: 'working', bubble: '커피 보충' };
      if (ch.goal && ch.goal.startsWith('deliver')) return { state: 'done', bubble: '커피 왔어요' };
      return { state: 'idle' };
    }
    if (ch.kind === 'sec' && ch.goal === 'scribe' && !ch.walking) return { state: 'working', bubble: '회의록 작성' };
    // 비서: 승인 요청이 있는 직원 옆에 도착하면 손을 든다
    return { state: state.perms.length && ch.goal !== 'home' && !ch.walking ? 'waiting' : 'idle' };
  }
  function lookOf(ch) { return ch.kind === 'staff' ? STAFF[ch.role].look : ch.kind === 'member' ? MEMBER_LOOKS[ch.slot % MEMBER_LOOKS.length] : ch.kind === 'temp' ? LOOKS.temp : ch.kind === 'sec' ? LOOKS.sec : (LOOKS[ch.id] || LOOKS.dev); }

  function drawChar(ctx, ch, t) {
    const id = ch.id;
    const a = charState(ch);
    const p = iso(ch.gx, ch.gy);
    let x = Math.round(p.x), y = Math.round(p.y);
    const look = lookOf(ch);
    const anim = ch.walking ? 'walk' : ch.goal === 'sofa' && seated(ch) ? 'sip' : a.state === 'working' ? 'work' : a.state === 'waiting' ? 'wait' : a.state === 'thinking' ? 'think' : 'idle';
    if (ch.jumpUntil > t) y -= Math.round(Math.sin((1 - (ch.jumpUntil - t) / 500) * Math.PI) * 4);

    if (state.selected === id || state.hover === id) {
      ctx.globalAlpha = state.selected === id ? 0.9 : 0.5;
      diamond(ctx, x, y, 10, 5, P.lamp);
      ctx.globalAlpha = 1;
      diamond(ctx, x, y, 7, 3.5, state.selected === id ? '#ffe9a3' : P.floorA);
    } else {
      ctx.globalAlpha = 0.25; diamond(ctx, x, y, 7, 3.5, P.ink); ctx.globalAlpha = 1;
    }
    const spriteKey = ch.kind === 'staff' ? 'char.' + ch.role : ch.kind === 'member' ? 'char.member' : ch.kind === 'temp' ? 'char.temp' : ch.kind === 'sec' ? 'char.sec' : 'char.' + id;
    const sit = seated(ch);
    if (drawAsset(ctx, sit ? spriteKey + (ch.desk.front ? '.seatedFront' : '.seated') : spriteKey, x, y, anim, t)) return;
    drawPerson(ctx, x, y, look, anim, ch.dir || 'SW', sit, t, id);
    if (ch.carry) { const fl = ch.dir === 'SE' || ch.dir === 'NE'; const cx = fl ? x + 5 : x - 7; R(ctx, cx, y - 10, 3, 3, P.paper); R(ctx, cx, y - 10, 3, 1, '#6b4430'); } // 커피 컵
  }

  const seated = (ch) => !!ch.desk && !ch.walking && near(ch, ch.desk);
  // 바라보는 방향: SW(+gy, 왼쪽 아래)·SE(+gx, 오른쪽 아래)는 얼굴, NW(-gx)·NE(-gy)는 뒷모습.
  // 그림은 왼쪽을 보는 SW·NW 를 기준으로 그리고 SE·NE 는 좌우를 뒤집는다.
  const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'SE' : 'NW') : (dy > 0 ? 'SW' : 'NE'));

  function drawPerson(ctx, x, y, look, anim, dir, sit, t, id) {
    const front = dir === 'SW' || dir === 'SE', flip = dir === 'SE' || dir === 'NE';
    const walk = anim === 'walk';
    const bob = sit ? (anim === 'work' ? Math.floor(t / 180) % 2 : 0) : walk ? (Math.floor(t / 140) % 2) : anim === 'work' || anim === 'idle' || anim === 'think' ? (Math.floor(t / 900) % 2) : 0;
    // px: 발(또는 의자) 기준 좌표. 반전이면 x 를 거울처럼 뒤집는다.
    const px = (dx, dy, w, h, c) => R(ctx, flip ? x - dx - w : x + dx, y + dy, w, h, c);
    const sh = look.shirt, shS = look.shirtS, skin = P.skin, skinS = P.skinS, hair = look.hair;
    const ph = Math.floor(t / 140) % 4;           // 걷기 4박자
    const lean = sit && !front ? -1 : anim === 'sip' ? 1 : 0;   // 뒷모습으로 앉으면 모니터 쪽으로 숙이고, 소파에선 등받이에 기댄다
    const top = sit ? 3 : 0;                      // 앉으면 몸이 의자 높이만큼 내려간다
    const B = (dy) => dy + top - bob;             // 몸통·머리의 세로 위치

    // 다리
    if (sit) {
      // 엉덩이는 방석 위, 허벅지는 바라보는 쪽으로 수평, 무릎에서 꺾여 정강이가 바닥까지. 앞모습은 몸통 다음에 그린다
      if (!front) { px(-6, -8, 6, 2, P.pants); px(-7, -7, 2, 5, P.pants); px(-8, -2, 3, 1, P.ink); }
    } else {
      const sw = walk ? [-1, 0, 1, 0][ph] : 0;   // 앞다리/뒷다리 보폭
      const lift = walk ? [0, 1, 0, 1][ph] : 0;
      px(-3 + sw, -6, 3, 6 - (ph === 1 && walk ? 1 : 0), P.pants);
      px(0 - sw, -6, 3, 6 - (ph === 3 && walk ? 1 : 0), P.pants);
      px(-4 + sw, -1 - (ph === 1 ? lift : 0), 3, 1, P.ink);
      px(-1 - sw, -1 - (ph === 3 ? lift : 0), 3, 1, P.ink);
    }

    // 몸통
    px(-4 + lean, B(-14), 8, 8, sh);
    if (front) {
      px(2 + lean, B(-14), 2, 8, shS);
      if (look.tie) { px(-2, B(-14), 2, 6, look.accent); px(-3, B(-14), 4, 1, P.paper); }
      if (look.collar) px(-3, B(-14), 5, 1, look.accent);
      if (look.badge) px(-3, B(-12), 2, 2, look.accent);
      if (look.apron) { px(-3 + lean, B(-12), 6, 6, '#2a2a2a'); px(-2 + lean, B(-14), 1, 2, '#2a2a2a'); px(1 + lean, B(-14), 1, 2, '#2a2a2a'); }
    } else {
      px(-4 + lean, B(-14), 2, 8, shS);
      if (look.apron) px(-1 + lean, B(-9), 3, 1, '#2a2a2a');                       // 앞치마 끈
    }

    // 앞모습으로 앉으면 허벅지 두 개가 몸통 앞으로 나오고, 정강이가 앞쪽 바닥까지 내려간다
    if (sit && front) {
      px(-5, -5, 6, 2, '#3a3a3a'); px(-6, -4, 6, 2, P.pants);              // 허벅지(뒤·앞)
      px(-6, -4, 2, 4, '#3a3a3a'); px(-7, -3, 2, 4, P.pants);              // 정강이
      px(-7, 0, 3, 1, P.ink); px(-8, 1, 3, 1, P.ink);                      // 신발
    }

    // 팔
    const k = Math.floor(t / 120) % 2;
    if (anim === 'wait') {
      px(-6 + lean, B(-22), 2, 9, front ? sh : shS); px(-6 + lean, B(-24), 2, 2, skin);   // 손을 든다
      px(3 + lean, B(-13), 2, 6, front ? shS : sh); px(3 + lean, B(-7), 2, 2, front ? skinS : skin);
    } else if (sit && anim === 'work') {
      // 키보드로 팔을 뻗어 타자를 친다
      px(-6 + lean, B(-13), 2, 3, front ? sh : shS); px(-9 + lean, B(-11), 4, 2, front ? sh : shS); px(-10 + lean, B(-11) - k, 2, 2, skin);
      px(2 + lean, B(-12), 2, 3, front ? shS : sh); px(-3 + lean, B(-10), 4, 2, front ? shS : sh); px(-5 + lean, B(-10) - (1 - k), 2, 2, skin);
    } else if (sit && anim === 'sip') {
      // 컵을 무릎에 들고 있다가 이따금 입으로 가져가 홀짝인다
      const cup = (cx, cy) => { px(cx, cy, 3, 3, '#d9774f'); px(cx, cy, 3, 1, '#4a2e20'); };   // 흰 셔츠에 묻히지 않게 주황 머그
      if ((t + id.length * 500) % 3500 < 900) { px(-5 + lean, B(-13), 2, 2, front ? sh : shS); px(-6 + lean, B(-14), 2, 2, skin); cup(-7 + lean, B(-17)); }
      else { px(-5 + lean, B(-13), 2, 4, front ? sh : shS); px(-6, -7, 3, 2, skin); cup(-8, -9); }   // 무릎 위에 컵
      px(3 + lean, B(-13), 2, 5, front ? shS : sh);
    } else if (sit && anim === 'think') {
      px(-5 + lean, B(-13), 2, 5, front ? sh : shS); px(-4 + lean, B(-15), 2, 2, skin);   // 턱을 괸다
      px(3 + lean, B(-13), 2, 6, front ? shS : sh);
    } else if (sit) {
      px(-5 + lean, B(-13), 2, 5, front ? sh : shS); px(-6 + lean, B(-8), 3, 2, skin);    // 무릎 위에 손
      px(3 + lean, B(-13), 2, 5, front ? shS : sh);
    } else {
      const s2 = walk ? [1, 0, -1, 0][ph] : 0;   // 걸을 때 팔을 다리와 반대로 흔든다
      px(-5 + s2, B(-13), 2, 6, front ? sh : shS); px(-5 + s2, B(-7), 2, 2, front ? skin : skinS);
      px(3 - s2, B(-13), 2, 5, front ? shS : sh); px(3 - s2, B(-8), 2, 2, front ? skinS : skin);
    }

    // 머리
    const hx = lean;
    if (front) {
      px(-3 + hx, B(-21), 7, 7, skin);
      px(3 + hx, B(-21), 1, 7, skinS);
      px(-4 + hx, B(-17), 1, 1, skin);                                   // 코
      const blinkEye = Math.floor((t + id.length * 777) / 140) % 28 === 0;
      const ey = B(-18);
      if (!blinkEye) { px(-3 + hx, ey, 1, 2, P.ink); px(0 + hx, ey, 1, 2, P.ink); }   // 비스듬히 보므로 눈이 얼굴 앞쪽으로 치우친다
      else { px(-3 + hx, ey + 1, 1, 1, P.ink); px(0 + hx, ey + 1, 1, 1, P.ink); }
      px(2 + hx, B(-18), 1, 2, skinS);                                   // 귀
      if (look.glasses) { px(-4 + hx, ey - 1, 3, 1, P.ink); px(-1 + hx, ey - 1, 3, 1, P.ink); }
      px(-3 + hx, B(-22), 7, 2, hair);
      px(3 + hx, B(-21), 1, 3, hair);
      if (look.style === 'bob') { px(-4 + hx, B(-22), 9, 1, hair); px(3 + hx, B(-21), 2, 6, hair); px(-4 + hx, B(-21), 1, 2, hair); }
      else if (look.style === 'messy') { px(-4 + hx, B(-21), 1, 2, hair); px(-1 + hx, B(-23), 2, 1, hair); px(3 + hx, B(-23), 1, 1, hair); }
      else px(-4 + hx, B(-21), 1, 1, hair);
      if (look.headphones) { px(-3 + hx, B(-23), 7, 1, P.ink); px(1 + hx, B(-19), 2, 3, P.coral); }
    } else {
      px(-1 + hx, B(-15), 3, 1, skinS);                                  // 목
      px(-3 + hx, B(-22), 7, 7, hair);
      px(-3 + hx, B(-18), 1, 2, skin);                                   // 볼이 살짝
      px(3 + hx, B(-19), 1, 2, skin);                                    // 귀
      if (look.style === 'bob') px(-4 + hx, B(-21), 9, 6, hair);
      else if (look.style === 'messy') { px(-4 + hx, B(-21), 1, 3, hair); px(-1 + hx, B(-23), 2, 1, hair); px(3 + hx, B(-23), 1, 1, hair); }
      if (look.headphones) { px(-3 + hx, B(-23), 7, 1, P.ink); px(3 + hx, B(-19), 2, 3, P.coral); }
    }
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
  function toScreen(lx, ly) { return { x: state.offX + lx * state.scale, y: state.offY + ly * state.scaleY }; }
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
      if (!r.plate) continue;
      // 문 옆 칸막이 위에 문패처럼 붙인다(복도에서 읽히고 방 안 물건과 겹치지 않음)
      const p = iso(r.plate[0], r.plate[1]);
      const tw = ctx.measureText(r.name).width;
      const s0 = toScreen(p.x, p.y - PART - 2);
      const s = { x: s0.x - (tw + 4 * d) / 2, y: s0.y - fs / 2 - 3 * d };
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
      const label = ch.kind === 'staff' ? STAFF[ch.role].label : ch.kind === 'member' ? '개발 팀원' : ch.kind === 'temp' ? '도우미' : ch.kind === 'sec' ? '비서' : (state.roles[id] || { name: id }).name;
      const nfs = Math.max(9 * d, Math.round(fs * 0.78));           // 이름표는 말풍선보다 작게
      ctx.font = nfs + 'px Galmuri9, Galmuri11, monospace';
      const tw = ctx.measureText(label).width;
      const pad = 4 * d, npad = 2 * d;
      // 이름표는 머리 바로 위(손을 들면 손 위), 말풍선은 그 위에 띄운다
      const headTop = toScreen(p.x, p.y - (seated(ch) ? 20 : 23) - (a.state === 'waiting' ? 3 : 0));
      const th = nfs + 2 * d;
      const ny = headTop.y - th;
      const dim = ch.kind !== 'role';
      pixelBox(ctx, Math.round(s.x - tw / 2 - npad), Math.round(ny), Math.round(tw + npad * 2), Math.round(th), state.selected === id ? '#f6c445' : dim ? '#4a4a4a' : '#141414', '#141414', Math.round(d));
      ctx.fillStyle = state.selected === id ? '#141414' : '#f5f5f5';
      ctx.fillText(label, Math.round(s.x - tw / 2), Math.round(ny + th / 2 + d * 0.5));
      ctx.font = fs + 'px Galmuri11, Galmuri9, monospace';

      let text = null, tone = 'normal';
      if (ch.kind === 'sec' && ch.goal !== 'scribe') continue; // 비서는 손만 든다(말풍선은 승인을 요청한 직원이 띄움). 회의 서기일 때만 말풍선
      if (a.state === 'thinking') text = '생각 중' + '.'.repeat(1 + (Math.floor(t / 400) % 3));
      else if (a.state === 'working') text = a.bubble || '작업 중';
      else if (a.state === 'waiting') { text = a.bubble || '승인 필요'; tone = 'alert'; }
      else if (a.state === 'done') { text = a.bubble || '완료'; tone = 'good'; }
      else if (a.state === 'failed') { text = a.bubble || '문제 발생'; tone = 'bad'; }
      if (!text) continue;
      if (text.length > 26) text = text.slice(0, 25) + '…';
      const bw = ctx.measureText(text).width + pad * 2;
      const bh = fs + 8 * d;
      let bx = Math.round(headTop.x - bw / 2);
      bx = Math.max(4 * d, Math.min(state.canvas.width - bw - 4 * d, bx));
      const byy = Math.round(ny - bh - 6 * d);
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
  // 멈춰 있을 때 바라보는 쪽: 자리면 책상, 회의 중이면 테이블, 비서는 대표(또는 승인을 요청한 직원)
  // 화면 전용 직원이 지금 있어야 할 곳 [자리, 키, 바라볼 곳]
  function staffGoal(ch, t) {
    const home = STAFF[ch.role].home;
    if (ch.role === 'lib') {
      if (state.shredUntil > t) return [SHRED_SPOT, 'shred', SHREDDER];
      if (state.fileUntil > t) return [CAB_SPOT, 'file', { gx: CAB_SPOT.gx, gy: 0 }];
      // 평소: 자리에 있다가 가끔 아무 캐비닛이나 열어 본다(빠져나온 서랍이 가리지 않게 살짝 옆에 선다)
      return routine(ch, t, (r) => {
        if (r && r.key === 'home') { const i = Math.floor(Math.random() * CABINETS.length), cb = CABINETS[i]; return { p: { gx: cb.gx - 0.45, gy: 1.25 }, key: 'cab-' + i, face: { gx: cb.gx, gy: 0 }, dwell: rand(4000, 7000) }; }
        return { p: home, key: 'home', face: { gx: home.gx - 1, gy: home.gy + 1 }, dwell: rand(15000, 40000) };
      });
    }
    if (ch.role === 'eng') {
      if (serverBusy()) return [RACK_SPOT, 'rack', { gx: RACK_SPOT.gx, gy: 10 }];
      if (state.panicUntil > t) return [RACK_SPOT, 'panic', { gx: RACK_SPOT.gx, gy: 10 }];
      // 평소: 콘솔과 무작위로 고른 랙 앞을 오간다
      return routine(ch, t, (r) => {
        if (r && r.key === 'home') { const i = Math.floor(Math.random() * RACKS.length), rk = RACKS[i]; return { p: { gx: rk.gx, gy: 8.5 }, key: 'rack-' + i, face: rk, dwell: rand(8000, 20000) }; }
        return { p: home, key: 'home', face: CONSOLE, dwell: rand(8000, 20000) };
      });
    }
    // 바리스타: 커피를 내려 오래 일한 직원에게 가져다준다. 할 일이 없으면 소파에서 커피를 마시다 가끔 채우러 간다
    const c = state.coffee;
    if (c && c.phase === 'deliver') return [SEC_SPOT[c.agent], 'deliver-' + c.agent, HOME[c.agent]];
    if (c) return [home, 'brew', COFFEE];
    return routine(ch, t, (r) => (r && r.key === 'sofa'
      ? { p: home, key: 'refill', face: COFFEE, dwell: 4000 }
      : { p: SOFA_SEAT, key: 'sofa', face: null, dwell: rand(20000, 40000) }));
  }
  // 할 일이 없을 때의 소일거리: 도착한 뒤 dwell 만큼 머물다 next 로 다음 동작을 고른다
  const rand = (a, b) => a + Math.random() * (b - a);
  function routine(ch, t, next) {
    let r = ch.routine;
    if (r && ch.goal !== r.key) r.until = undefined;            // 다른 일로 자리를 비웠으면 돌아와서 다시 잰다
    if (!r || (ch.goal === r.key && arrived(ch) && t > (r.until ??= t + r.dwell))) r = ch.routine = next(r);
    return [r.p, r.key, r.face];
  }
  function updateCoffee(ch, t) {
    let c = state.coffee;
    if (!c) {
      const id = Object.keys(HOME).find((k) => state.workSince[k] && t - state.workSince[k] > COFFEE_AFTER && !(t - (state.coffeeAt[k] || -Infinity) < COFFEE_AGAIN) && SEC_SPOT[k]);
      if (id) state.coffee = c = { agent: id, phase: 'brew', until: t + 3500 };
      return;
    }
    if (c.phase === 'brew' && t > c.until && !ch.walking) { c.phase = 'deliver'; ch.carry = true; }
    else if (c.phase === 'deliver' && arrived(ch) && ch.goal === 'deliver-' + c.agent && near(ch, SEC_SPOT[c.agent])) {
      ch.carry = false; state.cupUntil[c.agent] = t + CUP_STAYS; state.coffeeAt[c.agent] = t; c.phase = 'return';
    } else if (c.phase === 'return' && arrived(ch) && near(ch, STAFF.barista.home)) state.coffee = null;
  }
  function ensureStaff() {
    for (const role of Object.keys(STAFF)) {
      const key = 'staff:' + role, h = STAFF[role].home;
      if (!state.chars[key]) state.chars[key] = { id: key, kind: 'staff', role, gx: h.gx, gy: h.gy, path: [], goal: null, walking: false, placed: true, carry: false, faceTo: null, desk: role === 'barista' ? SOFA_SEAT : null };
    }
  }

  function restDir(ch) {
    if (seated(ch)) return ch.desk.front ? 'SW' : 'NE';
    const look = (p) => dirOf(p.gx - ch.gx, p.gy - ch.gy);
    if (ch.goal && (ch.goal.startsWith('meet') || ch.goal.startsWith('huddle'))) return look(TABLE);
    if (ch.kind === 'staff' && ch.faceTo) return look(ch.faceTo);
    if (ch.kind === 'sec') { if (ch.goal === 'scribe') return look(TABLE); const pr = state.perms.find((x) => HOME[x.agentId]); return look(pr ? HOME[pr.agentId] : HOME.ceo); }
    return ch.dir || 'SW';
  }

  function update(dt, t) {
    const tone = checkTone();
    if (tone === 'fail' && state.lastTone !== 'fail') state.panicUntil = t + 8000;   // 확인 실패 순간에만 당황한다
    state.lastTone = tone;
    for (const ch of Object.values(state.chars)) {
      if (ch.kind === 'staff') {
        if (ch.role === 'barista') updateCoffee(ch, t);
        const [p, key, face] = staffGoal(ch, t); goTo(ch, p, key); ch.faceTo = face;
      }
      if (ch.kind === 'role' && ch.placed) { const [p, key] = roleGoal(ch, t); goTo(ch, p, key); }
      else if (ch.kind === 'sec') { const [p, key] = secGoal(); goTo(ch, p, key); }
      else if (ch.kind === 'member') goTo(ch, ch.desk, 'desk');
      else if (ch.kind === 'temp') {
        if (ch.leaving) { goTo(ch, ENTRANCE, 'exit'); if (arrived(ch)) { delete state.chars[ch.id]; continue; } }
        else goTo(ch, ch.spot, 'desk');
      }
      const next = ch.path[0];
      if (!next) { ch.walking = false; ch.dir = restDir(ch); continue; }
      const dx = next.gx - ch.gx, dy = next.gy - ch.gy;
      if (Math.hypot(dx, dy) > 0.01) ch.dir = dirOf(dx, dy);
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
    const fit = Math.min(c.width / W, c.height / (H * TILT));
    state.scale = fit; // 남는 공간 없이 꽉 채운다(정수배로 내리면 최대 1/3이 비었다)
    state.scaleY = fit * TILT;
    state.offX = Math.round((c.width - W * state.scale) / 2);
    state.offY = Math.round((c.height - H * state.scaleY) / 2);
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
    // 뒷모습 자리: 책상은 사람 뒤, 의자 등받이는 사람 앞. 앞모습 자리: 의자는 사람 뒤, 책상은 사람 앞.
    const stations = [...Object.keys(HOME).map((id) => [HOME[id], id]), ...TEMP_DESKS.map((d) => [d, 'temp'])];
    for (const [h, owner] of stations) {
      // 긴 책상은 가운데 깊이로 정렬하면 벽·칸막이 조각과 순서가 칸마다 엇갈린다. 앉은 사람 깊이에 붙여,
      // 뒷모습 자리는 사람 바로 앞, 앞모습 자리는 사람 바로 뒤에 그린다(벽에 붙여도 벽 밖으로 튀어나오지 않음).
      add(h.gx + h.gy + (h.front ? 0.1 : -0.1), () => drawDesk(b, h, owner, t));
      add(h.gx + h.gy - (h.front ? 0.2 : 0.05), () => drawChairSeat(b, h, owner, t));
      add(h.gx + h.gy + (h.front ? -0.3 : 0.3), () => drawChairBack(b, h, owner, t));
    }
    // 칸막이에 붙은 책장은 칸막이보다 앞(방 안쪽)에 있으므로 칸막이 조각보다 나중에 그린다
    SHELVES.forEach((sh, i) => add(sh.x1 + sh.y1, () => drawShelf(b, sh, i, t)));
    for (const dv of DIVIDERS) add(dv[0] + (dv[1] + dv[2]) / 2, () => drawDivider(b, dv));
    add(TABLE.gx + TABLE.gy, () => drawTable(b, t));
    for (const p of PLANTS) add(p.gx + p.gy, () => drawPlant(b, p, t));
    add(COOLER.gx + COOLER.gy, () => drawCooler(b, t));
    add(COFFEE.gx + COFFEE.gy, () => drawCoffee(b, t));
    // 조각 깊이: 뒤 칸막이 조각(i+0.5+10)보다 크고, 소파 앞에 선 사람(gy 11.5)보다 작게
    for (const s of SOFA_SLICES) add(s.i + 0.5 + SOFA.y0 + 0.2, () => drawSofaSlice(b, s, t));
    add(LTABLE.gx + LTABLE.gy, () => drawLoungeTable(b, t));
    const busy = serverBusy();
    RACKS.forEach((p, i) => add(p.gx + p.gy, () => drawRack(b, p, i, t, busy)));
    add(CONSOLE.gx + CONSOLE.gy, () => drawConsole(b, t));
    CABINETS.forEach((p, i) => add(p.gx + p.gy, () => drawCabinet(b, p, i, t)));
    add(SHREDDER.gx + SHREDDER.gy, () => drawShredder(b, t));
    add(QA_BOARD.gx + QA_BOARD.gy, () => drawQaBoard(b, t));
    add(STAGE_BOARD.gx + STAGE_BOARD.gy, () => drawStageBoard(b, t));
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
    ctx.drawImage(state.buf, state.offX, state.offY, W * state.scale, H * state.scaleY);
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
      const hw = 9 * state.scale, hh = 16 * state.scaleY;
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
    const lx = (mx - state.offX) / state.scale, ly = (my - state.offY) / state.scaleY;
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
      ensureMembers();
      ensureStaff();
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
      if (!ch.placed) {
        // 처음 그릴 때: 각자 자기 방 자리에서 시작
        const spot = HOME[a.id];
        if (spot) { ch.gx = spot.gx; ch.gy = spot.gy; }
        ch.goal = 'home';
        ch.placed = true;
      }
      if (a.state === 'done' && (!prev || prev.state !== 'done')) ch.jumpUntil = now + 500;
      const busy = (x) => x && (x.state === 'working' || x.state === 'thinking');
      if (busy(a) && !busy(prev)) state.workSince[a.id] = now;     // 커피 배달용: 계속 일한 시간
      else if (!busy(a)) delete state.workSince[a.id];
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
    setDocs(n) {
      const v = n || 0;
      if (state.docsSeen && v > state.docs) state.fileUntil = performance.now() + 3500;   // 문서가 늘면 사서가 꽂는다
      state.docs = v; state.docsSeen = true;
    },
    setSubs(list) {
      for (const k of Object.keys(state.chars)) if (state.chars[k].kind === 'temp') delete state.chars[k];
      for (const m of members()) { m.sub = null; m.label = null; }
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
