// La Kurwa - game state, main loop, input and player interaction
'use strict';

LK.mapId = 'default';
LK.newGame = function (mapDef) {
  const def = JSON.parse(JSON.stringify(mapDef || LK.MAPS[LK.mapId] || LK.MAPS['default'] || LK.MAPS[Object.keys(LK.MAPS)[0]]));
  const world = new LK.World(def);
  const S = LK.state = {
    world, chars: [], orders: [], projectiles: [],
    money: LK.START_MONEY, rep: 50,
    stock: Object.fromEntries(Object.entries(LK.START_STOCK).filter(([k]) => LK.INGREDIENTS[k])), goods: Object.assign({}, LK.START_GOODS), furn: {},
    // starting recipes/stock only keep ingredients that exist in the (possibly edited) item data
    recipes: LK.START_RECIPES.map(r => Object.assign({ enabled: true }, JSON.parse(JSON.stringify(r)), { name: LK.tn('recipe', r.id, r.name) }))
      .map(r => { for (const k in r.parts) if (!LK.INGREDIENTS[k]) delete r.parts[k]; return r; }).filter(r => Object.keys(r.parts).length),
    time: 8 * 60, day: 1, simT: 0, speed: 1, brokeDays: 0, history: [],
    today: { income: 0, expense: 0, served: 0, clients: 0, fights: 0 },
    merchant: null, nextMerchant: 10 * 60, ring: null, applicants: [], over: false,
    order: { warnings: 0, paidStreak: 0, nextDay: LK.RENT.everyDays, squad: null },
    arrests: [], alarmT: 0
  };
  const ps = def.playerStart || { x: 1, y: def.route[0] };
  const p = new LK.Char('player', { name: LK.t('name.owner'), sheet: 'maleAdventurer', hue: 0, x: ps.x, y: ps.y, str: 6, sta: 6, int: 6,
    skills: { bartending: 15, cooking: 10, tinkering: 10, electric: 5, fighting: 15, vendor: 10 } });
  p.cargo = LK.emptyCargo();
  S.chars.push(p); S.player = p;
  LK.refreshApplicants();
  LK.centerOn(p.x, p.y);
  LK.fx.length = 0;
  if (LK.ui) { LK.ui.selected = null; LK.ui.setSpeed(1); }
  const ov = document.getElementById('over'); if (ov) ov.classList.add('hidden');
  return S;
};

LK.joinCoop = function () {
  const S = LK.state;
  if (S.player2) return LK.log(LK.t('log.coopAlready'), 'warn');
  const p = S.player;
  const q = new LK.Char('player', { name: LK.t('name.coowner'), sheet: 'femaleAdventurer', female: true, hue: 0, x: p.tx, y: p.ty, str: 5, sta: 7, int: 6,
    skills: { bartending: 10, cooking: 15, tinkering: 15, electric: 10, fighting: 10, vendor: 15 } });
  q.p2 = true; q.cargo = LK.emptyCargo();
  S.chars.push(q); S.player2 = q;
  LK.log(LK.t('log.coopJoined'), 'good');
};

// hooks used by chars.js
LK.onKO = function (c) {
  const S = LK.state;
  if (c.kind === 'client') { LK.releaseSeat(c); if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); } }
  if (c === S.merchant) { S.merchantLeaveAt = S.time; }
  if (LK.thiefKO) LK.thiefKO(c);
};
LK.onWake = function (c) {
  c.rescued = false;
  if (c.kind === 'client') { c.mood = Math.min(c.mood, 15); c.fightStart = null; if (LK.knownThief(c)) c.running = true; LK.clientLeave(c); }
};

// ---------------- player interaction (E / U) ----------------
LK.interact = function (p) {
  const S = LK.state, w = S.world;
  if (!p.active) return;
  if (p.dragging) { LK.dropDrag(p); p.say(LK.t('say.drop')); return; }
  if (p.job) { p.job = null; p.work = null; }
  // the crazy prophet (a hint) or the merchant (the shop): whoever is closer
  const pr = S.chars.find(c => c.kind === 'prophet' && c.active && LK.dist(c.x, c.y, p.x, p.y) < 2.2);
  const mer = S.merchant && S.merchant.state === 'wait' && LK.dist(p.x, p.y, S.merchant.x, S.merchant.y) < 2.5 ? S.merchant : null;
  if (pr && (!mer || LK.dist(pr.x, pr.y, p.x, p.y) <= LK.dist(mer.x, mer.y, p.x, p.y))) { pr.faceTo(p.x, p.y); LK.prophetSay(pr, true); return; }
  if (mer) { LK.ui.openShop(p); return; }
  // deliver what we carry
  if (p.carry) {
    const o = p.carry;
    if (LK.canReach(p, o.client)) { LK.deliverOrder(o, p); return; }
    p.job = LK.newJob('deliver', { order: o, phase: 'carry' });
    return;
  }
  // a knocked-out thief: call the Order of the Holy Flame to take him away (reward)
  const thief = S.chars.find(c => LK.canCallOrder(c) && LK.dist(c.x, c.y, p.x, p.y) < 1.8);
  if (thief) { LK.callArrest(thief, p); return; }
  // drag an unconscious person
  const ko = S.chars.find(c => c !== p && c.ko > 0 && !c.dragBy && LK.dist(c.x, c.y, p.x, p.y) < 1.6);
  if (ko) { LK.startDrag(p, ko); p.say(LK.t('say.dragKo', { name: ko.name.split(' ')[0] })); return; }
  // a guest next to us is waiting to order: take it right here
  const guest = S.orders.filter(o => o.state === 'placed' && !o.worker && o.client.active && LK.dist(o.client.x, o.client.y, p.x, p.y) < 1.8)
    .sort((a, b) => LK.dist(a.client.x, a.client.y, p.x, p.y) - LK.dist(b.client.x, b.client.y, p.x, p.y))[0];
  if (guest) { guest.worker = p; p.job = LK.newJob('serve', { order: guest, phase: 'takeHere' }); return; }
  // the rat altar: put a bottle of orzechówka on it
  if (LK.stockAltar(p)) return;
  const near = tag => w.objsWithTag(tag, true).filter(o => LK.isBeside(p, o) || Math.max(Math.abs(o.x - p.tx), Math.abs(o.y - p.ty)) <= 1)[0];
  const counter = near('counter');
  if (counter) {
    // 1. mix a drink that was already taken (own tray first, oldest first)
    const mix = S.orders.filter(o => o.state === 'bar' && !o.worker && o.client.active).sort((a, b) => (b.takenBy === p) - (a.takenBy === p) || a.id - b.id)[0];
    if (mix) { mix.worker = p; p.job = LK.newJob('serve', { order: mix, counter, phase: 'taken', skipTake: true }); return; }
    // 2. take the order of a guest sitting at the counter
    const o = S.orders.filter(o => o.state === 'placed' && !o.worker && LK.canReach(p, o.client)).sort((a, b) => a.id - b.id)[0];
    if (o) { o.worker = p; p.job = LK.newJob('serve', { order: o, phase: 'takeHere' }); return; }
  }
  const stove = near('cook');
  if (stove) {
    const o = S.orders.find(o => o.state === 'kitchen' && !o.worker);
    if (o) { o.worker = p; o.state = 'cooking-wait'; p.job = LK.newJob('cook', { order: o, stove }); return; }
  }
  // build / repair / clean something next to us
  for (const o of w.objects) {
    if (Math.max(Math.abs(o.x - p.tx), Math.abs(o.y - p.ty)) > 1) continue;
    if (!o.built || o.hp < 100 || o.dirty) { p.job = LK.newJob('fix', { target: o }); return; }
  }
  const dec = w.decals.find(d => Math.max(Math.abs(d.x - p.tx), Math.abs(d.y - p.ty)) <= 1);
  if (dec) { p.job = LK.newJob('fix', { target: dec, decal: true }); return; }
  if (counter) p.say(LK.t('say.noOrders'));
  else if (stove) p.say(LK.t('say.nothingToCook'));
  else p.say(LK.t('say.nothingHere'), 1.2);
};
LK.playerAttack = function (p) {
  const S = LK.state;
  if (!p.active) return;
  const cands = S.chars.filter(c => c !== p && c.active && c.kind !== 'player' && LK.dist(c.x, c.y, p.x, p.y) < 1.6 && LK.canHit(p, c));
  if (!cands.length) { p.atkAnim = 'attack0'; p.animLock = 0.3; return; }
  cands.sort((a, b) => (b.hostile ? 1 : 0) - (a.hostile ? 1 : 0) || LK.dist(a.x, a.y, p.x, p.y) - LK.dist(b.x, b.y, p.x, p.y));
  const t = cands[0];
  if (t.kind === 'employee' && !t.hostile) return p.say(LK.t('say.notMyStaff'));
  p.attack(t);
};

// character whose sprite is under screen point (sx,sy); the front-most one wins
LK.charAt = function (sx, sy) {
  const z = LK.cam.z;
  let best = null, bd = -Infinity;
  for (const c of LK.state.chars) {
    if (c.kind === 'gone' || c.inTent) continue;
    const [cx, cy] = LK.toScreen(c.x, c.y);
    const down = c.ko > 0 || c.dragBy;
    const hit = down ? Math.abs(sx - cx) < 45 * z && sy > cy - 30 * z && sy < cy + 8 * z
                     : Math.abs(sx - cx) < 26 * z && sy > cy - 88 * z && sy < cy + 8 * z;
    if (hit && c.x + c.y > bd) { bd = c.x + c.y; best = c; }
  }
  return best;
};
LK.devMode = false;
LK.setDevMode = function (on) {
  LK.devMode = on;
  const el = document.getElementById('devBadge');
  if (el) el.classList.toggle('hidden', !on);
  LK.log(LK.t(on ? 'log.devOn' : 'log.devOff'), 'warn');
};

// ---------------- input ----------------
LK.input = {
  keys: {}, hover: null, drag: null, pan: null,
  init(cv) {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (LK.splashOpen) { if (e.key === 'Escape') LK.splashPage(null); return; }   // the main menu ignores game keys
      if (LK.intro) { if (e.key === 'Escape') LK.introStop(false); e.preventDefault(); return; }   // the introduction plays by itself
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.key === 'Shift') this.keys.shift = true;
      const S = LK.state;
      if (k === 'e') LK.interact(S.player);
      else if (k === 'f') LK.playerAttack(S.player);
      else if (k === 'u' && S.player2) LK.interact(S.player2);
      else if (k === 'o' && S.player2) LK.playerAttack(S.player2);
      else if (k === 'm') LK.ui.toggle('menu');
      else if (k === 'h') LK.ui.toggle('staff');
      else if (k === 'i' && !S.player2) LK.ui.toggle('storage');
      else if (k === 'b') LK.ui.toggleBuild();
      else if (k === 'r' && LK.ui.buildMode) LK.ui.build.rot = (LK.ui.build.rot + 1) % 4;
      else if (k === 'v') LK.ui.cutaway = !LK.ui.cutaway;
      else if (k === 'c') LK.follow = true;
      else if (k === ' ') { LK.ui.setSpeed(S.speed ? 0 : 1); e.preventDefault(); }
      else if (k === '1' || k === '2' || k === '3') LK.ui.setSpeed({ 1: 1, 2: 2, 3: 4 }[k]);
      else if (e.key === 'F2') { LK.setDevMode(!LK.devMode); e.preventDefault(); }
      else if (k === 't' && LK.devMode) LK.dev.throwCup(LK.input.mouse ? LK.charAt(LK.input.mouse[0], LK.input.mouse[1]) || LK.ui.selected : LK.ui.selected);
      else if (k === 'g' && LK.devMode) LK.dev.callOrder();
      else if (k === 'n' && LK.devMode) LK.dev.callMerchant();
      else if (k === 'r' && LK.devMode) LK.dev.callThief(e.shiftKey);   // Shift+R: heist thief
      else if (k === 'y' && LK.devMode) LK.dev.callRat(e.shiftKey);   // Shift+Y: protector rat
      else if ((k === '+' || k === '=') && LK.devMode) LK.dev.money(1000);
      else if (k === 'p' && LK.devMode) LK.dev.piss(e.shiftKey);   // Shift+P: on a rental tent
      else if (k === 'x' && LK.devMode) LK.dev.callProphet();
      else if (e.key === 'F1') { LK.ui.toggle('help'); e.preventDefault(); }
      else if (k === 'escape') {
        // Esc closes what is open; with nothing open it opens the game menu
        if (LK.ui.pickPost) LK.ui.endPickPost();
        else if (!LK.ui.panel && !LK.ui.buildMode && !LK.ui.selected) LK.ui.toggle('game');
        else { LK.ui.close(); if (LK.ui.buildMode) LK.ui.toggleBuild(); LK.ui.selected = null; }
      }
      if (k.startsWith('arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; if (e.key === 'Shift') this.keys.shift = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousemove', e => {
      this.mouse = [e.clientX, e.clientY];
      const [fx, fy] = LK.toTile(e.clientX, e.clientY);
      this.hover = [Math.floor(fx), Math.floor(fy)];
      if (this.pan) { LK.cam.x -= e.clientX - this.pan[0]; LK.cam.y -= e.clientY - this.pan[1]; this.pan = [e.clientX, e.clientY]; LK.follow = false; }
      if (this.drag && LK.ui.buildMode && (LK.ui.build.tool === 'room' || LK.ui.build.tool === 'erase')) LK.ui.buildClick(this.hover[0], this.hover[1], fx, fy, true);
    });
    cv.addEventListener('mousedown', e => {
      if (LK.intro) return;
      const [fx, fy] = LK.toTile(e.clientX, e.clientY);
      const x = Math.floor(fx), y = Math.floor(fy), S = LK.state;
      if (e.button === 1) { this.pan = [e.clientX, e.clientY]; e.preventDefault(); return; }
      if (e.button === 2) { if (LK.ui.pickPost) { LK.ui.endPickPost(); return; } this.rightClick(x, y, fx, fy); return; }
      if (LK.ui.pickPost) { LK.ui.setPost(x, y); return; }           // choosing a security post
      if (LK.ui.buildMode) { this.drag = true; LK.ui.buildClick(x, y, fx, fy, false); return; }
      // select the character under the mouse
      LK.ui.selected = LK.charAt(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => { this.drag = false; this.pan = null; });
    cv.addEventListener('wheel', e => {
      const before = LK.toTile(e.clientX, e.clientY);
      LK.cam.z = LK.clamp(LK.cam.z * (e.deltaY < 0 ? 1.1 : 0.9), 0.35, 1.8);
      // keep the point under the cursor fixed
      const z = LK.cam.z;
      LK.cam.x = (before[0] - before[1]) * LK.TW / 2 * z - (e.clientX - LK.view.w / 2);
      LK.cam.y = (before[0] + before[1]) * LK.TH / 2 * z - (e.clientY - LK.view.h / 2);
      LK.follow = false;
      e.preventDefault();
    }, { passive: false });
  },
  rightClick(x, y) {
    const S = LK.state, p = S.player, w = S.world;
    if (!p.active || !w.inb(x, y)) return;
    p.job = null; p.work = null;
    if (w.walkable(x, y) ? p.goTo(x, y) : p.goAdjacent(x, y)) LK.follow = true;
    else p.say(LK.t('say.cantGetThere'), 1);
  },
  // keyboard -> grid velocity for a player (screen-relative directions)
  dirFor(up, down, left, right) {
    let sx = (right ? 1 : 0) - (left ? 1 : 0), sy = (down ? 1 : 0) - (up ? 1 : 0);
    if (!sx && !sy) return [0, 0];
    // screen direction -> grid direction (screen x = gx - gy, screen y = (gx + gy) / 2)
    const gx = sx / 2 + sy, gy = sy - sx / 2;
    const l = Math.hypot(gx, gy);
    return [gx / l, gy / l];
  }
};

// ---------------- main menu (splash) ----------------
LK.splashOpen = false;
LK.showSplash = function (inGame) {
  LK.splashOpen = true;
  LK.splashWasSpeed = inGame ? LK.state.speed : 1;
  LK.ui.setSpeed(0); LK.ui.close();
  const $id = id => document.getElementById(id);
  $id('start').classList.remove('hidden');
  document.body.classList.add('menu-open');
  $id('mResume').classList.toggle('hidden', !inGame);
  $id('mContinue').classList.add('hidden'); $id('mLoad').classList.add('hidden');
  LK.listSaves().then(list => {                             // Continue / Load game only when there are saves
    const any = list.some(s => s.meta);
    $id('mContinue').classList.toggle('hidden', !!inGame || !any);
    $id('mLoad').classList.toggle('hidden', !any);
  }).catch(() => {});
  LK.splashPage(null);
};
LK.hideSplash = function () {
  LK.splashOpen = false;
  document.getElementById('start').classList.add('hidden');
  document.body.classList.remove('menu-open');
  LK.ui.setSpeed(LK.splashWasSpeed || 1);
  LK.follow = true;
};
// show a text page (help / about) inside the main menu, or the menu again (html = null)
LK.splashPage = function (html, kind) {
  const $id = id => document.getElementById(id);
  LK.splashPageKind = html ? kind || null : null;
  $id('splashMenu').classList.toggle('hidden', !!html);
  $id('splashPage').classList.toggle('hidden', !html);
  if (html) $id('splashPageBody').innerHTML = html;
};

// ---------------- dev: render benchmark (hash `bench`) ----------------
// waits for the images, renders 200 frames back to back and prints per-phase times into the page
LK.runBench = function () {
  setTimeout(() => {
    const S = LK.state, N = 200, out = {};
    const run = (label, setup) => {
      setup();
      LK.Render.draw(); LK.Render.draw();                   // warm-up (masks, caches)
      LK.perf = {};
      const t0 = performance.now();
      for (let i = 0; i < N; i++) { LK.step(1 / 60); LK.Render.draw(); }
      const total = (performance.now() - t0) / N;
      const ph = Object.entries(LK.perf).map(([k, v]) => k + ' ' + (v / N).toFixed(2)).join(', ');
      out[label] = total.toFixed(2) + ' ms/frame  (' + ph + ')  chars ' + S.chars.length;
      LK.perf = null;
    };
    const W = LK.Render.cv.width + 'x' + LK.Render.cv.height;
    run('day  z0.8 ' + W, () => { S.time = 12 * 60; LK.cam.z = 0.8; });
    run('night z0.8', () => { S.time = 23 * 60; });
    run('night z0.4 (whole map)', () => { LK.cam.z = 0.4; const w = S.world; LK.centerOn(w.W / 2, w.H / 2); LK.follow = false; });
    run('day  z1.4', () => { S.time = 12 * 60; LK.cam.z = 1.4; });
    const pre = document.createElement('pre'); pre.id = 'bench';
    pre.style.cssText = 'position:fixed;left:0;top:0;z-index:999;background:#000;color:#0f0;font:12px monospace;padding:8px;margin:0';
    pre.textContent = Object.entries(out).map(([k, v]) => k + ': ' + v).join('\n');
    document.body.appendChild(pre);
    LK.ui.setSpeed(0);
  }, 2500);
};

// ---------------- main loop ----------------
LK.follow = true;
LK.step = function (dt) {
  const S = LK.state;
  if (S.over) return;
  const k = LK.input.keys;
  // player 1 keyboard movement
  const p = S.player;
  const [vx, vy] = LK.input.dirFor(k.w, k.s, k.a, k.d);
  p.vx = vx; p.vy = vy; p.running = !!k.shift;
  if (vx || vy) { p.path = []; if (p.job && p.job.type !== 'deliver') { p.job = null; } p.work = null; LK.follow = true; }
  if (S.player2) {
    const q = S.player2;
    const [ux, uy] = LK.input.dirFor(k.i, k.k, k.j, k.l);
    q.vx = ux; q.vy = uy; q.running = !!k['/'];
    if (ux || uy) { q.path = []; if (q.job && q.job.type !== 'deliver') q.job = null; q.work = null; }
  }
  // camera pan with arrows
  const pan = 600 * dt / Math.max(1, S.speed);
  if (k.arrowleft) { LK.cam.x -= pan; LK.follow = false; }
  if (k.arrowright) { LK.cam.x += pan; LK.follow = false; }
  if (k.arrowup) { LK.cam.y -= pan; LK.follow = false; }
  if (k.arrowdown) { LK.cam.y += pan; LK.follow = false; }

  if (S.speed === 0) return;
  const sdt = dt * S.speed;
  S.simT += sdt;
  const prevDay = Math.floor((S.time - 360) / 1440);
  S.time += sdt * 2;                       // 1 real second = 2 game minutes (a day = 12 minutes)
  if (Math.floor((S.time - 360) / 1440) > prevDay) LK.newDay();   // new day starts at 06:00

  // sub-steps for stability at high speed
  const n = Math.ceil(sdt / 0.05), h = sdt / n;
  for (let i = 0; i < n; i++) {
    LK.spawner(h);
    LK.merchantAI(h);
    LK.ratSpawner(h);
    LK.prophetUpdate(h);
    LK.orderUpdate(h);
    for (const c of S.chars) {
      if (c.kind === 'client') LK.clientAI(c, h);
      else if (c.kind === 'employee') LK.employeeAI(c, h);
      else if (c.kind === 'rat') LK.ratAI(c, h);
      else if (c.kind === 'prophet') LK.prophetAI(c, h);
      else if (c.kind === 'player') { if (c.job) LK.runJob(c); if (c.cargo && c.load > 0 && S.world.room(c.tx, c.ty) === 'S') LK.unloadCargo(c); }
      c.update(h);
    }
    LK.fightDirector(h);
    LK.thiefUpdate(h);
    LK.tentUpdate();
    LK.altarWatch();
  }
  // visual effects (thrown cups, particles, popups) run on real time
  LK.updateEffects(dt);
  LK.checkLowStock();                      // low food / drinks toast
  if (LK.intro) LK.introUpdate(sdt);       // introduction mode (intro.js)
  for (const f of LK.fx) f.t -= dt;
  if (LK.fx.some(f => f.t <= 0)) LK.fx = LK.fx.filter(f => f.t > 0);
  // remove characters that left the map
  for (const c of S.chars) if (c.kind === 'gone') { LK.releaseSeat(c); if (c.dragging) LK.dropDrag(c); }
  if (S.chars.some(c => c.kind === 'gone')) S.chars = S.chars.filter(c => c.kind !== 'gone');   // only rebuild when needed
  // keep the player alive-ish: knocked-out player wakes like everyone else
};

LK.loop = function (t) {
  const dt = Math.min(0.1, (t - (LK.lastT || t)) / 1000);
  LK.lastT = t;
  LK.step(dt);
  if (LK.splashOpen) {
    // behind the main menu the camera drifts slowly over the map
    LK.splashT = (LK.splashT || 0) + dt;
    const w = LK.state.world, a = LK.splashT * 0.03;
    LK.centerOn(w.W / 2 + Math.cos(a) * w.W * 0.3, w.H / 2 + Math.sin(a * 1.3) * w.H * 0.3);
  } else if (LK.follow) {
    const p = LK.state.player, z = LK.cam.z;
    const tx = (p.x - p.y) * LK.TW / 2 * z, ty = (p.x + p.y) * LK.TH / 2 * z;
    LK.cam.x += (tx - LK.cam.x) * Math.min(1, dt * 6); LK.cam.y += (ty - LK.cam.y) * Math.min(1, dt * 6);
  }
  LK.Render.draw();
  LK.ui.updateHUD(dt);
  requestAnimationFrame(LK.loop);
};

// start-up: runs only after the storage notice was accepted (consent.js)
LK.boot = function () {
  const modded = LK.applyMods();
  LK.finalizeData();
  // map choice on the start screen
  const sel = document.getElementById('startMap');
  const ids = Object.keys(LK.MAPS);
  sel.innerHTML = ids.map(id => '<option value="' + id + '">' + (LK.MAPS[id].name || id) + (id === 'default' ? '' : ' (' + id + ')') + '</option>').join('');
  const want = /map=([\w-]+)/.exec(location.hash);
  if (want && LK.MAPS[want[1]]) LK.mapId = want[1];
  sel.value = LK.mapId;
  sel.onchange = () => { LK.mapId = sel.value; LK.newGame(); LK.ui.setSpeed(0); };
  document.getElementById('startMapRow').classList.toggle('hidden', ids.length < 2);
  const cv = document.getElementById('game');
  LK.Render.init(cv);
  LK.ui.init();
  LK.input.init(cv);
  // ---- main menu (splash) ----
  const $id = id => document.getElementById(id);
  $id('mNew').onclick = () => { LK.newGame(); LK.hideSplash(); LK.log(LK.t('log.welcome'), 'good'); };
  $id('mContinue').onclick = async () => { const s = await LK.latestSave(); if (s && await LK.loadFrom(s.key)) LK.hideSplash(); };   // the newest save
  $id('mLoad').onclick = () => { LK.splashPage('<div id="splashSlots"></div>', 'load'); LK.ui.renderSlots($id('splashSlots'), 'load', () => LK.hideSplash()); };
  $id('mResume').onclick = () => LK.hideSplash();
  $id('mIntro').onclick = () => LK.introStart();
  $id('mHelp').onclick = () => LK.splashPage(LK.ui.helpHTML(), 'help');
  $id('mAbout').onclick = () => LK.splashPage(LK.ui.aboutHTML(), 'about');
  const langSel = $id('langSel');
  langSel.innerHTML = LK.languages().map(l => '<option value="' + l.code + '">' + l.name + '</option>').join('');
  langSel.value = LK.lang;
  langSel.onchange = () => LK.setLang(langSel.value, true);
  $id('langRow').classList.toggle('hidden', LK.languages().length < 2);
  if ($id('mEditor')) $id('mEditor').onclick = () => { location.href = 'editor.html'; };   // not in builds without the editor
  $id('splashBack').onclick = () => LK.splashPage(null);
  LK.newGame();
  LK.showSplash(false);                    // main menu over a paused, slowly drifting map
  if (modded) LK.log(LK.t('log.testData'), 'warn');
  // dev helper: index.html#autostart skips the start screen, #demo also hires staff and fast-forwards
  if (/autostart|demo/.test(location.hash)) {
    LK.hideSplash();
    if (/demo/.test(location.hash)) {
      const S = LK.state;
      for (let i = 0; i < 3; i++) LK.hire(S.applicants[0]);
      S.chars.filter(c => c.kind === 'employee').forEach((c, i) => c.task = ['bartender', 'cook', 'security'][i]);
      S.goods.ringpoles = 1; S.furn.lamp = 2; S.furn.aidkit = 1;
      const m = /demo(\d+)/.exec(location.hash);
      for (let i = 0; i < (m ? +m[1] : 600); i++) LK.step(0.1);
    }
  }
  const at = /at=([\d.]+),([\d.]+)/.exec(location.hash);   // dev: place player 1 on a tile (or exact position with decimals)
  if (at) { const q = v => v.includes('.') ? +v : +v + 0.5; LK.state.player.x = q(at[1]); LK.state.player.y = q(at[2]); LK.centerOn(LK.state.player.x, LK.state.player.y); }
  if (/tray/.test(location.hash)) {   // dev: pretend the owner took all waiting orders
    for (const o of LK.state.orders.filter(o => o.state === 'placed')) { o.byPlayer = true; o.takenBy = LK.state.player; o.state = o.kind === 'dish' ? 'kitchen' : 'bar'; }
  }
  const cs = /cupshot=([\d.]+)/.exec(location.hash);   // dev: freeze a thrown cup at progress K (>1 = seconds after impact + 1)
  if (cs) {
    const S = LK.state, K = +cs[1];
    const c = new LK.Char('client', { x: 12, y: 12 }); Object.assign(c, { prefs: LK.makePrefs(), mood: 10, budget: 1, patience: 99, rounds: 1, exitX: 0, exitY: S.world.route[0] });
    S.chars.push(c);
    c.ai = { state: 'throw', t: 0, target: S.world.objAt(15, 8) || S.world.objsWithTag('counter', true)[0] };
    if (/weak/.test(location.hash)) c.ai.target.hp = 10;     // dev: this hit destroys it
    LK.clientAI(c, 0);
    c.say(LK.t('say.throwCup'), 3);
    LK.centerOn(13.5, 10); LK.follow = false;
    for (let i = 0; i < 600; i++) {
      LK.step(1 / 60);
      const p = S.projectiles[0];
      if (K <= 1 && p && p.t / p.dur >= K) break;
      if (K > 1 && LK.impacts && (LK.cupHitT = (LK.cupHitT || 0) + 1 / 60) >= K - 1) break;
    }
    LK.ui.setSpeed(0);
  }
  if (/(^|[#,])dev([,]|$)/.test(location.hash)) LK.setDevMode(true);
  if (/devthrowtest/.test(location.hash)) {   // dev/screenshots: the bartender throws, frozen mid-flight
    const S = LK.state, b = S.chars.find(c => c.kind === 'employee' && c.task === 'bartender') || S.player;
    LK.centerOn(b.x, b.y); LK.follow = false;
    LK.dev.throwCup(b);
    for (let i = 0; i < 300 && !(S.projectiles[0] && S.projectiles[0].t > S.projectiles[0].dur * 0.35); i++) LK.step(1 / 60);
    LK.ui.setSpeed(0);
  }
  if (/ordershot/.test(location.hash)) {   // dev/screenshots: the Order arrives (day 3 noon), frozen at the demand
    const S = LK.state;
    if (/broke/.test(location.hash)) S.money = 50;
    S.day = 3; S.time = 2 * 1440 + 11.95 * 60;
    for (let i = 0; i < 60 * 120; i++) { LK.step(1 / 60); const sq = LK.orderState().squad; if (sq && sq.state === (/after/.test(location.hash) ? 'leave' : 'demand')) break; }
    const lead = LK.orderState().squad && LK.orderState().squad.members[0];
    if (lead) { LK.centerOn(lead.x, lead.y); LK.follow = false; }
    LK.ui.setSpeed(0);
  }
  if (/thiefshot/.test(location.hash)) {   // dev/screenshots: a thief rummaging in the storage (+caught: security got him, +arrest: the Order is taking him)
    const S = LK.state, p = S.player;
    p.x = 2.5; p.y = S.world.route[0] + 0.5;
    S.chars = S.chars.filter(c => c.kind !== 'employee');
    const th = LK.spawnThief(/heist/.test(location.hash));
    const stepUntil = (f, sec) => { for (let i = 0; i < sec * 60 && !f(); i++) LK.step(1 / 60); };
    if (th) {
      stepUntil(() => th.ai.state === 'search', 200);
      stepUntil(() => th.ai.t > 4, 10);
      if (/caught|arrest/.test(location.hash)) {
        const sec = new LK.Char('employee', { x: th.tx - 1, y: th.ty, task: 'security', skills: { fighting: 90 }, str: 10, sta: 10 });
        sec.recalc(); sec.hp = sec.maxHp; S.chars.push(sec);
        stepUntil(() => th.ko > 0, 120);
        if (/arrest/.test(location.hash)) stepUntil(() => S.arrests.length && S.arrests[0].state === 'leave', 200);
        else stepUntil(() => false, 1.2);
      }
      LK.centerOn(th.x, th.y); LK.follow = false; LK.ui.selected = th;
    }
    LK.ui.setSpeed(0);
  }
  const im = /intro=([\d.]+)/.exec(location.hash);   // dev/screenshots: the introduction, K seconds in (frozen)
  if (im) { LK.introStart(); for (let i = 0; i < +im[1] * 60; i++) LK.step(1 / 60); LK.ui.setSpeed(0); }
  if (/prophetshot/.test(location.hash)) {   // dev/screenshots: the prophet preaching, zoomed in
    const p = LK.dev.callProphet();
    for (let i = 0; i < 60 * 60 && p.ai.state !== 'preach'; i++) LK.step(1 / 60);
    LK.prophetSay(p, true); p.preachT = 1;
    LK.cam.z = 1.4; LK.centerOn(p.x, p.y); LK.follow = false; LK.ui.setSpeed(0);
  }
  if (/carryshot/.test(location.hash)) {   // dev/screenshots: the owner just bought at the merchant (barrel), a bartender carrying a chest
    const S = LK.state;
    S.time = S.nextMerchant; LK.merchantAI(0);
    for (let i = 0; i < 60 * 60 && S.merchant.state !== 'wait'; i++) LK.step(1 / 60);
    const m = S.merchant, p = S.player;
    p.x = m.x + 1; p.y = m.y; p.path = [];
    m.shop = LK.makeMerchantStock(0);
    const it = m.shop.find(s => s.cat === 'stock'); S.money = 5000; LK.buy(it, p, 3);
    const b = LK.makeApplicant(); b.task = 'bartender'; LK.hire(b); b.x = m.x - 1.5; b.y = m.y + 1; b.cargo = LK.emptyCargo(); b.cargo.goods.materials = 4; b.load = LK.cargoLoad(b.cargo);
    b.update = function (dt) { this.animT += dt; }; LK.employeeAI = () => {};
    LK.cam.z = 1.4; LK.centerOn(p.x, p.y); LK.follow = false; LK.ui.setSpeed(0);
  }
  if (/lowstock/.test(location.hash)) {   // dev/screenshots: almost no food and drinks left -> the alerts
    const S = LK.state;
    for (const [k, d] of Object.entries(LK.INGREDIENTS)) if (S.stock[k]) S.stock[k] = d.kind === 'food' ? 0 : 0;
    S.stock.potatoes = 3; S.stock.beer = 2;
    LK.checkLowStock();
  }
  if (/ratshot/.test(location.hash)) {   // dev/screenshots: a rat next to the owner, a stocked rat altar, (+bat) a guardian rat mid-swing
    const S = LK.state, w = S.world, p = S.player;
    p.x = 15.5; p.y = 11.5;
    const free = (x, y) => w.walkable(x, y) && !w.objAt(x, y) && w.room(x, y) === w.room(p.tx, p.ty);
    const at = [[p.tx + 1, p.ty - 1], [p.tx + 1, p.ty + 1], [p.tx + 2, p.ty], [p.tx, p.ty + 2], [p.tx - 1, p.ty + 1], [p.tx + 2, p.ty + 1]].filter(([x, y]) => free(x, y));
    const o = w.addObject('ratAltar', at[0][0], at[0][1], 0, true); o.stocked = true;
    const r = LK.spawnRat(/bat/.test(location.hash)); r.x = at[1][0] + 0.5; r.y = at[1][1] + 0.5; r.path = []; r.update = function (dt) { this.animT += dt; };
    const wm = /whack=([\d.]+)/.exec(location.hash);   // the bat scene, frozen K seconds in
    if (wm) {
      const th = new LK.Char('client', { x: r.tx + 1, y: r.ty }); th.ai = { state: 'stand', standT: 0 }; LK.makeThief(th); S.chars.push(th); th.update = function () {};
      r.guardian = true; r.flip = false;
      LK.whackStart(r, th);
      for (let t = 0; t < +wm[1]; t += 1 / 60) LK.updateEffects(1 / 60);
    }
    LK.ratAI = () => {};
    LK.ui.selected = r;
    LK.cam.z = 1.6; LK.centerOn(p.x, p.y); LK.follow = false; LK.ui.setSpeed(0);
  }
  if (/tentshot/.test(location.hash)) {   // dev/screenshots: two rental tents outside, one rented
    const S = LK.state, w = S.world, ent = w.entrances()[0];
    const spots = [];
    for (let r = 2; r < 9 && spots.length < 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = ent.outside[0] + dx, y = ent.outside[1] + dy;
      if (spots.length < 2 && w.room(x, y) === '.' && w.walkable(x, y) && !w.objAt(x, y) && !w.route.includes(y) && !spots.some(s => Math.abs(s[0] - x) + Math.abs(s[1] - y) < 3)) spots.push([x, y]);
    }
    const tents = spots.map(([x, y]) => w.addObject('rentTent', x, y, 0, true));
    const c = LK.makeClient(); c.x = ent.inside[0] + 0.5; c.y = ent.inside[1] + 0.5; c.path = []; c.budget = 1.5; c.ai = { state: 'seek' };
    const old = LK.TENT.rentChance; LK.TENT.rentChance = 1; LK.maybeRentTent(c); LK.TENT.rentChance = old;
    if (tents[1]) tents[1].hp = 70;
    LK.centerOn(tents[0].x, tents[0].y); LK.follow = false; LK.ui.setSpeed(0);
  }
  if (/postshot/.test(location.hash)) {   // dev/screenshots: a security guard with a chosen post, selected
    const S = LK.state, w = S.world, a = LK.makeApplicant(); a.task = 'security'; LK.hire(a);
    const t = w.roomTiles('B').find(([x, y]) => w.walkable(x, y) && !w.objAt(x, y) && w.entrances().every(e => Math.abs(e.inside[0] - x) + Math.abs(e.inside[1] - y) > 4));
    a.guardPost = { x: t[0], y: t[1] };
    for (let i = 0; i < 60 * 40 && !(a.tx === t[0] && a.ty === t[1]); i++) LK.step(1 / 60);
    LK.ui.selected = a; LK.centerOn(a.x, a.y); LK.follow = false; LK.ui.setSpeed(0);
  }
  // dev badge buttons
  document.querySelectorAll('#devBadge [data-dev]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const a = b.dataset.dev;
    if (a === 'cup') LK.dev.throwCup(LK.ui.selected || LK.state.player);
    else if (a === 'order') LK.dev.callOrder();
    else if (a === 'merchant') LK.dev.callMerchant();
    else if (a === 'thief') LK.dev.callThief();
    else if (a === 'heist') LK.dev.callThief(true);
    else if (a === 'rat') LK.dev.callRat();
    else if (a === 'ratguard') LK.dev.callRat(true);
    else if (a === 'money') LK.dev.money(1000);
    else if (a === 'piss') LK.dev.piss();
    else if (a === 'pisstent') LK.dev.piss(true);
    else if (a === 'prophet') LK.dev.callProphet();
  });
  if (/noblend/.test(location.hash)) LK.TERRAIN.on = false;   // dev: compare without terrain transitions
  if (/tdebug/.test(location.hash)) LK.TERRAIN.debug = true;   // dev: show transition pieces as solid colours
  const ovm = /ov=([\d.]+)/.exec(location.hash); if (ovm) LK.GROUND_OVERLAP.big = +ovm[1];   // dev: ground tile overlap
  const sp = /splash=(help|about)/.exec(location.hash);   // dev/screenshots: open a main-menu page
  if (sp) LK.splashPage(sp[1] === 'help' ? LK.ui.helpHTML() : LK.ui.aboutHTML(), sp[1]);
  if (/bench/.test(location.hash)) LK.runBench();
  const st = /stab=(\w+)/.exec(location.hash);   // dev/screenshots: storage tab (stock|other|placed), sinfo = (i) open
  if (st) LK.ui.storageTab = st[1];
  if (/sinfo/.test(location.hash)) LK.ui.storageInfo = true;
  const mt = /mtab=(drink|dish|tent)/.exec(location.hash);   // dev/screenshots: menu window tab, minfo = (i) open
  if (mt) LK.ui.menuTab = mt[1];
  if (/minfo/.test(location.hash)) LK.ui.menuInfo = true;
  const inf = /info=(\w+)/.exec(location.hash);   // dev/screenshots: open the (i) of the staff / stats window
  if (inf) LK.ui.info[inf[1]] = true;
  const pm = /panel=(\w+)/.exec(location.hash);
  const fsm = /fs=([\d.]+)/.exec(location.hash);   // dev/screenshots: text size
  if (fsm) LK.setFontScale(+fsm[1]);
  if (pm) { if (pm[1] === 'build') LK.ui.toggleBuild(); else if (pm[1] === 'shop') { if (LK.state.merchant) LK.ui.openShop(LK.state.player); } else LK.ui.toggle(pm[1]); }
  if (/gopts/.test(location.hash) && LK.ui.panel === 'game') { LK.ui.gameView = 'options'; LK.ui.renderPanel(); }   // dev/screenshots: Options page
  requestAnimationFrame(LK.loop);
};
// storage notice -> loading screen (all images) -> main menu
// language: #lang=xx (dev/screenshots) > saved choice > browser language > English
LK.startLang = function () {
  if (LK.loadSettings) LK.loadSettings();                 // text size (saved settings are readable after consent)
  const hl = /lang=(\w+)/.exec(location.hash);
  LK.setLang(hl && LK.LANGS[hl[1]] ? hl[1] : LK.detectLang());
};
// after a language switch: rebuild everything that was drawn from texts
LK.onLangChange = function () {
  if (!LK.ui || !LK.ui.refreshTexts || !document.getElementById('langSel')) return;
  LK.ui.refreshTexts();
  const sel = document.getElementById('langSel'); if (sel) sel.value = LK.lang;
  if (LK.splashPageKind === 'load') document.getElementById('mLoad').click();
  else if (LK.splashPageKind) LK.splashPage(LK.splashPageKind === 'help' ? LK.ui.helpHTML() : LK.ui.aboutHTML(), LK.splashPageKind);
};
window.addEventListener('load', () => { LK.startLang(); LK.consent.gate(() => { LK.startLang(); LK.loadAssets(LK.boot); }); });
