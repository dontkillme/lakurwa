// La Kurwa - visual effects: the epic thrown cup (easter egg), particles, screen shake.
// Effects run on REAL time (not game speed) so they look the same at 1x and 4x.
'use strict';

LK.particles = [];
LK.shake = 0;                 // seconds of screen shake left
LK.CUP = {
  windup: 0.55,               // game seconds the guest winds up before throwing
  baseTime: 1.15,             // flight time (real seconds) + perTile * distance
  perTile: 0.07,
  peak: 110,                  // arc height in screen px (zoom 1) + 9 per tile
  size: 54,                   // mug size in px (zoom 1)
  damage: 25                  // counter damage
};

// shout + nearby reactions when a cup flies
function react(x, y, r, lines, staffLines) {
  for (const c of LK.state.chars) {
    if (!c.active || LK.dist(c.x, c.y, x, y) > r) continue;
    if (c.kind === 'client' && lines && Math.random() < 0.7) c.say(LK.pick(LK.tList(lines)), 1.6);
    else if ((c.kind === 'employee' || c.kind === 'player') && staffLines) c.say(LK.pick(LK.tList(staffLines)), 1.8);
  }
}

// Any character can throw: wind-up (arm raised, real time), then the mug flies.
// target: an object or {x, y}; default = the nearest bar counter (or the tile in front).
LK.startThrow = function (c, target, quiet) {
  if (!c || !c.active || c.throwing) return false;
  const w = LK.state.world;
  target = target || w.nearestObj('counter', c.tx, c.ty) || { x: c.tx + 3, y: c.ty - 1 };
  c.throwing = { t: 0, target };
  c.path = []; c.work = null;
  c.faceTo(target.x + 0.5, target.y + 0.5);
  if (!quiet) c.say(LK.t('say.throwCup'), 2.2);
  return true;
};
function updateThrowers(dt) {
  for (const c of LK.state.chars) {
    const th = c.throwing;
    if (!th) continue;
    if (!c.active) { c.throwing = null; continue; }           // knocked out / dragged mid-throw
    th.t += dt;
    c.path = []; c.vx = c.vy = 0;                              // stand still while throwing
    c.atkAnim = th.thrown ? 'attack2' : 'hold'; c.animLock = 0.2;
    if (!th.thrown && th.t >= LK.CUP.windup) { th.thrown = true; LK.launchCup(c, th.target); }
    if (th.t >= LK.CUP.windup + 0.5) c.throwing = null;
  }
}

// the thrower has wound up: launch the mug at the target (object or {x,y})
LK.launchCup = function (thrower, target) {
  const S = LK.state, C = LK.CUP;
  const tx = target.x + 0.5, ty = target.y + 0.5;
  const dist = LK.dist(thrower.x, thrower.y, tx, ty);
  S.projectiles.push({
    x: thrower.x, y: thrower.y, tx, ty, t: 0, dur: C.baseTime + dist * C.perTile,
    peak: C.peak + dist * 9, spin: (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 5),
    trail: [], target, thrower
  });
  react(thrower.x, thrower.y, 6, 'say.cupWatch', null);
};

// position of a projectile at progress k (0..1): tile x,y and height in px
LK.cupPos = function (p, k) {
  return { x: p.x + (p.tx - p.x) * k, y: p.y + (p.ty - p.y) * k, h: Math.sin(k * Math.PI) * p.peak + 40 * (1 - k) + 18 };
};

LK.fxBurst = (x, y, h, n, kind) => burst(x, y, h, n, kind);
// a 5-point star path around 0,0 (dizzy stars, star particles)
LK.starPath = function (ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
};
function burst(x, y, h, n, kind) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (kind === 'shard' ? 1.2 : 0.8) + Math.random() * 1.6;
    LK.particles.push({
      kind, x, y, h,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,          // tiles / s
      vh: 180 + Math.random() * 260,                       // px / s upwards
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
      life: kind === 'shard' ? 1.4 + Math.random() * 0.6 : 0.7 + Math.random() * 0.4,
      size: kind === 'shard' ? 3 + Math.random() * 4 : 2 + Math.random() * 3,
      color: kind === 'shard' ? LK.pick(['#e8f4ff', '#bcd8f0', '#ffffff', '#9fb8cc']) : kind === 'star' ? LK.pick(['#ffe14a', '#fff6b0', '#ffb830']) : LK.pick(['#f2b52c', '#e8a020', '#fff2c0', '#f7c948'])
    });
  }
}

function impact(p) {
  const S = LK.state;
  LK.impacts = (LK.impacts || 0) + 1;
  const h = 26;
  LK.damageObject(p.target, LK.CUP.damage);              // may destroy it; {x,y} targets just get a splash
  burst(p.tx, p.ty, h, 22, 'shard');
  burst(p.tx, p.ty, h, 18, 'beer');
  LK.fx.push({ type: 'crash', x: p.tx, y: p.ty, t: 1.6, text: LK.t('label.crash') });
  LK.fx.push({ type: 'ring', x: p.tx, y: p.ty, t: 0.35, h: 26 });
  LK.shake = 0.45;
  react(p.tx, p.ty, 6, 'say.cupHit', 'say.cupHitStaff');
}

// called every frame with real seconds (paused game = frozen effects)
LK.updateEffects = function (dt) {
  const S = LK.state;
  updateThrowers(dt);
  if (LK.updateWhacks) LK.updateWhacks(dt);   // the rat's baseball bat (rats.js)
  for (const p of S.projectiles) {
    p.t += dt;
    const k = Math.min(1, p.t / p.dur), pos = LK.cupPos(p, k);
    p.trail.push(pos); if (p.trail.length > 14) p.trail.shift();
    if (Math.random() < dt * 25) LK.particles.push({ kind: 'drop', x: pos.x, y: pos.y, h: pos.h, vx: 0, vy: 0, vh: -40, rot: 0, vr: 0,
      life: 0.6, size: 2 + Math.random() * 2, color: '#f2b52c' });
    if (p.t >= p.dur && !p.hit) { p.hit = true; impact(p); }
  }
  if (S.projectiles.some(p => p.hit)) S.projectiles = S.projectiles.filter(p => !p.hit);
  for (const q of LK.particles) {
    q.life -= dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    q.vh -= 900 * dt; q.h += q.vh * dt; q.rot += q.vr * dt;
    if (q.h <= 0) {                                       // landed: bounce shards, splat drops
      q.h = 0;
      if (q.kind === 'shard' && Math.abs(q.vh) > 80) { q.vh = -q.vh * 0.3; q.vx *= 0.5; q.vy *= 0.5; }
      else { q.vh = 0; q.vx = 0; q.vy = 0; q.vr = 0; }
    }
  }
  if (LK.particles.some(q => q.life <= 0)) LK.particles = LK.particles.filter(q => q.life > 0);
  if (LK.shake > 0) LK.shake = Math.max(0, LK.shake - dt);
};

// ---------- drawing (called by render.js) ----------
LK.shakeOffset = () => LK.shake > 0 ? [(Math.random() - 0.5) * 14 * LK.shake / 0.45, (Math.random() - 0.5) * 10 * LK.shake / 0.45] : [0, 0];

LK.drawCup = function (ctx, p) {
  const z = LK.cam.z, k = Math.min(1, p.t / p.dur), pos = LK.cupPos(p, k);
  const [gx, gy] = LK.toScreen(pos.x, pos.y);
  // shadow on the ground: smaller and fainter the higher the mug flies
  const sh = Math.max(0.35, 1 - pos.h / (p.peak + 60));
  ctx.fillStyle = 'rgba(0,0,0,' + (0.5 * sh) + ')';
  ctx.beginPath(); ctx.ellipse(gx, gy, 22 * z * sh, 10 * z * sh, 0, 0, Math.PI * 2); ctx.fill();
  // motion trail
  for (let i = 1; i < p.trail.length; i++) {
    const a = p.trail[i - 1], b = p.trail[i];
    const [ax, ay] = LK.toScreen(a.x, a.y), [bx, by] = LK.toScreen(b.x, b.y);
    ctx.strokeStyle = 'rgba(255,214,120,' + (i / p.trail.length * 0.85) + ')';
    ctx.lineWidth = (3 + i / p.trail.length * 14) * z; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ax, ay - a.h * z); ctx.lineTo(bx, by - b.h * z); ctx.stroke();
  }
  // the spinning mug with a warm glow
  const size = LK.CUP.size * z * (1 + Math.sin(k * Math.PI) * 0.25);
  const cx = gx, cy = gy - pos.h * z;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 1.1);
  glow.addColorStop(0, 'rgba(255,230,150,0.55)'); glow.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, size * 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.t * p.spin);
  LK.drawIcon(ctx, 'mug', 0, size / 2, size);
  ctx.restore();
};

LK.drawParticles = function (ctx) {
  const z = LK.cam.z;
  for (const q of LK.particles) {
    const [sx, sy] = LK.toScreen(q.x, q.y);
    ctx.globalAlpha = Math.min(1, q.life * 2);
    ctx.fillStyle = q.color;
    if (q.kind === 'star') {
      ctx.save(); ctx.translate(sx, sy - q.h * z); ctx.rotate(q.rot); LK.starPath(ctx, q.size * 1.6 * z); ctx.fill(); ctx.restore();
    } else if (q.kind === 'shard') {
      ctx.save(); ctx.translate(sx, sy - q.h * z); ctx.rotate(q.rot);
      ctx.beginPath(); ctx.moveTo(0, -q.size * z); ctx.lineTo(q.size * 0.8 * z, q.size * 0.6 * z); ctx.lineTo(-q.size * 0.7 * z, q.size * 0.5 * z); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (q.h <= 0 && q.kind !== 'shard') {
      ctx.beginPath(); ctx.ellipse(sx, sy, q.size * 1.8 * z, q.size * 0.8 * z, 0, 0, Math.PI * 2); ctx.fill();   // splat
    } else {
      ctx.beginPath(); ctx.arc(sx, sy - q.h * z, q.size * z, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
};

// ---------- developer helpers (F2 toggles dev mode in the game; also usable from the browser console) ----------
LK.dev = {
  // make a character throw a cup at the nearest bar counter
  throwCup(c, target) {
    if (!c) { LK.log(LK.t('log.devNoChar'), 'warn'); return false; }
    if (!c.active) { LK.log(LK.t('log.devCantThrow', { name: c.name }), 'warn'); return false; }
    const ok = LK.startThrow(c, target);
    LK.log(LK.t(ok ? 'log.devThrows' : 'log.devThrowing', { name: c.name }), 'warn');
    return ok;
  },
  // the Order of the Holy Flame comes right now (a real visit: rent is collected, but the schedule is kept)
  callOrder() {
    const ok = LK.orderSummon();
    LK.log(LK.t(ok ? 'log.devOrder' : 'log.devOrderHere'), 'warn');
    return ok;
  },
  // one more merchant comes now (walks in from the road; the daily schedule is kept)
  callMerchant() {
    const m = LK.spawnMerchant();
    LK.log(LK.t(m ? 'log.devMerchant' : 'log.devMerchantHere', { max: LK.MERCHANT.max }), 'warn');
    return !!m;
  },
  // a thief walks into the bar now
  // the crazy prophet comes now (any hour)
  callProphet() {
    const S = LK.state;
    if (S.prophet && S.chars.includes(S.prophet)) { LK.log(LK.t('log.devProphetHere'), 'warn'); return S.prophet; }
    const p = LK.spawnProphet();
    if (p) p.devCalled = true;
    return p;
  },
  // +1000 Mariuszki
  // put n of an item straight into the storage (ignores the storage space). cat: 'stock' | 'goods' | 'furn'
  addItem(cat, key, n) {
    const S = LK.state, store = cat === 'stock' ? S.stock : cat === 'goods' ? S.goods : S.furn;
    const def = (cat === 'stock' ? LK.INGREDIENTS : cat === 'goods' ? LK.GOODS : LK.FURNITURE)[key];
    if (!def || !(n > 0)) return false;
    store[key] = Math.round(((store[key] || 0) + n) * 10) / 10;
    const name = cat === 'stock' ? LK.ingName(key) : cat === 'goods' ? LK.goodName(key) : LK.furnName(key);
    LK.log(LK.t('log.devAdded', { n, name }), 'warn');
    if (LK.ui && LK.ui.buildMode) LK.ui.renderBuildBar();
    return true;
  },
  money(n) {
    const S = LK.state; n = n || 1000;
    S.money += n;
    LK.fx.push({ type: 'money', x: S.player.x, y: S.player.y, t: 1.4, text: '+' + n });
    LK.log(LK.t('log.devMoney', { n }), 'warn');
    return S.money;
  },
  // the piss easter egg: a random guest who is in the bar (onTent: he must piss on a rental tent)
  piss(onTent) {
    const S = LK.state, w = S.world;
    const guests = S.chars.filter(c => c.kind === 'client' && c.active && !c.hostile && !c.inTent && w.isBar(c.tx, c.ty) &&
      !['piss', 'throw', 'wreck', 'fight', 'toExit', 'leaving'].includes(c.ai.state) && !(c.thief && ['heist', 'search'].includes(c.ai.state)));
    if (!guests.length) { LK.log(LK.t('log.devNoGuest'), 'warn'); return null; }
    const c = LK.pick(guests);
    if (onTent) {
      const tent = LK.angryTent && LK.angryTent(c);
      if (!tent) { LK.log(LK.t('log.devNoTent'), 'warn'); return null; }
      if (!LK.startPiss(c, null, tent)) { LK.log(LK.t('log.devNoTent'), 'warn'); return null; }
    } else if (!LK.startPiss(c)) { LK.log(LK.t('log.devNoTable'), 'warn'); return null; }
    LK.log(LK.t('log.devPiss', { name: c.name }), 'warn');
    return c;
  },
  // a rat comes onto the map now; guardian = the storage protector (works without an altar)
  callRat(guardian) {
    const r = LK.spawnRat(guardian);
    LK.log(LK.t(guardian ? 'log.devRatGuard' : 'log.devRat'), 'warn');
    return r;
  },
  // bold: a heist thief that ignores the staff and goes straight for the storage
  callThief(bold) {
    const c = LK.spawnThief(bold);
    LK.log(LK.t(c ? (bold ? 'log.devHeist' : 'log.devThief') : 'log.devThiefFail'), 'warn');
    return c;
  }
};
