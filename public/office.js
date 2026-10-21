// 쿼터뷰(아이소메트릭) 도트 사무실 렌더러.
// - 모든 그래픽은 코드로 그린 임시 도트(절차적 스프라이트)이며, /assets/manifest.json 에
//   이미지를 등록하면 해당 요소가 그 이미지로 교체된다(자세한 형식은 /assets/README.md).
// - 월드는 낮은 해상도 버퍼(W×H)에 그리고 정수배로 확대해 픽셀 느낌을 유지한다.
// - 이름표와 말풍선은 가독성을 위해 화면 해상도에서 도트 폰트로 그린다.
(function () {
  const W = 304, H = 220;            // 논리 해상도(방이 화면을 꽉 채우도록 여백 최소화)
  const TW = 32, TH = 16;            // 타일 크기
  const GX = 9, GY = 8;              // 바닥 칸 수
  const WALL = 58;                   // 벽 높이
  const OX = W / 2 - (GX - GY) * 8;  // 원점(뒤쪽 모서리) x
  const OY = 70;                     // 원점 y

  const P = {
    ink: '#1b1f3a', floorA: '#8eb0d6', floorB: '#7ea2cb', floorLine: '#6f93bd',
    wallL: '#46558a', wallR: '#55669f', wallTop: '#2b3460', trim: '#38447a',
    wood: '#c98d55', woodL: '#9e6738', woodR: '#b47844', woodTop2: '#d9a06a',
    monitor: '#2a2f4d', led: '#5d648b', lamp: '#f6c445', coral: '#e2574c', mint: '#2fa37a',
    skin: '#f1c7a4', skinS: '#d9a882', pants: '#2a2f4d', paper: '#f3f5fa', plant: '#3e9a62', plantD: '#2b6e46', pot: '#b9643c',
    sky: '#1b2350', star: '#fbe7a6', rug: '#d9c48c', rugD: '#c4ad72',
  };

  const LOOKS = {
    ceo: { shirt: '#2f3a6b', shirtS: '#232c55', hair: '#2b2235', accent: '#e2574c', style: 'short' },
    planner: { shirt: '#8e6bd8', shirtS: '#7253b8', hair: '#6b4430', accent: '#f3f5fa', style: 'bob' },
    dev: { shirt: '#3d8fd1', shirtS: '#2c71aa', hair: '#1f1f2b', accent: '#1b1f3a', style: 'messy', headphones: true },
    qa: { shirt: '#2fa37a', shirtS: '#23825f', hair: '#d9b05a', accent: '#1b1f3a', style: 'short', glasses: true },
  };

  const HOME = {
    ceo: { gx: 6.4, gy: 1.1 },
    planner: { gx: 1.1, gy: 2.0 },
    dev: { gx: 1.6, gy: 5.4 },
    qa: { gx: 6.2, gy: 5.0 },
  };
  // 회의석: 테이블 양옆과 앞쪽(뒤쪽에 서면 테이블에 가려 보이지 않음)
  const MEET = [{ gx: 3.4, gy: 4.2 }, { gx: 5.6, gy: 3.0 }, { gx: 4.9, gy: 4.9 }, { gx: 3.9, gy: 2.4 }];
  const TABLE = { gx: 4.5, gy: 3.6 };
  const PLANTS = [{ gx: 0.5, gy: 0.5 }, { gx: 8.4, gy: 0.6 }, { gx: 0.6, gy: 7.4 }];
  const COOLER = { gx: 0.55, gy: 6.3 };

  const iso = (gx, gy) => ({ x: OX + (gx - gy) * (TW / 2), y: OY + (gx + gy) * (TH / 2) });

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
  // 바닥 위에 놓인 상자(아이소메트릭)
  function box(ctx, cx, cy, hw, hh, h, top, left, right) {
    poly(ctx, [{ x: cx - hw, y: cy }, { x: cx, y: cy + hh }, { x: cx, y: cy + hh - h }, { x: cx - hw, y: cy - h }], left);
    poly(ctx, [{ x: cx + hw, y: cy }, { x: cx, y: cy + hh }, { x: cx, y: cy + hh - h }, { x: cx + hw, y: cy - h }], right);
    diamond(ctx, cx, cy - h, hw, hh, top);
  }
  // 벽면 위의 사각형. side='R'은 gy=0 벽(오른쪽 뒤), 'L'은 gx=0 벽(왼쪽 뒤)
  function wallQuad(side, a, b, h0, h1) {
    const p = (t, h) => { const q = side === 'R' ? iso(t, 0) : iso(0, t); return { x: q.x, y: q.y - h }; };
    return [p(a, h0), p(b, h0), p(b, h1), p(a, h1)];
  }

  // ───────── 상태 ─────────
  const state = {
    canvas: null, ctx: null, buf: null, bctx: null, scale: 1, offX: 0, offY: 0, dpr: 1,
    roles: {}, agents: {}, run: null, active: false, selected: null, hover: null,
    chars: {}, fx: [], onSelect: null, last: 0, stars: [],
  };

  function ensureChar(id) {
    if (!state.chars[id]) {
      const h = HOME[id] || { gx: 4, gy: 4 };
      state.chars[id] = { id, gx: h.gx, gy: h.gy, tx: h.gx, ty: h.gy, atDesk: true, walking: false, face: 1, jumpUntil: 0 };
    }
    return state.chars[id];
  }

  // ───────── 그리기: 방 ─────────
  function drawRoom(ctx, t) {
    // 벽
    poly(ctx, wallQuad('R', 0, GX, 0, WALL), P.wallR);
    poly(ctx, wallQuad('L', 0, GY, 0, WALL), P.wallL);
    poly(ctx, wallQuad('R', 0, GX, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('L', 0, GY, WALL - 4, WALL), P.wallTop);
    poly(ctx, wallQuad('R', 0, GX, 0, 4), P.trim);
    poly(ctx, wallQuad('L', 0, GY, 0, 4), P.trim);
    // 창문(오른쪽 벽): 밤하늘
    for (const [a, b] of [[1.2, 3.0], [3.6, 5.4]]) {
      poly(ctx, wallQuad('R', a - 0.12, b + 0.12, 16, 50), P.trim);
      poly(ctx, wallQuad('R', a, b, 19, 47), P.sky);
      // 별
      for (let i = 0; i < 4; i++) {
        const u = a + (b - a) * ((i * 0.27 + 0.13) % 1);
        const q = iso(u, 0);
        const yy = q.y - 24 - ((i * 7) % 18);
        const on = Math.sin(t / 700 + i * 2 + a) > -0.3;
        if (on) R(ctx, q.x, yy, 1, 1, P.star);
      }
      // 창살
      const m = iso((a + b) / 2, 0);
      R(ctx, m.x, m.y - 47, 1, 28, P.trim);
    }
    // 달
    { const q = iso(4.9, 0); R(ctx, q.x - 1, q.y - 41, 4, 4, P.star); R(ctx, q.x, q.y - 42, 2, 1, P.star); }
    // 화이트보드(왼쪽 벽): 업무 단계 표시
    poly(ctx, wallQuad('L', 2.0, 5.6, 16, 46), P.trim);
    poly(ctx, wallQuad('L', 2.15, 5.45, 18, 44), '#eef2fa');
    const run = state.run;
    const stages = run ? run.stages : null;
    for (let i = 0; i < 6; i++) {
      const u = 2.55 + i * 0.5;
      const q = iso(0, u);
      let c = '#c9d1e4';
      if (stages && stages[i]) {
        const st = stages[i].status;
        c = st === 'done' ? P.mint : st === 'active' ? (Math.floor(t / 400) % 2 ? P.lamp : '#e0a92b') : st === 'failed' ? P.coral : st === 'skipped' ? '#e3e8f2' : '#9aa5c4';
      }
      R(ctx, q.x - 2, q.y - 33, 5, 5, c);
      if (i < 5) R(ctx, q.x - 6, q.y - 29, 2, 1, '#9aa5c4');
    }
    // 화이트보드 낙서
    { const q = iso(0, 2.6); R(ctx, q.x - 3, q.y - 40, 10, 1, '#9aa5c4'); R(ctx, q.x - 6, q.y - 38, 14, 1, '#c9d1e4'); }
    // 벽시계(오른쪽 벽)
    { const q = iso(7.2, 0); R(ctx, q.x - 4, q.y - 44, 9, 9, P.paper); R(ctx, q.x - 4, q.y - 44, 9, 1, P.ink); R(ctx, q.x - 4, q.y - 36, 9, 1, P.ink); R(ctx, q.x - 4, q.y - 44, 1, 9, P.ink); R(ctx, q.x + 4, q.y - 44, 1, 9, P.ink);
      const ang = t / 6000; R(ctx, q.x, q.y - 40, 1, 1, P.ink); R(ctx, q.x + Math.round(Math.cos(ang) * 2), q.y - 40 + Math.round(Math.sin(ang) * 2), 1, 1, P.coral); }

    // 바닥
    for (let gx = 0; gx < GX; gx++) {
      for (let gy = 0; gy < GY; gy++) {
        const c = iso(gx + 0.5, gy + 0.5);
        if (!drawAsset(ctx, 'floor', c.x, c.y + TH / 2, 'idle', t)) {
          diamond(ctx, c.x, c.y, TW / 2, TH / 2, (gx + gy) % 2 ? P.floorA : P.floorB);
        }
      }
    }
    // 회의용 러그
    { const c = iso(TABLE.gx, TABLE.gy); diamond(ctx, c.x, c.y, 46, 23, P.rugD); diamond(ctx, c.x, c.y, 42, 21, P.rug); }
    // 일하는 책상 아래 조명 웅덩이
    for (const id of Object.keys(HOME)) {
      const a = state.agents[id];
      if (a && (a.state === 'working' || a.state === 'thinking')) {
        const h = HOME[id];
        const c = iso(h.gx + 0.6, h.gy + 0.6);
        ctx.globalAlpha = 0.22 + 0.06 * Math.sin(t / 300);
        diamond(ctx, c.x, c.y, 26, 13, P.lamp);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ───────── 그리기: 소품 ─────────
  function drawDesk(ctx, id, t) {
    const h = HOME[id];
    const c = iso(h.gx + 0.62, h.gy + 0.62);
    if (drawAsset(ctx, 'desk', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 15, 8, 10, P.wood, P.woodL, P.woodR);
    diamond(ctx, c.x, c.y - 10, 13, 6, P.woodTop2);
    // 모니터(뒷면) + LED
    const a = state.agents[id] || {};
    const busy = a.state === 'working' || a.state === 'thinking';
    R(ctx, c.x - 13, c.y - 22, 9, 8, P.monitor);
    R(ctx, c.x - 10, c.y - 14, 3, 2, P.monitor);
    R(ctx, c.x - 6, c.y - 20, 1, 1, busy ? (Math.floor(t / 250) % 2 ? P.lamp : '#fff6c9') : a.state === 'waiting' ? P.coral : P.led);
    if (busy) { ctx.globalAlpha = 0.35; R(ctx, c.x - 14, c.y - 23, 1, 10, P.lamp); ctx.globalAlpha = 1; }
    // 머그컵 / 서류
    R(ctx, c.x + 6, c.y - 15, 3, 3, id === 'qa' ? P.mint : id === 'ceo' ? P.coral : P.paper);
    R(ctx, c.x + 9, c.y - 14, 1, 1, P.ink);
    if (id === 'planner' || id === 'ceo') { R(ctx, c.x + 1, c.y - 13, 5, 2, P.paper); R(ctx, c.x + 1, c.y - 13, 5, 1, '#c9d1e4'); }
  }

  function drawTable(ctx, t) {
    const c = iso(TABLE.gx, TABLE.gy);
    if (drawAsset(ctx, 'table', c.x, c.y, 'idle', t)) return;
    box(ctx, c.x, c.y, 22, 11, 9, P.wood, P.woodL, P.woodR);
    diamond(ctx, c.x, c.y - 9, 19, 9, P.woodTop2);
    // 계약 단계일 때 테이블 위에 서류
    if (state.run && state.run.stage === 'contract' && state.run.status === 'running') {
      R(ctx, c.x - 5, c.y - 12, 6, 4, P.paper); R(ctx, c.x + 2, c.y - 11, 5, 4, P.paper);
      R(ctx, c.x - 4, c.y - 11, 4, 1, '#9aa5c4');
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
    box(ctx, c.x, c.y, 5, 3, 14, '#e3e8f2', '#aab3cc', '#c9d1e4');
    R(ctx, c.x - 3, c.y - 25, 6, 8, '#9fd0f2');
    R(ctx, c.x - 2, c.y - 24, 2, 5, '#cfe9fb');
  }

  // ───────── 그리기: 직원 ─────────
  function drawChar(ctx, id, ch, t) {
    const a = state.agents[id] || { state: 'idle' };
    const p = iso(ch.gx, ch.gy);
    let x = Math.round(p.x), y = Math.round(p.y);
    const look = LOOKS[id] || LOOKS.dev;
    const anim = ch.walking ? 'walk' : a.state === 'working' ? 'work' : a.state === 'waiting' ? 'wait' : a.state === 'thinking' ? 'think' : 'idle';
    if (ch.jumpUntil > t) y -= Math.round(Math.sin((1 - (ch.jumpUntil - t) / 500) * Math.PI) * 4);

    // 선택/호버 표시
    if (state.selected === id || state.hover === id) {
      ctx.globalAlpha = state.selected === id ? 0.9 : 0.5;
      diamond(ctx, x, y, 10, 5, P.lamp);
      ctx.globalAlpha = 1;
      diamond(ctx, x, y, 7, 3.5, state.selected === id ? '#ffe9a3' : P.floorA);
    } else {
      ctx.globalAlpha = 0.25; diamond(ctx, x, y, 7, 3.5, P.ink); ctx.globalAlpha = 1;
    }
    if (drawAsset(ctx, 'char.' + id, x, y, anim, t)) return;

    const bob = anim === 'work' ? (Math.floor(t / 180) % 2) : anim === 'idle' || anim === 'think' ? (Math.floor(t / 900) % 2) : 0;
    const by = y - bob;
    // 다리
    const step = ch.walking ? (Math.floor(t / 140) % 2) : 0;
    R(ctx, x - 4, y - 6 - (step ? 1 : 0), 3, 6 - (step ? 1 : 0), P.pants);
    R(ctx, x + 1, y - 6 - (step ? 0 : 1) * (ch.walking ? 1 : 0), 3, 6 - (ch.walking && !step ? 1 : 0), P.pants);
    R(ctx, x - 4, y - 1, 3, 1, P.ink); R(ctx, x + 1, y - 1, 3, 1, P.ink);
    // 몸통
    R(ctx, x - 5, by - 14, 10, 8, look.shirt);
    R(ctx, x + 3, by - 14, 2, 8, look.shirtS);
    if (id === 'ceo') { R(ctx, x - 1, by - 14, 2, 6, look.accent); R(ctx, x - 2, by - 14, 4, 1, P.paper); }
    if (id === 'planner') R(ctx, x - 3, by - 14, 6, 1, look.accent);
    // 팔
    if (anim === 'wait') {
      R(ctx, x + 5, by - 22, 2, 9, look.shirtS); R(ctx, x + 5, by - 24, 2, 2, P.skin); // 손 들기
      R(ctx, x - 7, by - 13, 2, 6, look.shirt); R(ctx, x - 7, by - 7, 2, 2, P.skin);
    } else if (anim === 'work') {
      const k = Math.floor(t / 120) % 2;
      R(ctx, x - 7, by - 13, 2, 5, look.shirt); R(ctx, x - 6, by - 8 - k, 3, 2, P.skin);
      R(ctx, x + 5, by - 13, 2, 5, look.shirtS); R(ctx, x + 3, by - 8 - (1 - k), 3, 2, P.skin);
    } else {
      R(ctx, x - 7, by - 13, 2, 6, look.shirt); R(ctx, x - 7, by - 7, 2, 2, P.skin);
      R(ctx, x + 5, by - 13, 2, 6, look.shirtS); R(ctx, x + 5, by - 7, 2, 2, P.skin);
    }
    // 머리
    R(ctx, x - 3, by - 21, 7, 7, P.skin);
    R(ctx, x + 3, by - 21, 1, 7, P.skinS);
    const blink = Math.floor((t + id.length * 777) / 140) % 28 === 0;
    const eyeY = by - 18;
    if (!blink) { R(ctx, x - 2, eyeY, 1, 2, P.ink); R(ctx, x + 1, eyeY, 1, 2, P.ink); }
    else { R(ctx, x - 2, eyeY + 1, 1, 1, P.ink); R(ctx, x + 1, eyeY + 1, 1, 1, P.ink); }
    if (look.glasses) { R(ctx, x - 3, eyeY - 1, 3, 1, P.ink); R(ctx, x + 0, eyeY - 1, 3, 1, P.ink); }
    // 머리카락
    R(ctx, x - 3, by - 22, 7, 2, look.hair);
    if (look.style === 'bob') { R(ctx, x - 4, by - 21, 1, 6, look.hair); R(ctx, x + 4, by - 21, 1, 6, look.hair); R(ctx, x - 4, by - 22, 9, 1, look.hair); }
    else if (look.style === 'messy') { R(ctx, x - 4, by - 21, 1, 3, look.hair); R(ctx, x - 1, by - 23, 2, 1, look.hair); R(ctx, x + 3, by - 23, 1, 1, look.hair); }
    else { R(ctx, x - 4, by - 21, 1, 2, look.hair); }
    if (look.headphones) { R(ctx, x - 4, by - 23, 9, 1, P.ink); R(ctx, x - 5, by - 19, 2, 3, P.coral); R(ctx, x + 4, by - 19, 2, 3, P.coral); }
  }

  // ───────── 효과(서류 전달 등) ─────────
  function charPos(id) { const c = ensureChar(id); return iso(c.gx, c.gy); }
  function drawFx(ctx, t) {
    state.fx = state.fx.filter((f) => t < f.start + f.dur);
    for (const f of state.fx) {
      const k = Math.max(0, Math.min(1, (t - f.start) / f.dur));
      if (f.kind === 'paper') {
        const x = f.a.x + (f.b.x - f.a.x) * k;
        const y = f.a.y + (f.b.y - f.a.y) * k - Math.sin(k * Math.PI) * 30 - 18;
        R(ctx, x - 3, y - 4, 6, 7, P.paper);
        R(ctx, x - 2, y - 2, 4, 1, '#9aa5c4'); R(ctx, x - 2, y, 3, 1, '#9aa5c4');
        R(ctx, x - 3, y + 3, 6, 1, '#c9d1e4');
      }
    }
  }

  // ───────── 화면 해상도 레이어(이름표, 말풍선) ─────────
  function toScreen(lx, ly) { return { x: state.offX + lx * state.scale, y: state.offY + ly * state.scale }; }
  function pixelBox(ctx, x, y, w, h, fill, border, bw) {
    ctx.fillStyle = border; ctx.fillRect(x - bw, y - bw, w + bw * 2, h + bw * 2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  }
  function drawOverlay(ctx, t) {
    const d = state.dpr;
    const fs = Math.round(12 * d);
    ctx.font = `${fs}px Galmuri11, Galmuri9, monospace`;
    ctx.textBaseline = 'middle';
    const order = Object.values(state.chars).sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
    for (const ch of order) {
      const id = ch.id;
      const role = state.roles[id] || { name: id };
      const a = state.agents[id] || {};
      const p = iso(ch.gx, ch.gy);
      const s = toScreen(p.x, p.y);
      // 이름표
      const label = role.name;
      const tw = ctx.measureText(label).width;
      const pad = 4 * d;
      const home = HOME[id];
      const atDesk = home && Math.hypot(ch.gx - home.gx, ch.gy - home.gy) < 0.1;
      const ny = s.y + (atDesk ? 20 : 4) * state.scale; // 책상에 있으면 책상 아래쪽에 이름표
      pixelBox(ctx, Math.round(s.x - tw / 2 - pad), Math.round(ny), Math.round(tw + pad * 2), Math.round(fs + 4 * d), state.selected === id ? '#f6c445' : '#1b1f3a', '#1b1f3a', Math.round(d));
      ctx.fillStyle = state.selected === id ? '#1b1f3a' : '#f3f5fa';
      ctx.fillText(label, Math.round(s.x - tw / 2), Math.round(ny + (fs + 4 * d) / 2 + d * 0.5));

      // 말풍선
      let text = null, tone = 'normal';
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
      pixelBox(ctx, bx, byy, Math.round(bw), Math.round(bh), fill, '#1b1f3a', Math.round(2 * d));
      // 꼬리
      ctx.fillStyle = '#1b1f3a';
      const tx = Math.round(headTop.x);
      ctx.fillRect(tx - 3 * d, byy + bh + 2 * d, 6 * d, 2 * d);
      ctx.fillRect(tx - 1 * d, byy + bh + 4 * d, 2 * d, 2 * d);
      ctx.fillStyle = fill; ctx.fillRect(tx - 2 * d, byy + bh, 4 * d, 2 * d);
      ctx.fillStyle = '#1b1f3a';
      ctx.fillText(text, bx + pad, byy + bh / 2 + d * 0.5);
    }
  }

  // ───────── 업데이트/루프 ─────────
  function update(dt, t) {
    for (const ch of Object.values(state.chars)) {
      const dx = ch.tx - ch.gx, dy = ch.ty - ch.gy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.02) {
        const sp = 2.4 * dt;
        const k = Math.min(1, sp / dist);
        ch.gx += dx * k; ch.gy += dy * k; ch.walking = true;
      } else if (ch.walking) { ch.gx = ch.tx; ch.gy = ch.ty; ch.walking = false; }
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
    drawRoom(b, t);
    // 깊이 정렬 대상
    const items = [];
    for (const id of Object.keys(HOME)) {
      const h = HOME[id];
      items.push({ d: h.gx + h.gy + 1.24, draw: () => drawDesk(b, id, t) });
    }
    items.push({ d: TABLE.gx + TABLE.gy, draw: () => drawTable(b, t) });
    for (const p of PLANTS) items.push({ d: p.gx + p.gy, draw: () => drawPlant(b, p, t) });
    items.push({ d: COOLER.gx + COOLER.gy, draw: () => drawCooler(b, t) });
    for (const ch of Object.values(state.chars)) {
      const atTable = Math.hypot(ch.gx - TABLE.gx, ch.gy - TABLE.gy) < 1.6;
      // 회의석에 선 사람은 테이블 위에 겹쳐 그려 가려지지 않게 한다
      items.push({ d: ch.gx + ch.gy + (atTable ? 1.2 : 0), draw: () => drawChar(b, ch.id, ch, t) });
    }
    items.sort((a, c) => a.d - c.d);
    for (const it of items) it.draw();
    drawFx(b, t);

    const ctx = state.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#232b4f';
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
    if (!state.active) ctx.globalAlpha = 0.45;
    ctx.drawImage(state.buf, state.offX, state.offY, W * state.scale, H * state.scale);
    ctx.globalAlpha = 1;
    if (state.active) drawOverlay(ctx, t);
    requestAnimationFrame(frame);
  }

  function hitTest(ev) {
    const r = state.canvas.getBoundingClientRect();
    const mx = (ev.clientX - r.left) * state.dpr, my = (ev.clientY - r.top) * state.dpr;
    let best = null, bestD = Infinity;
    for (const ch of Object.values(state.chars)) {
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

  // ───────── 공개 API ─────────
  window.Office = {
    async init(canvas, { onSelect }) {
      state.canvas = canvas;
      state.ctx = canvas.getContext('2d');
      state.buf = document.createElement('canvas');
      state.buf.width = W; state.buf.height = H;
      state.bctx = state.buf.getContext('2d');
      state.onSelect = onSelect;
      for (const id of Object.keys(HOME)) ensureChar(id);
      new ResizeObserver(resize).observe(canvas);
      resize();
      canvas.addEventListener('mousemove', (e) => {
        const h = state.active ? hitTest(e) : null;
        state.hover = h; canvas.style.cursor = h ? 'pointer' : 'default';
      });
      canvas.addEventListener('mouseleave', () => { state.hover = null; });
      canvas.addEventListener('click', (e) => { const h = state.active ? hitTest(e) : null; if (h && state.onSelect) state.onSelect(h); });
      await loadAssets();
      requestAnimationFrame(frame);
    },
    setRoles(roles) { state.roles = roles || {}; },
    setActive(on) { state.active = !!on; },
    setAgent(a) {
      const prev = state.agents[a.id];
      state.agents[a.id] = a;
      const ch = ensureChar(a.id);
      if (a.state === 'done' && (!prev || prev.state !== 'done')) ch.jumpUntil = performance.now() + 500;
    },
    setAgents(map) { for (const a of Object.values(map || {})) this.setAgent(a); },
    setRun(run) { state.run = run; },
    select(id) { state.selected = id; },
    fx(e) {
      const now = performance.now();
      if (e.kind === 'handoff' && e.from && e.to && e.from !== e.to) {
        state.fx.push({ kind: 'paper', a: charPos(e.from), b: charPos(e.to), start: now, dur: 950 });
      } else if (e.kind === 'gather') {
        (e.ids || []).forEach((id, i) => { const c = ensureChar(id); const m = MEET[i % MEET.length]; c.tx = m.gx; c.ty = m.gy; });
      } else if (e.kind === 'disperse') {
        (e.ids || []).forEach((id) => { const c = ensureChar(id); const h = HOME[id]; c.tx = h.gx; c.ty = h.gy; });
      }
    },
  };
})();
