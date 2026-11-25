// La Kurwa - rendering (2.5D isometric, painter's algorithm)
'use strict';

LK.fx = [];
// optional per-phase timing (dev hash `bench`): LK.perf = { name: total ms }
LK.perf = null;
const pmark = (() => { let t = 0, ph = null; return name => { if (!LK.perf) return; const n = performance.now(); if (ph) LK.perf[ph] = (LK.perf[ph] || 0) + n - t; ph = name; t = n; }; })();
LK.GROUND_OVERLAP = { big: 1.03 };
LK.DIRS4 = ['E', 'N', 'S', 'W'];

LK.Render = {
  // opt.fitParent: size the canvas to its parent element instead of the window (editor)
  init(canvas, opt) {
    this.cv = canvas;
    this.opt = opt || {};
    this.ctx = canvas.getContext('2d');
    this.night = document.createElement('canvas');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },
  resize() {
    const box = this.opt.fitParent ? this.cv.parentElement.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    this.cv.width = Math.max(50, Math.floor(box.width)); this.cv.height = Math.max(50, Math.floor(box.height));
    this.night.width = this.cv.width; this.night.height = this.cv.height;
    LK.view.w = this.cv.width; LK.view.h = this.cv.height;
  },
  diamond(ctx, x, y, fill, stroke, lw) {
    const z = LK.cam.z;
    const [cx, cy] = LK.toScreen(x + 0.5, y + 0.5);
    const hw = LK.TW / 2 * z, hh = LK.TH / 2 * z;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  },
  visibleRange(w) {
    const pts = [[0, 0], [LK.view.w, 0], [0, LK.view.h], [LK.view.w, LK.view.h]].map(p => LK.toTile(p[0], p[1]));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [Math.max(0, Math.floor(Math.min(...xs)) - 2), Math.max(0, Math.floor(Math.min(...ys)) - 2),
            Math.min(w.W - 1, Math.ceil(Math.max(...xs)) + 3), Math.min(w.H - 1, Math.ceil(Math.max(...ys)) + 3)];
  },
  // ---- ground cache ----
  // The ground never changes while playing, so it is drawn once into chunks of CH x CH tiles
  // (ground + floors + terrain transitions) and each frame only copies the visible chunks.
  // Chunks are rebuilt when the zoom or the world's ground changes (world.groundVer) or while
  // something they need (a sprite, a transition mask) was not ready yet.
  CHUNK: 8,
  groundCache: null,
  drawGround(ctx, w, x0, y0, x1, y1, z) {
    const C = this.CHUNK;
    let gc = this.groundCache;
    if (!gc || gc.world !== w || gc.z !== z || gc.ver !== (w.groundVer || 0)) gc = this.groundCache = { world: w, z, ver: w.groundVer || 0, chunks: new Map() };
    const cx0 = Math.floor(x0 / C), cy0 = Math.floor(y0 / C), cx1 = Math.floor(x1 / C), cy1 = Math.floor(y1 / C);
    const keep = new Set();
    for (let s = cx0 + cy0; s <= cx1 + cy1; s++) for (let cx = cx0; cx <= cx1; cx++) {
      const cy = s - cx;
      if (cy < cy0 || cy > cy1) continue;
      const key = cx + ',' + cy;
      keep.add(key);
      let ch = gc.chunks.get(key);
      if (!ch || !ch.complete) { ch = this.buildChunk(w, cx, cy, z); gc.chunks.set(key, ch); }
      const [sx, sy] = LK.toScreen(0, 0);           // screen position of the world origin
      ctx.drawImage(ch.canvas, sx + ch.left, sy + ch.top);
    }
    if (gc.chunks.size > keep.size * 2 + 8) for (const k of [...gc.chunks.keys()]) if (!keep.has(k)) gc.chunks.delete(k);
  },
  buildChunk(w, cx, cy, z) {
    const C = this.CHUNK, X0 = cx * C, Y0 = cy * C, X1 = Math.min(w.W, X0 + C) - 1, Y1 = Math.min(w.H, Y0 + C) - 1;
    // world-pixel bounds of the chunk (origin = tile (0,0) corner)
    const left = Math.floor(((X0 - Y1) * 64 - 72) * z), right = Math.ceil(((X1 + 1 - Y0) * 64 + 72) * z);
    const top = Math.floor(((X0 + Y0) * 32 - 40) * z), bottom = Math.ceil(((X1 + Y1 + 2) * 32 + 56) * z);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, right - left); canvas.height = Math.max(1, bottom - top);
    const g = canvas.getContext('2d');
    let complete = true;
    const at = (x, y) => [(x - y) * 64 * z - left, (x + y + 1) * 32 * z - top];   // tile centre in the chunk canvas
    if (X1 >= X0 && Y1 >= Y0) {
      for (let s = X0 + Y0; s <= X1 + Y1; s++) for (let x = X0; x <= X1; x++) {
        const y = s - x;
        if (y < Y0 || y > Y1) continue;
        const [px, py] = at(x, y);
        // ground tiles are drawn 3 % larger so neighbours overlap and no anti-aliasing seams show between them
        for (const [base, dir] of w.floorLayers(x, y)) {
          const name = LK.groundName(base, x, y, dir);
          if (!LK.iso(name)) complete = false;
          LK.drawIso(g, name, px, py, z, LK.GROUND_OVERLAP);
        }
      }
      if (LK.Terrain) for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const [px, py] = at(x, y);
        if (LK.Terrain.drawBlends(g, w, x, y, px, py, z) === false) complete = false;
      }
    }
    return { canvas, left, top, complete };
  },
  objSprite(o) { return LK.furnSprite(LK.FURNITURE[o.type], o.rot); },
  draw() {
    const S = LK.state, ctx = this.ctx, w = S.world, z = LK.cam.z;
    ctx.fillStyle = '#1d1a16';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const [shx, shy] = LK.shakeOffset ? LK.shakeOffset() : [0, 0];
    ctx.save(); ctx.translate(shx, shy);
    pmark('ground');
    const [x0, y0, x1, y1] = this.visibleRange(w);
    const build = LK.ui && LK.ui.buildMode;

    // ---- ground, floors and terrain transitions: cached chunks (see groundChunks) ----
    if (LK.Terrain) LK.Terrain.budget = LK.TERRAIN.budget;
    this.drawGround(ctx, w, x0, y0, x1, y1, z);
    pmark('terrain');
    // room colours in build mode
    if (build) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const r = w.rooms[y][x];
        if (r !== '.' && LK.ROOMS[r]) this.diamond(ctx, x, y, LK.ROOMS[r].color + '55');
      }
    }
    // decals
    for (const d of w.decals) {
      const [sx, sy] = LK.toScreen(d.x + 0.5, d.y + 0.5);
      if (d.type === 'debris') {
        // broken furniture: a dust patch with splinters and chunks scattered over it
        ctx.fillStyle = 'rgba(30,22,14,0.45)';
        ctx.beginPath(); ctx.ellipse(sx, sy, 40 * z, 17 * z, 0, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 20; i++) {
          const a = LK.hash(d.x * 31 + i, d.y * 17 + i), b = LK.hash(d.x * 7 + i * 3, d.y * 29 + i * 5);
          const px = sx + (a - 0.5) * 76 * z, py = sy + (b - 0.5) * 30 * z;
          ctx.fillStyle = ['#c99a62', '#8a6239', '#e0c49a', '#bdbdb4', '#5a3a22'][i % 5];
          ctx.strokeStyle = 'rgba(20,12,6,0.8)'; ctx.lineWidth = 1;
          ctx.save(); ctx.translate(px, py - 2 * z); ctx.rotate(a * 6);
          const len = (8 + b * 14) * z, th = (2.5 + (i % 3)) * z;
          ctx.fillRect(-len / 2, -th / 2, len, th); ctx.strokeRect(-len / 2, -th / 2, len, th);
          ctx.restore();
        }
        continue;
      }
      ctx.fillStyle = 'rgba(230,210,40,0.55)';
      ctx.beginPath(); ctx.ellipse(sx + 6 * z, sy + 4 * z, 26 * z, 11 * z, 0, 0, Math.PI * 2); ctx.fill();
    }
    // the ring floor
    if (S.ring) {
      const R = S.ring;
      for (let y = R.y - 1; y <= R.y + 1; y++) for (let x = R.x - 1; x <= R.x + 1; x++) this.diamond(ctx, x, y, 'rgba(200,40,30,0.25)');
    }
    // security posts: while choosing one, or while a guard is selected
    const picking = LK.ui && LK.ui.pickPost, sel = LK.ui && LK.ui.selected;
    if (picking || (sel && sel.kind === 'employee' && sel.task === 'security')) {
      for (const c of S.chars) {
        if (c.kind !== 'employee' || !c.guardPost) continue;
        const mine = c === picking || c === sel;
        this.diamond(ctx, c.guardPost.x, c.guardPost.y, mine ? 'rgba(80,170,255,0.35)' : 'rgba(80,170,255,0.15)', '#5af', mine ? 2 : 1);
        const [px, py] = LK.toScreen(c.guardPost.x + 0.5, c.guardPost.y + 0.5);
        if (c.tx !== c.guardPost.x || c.ty !== c.guardPost.y) this.label(ctx, px, py + 4 * z, LK.t('label.post', { name: c.name.split(' ')[0] }), '#9cf', 11);   // he stands on it: his name is there
      }
    }
    // hover
    // touch controls: the selected field is the tile the owner faces (build mode / post picking: the tapped tile)
    const faced = LK.touchMode && !build && !picking && !LK.splashOpen && S.player && S.player.active;
    const hov = faced ? LK.facingTile(S.player) : LK.touchMode && !build && !picking ? null : LK.input && LK.input.hover;
    if (hov) {
      const [hx, hy] = hov;
      if (w.inb(hx, hy)) {
        if (picking) this.diamond(ctx, hx, hy, w.walkable(hx, hy) ? 'rgba(80,170,255,0.3)' : 'rgba(255,60,60,0.3)', w.walkable(hx, hy) ? '#5af' : '#f55', 2);
        else if (faced) this.diamond(ctx, hx, hy, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.6)', 2);
        else this.diamond(ctx, hx, hy, null, build ? '#ffd24a' : 'rgba(255,255,255,0.35)', 2);
      }
    }

    pmark('decals+hover');
    // ---- sortable things ----
    const list = [];
    const cut = !LK.ui || LK.ui.cutaway;
    const players = S.chars.filter(c => c.kind === 'player');
    for (const k in w.edges) {
      const [ex, ey, side] = k.split(',');
      const x = +ex, y = +ey;
      if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) continue;
      const e = w.edges[k];
      // see-through only when a player stands right behind this wall (hidden by it)
      const front = cut && players.some(p => side === 'N'
        ? p.y < y && y - p.y < 2 && p.x > x - 1 && p.x < x + 2
        : p.x < x && x - p.x < 2 && p.y > y - 1 && p.y < y + 2);
      list.push({ d: x + y + 0.5, wall: side, wx: x, wy: y, f: () => {
        const name = (e.sprite || LK.WALLSPR[e.mat][e.kind]) + (side === 'W' ? '_E' : '_S');
        const [sx, sy] = LK.toScreen(x + 0.5, y + 0.5);
        if (front) { ctx.globalAlpha = 0.28; }
        LK.drawIso(ctx, name, sx, sy, z);
        ctx.globalAlpha = 1;
      } });
    }
    for (const o of w.objects) {
      if (!LK.FURNITURE[o.type]) continue;
      if (o.x < x0 - 1 || o.x > x1 + 1 || o.y < y0 - 1 || o.y > y1 + 1) continue;
      const def = LK.FURNITURE[o.type];
      list.push({ d: def.tags.includes('flat') ? o.x + o.y - 0.4 : o.x + o.y + 0.98, px: o.x + 0.5, py: o.y + 0.5, f: () => {
        const [sx, sy] = LK.toScreen(o.x + 0.5, o.y + 0.5);
        if (!o.built) ctx.globalAlpha = 0.35;
        LK.drawFurnMain(ctx, def, o.rot, sx + (o.rummage ? Math.sin(S.simT * 38) * 1.6 * z : 0), sy, z);   // a thief rummaging shakes it
        if (def.icon) LK.drawIcon(ctx, def.icon, sx, sy - 30 * z, 30 * z);
        if (def.tags.includes('ratAltar') && o.built) LK.drawAltarDecor(ctx, o, sx, sy, z);
        ctx.globalAlpha = 1;
        if (!o.built) this.label(ctx, sx, sy - 40 * z, LK.t('label.blueprint'), '#9cf');
        else if (o.hp < 100) this.bar(ctx, sx, sy - 50 * z, o.hp / 100, '#e84');
        if (o.dirty) this.label(ctx, sx, sy - 55 * z, LK.t('label.dirty'), '#dd4');
        if (def.produce && o.built && o.prod >= 1) this.label(ctx, sx, sy - 70 * z, (def.produce.icon || '') + ' ' + Math.floor(o.prod) + ' ' + LK.prodUnit(def.produce), '#9df', 12);   // ready to gather (produce.js)
      } });
      // extra sprite parts, each sorted by the tile it stands on
      for (const p of def.parts || []) {
        const px = o.x + (p.tx || 0), py = o.y + (p.ty || 0);
        list.push({ d: px + py + 0.97, px: px + 0.5, py: py + 0.5, f: () => {
          const [sx, sy] = LK.toScreen(o.x + 0.5, o.y + 0.5);
          if (!o.built) ctx.globalAlpha = 0.35;
          LK.drawFurnPart(ctx, def, p, sx, sy, z);
          ctx.globalAlpha = 1;
        } });
      }
    }
    if (S.ring) {
      const R = S.ring;
      for (let i = -1; i <= 1; i++) {
        const pieces = [[R.x + i, R.y - 1, '_S'], [R.x - 1, R.y + i, '_E'], [R.x + i, R.y + 2, '_S'], [R.x + 2, R.y + i, '_E']];
        for (const [x, y, suf] of pieces) list.push({ d: x + y + 0.5, wall: suf === '_S' ? 'N' : 'W', wx: x, wy: y, f: () => { const [sx, sy] = LK.toScreen(x + 0.5, y + 0.5); LK.drawIso(ctx, 'fenceLow' + suf, sx, sy, z); } });
      }
    }
    for (const c of S.chars) {
      if (c.inTent || c.away) continue;                      // inside his rental tent / on a supply trip
      if (c.x < x0 - 1 || c.x > x1 + 2 || c.y < y0 - 1 || c.y > y1 + 2) continue;
      list.push({ d: c.x + c.y + (c.ko > 0 ? -0.3 : 0.02), px: c.x, py: c.y, f: () => this.drawCharacter(ctx, c) });
    }
    for (const p of S.projectiles) {
      const k = Math.min(1, p.t / p.dur), x = p.x + (p.tx - p.x) * k, y = p.y + (p.ty - p.y) * k;
      list.push({ d: x + y + 3, f: () => LK.drawCup(ctx, p) });   // flies above everything
    }
    pmark('sort');
    list.sort(LK.Render.drawOrder);
    pmark('sprites');
    for (const it of list) it.f();
    if (LK.drawParticles) LK.drawParticles(ctx);

    pmark('night');
    // ---- night ----
    const dark = LK.darkness();
    if (dark > 0.01) {
      const n = this.night, g = n.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, n.width, n.height);
      g.fillStyle = 'rgba(6,8,28,' + dark + ')';
      g.fillRect(0, 0, n.width, n.height);
      g.globalCompositeOperation = 'destination-out';
      const light = (tx, ty, r, a) => {
        const [sx, sy] = LK.toScreen(tx, ty);
        const R = r * LK.TW * 0.55 * z;
        const gr = g.createRadialGradient(sx, sy - 20 * z, 0, sx, sy - 20 * z, R);
        gr.addColorStop(0, 'rgba(0,0,0,' + a + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(sx, sy - 20 * z, R, 0, Math.PI * 2); g.fill();
      };
      for (const o of w.objsWithTag('light', true)) light(o.x + 0.5, o.y + 0.5, LK.FURNITURE[o.type].light, 0.95);
      for (const c of S.chars) if (c.kind === 'player') light(c.x, c.y, 1.6, 0.6);
      if (S.merchant) light(S.merchant.x, S.merchant.y, 1.4, 0.7);
      ctx.drawImage(n, 0, 0);
      // warm tint around lights
      ctx.globalCompositeOperation = 'lighter';
      for (const o of w.objsWithTag('light', true)) {
        const [sx, sy] = LK.toScreen(o.x + 0.5, o.y + 0.5);
        const R = LK.FURNITURE[o.type].light * LK.TW * 0.4 * z;
        const gr = ctx.createRadialGradient(sx, sy - 30 * z, 0, sx, sy - 30 * z, R);
        gr.addColorStop(0, 'rgba(255,160,60,' + 0.18 * dark + ')'); gr.addColorStop(1, 'rgba(255,160,60,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(sx, sy - 30 * z, R, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    pmark('overlays');
    // ---- overlays (always readable) ----
    for (const c of S.chars) this.drawOverlay(ctx, c);
    for (const f of LK.fx) {
      const [sx, sy] = LK.toScreen(f.x, f.y);
      if (f.type === 'ring') {                               // impact shockwave
        const k = LK.clamp(1 - f.t / (f.dur || 0.35), 0, 1);   // never a negative radius (canvas throws)
        ctx.strokeStyle = 'rgba(255,250,230,' + (1 - k) + ')'; ctx.lineWidth = (6 - 4 * k) * z;
        ctx.beginPath(); ctx.ellipse(sx, sy - f.h * z, (14 + 70 * k) * z, (7 + 35 * k) * z, 0, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (f.type === 'key') {                                 // introduction: the key the bot "presses", over the owner
        const c = LK.state.player, [kx, ky] = c ? LK.toScreen(c.x, c.y) : [sx, sy];
        const age = 1.3 - f.t, pop = age < 0.12 ? 0.5 + age / 0.12 * 0.7 : 1.2 - Math.min(0.2, (age - 0.12));
        const wdt = Math.max(34, 18 + f.text.length * 13);
        ctx.save(); ctx.globalAlpha = Math.min(1, f.t * 2); ctx.translate(kx, ky - 125 * z); ctx.scale(pop, pop);
        ctx.fillStyle = '#f3e6cf'; ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 3;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-wdt / 2, -22, wdt, 40, 7); else ctx.rect(-wdt / 2, -22, wdt, 40); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c9a070'; ctx.fillRect(-wdt / 2 + 3, 12, wdt - 6, 4);
        ctx.fillStyle = '#241c14'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, 0, 6);
        ctx.restore();
        continue;
      }
      if (f.type === 'dizzy') {                               // stars circling a head
        const c = f.follow, [hx, hy] = c ? LK.toScreen(c.x, c.y) : [sx, sy];
        for (let i = 0; i < 4; i++) {
          const a = f.t * 5 + i * Math.PI / 2, x = hx + Math.cos(a) * 18 * z, y = hy - 92 * z + Math.sin(a) * 6 * z;
          ctx.save(); ctx.globalAlpha = Math.min(1, f.t); ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#7a5a00'; ctx.lineWidth = 1;
          ctx.translate(x, y); ctx.rotate(a); LK.starPath(ctx, 5 * z); ctx.fill(); ctx.stroke(); ctx.restore();
        }
        continue;
      }
      if (f.type === 'crash' && f.small) {                    // a quick "!" over someone
        ctx.save(); ctx.globalAlpha = Math.min(1, f.t * 2); ctx.font = '900 ' + Math.round(30 * Math.max(0.8, z)) + 'px sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = '#2a0a00'; ctx.fillStyle = '#ff5040';
        const yy = sy - 110 * z - (1 - f.t) * 10; ctx.strokeText(f.text, sx, yy); ctx.fillText(f.text, sx, yy); ctx.restore();
        continue;
      }
      if (f.type === 'crash') {
        const age = Math.max(0, (f.dur || 1.6) - f.t), pop = age < 0.15 ? 0.6 + age / 0.15 * 0.8 : 1.4 - Math.min(0.4, (age - 0.15) * 0.6);   // f.dur: its own lifetime
        ctx.save(); ctx.translate(sx, sy - (f.lift || 70) * z - age * 25); ctx.rotate(-0.12); ctx.scale(pop, pop);
        ctx.globalAlpha = Math.min(1, f.t * 1.5);
        ctx.font = '900 ' + Math.round(34 * Math.max(0.8, z)) + 'px sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 6; ctx.strokeStyle = '#2a0a00'; ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = '#ffcf3a'; ctx.fillText(f.text, 0, 0);
        ctx.restore();
        continue;
      }
      const up = (1.2 - f.t) * 40;
      ctx.font = 'bold ' + Math.round((f.big ? 30 : 15) * Math.max(0.8, z)) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = f.type === 'money' ? '#7f7' : '#f55';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      ctx.strokeText(f.text, sx, sy - 90 * z - up); ctx.fillText(f.text, sx, sy - 90 * z - up);
    }
    // build ghost
    if (build && LK.ui.buildGhost) LK.ui.buildGhost(ctx);
    ctx.restore();
    pmark(null);
  },
  // Painter's order. A wall is a long segment, so its centre depth alone is wrong for things standing
  // next to it (a wall piece one tile to the side would cover a person in front of it). When a wall and
  // a person/object are close, the side of the wall line they stand on decides the order.
  drawOrder(a, b) {
    if (a.wall && b.px != null) { const r = LK.Render.wallVsPoint(a, b); if (r) return r; }
    else if (b.wall && a.px != null) { const r = LK.Render.wallVsPoint(b, a); if (r) return -r; }
    return a.d - b.d;
  },
  // -1: wall first (point in front of it), 1: point first (behind it), 0: they can't overlap on screen.
  // For a straight wall, whatever stands in front of its line is nearer to the viewer at every screen
  // column where the two overlap, so the side test is exact whenever it matters.
  wallVsPoint(w, p) {
    const s = p.px - p.py, s0 = w.wx - w.wy;                // screen-x in tile units
    const lo = w.wall === 'N' ? s0 : s0 - 1, hi = lo + 1;   // horizontal extent of the wall piece
    if (s < lo - 0.7 || s > hi + 0.7) return 0;              // ~ half a character sprite of margin
    if (Math.abs(p.px + p.py - (w.wx + w.wy + 0.5)) > 4) return 0;   // too far apart vertically
    if (w.wall === 'N') return p.py >= w.wy ? -1 : 1;
    return p.px >= w.wx ? -1 : 1;
  },
  frameFor(c) {
    const t = c.animT;
    if (c.pose) return c.pose;                              // a fixed pose for a scene
    if (c.ko > 0 || c.dragBy) return 'idle';
    if (c.animLock > 0 && c.atkAnim) return c.atkAnim;
    if (c.hurtT > 0) return 'hurt';
    if (c.anim === 'walk') return 'walk' + (Math.floor(t * 10) % 8);
    if (c.anim === 'run') return 'run' + (Math.floor(t * 10) % 3);
    if (c.anim === 'drag') return 'drag';
    if (LK.carryingGoods(c) && !c.work) return 'hold';      // arms around the barrel / chest
    if (c.work && c.work.anim === 'idle') return 'idle';
    if (c.work) return Math.floor(t * 3) % 2 ? 'interact' : 'switch0';
    if (c.cheer) return 'cheer' + (Math.floor(t * 3) % 2);
    if (c.hostile) return 'idle';
    if (c.kind === 'client') {
      const s = c.ai.state;
      if (s === 'eating') return Math.floor(t * 0.7) % 3 === 0 ? 'hold' : 'idle';
      if (s === 'waiting') return Math.floor(t * 0.5) % 4 === 0 ? 'think' : 'idle';
      if (s === 'seated') return 'talk';
    }
    if (c.kind === 'merchant' && !c.path.length) return Math.floor(t * 0.5) % 3 === 0 ? 'show' : 'idle';
    if (c.kind === 'prophet' && !c.path.length) return c.preachT > 0 ? 'cheer' + (Math.floor(t * 4) % 2) : Math.floor(t * 0.4) % 3 === 0 ? 'think' : 'idle';
    return 'idle';
  },
  drawCharacter(ctx, c) {
    const z = LK.cam.z;
    const [sx, sy] = LK.toScreen(c.x, c.y);
    if (c.kind === 'rat') {                                  // drawn in code (rats.js)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx, sy, 14 * z, 5 * z, 0, 0, Math.PI * 2); ctx.fill();
      if (LK.ui && LK.ui.selected === c) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy, 18 * z, 7 * z, 0, 0, Math.PI * 2); ctx.stroke(); }
      LK.drawRat(ctx, c, sx, sy, z);
      return;
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 18 * z, 8 * z, 0, 0, Math.PI * 2); ctx.fill();
    const sel = LK.ui && LK.ui.selected === c;
    if (sel || c.kind === 'player') {
      ctx.strokeStyle = sel ? '#ffd24a' : (c.p2 ? '#f6a' : '#6cf'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy, 22 * z, 10 * z, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const down = c.ko > 0 || c.dragBy;
    const seated = c.kind === 'client' && ['seated', 'waiting', 'eating'].includes(c.ai.state) && c.seat;
    LK.drawChar(ctx, c.sheet, c.hue, this.frameFor(c), sx + (down ? -30 * z : 0), sy - (seated ? 14 * z : 0) - (down ? 6 * z : 0), z,
      c.flip, down ? -Math.PI / 2 : 0, c.kind === 'gone' ? 0 : 1);
    // bought goods on his back: a chest (furniture / materials) or a barrel (food and drinks), held in front
    if (LK.carryingGoods(c) && !down) {
      const cg = c.cargo, box = Object.keys(cg.furn).length || Object.keys(cg.goods).length ? 'chestClosed_S' : 'barrel_S';
      const bob = (c.anim === 'walk' || c.anim === 'run') ? Math.sin(c.animT * 20) * 1.5 * z : 0;
      LK.drawIso(ctx, box, sx + (c.flip ? -10 : 10) * z, sy - 20 * z + bob, z * 0.7);
    }
  },
  drawOverlay(ctx, c) {
    const z = LK.cam.z, S = LK.state;
    if (c.kind === 'gone' || c.inTent || c.away) return;
    const [sx, sy0] = LK.toScreen(c.x, c.y);
    const top = sy0 - 100 * z;
    if (c.ko > 0) {
      this.label(ctx, sx, sy0 - 40 * z, c.tied ? LK.t('label.tied') : LK.t('label.ko', { s: Math.ceil(c.ko) }), '#f88');
      if (LK.knownThief(c)) this.label(ctx, sx, sy0 - 56 * z, LK.t('label.thief'), '#ff5040', 12);
      return;
    }
    if (LK.knownThief(c)) this.label(ctx, sx, top - 4, LK.t('label.thief'), '#ff5040', 13);
    if (c.hp < c.maxHp && (c.hostile || c.hurtT > 0 || c.isStaff())) this.bar(ctx, sx, top, c.hp / c.maxHp, '#e33');
    if (c.work && c.work.label) { this.bar(ctx, sx, top - 8, c.work.t / c.work.dur, '#4c4'); this.label(ctx, sx, top - 14, c.work.label, '#cfc', 11); }
    if (c.kind === 'client' && c.ai.state === 'waiting' && c.order) {
      const k = 1 - c.ai.waitT / c.patience;
      this.bar(ctx, sx, top - 6, k, k > 0.5 ? '#6c6' : k > 0.25 ? '#dc4' : '#e44');
      this.label(ctx, sx, top - 12, (c.order.kind === 'drink' ? '🍺 ' : '🍲 ') + c.order.recipe.name, '#fff', 11);
    }
    if (c.carry) this.label(ctx, sx, top - 4, '🍽 ' + c.carry.recipe.name, '#ffd', 11);
    if (c.kind === 'client' && c.hostile) this.label(ctx, sx, top - 4, '💢', '#f44', 16);
    if (c.kind === 'merchant' && !c.bubble && c.state === 'wait') this.label(ctx, sx, top - 4, LK.t('label.trader'), '#ffd24a', 13);
    if (c.bubble) this.bubble(ctx, sx, (c.kind === 'rat' ? sy0 - 34 * z * (c.whack ? 1.6 : 1) : top - 22 * z) - (c.work ? 14 : 0), c.bubble.text);   // rats are small
    if (LK.ui && (LK.ui.selected === c || c.kind === 'employee' && LK.ui.showNames)) this.label(ctx, sx, sy0 + 16 * z, c.name + (c.task && c.kind === 'employee' ? ' [' + LK.tn('task', c.task, c.task) + ']' : ''), '#ffd', 11);
    if (c.kind === 'player') this.label(ctx, sx, sy0 + 16 * z, c.p2 ? 'P2' : 'P1', c.p2 ? '#f6a' : '#6cf', 11);
    if (c.kind === 'order') this.label(ctx, sx, sy0 + 16 * z, LK.t('label.order'), '#ff6a4a', 11);
  },
  bar(ctx, x, y, k, col) {
    const w = 38;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * LK.clamp(k, 0, 1), 4);
  },
  label(ctx, x, y, text, col, size) {
    ctx.font = 'bold ' + Math.round((size || 12) * (LK.fontScale || 1)) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y); ctx.fillStyle = col || '#fff'; ctx.fillText(text, x, y);
  },
  bubble(ctx, x, y, text) {
    const f = LK.fontScale || 1, h = 20 * f;             // text size from Options
    ctx.font = Math.round(12 * f) + 'px sans-serif';
    const w = ctx.measureText(text).width + 12 * f;
    ctx.fillStyle = 'rgba(255,250,235,0.95)'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y + 2 - h, w, h, 6); else ctx.rect(x - w / 2, y + 2 - h, w, h);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 4, y + 2); ctx.lineTo(x, y + 8); ctx.lineTo(x + 4, y + 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 2 - h * 0.3);
  }
};
