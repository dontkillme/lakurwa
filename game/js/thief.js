// La Kurwa - thieves.
// A thief is an ordinary guest (kind 'client') with c.thief set: he sits, orders and behaves like everyone
// else. When nobody from the staff is close, he sneaks into the storage room and rummages through the
// storage furniture for 10-30 s, grabbing goods (max 20 kg) and some cash from the cash box.
// Staff who see him there raise the alarm; security staff attack him. A knocked-out thief can be handed
// over to the Order of the Holy Flame (by the owner with E / the selection panel, or by security):
// two brothers come, take him away, give back everything he stole and pay a 100 M reward.
// Bystanders step away from a thief fight instead of joining it.
'use strict';

LK.THIEF = {
  chance: 0.06,          // share of guests who stop at the bar that are thieves
  minWait: 8,            // seconds in the bar before he thinks about it
  checkEvery: 3,         // seconds between "now?" checks
  tryChance: 0.35,       // chance per check to go when the coast is clear
  watchRange: 5,         // staff this close to him or to the storage = not now
  ownerRange: 5,         // owner this close to the storage = he gives up
  maxSecurity: 2,        // this many security employees on duty = he gives up
  searchTime: [10, 30],  // seconds of rummaging
  stealEvery: 2.5,       // one grab every N seconds
  maxLoad: 20,           // kg
  cash: [15, 70],        // Mariuszki taken from the cash box (once)
  noticeRange: 4,        // staff in the storage room this close notice him (2 tiles from another room)
  dodgeRange: 2.6,       // guests this close to a thief fight step aside
  reward: 100,           // paid by the Order for a thief
  windowChance: 0.6,     // a storage window exists: chance he climbs in through it instead of using the door
  climbTime: 3,          // seconds to get through a window
  climbBars: 7,          // ... through a window with bars
  boldWait: 3            // dev heist thief: seconds in the bar before he goes
};

const tcheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const staffActive = () => LK.state.chars.filter(o => o.isStaff() && o.active);

// make guest c a thief
// bold (dev): goes for the storage soon and ignores staff, security and the owner (can still be caught)
LK.makeThief = function (c, bold) {
  c.thief = { loot: { stock: {}, goods: {}, money: 0 }, checkT: bold ? 0 : LK.THIEF.checkEvery, inBarT: 0, bold: !!bold };
  return c;
};
LK.lootWeight = l => Object.values(l.stock).reduce((a, v) => a + v * LK.WEIGHT.stock, 0) + Object.values(l.goods).reduce((a, v) => a + v * LK.WEIGHT.goods, 0);
LK.lootEmpty = l => !l.money && !l.belongings && !Object.keys(l.stock).length && !Object.keys(l.goods).length;
LK.lootText = l => [].concat(
  Object.entries(l.stock).map(([k, n]) => n + '× ' + LK.ingName(k)),
  Object.entries(l.goods).map(([k, n]) => n + '× ' + LK.goodName(k)),
  l.money ? [l.money + ' M'] : [], l.belongings ? [LK.t('loot.belongings', { name: l.belongings })] : []).join(', ');
LK.isThief = c => !!(c && c.thief && c.kind === 'client');
LK.knownThief = c => LK.isThief(c) && c.thief.discovered;

// what he goes for: storage furniture (shelves, barrels...) or any free tile of the storage room
LK.thiefTarget = function (c) {
  const w = LK.state.world;
  const furn = LK.storageFurniture().filter(o => w.findPath(c.tx, c.ty, LK.besideGoal(o), o.x, o.y) !== null);
  if (furn.length) { const o = LK.pick(furn); return { obj: o, x: o.x, y: o.y }; }
  const t = w.randomFree('S');
  return t ? { obj: null, x: t[0], y: t[1] } : null;
};

// windows of the storage room a thief can climb through: [{ key, in: [x,y] (storage tile), out: [x,y], dur, bars }]
LK.storageWindows = function () {
  const w = LK.state.world, out = [];
  for (const k in w.edges) {
    const e = w.edges[k];
    if (e.kind !== 'window') continue;
    const [x, y, s] = k.split(','), ax = +x, ay = +y, bx = s === 'W' ? ax - 1 : ax, by = s === 'N' ? ay - 1 : ay;
    const ra = w.room(ax, ay), rb = w.room(bx, by);
    if ((ra === 'S') === (rb === 'S')) continue;               // one side must be the storage room
    const [ix, iy, ox, oy] = ra === 'S' ? [ax, ay, bx, by] : [bx, by, ax, ay];
    if (!w.walkable(ix, iy) || !w.walkable(ox, oy)) continue;
    const bars = !!(e.sprite && LK.WALL_PIECES[e.sprite] && LK.WALL_PIECES[e.sprite].bars);
    out.push({ key: k, in: [ix, iy], out: [ox, oy], bars, dur: bars ? LK.THIEF.climbBars : LK.THIEF.climbTime });
  }
  return out;
};
// climb through window `win` (dir 'in' | 'out'), then call then()
function startClimb(c, win, dir, then) {
  const [fx, fy] = dir === 'in' ? win.out : win.in, [tx, ty] = dir === 'in' ? win.in : win.out;
  c.x = fx + 0.5; c.y = fy + 0.5; c.path = [];
  c.climb = { fx, fy, tx, ty };
  c.faceTo(tx + 0.5, ty + 0.5);
  c.ai = { state: dir === 'in' ? 'climbIn' : 'climbOut', win, then };
  c.startWork(win.dur, '', () => { c.x = tx + 0.5; c.y = ty + 0.5; c.climb = null; then(); });
}
// hit while climbing through a window: he drops back to where he started and has to deal with it
LK.thiefStopClimb = function (c) {
  if (!c.climb) return;
  c.x = c.climb.fx + 0.5; c.y = c.climb.fy + 0.5;
  c.climb = null; c.work = null; c.path = [];
  c.say(LK.t('say.climbStopped'), 1.5);
  if (c.ai.state === 'climbIn' || c.ai.state === 'climbOut') c.ai = { state: 'leaving' };
};
// get out: through a storage window when he is in the storage room and there is one (the one he came in by
// first, unbarred ones before barred ones), otherwise through the door
LK.thiefExit = function (c) {
  const S = LK.state, w = S.world;
  const wins = w.room(c.tx, c.ty) === 'S' ? LK.storageWindows().filter(v => c.findPathOk(v.in)) : [];
  wins.sort((a, b) => ((c.thief.window && b.key === c.thief.window.key) - (c.thief.window && a.key === c.thief.window.key)) || a.dur - b.dur ||
    LK.dist(a.in[0], a.in[1], c.x, c.y) - LK.dist(b.in[0], b.in[1], c.x, c.y));
  const win = wins[0];
  if (!win || !c.goTo(win.in[0], win.in[1])) { LK.clientLeave(c); return; }
  c.ai = { state: 'toWindow', win };
};

// one grab: a random unit of stock or goods (heavier/valuable things less likely), or the cash
function grab(c) {
  const S = LK.state, T = LK.THIEF, l = c.thief.loot;
  const room = T.maxLoad - LK.lootWeight(l);
  const opts = [];
  for (const [k, n] of Object.entries(S.stock)) if (n >= 1 && room >= LK.WEIGHT.stock) opts.push(['stock', k, 3]);
  for (const [k, n] of Object.entries(S.goods)) if (n >= 1 && room >= LK.WEIGHT.goods && LK.GOODS[k]) opts.push(['goods', k, 1]);
  if (!l.money && S.money > 0) opts.push(['money', null, 4]);
  if (!opts.length) return false;
  let r = Math.random() * opts.reduce((a, o) => a + o[2], 0), pick = opts[0];
  for (const o of opts) { if ((r -= o[2]) <= 0) { pick = o; break; } }
  const [cat, k] = pick;
  if (cat === 'money') {
    const m = Math.min(Math.floor(S.money), LK.rint(T.cash[0], T.cash[1]));
    S.money -= m; l.money = m;
  } else {
    const store = cat === 'stock' ? S.stock : S.goods;
    store[k] = Math.round((store[k] - 1) * 10) / 10;
    if (store[k] <= 1e-6) delete store[k];
    l[cat][k] = (l[cat][k] || 0) + 1;
  }
  c.load = LK.lootWeight(l);
  return true;
}
// everything back into the storage room (and the cash box)
LK.returnLoot = function (c) {
  const S = LK.state, l = c.thief.loot;
  for (const [k, n] of Object.entries(l.stock)) S.stock[k] = Math.round(((S.stock[k] || 0) + n) * 10) / 10;
  for (const [k, n] of Object.entries(l.goods)) S.goods[k] = (S.goods[k] || 0) + n;
  S.money += l.money;
  const text = LK.lootText(l);
  c.thief.loot = { stock: {}, goods: {}, money: 0 }; c.load = 0;
  return text;
};
function endRummage(c) {
  const a = c.ai;
  if (a.target && a.target.obj) a.target.obj.rummage = false;
  c.work = null;
}

// knocked out: a rummaging thief drops it; with stolen goods on him everybody can see what he is
LK.thiefKO = function (c) {
  if (!LK.isThief(c)) return;
  if (c.climb) { c.x = c.climb.fx + 0.5; c.y = c.climb.fy + 0.5; c.climb = null; }   // falls back to where he started climbing
  if (['search', 'heist', 'climbIn', 'climbOut', 'toWindow', 'toWindowIn'].includes(c.ai.state)) { endRummage(c); c.ai = { state: 'leaving' }; }
  if (!c.thief.discovered && !LK.lootEmpty(c.thief.loot)) { c.thief.discovered = true; LK.log(LK.t('log.thiefRevealed', { thief: c.name }), 'bad'); }
};

// the thief was seen in the storage room
LK.thiefSpotted = function (c, by) {
  const T = c.thief;
  if (T.discovered) return;
  T.discovered = true;
  if (c.ai.state === 'search') endRummage(c);
  by.say(LK.t(by.kind === 'player' ? 'say.spotThiefOwner' : by.kind === 'rat' ? 'say.ratAlarm' : 'say.alarm'), 3);
  LK.log(LK.t(by.kind === 'player' ? 'log.thiefSpottedOwner' : by.kind === 'rat' ? 'log.ratAlarm' : 'log.alarm', { name: by.name, thief: c.name }), 'bad');
  LK.fx.push({ type: 'hit', x: by.x, y: by.y - 0.6, t: 1.6, text: LK.t('label.alarm') });
  LK.shake = Math.max(LK.shake || 0, 0.2);
  LK.state.alarmT = 8;
  if (c.active && !c.hostile) {
    c.say(LK.t('say.thiefCaught'), 2); c.running = true;
    if (c.ai.state === 'climbIn') { c.work = null; c.x = c.climb.fx + 0.5; c.y = c.climb.fy + 0.5; c.climb = null; LK.clientLeave(c); }   // back out and away
    else if (c.ai.state !== 'climbOut') LK.thiefExit(c);
  }
};

// runs at the top of LK.clientAI for thieves; returns true when it took over this tick
LK.thiefAI = function (c, dt) {
  const S = LK.state, w = S.world, T = c.thief, CFG = LK.THIEF, a = c.ai;
  // ---- windows ----
  if (a.state === 'toWindowIn') {                 // walking (outside) to the storage window
    if (!T.bold && staffActive().some(o => LK.dist(o.x, o.y, c.x, c.y) < 2.5)) { T.gaveUp = true; LK.clientLeave(c); return true; }
    if (!c.path.length) {
      if (c.tx !== a.win.out[0] || c.ty !== a.win.out[1]) { T.gaveUp = true; LK.clientLeave(c); return true; }
      const tg = a.target;
      startClimb(c, a.win, 'in', () => {
        const ok = tg.obj ? c.goWhere(LK.besideGoal(tg.obj), tg.obj.x, tg.obj.y) : c.goTo(tg.x, tg.y);
        c.ai = { state: 'heist', target: tg };
        if (!ok) c.path = [];
      });
    }
    return true;
  }
  if (a.state === 'climbIn' || a.state === 'climbOut') {
    // move across the window frame while climbing
    if (c.climb && c.work) { const k = Math.min(1, c.work.t / c.work.dur); c.x = c.climb.fx + 0.5 + (c.climb.tx - c.climb.fx) * k; c.y = c.climb.fy + 0.5 + (c.climb.ty - c.climb.fy) * k; }
    else if (c.climb) { c.x = c.climb.fx + 0.5; c.y = c.climb.fy + 0.5; c.climb = null; LK.clientLeave(c); }   // interrupted
    return true;
  }
  if (a.state === 'toWindow') {                   // walking (inside the storage) to the window, to get out
    if (!c.path.length) {
      if (c.tx !== a.win.in[0] || c.ty !== a.win.in[1]) { LK.clientLeave(c); return true; }
      startClimb(c, a.win, 'out', () => LK.clientLeave(c));
    }
    return true;
  }
  if (a.state === 'heist') {
    // on the way: give up when someone shows up (before he is in the storage room)
    const tg = a.target;
    if (!T.bold && w.room(c.tx, c.ty) !== 'S' && staffActive().some(o => LK.dist(o.x, o.y, c.x, c.y) < 2.5 || o.kind === 'player' && LK.dist(o.x, o.y, tg.x, tg.y) < CFG.ownerRange)) {
      T.gaveUp = true; LK.clientLeave(c); return true;
    }
    if (!c.path.length) {
      const there = tg.obj ? LK.isBeside(c, tg.obj) : c.tx === tg.x && c.ty === tg.y;
      if (!there) { T.gaveUp = true; LK.clientLeave(c); return true; }
      const dur = LK.rint(CFG.searchTime[0], CFG.searchTime[1]);
      c.ai = { state: 'search', target: tg, t: 0, dur, grabT: CFG.stealEvery };
      if (tg.obj) { tg.obj.rummage = true; c.faceTo(tg.obj.x + 0.5, tg.obj.y + 0.5); }
      c.startWork(dur, '', null);
    }
    return true;
  }
  if (a.state === 'search') {
    a.t += dt; a.grabT -= dt;
    if (!c.work) c.startWork(Math.max(1, a.dur - a.t), '', null);
    if (a.grabT <= 0) { a.grabT = CFG.stealEvery; if (!a.target.tent && !grab(c)) a.t = a.dur; }   // a tent: the tenant's things, taken at the end
    if (a.t >= a.dur || LK.lootWeight(T.loot) >= CFG.maxLoad - 0.5) {
      endRummage(c);
      T.done = true;
      if (a.target.tent) {            // the tenant's belongings are gone: he breaks the deal
        const o = a.target.obj, who = o.rent && o.rent.tenant;
        T.loot.belongings = who ? who.name : '?';
        if (o.rent) LK.endRent(o, 'robbed');
      }
      LK.thiefExit(c);                // walks out calmly with the loot (door, or the window)
    }
    return true;
  }
  if (T.discovered || T.gaveUp || T.done) return false;
  // a normal guest... until the moment is right
  const calm = ['seated', 'waiting', 'eating', 'stand'].includes(a.state) && w.isBar(c.tx, c.ty);
  if (!calm) return false;
  T.inBarT += dt;
  T.checkT -= dt;
  if (T.checkT > 0 || T.inBarT < (T.bold ? LK.THIEF.boldWait : CFG.minWait)) return false;
  T.checkT = CFG.checkEvery;
  const tg = (LK.thiefTentTarget && LK.thiefTentTarget(c)) || LK.thiefTarget(c);   // a rented tent (tents.js) or the storage
  if (!tg) { T.gaveUp = true; return false; }
  const staff = staffActive();
  const security = staff.filter(o => o.kind === 'employee' && o.task === 'security').length;
  if (!T.bold && (security >= CFG.maxSecurity || staff.some(o => o.kind === 'player' && LK.dist(o.x, o.y, tg.x, tg.y) < CFG.ownerRange))) { T.gaveUp = true; return false; }
  if (!T.bold && staff.some(o => LK.dist(o.x, o.y, c.x, c.y) < CFG.watchRange || LK.dist(o.x, o.y, tg.x, tg.y) < CFG.watchRange)) return false;
  if (!T.bold && Math.random() > CFG.tryChance) return false;
  // go: quietly drop the order and the seat
  if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); }
  LK.releaseSeat(c);
  // through a storage window from outside (unbarred ones preferred), or through the bar
  const wins = tg.tent ? [] : LK.storageWindows().filter(v => c.findPathOk(v.out)).sort((p, q) => p.dur - q.dur || LK.dist(p.out[0], p.out[1], c.x, c.y) - LK.dist(q.out[0], q.out[1], c.x, c.y));
  if (wins.length && Math.random() < CFG.windowChance && c.goTo(wins[0].out[0], wins[0].out[1])) {
    T.window = wins[0];
    c.ai = { state: 'toWindowIn', win: wins[0], target: tg };
    return true;
  }
  const ok = tg.obj ? c.goWhere(LK.besideGoal(tg.obj), tg.obj.x, tg.obj.y) : c.goTo(tg.x, tg.y);
  if (!ok) { if (!T.bold) T.gaveUp = true; c.ai = { state: 'seek' }; return true; }
  c.ai = { state: 'heist', target: tg };
  return true;
};

// ---------------- guests stepping away from a thief fight ----------------
const thiefFight = t => LK.isThief(t) && t.active && (t.hostile || LK.state.chars.some(o => o.hostile === t && o.active));
LK.startDodge = function (c, fx, fy) {
  const w = LK.state.world;
  const ok = c.goWhere((x, y) => LK.dist(x + 0.5, y + 0.5, fx, fy) >= 4 && LK.dist(x + 0.5, y + 0.5, fx, fy) < 9 && w.isInside(x, y) && w.walkable(x, y) &&
    !w.objAt(x, y) && !LK.state.chars.some(o => o !== c && o.tx === x && o.ty === y), Math.round(fx), Math.round(fy));
  if (!ok) return false;
  c.dodge = { ai: c.ai, seat: c.seat, hx: c.x, hy: c.y, t: 0 };
  c.ai = { state: 'dodge' };
  c.say(LK.t('say.dodge'), 1.5);
  return true;
};
LK.dodgeAI = function (c, dt) {
  const S = LK.state, d = c.dodge;
  if (c.ai.state !== 'dodge') { d.ai = c.ai; c.ai = { state: 'dodge' }; }   // e.g. an order arrived meanwhile
  d.t += dt;
  const danger = S.chars.some(t => thiefFight(t) && LK.dist(t.x, t.y, d.hx, d.hy) < 4);
  if (danger && d.t < 60) return;
  if (c.path.length) return;
  const back = () => {
    c.dodge = null;
    c.ai = d.ai.state === 'waiting' && !c.order ? { state: 'seated', thinkT: 3 } : d.ai;
  };
  if (!d.seat) { back(); return; }
  if (c.tx === d.seat.x && c.ty === d.seat.y) { back(); return; }
  if (!d.back) { d.back = true; if (c.goTo(d.seat.x, d.seat.y)) return; }
  c.dodge = null; c.ai = { state: 'stand', standT: 0 }; LK.releaseSeat(c);    // could not get back to the seat
};

// ---------------- the Order takes the thief away ----------------
LK.canCallOrder = c => LK.knownThief(c) && c.ko > 0 && !c.thief.arrest && c.kind !== 'gone';
LK.callArrest = function (thief, caller) {
  const S = LK.state, w = S.world;
  if (!LK.canCallOrder(thief)) return false;
  thief.thief.arrest = true; thief.tied = true;
  const names = LK.ORDER_MEMBERS.slice().sort(() => Math.random() - 0.5);
  const fromE = thief.tx > w.W / 2;
  const members = [0, 1].map(i => {
    const m = new LK.Char('order', { name: LK.t('name.brother', { name: names[i] }), sheet: 'soldier', hue: 0, female: false,
      x: fromE ? w.W - 1 : 0, y: w.route[0] + i % 2, str: 9, sta: 9, int: 6, skills: { fighting: 80 } });
    m.invulnerable = true; m.recalc(); m.hp = m.maxHp;
    S.chars.push(m);
    return m;
  });
  S.arrests = S.arrests || [];
  S.arrests.push({ thief, caller, members, state: 'come', t: 0, exitX: fromE ? w.W - 1 : 0 });
  caller.say(LK.t('say.callOrder'), 2.5);
  LK.log(LK.t('log.arrestCalled', { name: caller.name, thief: thief.name, order: LK.t('order.name') }), 'warn');
  return true;
};
function updateArrest(A, dt) {
  const S = LK.state, w = S.world, th = A.thief, [lead, mate] = A.members;
  A.t += dt;
  for (const m of A.members) if (m.hostile) LK.fightStep(m, dt);
  if (th.kind !== 'gone') th.ko = Math.max(th.ko, 5);              // tied up: stays down until they take him
  if (A.state === 'come') {
    A.repath = (A.repath || 0) - dt;
    if (A.repath <= 0) {
      A.repath = 1;
      if (!lead.hostile && LK.dist(lead.x, lead.y, th.x, th.y) > 1.6) lead.goAdjacent(th.tx, th.ty);
      if (!mate.hostile && LK.dist(mate.x, mate.y, th.x, th.y) > 2.5 && !mate.path.length) mate.goAdjacent(th.tx, th.ty);
    }
    if (LK.dist(lead.x, lead.y, th.x, th.y) <= 1.6 || A.t > 120) {
      if (th.dragBy) LK.dropDrag(th.dragBy);
      LK.startDrag(lead, th);
      const items = LK.returnLoot(th);
      S.money += LK.THIEF.reward; S.today.income += LK.THIEF.reward;
      LK.fx.push({ type: 'money', x: lead.x, y: lead.y, t: 1.6, text: '+' + LK.THIEF.reward });
      lead.say(LK.t('say.arrest'), 3);
      LK.log(LK.t(items ? 'log.arrestedLoot' : 'log.arrested', { thief: th.name, items, reward: LK.THIEF.reward }), 'good');
      A.state = 'leave'; A.t = 0;
      for (const m of A.members) m.goTo(A.exitX, w.route[0]) || m.goTo(w.W - 1 - A.exitX, w.route[0]);
    }
  } else if (A.state === 'leave') {
    for (const m of A.members) if (!m.path.length && !m.hostile && (m.tx <= 0 || m.tx >= w.W - 1)) m.atEdge = true;
    if (A.members.every(m => m.atEdge) || A.t > 90) {
      th.kind = 'gone'; th.dragBy = null; lead.dragging = null;
      for (const m of A.members) m.kind = 'gone';
      A.done = true;
    } else for (const m of A.members) if (!m.path.length && !m.atEdge && !m.hostile) m.goTo(A.exitX, w.route[0]);
  }
}

// security: go to a knocked-out thief and call the Order
LK.JOBS.callOrder = function (c, j) {
  const t = j.thief;
  if (!LK.canCallOrder(t)) return 'done';
  if (LK.dist(c.x, c.y, t.x, t.y) <= 1.6) { LK.callArrest(t, c); return 'done'; }
  if (!c.path.length) { if (j.tries++ > 3 || !c.goAdjacent(t.tx, t.ty)) { LK.callArrest(t, c); return 'done'; } }
};

// runs every simulation sub-step (after the characters)
LK.thiefUpdate = function (dt) {
  const S = LK.state, w = S.world, CFG = LK.THIEF;
  if (S.alarmT > 0) S.alarmT -= dt;
  for (const c of S.chars) {
    if (!LK.isThief(c) && !(c.thief && c.kind === 'gone')) continue;
    const T = c.thief;
    // he got away
    if (c.kind === 'gone') {
      if (!T.reported && !LK.lootEmpty(T.loot) && !T.arrest) { T.reported = true; LK.log(LK.t('log.thiefEscaped', { items: LK.lootText(T.loot) }), 'bad'); }
      continue;
    }
    // seen in the storage room
    if (!T.discovered && c.active && (c.ai.state === 'search' || c.ai.state === 'climbIn' || c.ai.state === 'climbOut' && !LK.lootEmpty(T.loot) ||
        (c.ai.state === 'heist' || c.ai.state === 'toWindow') && w.room(c.tx, c.ty) === 'S')) {
      const by = S.chars.find(o => o.isStaff() && o.active && LK.dist(o.x, o.y, c.x, c.y) <= CFG.noticeRange &&
        (w.room(o.tx, o.ty) === 'S' || LK.dist(o.x, o.y, c.x, c.y) <= 2));
      if (by) LK.thiefSpotted(c, by);
    }
  }
  // guests step away from thief fights
  S.dodgeT = (S.dodgeT || 0) - dt;
  if (S.dodgeT <= 0) {
    S.dodgeT = 0.5;
    for (const t of S.chars) {
      if (!thiefFight(t)) continue;
      for (const c of S.chars) {
        if (c.kind !== 'client' || c === t || c.thief || c.dodge || c.hostile || !c.active || t.hostile === c) continue;
        if (!['seated', 'waiting', 'eating', 'stand', 'seek', 'toSeat'].includes(c.ai.state)) continue;
        if (LK.dist(c.x, c.y, t.x, t.y) < CFG.dodgeRange) LK.startDodge(c, t.x, t.y);
      }
    }
  }
  if (S.arrests && S.arrests.length) {
    for (const A of S.arrests) updateArrest(A, dt);
    S.arrests = S.arrests.filter(A => !A.done);
  }
};

// dev: a thief walks in now
// bold: a heist thief (ignores staff, goes for the storage right away)
LK.spawnThief = function (bold) {
  const c = LK.makeClient(true);
  if (c.ai.state === 'toBar') { if (bold) c.thief.bold = true, c.thief.checkT = 0; return c; }
  c.kind = 'gone';
  return null;
};
