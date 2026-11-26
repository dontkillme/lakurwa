// La Kurwa - game state, main loop, input and player interaction
'use strict';

LK.mapId = 'default';
LK.newGame = function (mapDef) {
  if (LK.intro && LK.introAbort) LK.introAbort();          // a running introduction never outlives its game
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
    merchants: [], nextMerchant: LK.MERCHANT.firstAt, merchantChain: 0, ring: null, applicants: [], over: false,
    order: { warnings: 0, paidStreak: 0, nextDay: LK.RENT.everyDays, squad: null },
    arrests: [], alarmT: 0, plans: {}, furnCrafted: {}
  };
  const ps = def.playerStart || { x: 1, y: def.route[0] };
  const p = new LK.Char('player', { name: LK.t('name.owner'), sheet: 'maleAdventurer', hue: 0, x: ps.x, y: ps.y, str: 6, sta: 6, int: 6,
    skills: { bartending: 15, cooking: 10, tinkering: 10, electric: 5, fighting: 15, vendor: 10 } });
  p.cargo = LK.emptyCargo();
  S.chars.push(p); S.player = p;
  LK.refreshApplicants();
  LK.centerOn(p.x, p.y);
  LK.fx.length = 0;
  if (LK.whacks) LK.whacks.length = 0;                      // a bat scene of the old game must not play on in this one
  if (LK.ui) { LK.ui.resetModes(); LK.ui.setSpeed(1); }
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
  if (c.kind === 'merchant') c.leaveAt = S.time;
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
  if (p.job) LK.dropJob(p);
  // the crazy prophet (a hint) or the merchant (the shop): whoever is closer
  const pr = S.chars.find(c => c.kind === 'prophet' && c.active && LK.dist(c.x, c.y, p.x, p.y) < 2.2);
  const mer = LK.nearMerchant(p, 2.5);
  if (pr && (!mer || LK.dist(pr.x, pr.y, p.x, p.y) <= LK.dist(mer.x, mer.y, p.x, p.y))) { pr.faceTo(p.x, p.y); LK.prophetSay(pr, true); return; }
  if (mer) { LK.ui.openShop(p, mer); return; }
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
  const guest = S.orders.filter(o => o.state === 'placed' && !o.worker && o.client.active && LK.dist(o.client.x, o.client.y, p.x, p.y) < 1.8 && LK.canReach(p, o.client))   // not through a wall
    .sort((a, b) => LK.dist(a.client.x, a.client.y, p.x, p.y) - LK.dist(b.client.x, b.client.y, p.x, p.y))[0];
  if (guest) { guest.worker = p; p.job = LK.newJob('serve', { order: guest, phase: 'takeHere' }); return; }
  // a dead rat next to us: pick it up (rat meat, carried into the storage)
  const deadRat = w.decals.filter(d => LK.isDeadRat(d) && Math.max(Math.abs(d.x - p.tx), Math.abs(d.y - p.ty)) <= 1)
    .sort((a, b) => LK.dist(a.fx, a.fy, p.x, p.y) - LK.dist(b.fx, b.fy, p.x, p.y))[0];
  if (deadRat) { p.job = LK.newJob('fix', { target: deadRat, decal: true }); return; }
  // outside the bar: the item under the mouse next to us - take it, or a menu when it has more actions
  const item = LK.pointedItem(p);
  if (item) {
    const acts = LK.itemActions(item);
    if (acts.length === 1) { LK.doItemAction(p, item, acts[0]); return; }
    if (acts.length > 1) { LK.ui.openItemMenu(p, item, acts); return; }
    if (LK.idleObjSay(p, item)) return;                       // a well with nothing in it: say so (never pick it up)
  }
  // the rat altar: put a bottle of orzechówka on it
  if (LK.stockAltar(p)) return;
  // a special action on something right next to us (gather water…) - without pointing at it
  const special = LK.objActions && w.objects.find(o => LK.objActions(o, p).length && (LK.isBeside(p, o) || (o.x === p.tx && o.y === p.ty) || LK.openNeighbour(p.tx, p.ty, o.x, o.y)));
  if (special) { LK.startObjAction(p, special, LK.objActions(special, p)[0]); return; }
  const idle = w.objects.find(o => (LK.FURNITURE[o.type] || {}).actions && (LK.isBeside(p, o) || LK.openNeighbour(p.tx, p.ty, o.x, o.y)));
  if (idle && LK.idleObjSay(p, idle)) return;
  const near = tag => w.objsWithTag(tag, true).filter(o => LK.isBeside(p, o) || (o.x === p.tx && o.y === p.ty) || LK.openNeighbour(p.tx, p.ty, o.x, o.y))[0];   // never through a wall
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
  // the workbench: its window (queue, plans, recycling)
  const bench = near('workbench');
  if (bench && LK.ui.openBench) { LK.ui.openBench(bench); return; }
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

// ---------------- items outside the bar (E with the mouse on the item's tile) ----------------
// the tile character c faces: his last direction snapped to one of the 8 neighbours
LK.facingTile = function (c) {
  const dx = c.fdx || 0, dy = c.fdy || 0;
  if (!dx && !dy) return [c.tx, c.ty + 1];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4;
  return [c.tx + Math.round(Math.cos(a)), c.ty + Math.round(Math.sin(a))];
};
// the selected field: on PC the tile under the mouse (null without a mouse; computed now, the camera may have moved
// since the last mousemove); with touch controls the tile the owner faces (the tapped tile in build mode / post picking)
LK.mouseTile = function () {
  if (LK.touchMode && !(LK.ui && (LK.ui.buildMode || LK.ui.pickPost)) && LK.state && LK.state.player) return LK.facingTile(LK.state.player);
  const m = LK.input.mouse;
  if (!m) return null;
  const [fx, fy] = LK.toTile(m[0], m[1]);
  return [Math.floor(fx), Math.floor(fy)];
};
// the object standing on tile (x,y): its own tile or the tile of one of its parts
LK.objOnTile = function (x, y) {
  const w = LK.state.world;
  return w.objAt(x, y) || w.objects.find(o => ((LK.FURNITURE[o.type] || {}).parts || []).some(q => (q.tx || q.ty) && o.x + (q.tx || 0) === x && o.y + (q.ty || 0) === y)) || null;
};
// the object outside the bar that player p (outside too) points at with the mouse and stands next to, or null
LK.pointedItem = function (p) {
  const S = LK.state, w = S.world, h = LK.mouseTile();
  if (p !== S.player || !h || w.isBar(p.tx, p.ty)) return null;
  const o = LK.objOnTile(h[0], h[1]);
  if (!o || w.isBar(o.x, o.y)) return null;
  const near = (x, y) => Math.max(Math.abs(x - p.tx), Math.abs(y - p.ty)) <= 1;
  return near(o.x, o.y) || near(h[0], h[1]) ? o : null;
};
// what the owner can do with an outside item, in menu order: 'stock' | 'build' | 'repair' | 'clean' | 'take'
LK.itemActions = function (o) {
  const d = LK.FURNITURE[o.type] || {}, acts = LK.objActions ? LK.objActions(o, LK.state.player) : [];   // special actions first (gather…, produce.js)
  if ((d.tags || []).includes('ratAltar') && o.built && !o.stocked) acts.push('stock');
  if (!o.built) acts.push('build');
  else if (o.hp < 100) acts.push('repair');
  else if (o.dirty) acts.push('clean');
  if (!d.nosell && !(d.actions || []).length) acts.push('take');   // furniture with special actions (well…) is picked up like any furniture: build mode → Pick up
  return acts;
};
LK.doItemAction = function (p, o, act) {
  if (!LK.state.world.objects.includes(o)) return;
  if (LK.OBJ_ACTIONS && LK.OBJ_ACTIONS[act]) { LK.startObjAction(p, o, act); return; }
  if (act === 'stock') { LK.stockAltar(p, o); return; }
  if (act === 'take') {
    const err = LK.takeError(o);
    if (err) { p.say(LK.t(err), 1.5); return; }
    LK.takeItem(o);
    LK.log(LK.t('log.itemTaken', { name: LK.furnName(o.type) }), 'good');
    return;
  }
  p.job = LK.newJob('fix', { target: o });                  // build / repair / clean
};
// why object o can't be taken back into the storage: a text key, or null
LK.takeError = function (o) {
  const S = LK.state;
  if ((LK.FURNITURE[o.type] || {}).nosell) return 'log.wasteland';
  if (o.rent && o.rent.tenant) return 'log.itemRented';
  if (o.reserved || S.chars.some(c => c.seat === o)) return 'log.inUse';
  return null;
};
// take object o back into the storage (furniture count); jobs aimed at it are dropped
LK.takeItem = function (o) {
  const S = LK.state;
  if (o.queue && LK.benchRefundAll) LK.benchRefundAll(o);   // a workbench: its queue goes back into the storage
  S.world.removeObject(o);
  S.furn[o.type] = (S.furn[o.type] || 0) + 1;
  if (o.crafted && LK.ensureCraftState) { LK.ensureCraftState(S).furnCrafted[o.type] = (S.furnCrafted[o.type] || 0) + 1; }   // still a crafted piece (quick set-up)
  for (const c of S.chars) if (c.job && (c.job.target === o || c.job.stove === o || c.job.counter === o)) LK.dropJob(c);
  if (LK.ui && LK.ui.itemMenu && LK.ui.itemMenu.o === o) LK.ui.closeItemMenu();
  if (LK.ui && LK.ui.buildMode) LK.ui.renderBuildBar();
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
    if (c.kind === 'gone' || c.inTent || c.away) continue;
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
      if (S.over && k !== 'escape' && e.key !== 'F1') return;   // game over: only the game menu (load) and help
      if (LK.ui.itemMenu && /^[1-9]$/.test(k) && LK.ui.itemMenuActs[+k - 1]) { LK.ui.pickItemAction(LK.ui.itemMenuActs[+k - 1]); return; }   // item menu: number keys
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
      else if (k === 'z' && LK.devMode) LK.ui.toggle('devitems');   // the dev window: add any item to the storage
      else if (e.key === 'F1') { LK.ui.toggle('help'); e.preventDefault(); }
      else if (k === 'escape') {
        // Esc closes what is open; with nothing open it opens the game menu
        if (LK.ui.itemMenu) LK.ui.closeItemMenu();
        else if (LK.ui.pickPost) LK.ui.endPickPost();
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
      if (e.button === 1) { this.pan = [e.clientX, e.clientY]; e.preventDefault(); return; }
      this.click(e.clientX, e.clientY, e.button === 2);
    });
    window.addEventListener('mouseup', () => { this.drag = false; this.pan = null; });
    cv.addEventListener('wheel', e => { LK.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 0.9); e.preventDefault(); }, { passive: false });
  },
  // a click (or a tap / long press with touch controls) on the map at screen point (sx,sy)
  click(sx, sy, right) {
    const [fx, fy] = LK.toTile(sx, sy);
    const x = Math.floor(fx), y = Math.floor(fy);
    if (LK.ui.itemMenu) LK.ui.closeItemMenu();              // a click on the map closes the item menu
    if (right) { if (LK.ui.pickPost) { LK.ui.endPickPost(); return; } this.rightClick(x, y, fx, fy); return; }
    if (LK.ui.pickPost) { LK.ui.setPost(x, y); return; }           // choosing a security post
    if (LK.ui.buildMode) { this.drag = true; LK.ui.buildClick(x, y, fx, fy, false); return; }
    // select the character under the mouse
    LK.ui.selected = LK.charAt(sx, sy);
  },
  rightClick(x, y) {
    const S = LK.state, p = S.player, w = S.world;
    if (!p.active || !w.inb(x, y)) return;
    LK.dropJob(p);
    if (w.walkable(x, y) ? p.goTo(x, y) : p.goAdjacent(x, y)) LK.follow = true;
    else p.say(LK.t('say.cantGetThere'), 1);
  },
  // keyboard -> grid velocity for a player (screen-relative directions)
  dirFor(up, down, left, right) {
    return this.dirFromScreen((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
  },
  // screen direction (any length) -> unit grid direction (screen x = gx - gy, screen y = (gx + gy) / 2)
  dirFromScreen(sx, sy) {
    if (!sx && !sy) return [0, 0];
    const gx = sx / 2 + sy, gy = sy - sx / 2;
    const l = Math.hypot(gx, gy);
    return [gx / l, gy / l];
  },
  joy: null,          // touch joystick: [sx, sy] screen direction (-1..1), null when released (touch.js)
  runToggle: false    // touch Run button
};
// zoom by factor f keeping the screen point (sx,sy) fixed (mouse wheel, pinch)
LK.zoomAt = function (sx, sy, f) {
  const before = LK.toTile(sx, sy);
  LK.cam.z = LK.clamp(LK.cam.z * f, 0.35, 1.8);
  const z = LK.cam.z;
  LK.cam.x = (before[0] - before[1]) * LK.TW / 2 * z - (sx - LK.view.w / 2);
  LK.cam.y = (before[0] + before[1]) * LK.TH / 2 * z - (sy - LK.view.h / 2);
  LK.follow = false;
};

// ---------------- main menu (splash) ----------------
LK.splashOpen = false;
LK.showSplash = function (inGame) {
  LK.splashOpen = true;
  LK.splashWasSpeed = inGame ? LK.state.speed : 1;
  LK.ui.setSpeed(0); LK.ui.close();
  if (LK.ui.pickPost) LK.ui.endPickPost();                  // its banner would show over the main menu
  if (LK.ui.itemMenu) LK.ui.closeItemMenu();
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
  let [vx, vy] = LK.input.dirFor(k.w, k.s, k.a, k.d);
  const joy = LK.input.joy;                // touch joystick when no key is held
  if (!vx && !vy && joy && !LK.intro) [vx, vy] = LK.input.dirFromScreen(joy[0], joy[1]);
  p.vx = vx; p.vy = vy; p.running = !!k.shift || LK.input.runToggle;
  if (vx || vy) { p.path = []; if (p.job && p.job.type !== 'deliver') LK.dropJob(p); p.work = null; LK.follow = true; }
  if (S.player2) {
    const q = S.player2;
    const [ux, uy] = LK.input.dirFor(k.i, k.k, k.j, k.l);
    q.vx = ux; q.vy = uy; q.running = !!k['/'];
    if (ux || uy) { q.path = []; if (q.job && q.job.type !== 'deliver') LK.dropJob(q); q.work = null; }
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
    LK.supplyUpdate();
    LK.altarWatch();
  }
  if (LK.produceUpdate) LK.produceUpdate();                // wells, water gatherers… (produce.js)
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
  if (LK.touchMode) LK.touch.frame();
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
  const ver = document.getElementById('gameVersion'); if (ver) ver.textContent = 'v' + LK.VERSION;   // main menu
  LK.Render.init(cv);
  LK.ui.init();
  LK.input.init(cv);
  if (LK.touch) LK.touch.init(cv);        // joystick + buttons + map gestures (touch.js)
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
  if (/supplyshot/.test(location.hash)) {   // dev/screenshots: desired amounts set, the "send for supplies" box in the storage window
    const S = LK.state;
    S.desired = { 'stock:beer': 40, 'stock:moonshine': 10, 'stock:bread': 12, 'stock:potatoes': 20, 'stock:rat': 8 };
    if (/away/.test(location.hash)) { const e = S.chars.find(c => c.kind === 'employee'); if (e) LK.sendForSupplies(e, 250, 260); }
    LK.ui.storageTab = 'stock'; LK.ui.toggle('storage');
  }
  if (/carryshot/.test(location.hash)) {   // dev/screenshots: the owner just bought at the merchant (barrel), a bartender carrying a chest
    const S = LK.state;
    const m = LK.spawnMerchant(), p = S.player;
    for (let i = 0; i < 60 * 60 && m.state !== 'wait'; i++) LK.step(1 / 60);
    p.x = m.x + 1; p.y = m.y; p.path = [];
    m.shop = LK.makeMerchantStock(0);
    const it = m.shop.find(s => s.cat === 'stock'); S.money = 5000; LK.buy(it, p, 3);
    const b = LK.makeApplicant(); b.task = 'bartender'; LK.hire(b); b.x = m.x - 1.5; b.y = m.y + 1; b.cargo = LK.emptyCargo(); b.cargo.goods.materials = 4; b.load = LK.cargoLoad(b.cargo);
    b.update = function (dt) { this.animT += dt; }; LK.employeeAI = () => {};
    if (/hands/.test(location.hash)) { p.cargo.furn.lamp = 2; p.load = LK.cargoLoad(p.cargo); LK.ui.toggleBuild(); }   // +hands: build bar with furniture in his hands
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
  if (/deadrat/.test(location.hash)) {   // dev/screenshots: two dead rats next to the owner (one with SPLAT!), a living rat
    const S = LK.state, w = S.world, p = S.player, sp = w.def.merchantSpot;   // outside, on open ground, zoomed in
    S.nextMerchant = 1e12;
    p.x = sp.x + 0.5; p.y = sp.y - 1.5; p.path = [];
    LK.cam.z = 2; LK.centerOn(p.x, p.y);
    for (const [dx, dy, fl] of [[1, 1, false], [2, -1, true]]) { const r = LK.spawnRat(); r.x = p.tx + dx + 0.5; r.y = p.ty + dy + 0.5; r.flip = fl; r.path = []; LK.ratHit(r, p); LK.ratHit(r, p); }
    const r = LK.spawnRat(); r.x = p.tx - 1.5; r.y = p.ty + 1.5; r.path = []; r.update = function (dt) { this.animT += dt; };
  }
  if (/merchants/.test(location.hash)) {   // dev/screenshots: three merchants waiting outside, the owner next to them
    const S = LK.state;
    S.nextMerchant = 1e12;
    const ms = [LK.spawnMerchant(), LK.spawnMerchant(), LK.spawnMerchant()].filter(Boolean);
    for (const m of ms) { m.x = m.spot[0] + 0.5; m.y = m.spot[1] + 0.5; m.path = []; m.state = 'wait'; }
    const p = S.player; p.x = ms[0].x + 1; p.y = ms[0].y + 1; p.path = [];
    LK.centerOn(ms[0].x, ms[0].y);
  }
  if (/itemshot/.test(location.hash)) {   // dev/screenshots: the owner outside next to a rat altar, its item menu open (+ghost: build ghost of a lamp outside)
    const S = LK.state, w = S.world, p = S.player, ent = w.entrances()[0];
    const x = ent.outside[0] + 2, y = ent.outside[1] + 2;
    const alt = w.addObject('ratAltar', x, y, 0, true); S.stock.orzechowka = 1;
    p.x = x - 0.5; p.y = y + 0.5; p.path = [];
    LK.cam.z = 1.4; LK.centerOn(x, y); LK.follow = false; LK.ui.setSpeed(0);
    if (/ghost/.test(location.hash)) {
      S.furn.lamp = 1; LK.ui.toggleBuild(); LK.ui.build.furn = 'lamp'; LK.ui.renderBuildBar();
      LK.input.hover = [x + 1, y - 1];
    } else {
      LK.input.mouse = LK.toScreen(x + 0.5, y + 0.5);
      LK.ui.openItemMenu(p, alt, LK.itemActions(alt));
    }
  }
  if (/wellshot/.test(location.hash)) {   // dev/screenshots: a well (1 L) and a water gatherer (6 L) outside near the entrance, the owner next to them
    const S = LK.state, w = S.world, ent = w.entrances()[0];
    const free = (x, y) => w.inb(x, y) && w.room(x, y) === '.' && w.walkable(x, y) && !w.objAt(x, y) && !w.route.includes(y);
    let spot = null;
    for (let r = 2; r < 10 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) { const x = ent.outside[0] + dx, y = ent.outside[1] - r; if (free(x, y) && free(x + 2, y) && free(x + 1, y + 1)) spot = [x, y]; }
    if (!spot) for (let y = 1; y < w.H - 2 && !spot; y++) for (let x = 1; x < w.W - 3 && !spot; x++) if (free(x, y) && free(x + 2, y) && free(x + 1, y + 1)) spot = [x, y];
    const well = w.addObject('well', spot[0], spot[1], 0, true), gw = w.addObject('watergather', spot[0] + 2, spot[1], 0, true);
    well.prod = 1; gw.prod = 6; well.prodNext = gw.prodNext = S.time + 999;
    S.player.x = spot[0] + 1.5; S.player.y = spot[1] + 1.5; S.player.path = [];
    LK.cam.z = 1.3; LK.centerOn(spot[0] + 1, spot[1]); LK.follow = false; LK.ui.setSpeed(0);
  }
  if (/wbshot/.test(location.hash)) {   // dev/screenshots (not 'bench…': that hash runs the render benchmark): a workbench in the storage, the owner beside it, plans + materials, a queue, its window open (+recycle: that tab)
    const S = LK.state, w = S.world;
    const t = w.roomTiles('S').find(([x, y]) => w.walkable(x, y) && !w.objAt(x, y) && w.walkable(x - 1, y) && !w.objAt(x - 1, y));
    const b = w.addObject('workbench', t[0], t[1], 0, true);
    Object.assign(S.goods, { scrap: 30, wood: 40, textile: 12, plastic: 3 });
    ['chair', 'table', 'stool', 'fridge', 'lamp'].forEach(k => LK.learnPlan('furn', k)); LK.learnPlan('goods', 'bat');
    S.furn.counter = 1; S.furn.rug = 2;
    LK.queueCraft(b, 'furn', 'table'); LK.queueCraft(b, 'furn', 'chair'); b.queue[0].done = b.queue[0].time * 0.4;
    S.player.x = t[0] - 0.5; S.player.y = t[1] + 0.5; S.player.path = [];
    if (/recycle/.test(location.hash)) LK.ui.benchTab = 'recycle';
    LK.ui.openBench(b); LK.centerOn(t[0], t[1]); LK.follow = false; LK.ui.setSpeed(0);
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
    else if (a === 'additem') LK.ui.toggle('devitems');
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
  const stt = /stafftab=(mine|hire)/.exec(location.hash); if (stt) LK.ui.staffTab = stt[1];   // dev/screenshots: staff window tab
  const mt = /mtab=(drink|dish|tent)/.exec(location.hash);   // dev/screenshots: menu window tab, minfo = (i) open
  if (mt) LK.ui.menuTab = mt[1];
  if (/minfo/.test(location.hash)) LK.ui.menuInfo = true;
  if (/invent/.test(location.hash)) { LK.inventRecipes('drink'); LK.inventRecipes('dish'); }   // dev/screenshots: the staff invent recipes (needs demo staff)
  const inf = /info=(\w+)/.exec(location.hash);   // dev/screenshots: open the (i) of the staff / stats window
  if (inf) LK.ui.info[inf[1]] = true;
  const pm = /panel=(\w+)/.exec(location.hash);
  const fsm = /fs=([\d.]+)/.exec(location.hash);   // dev/screenshots: text size
  if (fsm) LK.setFontScale(+fsm[1]);
  if (pm) { if (pm[1] === 'build') LK.ui.toggleBuild(); else if (pm[1] === 'shop') { if (LK.merchantList().length) LK.ui.openShop(LK.state.player, LK.merchantList()[0]); } else LK.ui.toggle(pm[1]); }
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
