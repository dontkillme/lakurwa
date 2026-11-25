// La Kurwa - the rat, and the rat altar.
// A rat (kind 'rat', drawn in code: LK.drawRat) wanders the map. Near the storage room it sneaks in and
// nibbles food (ingredients of kind 'food'), then runs off the map with it. Hit it (owner F, security) and it
// drops what it took (back into the storage) and runs away very, very fast.
// The rat altar (furniture tag 'ratAltar', merchant sometimes, 900 M) can stand anywhere, but guests who see it
// don't like it (reputation). The owner restocks it every day with one bottle of orzechówka (E next to it).
// While it is stocked the rat does not steal: when a thief is in the storage room the rat rushes there from
// anywhere on the map, hits him with a baseball bat (half his health), raises the alarm and runs away.
'use strict';

LK.RAT = {
  max: 3,                    // rats on the map at the same time (only one protects, see LK.protectorRat)
  gnawDmg: 10, gnawTime: 3, gnawChance: 0.6,   // rats gnaw an empty altar (chance per decision when within 10 tiles)
  spawnEvery: [300, 700],    // seconds between rats (when there is none)
  hp: 12,
  wander: [3, 8],            // tiles per wander walk
  wanderSpeed: 1.0, sneakSpeed: 1.15, fleeSpeed: 3.2, rushSpeed: 2.6,   // × normal walking speed
  smellRange: 9,             // tiles to the storage room: he goes for the food
  nibble: [5, 9],            // seconds of nibbling
  take: [1, 2],              // food units taken
  batHit: 0.5,               // share of the thief's max health taken by the baseball bat
  altarChance: 0.35,         // the merchant has a rat altar this often
  seeRange: 4.5,             // guests this close to the altar (and not behind a wall... roughly) see it
  seenRep: 1,                // reputation lost per guest who sees it
  seenMood: 12
};

const rcheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
LK.isRat = c => !!(c && c.kind === 'rat');
LK.ratAltars = () => LK.state.world.objsWithTag('ratAltar', true);   // cached per tag (world.js)
LK.altarActive = () => LK.ratAltars().some(o => o.stocked);
// the one rat that protects the storage: a dev protector rat, else (stocked altar) the oldest rat on the map
LK.protectorRat = function () {
  const rats = LK.state.chars.filter(c => c.kind === 'rat' && c.ai.state !== 'flee');
  return rats.find(c => c.guardian) || (LK.altarActive() ? rats.sort((a, b) => a.id - b.id)[0] : null) || null;
};
LK.ownsAltar = () => LK.ratAltars().length > 0 || Object.entries(LK.state.furn).some(([k, n]) => n > 0 && LK.FURNITURE[k] && LK.FURNITURE[k].tags.includes('ratAltar'));

// guardian (dev): this rat protects the storage even without a stocked altar
LK.spawnRat = function (guardian) {
  const S = LK.state, w = S.world;
  const fromW = Math.random() < 0.5, y = LK.pick(w.route);
  const r = new LK.Char('rat', { name: LK.t('name.rat'), x: fromW ? 0 : w.W - 1, y, str: 2, sta: 2, int: 2, skills: { fighting: 10 } });
  r.maxHp = r.hp = LK.RAT.hp; r.carryCap = 99;
  r.ai = { state: 'wander', t: 0 };
  r.ratLoot = {};
  if (guardian) { r.guardian = true; r.name = LK.t('name.ratGuard'); }
  S.chars.push(r);
  return r;
};
const ratLootEmpty = r => !Object.keys(r.ratLoot || {}).length;
const ratLootText = r => Object.entries(r.ratLoot).map(([k, n]) => n + '× ' + LK.ingName(k)).join(', ');
// flee off the map, very fast
function flee(r) {
  const w = LK.state.world, ex = r.tx < w.W / 2 ? 0 : w.W - 1;
  r.speedMul = LK.RAT.fleeSpeed; r.running = false;
  r.ai = { state: 'flee' };
  if (!r.goTo(ex, LK.pick(w.route)) && !r.goTo(w.W - 1 - ex, w.route[0])) r.kind = 'gone';
}
// hit by anyone: drops the food (back into the storage) and runs
LK.ratHit = function (r, by) {
  const S = LK.state;
  if (r.ai.state === 'flee') return;
  r.hurtT = 0.3;
  LK.fx.push({ type: 'hit', x: r.x, y: r.y, t: 0.5, text: LK.t('label.squeak') });
  if (!ratLootEmpty(r)) {
    const text = ratLootText(r);
    for (const [k, n] of Object.entries(r.ratLoot)) S.stock[k] = Math.round(((S.stock[k] || 0) + n) * 10) / 10;
    r.ratLoot = {};
    LK.log(LK.t('log.ratDropped', { items: text, by: by ? by.name : '?' }), 'good');
  }
  r.say(LK.t('say.ratSqueak'), 1.2);
  r.work = null;
  for (const c of S.chars) if (c.hostile === r) { c.hostile = null; c.path = []; }   // nobody chases it across the map
  flee(r);
};

// what the rat does
LK.ratAI = function (r, dt) {
  const S = LK.state, w = S.world, a = r.ai, R = LK.RAT;
  if (!r.active) return;
  if (r.batT > 0) r.batT -= dt;
  if (a.state === 'whack') return;                         // the bat scene runs on real time (LK.updateWhacks)
  if (a.state === 'flee') {
    if (!r.path.length) {
      if (!ratLootEmpty(r) && !r.reported) { r.reported = true; LK.log(LK.t('log.ratEscaped', { items: ratLootText(r) }), 'bad'); }
      r.kind = 'gone';
    }
    return;
  }
  const guard = r.guardian || LK.altarActive();             // r.guardian: dev protector rat (no altar needed); stocked altar: no rat steals
  // ---- the protector (only one rat): a thief in the storage room?
  if (guard && LK.protectorRat() === r) {
    const thief = S.chars.find(t => LK.isThief(t) && t.active && w.room(t.tx, t.ty) === 'S' && ['heist', 'search', 'toWindow'].includes(t.ai.state));
    if (thief) {
      if (a.state !== 'rush') { r.ai = { state: 'rush', thief, repath: 0 }; r.work = null; r.say(LK.t('say.ratRush'), 1.5); }
      const b = r.ai;
      b.repath -= dt;
      r.speedMul = R.rushSpeed;
      if (LK.dist(r.x, r.y, thief.x, thief.y) <= 1.5 && LK.canHit(r, thief)) { ratWhack(r, thief); return; }
      if (b.repath <= 0 || !r.path.length) { b.repath = 0.5; if (!r.goAdjacent(thief.tx, thief.ty)) r.goTo(thief.tx, thief.ty); }
      return;
    }
    if (a.state === 'rush') r.ai = { state: 'wander', t: 0 };
  }
  // ---- thief rat: nibbling in the storage
  if (a.state === 'nibble') {
    if (guard) { r.work = null; r.ai = { state: 'wander', t: 0 }; return; }   // the altar got stocked meanwhile: no stealing
    if (!r.work) {
      // done: take some food and run
      const food = Object.entries(S.stock).filter(([k, n]) => n >= 1 && LK.INGREDIENTS[k] && LK.INGREDIENTS[k].kind === 'food');
      if (food.length) {
        const [k] = LK.pick(food), n = Math.min(Math.floor(S.stock[k]), LK.rint(R.take[0], R.take[1]));
        S.stock[k] = Math.round((S.stock[k] - n) * 10) / 10; if (S.stock[k] <= 1e-6) delete S.stock[k];
        r.ratLoot[k] = (r.ratLoot[k] || 0) + n;
      }
      flee(r);
    }
    return;
  }
  if (a.state === 'sneak') {
    if (guard) { r.ai = { state: 'wander', t: 0 }; return; }
    if (!r.path.length) {
      if (w.room(r.tx, r.ty) !== 'S') { r.ai = { state: 'wander', t: 0 }; return; }
      r.ai = { state: 'nibble' };
      r.startWork(LK.rint(R.nibble[0], R.nibble[1]), '', null, 'idle');
    }
    return;
  }
  // ---- gnawing the (empty) altar
  if (a.state === 'gnaw') {
    const o = a.altar;
    if (!o || !w.objects.includes(o) || o.stocked) { r.work = null; r.ai = { state: 'wander', t: 0 }; return; }
    if (r.path.length) return;
    if (!a.started) { a.started = true; r.faceTo(o.x + 0.5, o.y + 0.5); r.startWork(R.gnawTime, '', null, 'idle'); return; }
    if (!r.work) {
      LK.fx.push({ type: 'hit', x: o.x + 0.5, y: o.y + 0.5, t: 0.6, text: '-' + R.gnawDmg });
      if (!S.gnawWarned) { S.gnawWarned = true; LK.log(LK.t('log.altarGnawed'), 'warn'); }
      LK.damageObject(o, R.gnawDmg);
      r.ai = { state: 'wander', t: 2 };
    }
    return;
  }
  // ---- wandering
  if (r.path.length) return;
  a.t = (a.t || 0) - dt;
  if (a.t > 0) return;
  a.t = 1 + Math.random() * 3;                        // sniffing around between walks
  r.speedMul = R.wanderSpeed;
  const store = w.roomTiles('S'), hasFood = Object.entries(S.stock).some(([k, n]) => n >= 1 && LK.INGREDIENTS[k] && LK.INGREDIENTS[k].kind === 'food');
  const near = store.length && store.some(([x, y]) => LK.dist(x, y, r.tx, r.ty) < R.smellRange);
  if (!guard && near && hasFood && Math.random() < 0.6) {
    const free = store.filter(([x, y]) => w.walkable(x, y));
    const t = free.length && LK.pick(free);
    if (t && r.goTo(t[0], t[1])) { r.speedMul = R.sneakSpeed; r.ai = { state: 'sneak' }; return; }
  }
  // an altar nobody stocked: the rats gnaw it
  if (!guard) {
    const alt = w.objsWithTag('ratAltar', true).find(o => !o.stocked && LK.dist(o.x, o.y, r.tx, r.ty) < 10);
    if (alt && Math.random() < R.gnawChance && r.goAdjacent(alt.x, alt.y)) { r.ai = { state: 'gnaw', altar: alt }; return; }
  }
  // a random walk; without a storage nearby he drifts towards it
  const target = store.length && !guard && Math.random() < 0.5 ? LK.pick(store) : null;
  for (let i = 0; i < 8; i++) {
    const d = LK.rint(R.wander[0], R.wander[1]), ang = Math.random() * Math.PI * 2;
    let x = Math.round(r.tx + Math.cos(ang) * d), y = Math.round(r.ty + Math.sin(ang) * d);
    if (target) { x = Math.round((x + target[0]) / 2); y = Math.round((y + target[1]) / 2); }
    if (w.inb(x, y) && w.walkable(x, y) && r.goTo(x, y)) return;
  }
};
// the guardian rat: one epic swing of the baseball bat (a little scene on real time, like the thrown cup),
// then the alarm and the rat is gone. Both freeze while it plays (c.frozen, see chars.js).
LK.WHACK = { windup: 1.1, swing: 0.28, hold: 0.9 };
LK.whacks = [];
function ratWhack(r, thief) {
  if (r.whack) return;
  r.path = []; thief.path = []; thief.work = null;
  r.frozen = true; thief.frozen = true;
  r.faceTo(thief.x, thief.y); thief.faceTo(r.x, r.y);
  r.ai = { state: 'whack' };
  r.whack = { t: 0, phase: 'windup', thief };
  r.say(LK.t('say.ratRush'), 1.6);
  thief.say(LK.t('say.thiefWhat'), 1.6);
  LK.fx.push({ type: 'crash', x: thief.x, y: thief.y, t: 1.0, text: '!', small: true });
  LK.whacks.push(r);
}
LK.whackStart = (r, thief) => ratWhack(r, thief);    // dev / screenshots
function whackImpact(r, thief) {
  const dmg = thief.maxHp * LK.RAT.batHit;
  if (!(thief.ko > 0)) { thief.hp -= dmg; thief.hurtT = 0.6; }
  thief.pose = 'hurt';
  LK.fx.push({ type: 'crash', x: thief.x, y: thief.y, t: 1.8, dur: 1.8, text: LK.t('label.bonk'), lift: 135 });   // above his head
  LK.fx.push({ type: 'ring', x: thief.x, y: thief.y, t: 0.45, dur: 0.45, h: 60 });
  LK.fx.push({ type: 'hit', x: thief.x, y: thief.y - 0.3, t: 1.4, text: '-' + Math.round(dmg), big: true });
  LK.fx.push({ type: 'dizzy', x: thief.x, y: thief.y, t: 2.6, follow: thief });
  if (LK.fxBurst) { LK.fxBurst(thief.x, thief.y, 70, 16, 'star'); LK.fxBurst(thief.x, thief.y, 50, 10, 'shard'); }
  LK.shake = Math.max(LK.shake || 0, 0.8);
  LK.log(LK.t('log.ratBat', { thief: thief.name }), 'good');
}
// called every frame with real seconds from LK.updateEffects (fx.js)
LK.updateWhacks = function (dt) {
  if (!LK.whacks.length) return;
  const W = LK.WHACK;
  for (const r of LK.whacks) {
    const k = r.whack, th = k.thief;
    k.t += dt;
    if (k.phase === 'windup' && k.t >= W.windup) { k.phase = 'swing'; k.t = 0; }
    else if (k.phase === 'swing' && k.t >= W.swing) { k.phase = 'hold'; k.t = 0; whackImpact(r, th); }
    else if (k.phase === 'hold' && k.t >= W.hold) {
      k.done = true;
      r.frozen = false; th.frozen = false; th.pose = null; r.whack = null;
      if (th.hp <= 0 && !(th.ko > 0)) LK.knockOut(th, r);
      LK.thiefSpotted(th, r);                          // the alarm
      flee(r);
    }
  }
  LK.whacks = LK.whacks.filter(r => r.whack && !r.whack.done);
};
// bat angle / rat size for the drawing
LK.whackPose = function (r) {
  const k = r.whack, W = LK.WHACK;
  if (!k) return null;
  // angles: 0 = pointing forward (at the thief), -PI/2 = straight up, < -PI/2 = back over the shoulder
  if (k.phase === 'windup') { const p = Math.min(1, k.t / W.windup), e = 1 - Math.pow(1 - p, 3); return { ang: -0.9 - 1.5 * e + Math.sin(k.t * 45) * 0.07 * p, grow: 1 + 0.6 * e, trail: false }; }
  if (k.phase === 'swing') { const p = Math.min(1, k.t / W.swing); return { ang: -2.4 + 3.0 * p * p, grow: 1.6 - 0.15 * p, trail: true }; }
  return { ang: -2.0, grow: 1.45 - Math.min(0.45, k.t * 0.6), trail: false };   // bat on the shoulder
};

// rats come now and then; with a stocked altar there is always one around
LK.ratSpawner = function (dt) {
  const S = LK.state;
  const rats = S.chars.filter(c => c.kind === 'rat').length;
  if (S.nextRat == null) S.nextRat = S.simT + LK.rint(LK.RAT.spawnEvery[0], LK.RAT.spawnEvery[1]);
  if (rats >= LK.RAT.max) return;
  if (S.simT >= S.nextRat || (LK.altarActive() && !LK.protectorRat())) {
    LK.spawnRat();
    S.nextRat = S.simT + LK.rint(LK.RAT.spawnEvery[0], LK.RAT.spawnEvery[1]);
  }
};

// guests who see the altar don't like it (each guest once)
LK.altarWatch = function () {
  const S = LK.state, w = S.world, altars = LK.ratAltars();
  if (!altars.length) return;
  for (const c of S.chars) {
    if (c.kind !== 'client' || c.sawAltar || !c.active || c.inTent) continue;
    const o = altars.find(o => LK.dist(o.x + 0.5, o.y + 0.5, c.x, c.y) <= LK.RAT.seeRange && (w.room(o.x, o.y) === w.room(c.tx, c.ty) || rcheb(o.x, o.y, c.tx, c.ty) <= 1));
    if (!o) continue;
    c.sawAltar = true;
    c.mood -= LK.RAT.seenMood;
    S.rep = LK.clamp(S.rep - LK.RAT.seenRep, 0, 100);
    c.say(LK.t('say.sawAltar'), 2.5);
    LK.log(LK.t('log.sawAltar', { name: c.name, rep: LK.RAT.seenRep }), 'bad');
  }
};
// the owner puts a bottle of orzechówka on the altar (E next to it); returns true if E was used for that
LK.stockAltar = function (p, target) {      // target: a given altar (item menu), else the one next to p
  const S = LK.state, o = target || LK.ratAltars().find(o => rcheb(o.x, o.y, p.tx, p.ty) <= 1);
  if (!o) return false;
  if (o.stocked) { p.say(LK.t('say.altarFull'), 1.5); return true; }
  if ((S.stock.orzechowka || 0) < 1) { p.say(LK.t('say.altarNoBottle'), 2); LK.log(LK.t('log.altarNoBottle'), 'warn'); return true; }
  S.stock.orzechowka = Math.round((S.stock.orzechowka - 1) * 10) / 10; if (S.stock.orzechowka <= 1e-6) delete S.stock.orzechowka;
  o.stocked = true;
  p.say(LK.t('say.altarStocked'), 2);
  LK.log(LK.t('log.altarStocked'), 'good');
  return true;
};
// every morning the rat has drunk it
LK.ratNewDay = function () {
  const alts = LK.ratAltars();
  if (!alts.length) return;
  const was = alts.some(o => o.stocked);
  for (const o of alts) o.stocked = false;
  LK.log(LK.t(was ? 'log.altarEmptied' : 'log.altarEmpty'), 'warn');
};

// ---------------- drawing (no rat graphics in the packs: drawn here) ----------------
// sx,sy = feet on screen; opt.idol = the golden statue on the altar
LK.drawRat = function (ctx, c, sx, sy, z, opt) {
  opt = opt || {};
  const pose = c && LK.whackPose(c);
  const s = z * (opt.scale || 1) * (pose ? pose.grow : 1), t = c ? c.animT || 0 : 0, moving = c && (c.path.length > 0);
  const fast = c && c.speedMul > 1.5, f = c && c.flip ? -1 : 1;
  const body = opt.idol ? '#c9a14a' : '#6e5d50', dark = opt.idol ? '#8a6a26' : '#4b3e35', pink = opt.idol ? '#e0c070' : '#d89a9a';
  const bob = moving ? Math.sin(t * (fast ? 40 : 18)) * 1.5 * s : 0;
  ctx.save();
  ctx.translate(sx, sy - bob);
  ctx.scale(f, 1);
  // tail
  ctx.strokeStyle = pink; ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-12 * s, -6 * s);
  const wig = Math.sin(t * (moving ? 14 : 3)) * 4 * s;
  ctx.bezierCurveTo(-22 * s, -4 * s + wig, -26 * s, -12 * s - wig, -32 * s, -8 * s + wig);
  ctx.stroke();
  // legs
  ctx.strokeStyle = dark; ctx.lineWidth = 2.2 * s;
  const step = moving ? Math.sin(t * (fast ? 40 : 18)) * 3 * s : 0;
  for (const [lx, ph] of [[-7, 1], [6, -1]]) { ctx.beginPath(); ctx.moveTo(lx * s, -4 * s); ctx.lineTo(lx * s + step * ph, 0); ctx.stroke(); }
  // body + head
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(-2 * s, -8 * s, 13 * s, 7.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(11 * s, -10 * s, 7 * s, 5.5 * s, -0.25, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(15 * s, -12 * s); ctx.lineTo(22 * s, -8 * s); ctx.lineTo(15 * s, -7 * s); ctx.fill();   // snout
  ctx.fillStyle = pink;
  ctx.beginPath(); ctx.arc(22 * s, -8.5 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();                                       // nose
  ctx.beginPath(); ctx.ellipse(8 * s, -16 * s, 3.2 * s, 4 * s, -0.3, 0, Math.PI * 2); ctx.fill();                       // ear
  ctx.fillStyle = opt.idol ? '#5a3a00' : '#111';
  ctx.beginPath(); ctx.arc(14 * s, -11.5 * s, 1.3 * s, 0, Math.PI * 2); ctx.fill();                                     // eye
  // the baseball bat (with a motion trail during the swing)
  if (pose || (c && c.batT > 0)) {
    const ang = pose ? pose.ang : -2.2 + (1 - c.batT / 0.6) * 2.6;
    const bat = (a, alpha) => {
      ctx.save(); ctx.translate(10 * s, -12 * s); ctx.rotate(a); ctx.globalAlpha = alpha;
      ctx.fillStyle = '#9a6a3a'; ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -1.6 * s); ctx.lineTo(30 * s, -4 * s); ctx.lineTo(31 * s, 0); ctx.lineTo(30 * s, 4 * s); ctx.lineTo(0, 1.6 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    if (pose && pose.trail) for (let i = 4; i >= 1; i--) bat(ang - i * 0.32, 0.12 * (5 - i));
    bat(ang, 1);
  }
  ctx.restore();
};
// the altar's decoration on top of its stone: the golden rat idol and, when stocked, a bottle
LK.drawAltarDecor = function (ctx, o, sx, sy, z) {
  LK.drawRat(ctx, null, sx - 4 * z, sy - 34 * z, z, { idol: true, scale: 0.9 });
  if (o.stocked) {
    ctx.fillStyle = '#7a4a1a'; ctx.strokeStyle = '#2a1a08'; ctx.lineWidth = 1;
    ctx.fillRect(sx + 14 * z, sy - 52 * z, 6 * z, 14 * z); ctx.strokeRect(sx + 14 * z, sy - 52 * z, 6 * z, 14 * z);
    ctx.fillRect(sx + 15.5 * z, sy - 57 * z, 3 * z, 5 * z);
    ctx.fillStyle = 'rgba(255,200,90,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 40 * z, 26 * z, 16 * z, 0, 0, Math.PI * 2); ctx.fill();   // a faint glow
  }
};
