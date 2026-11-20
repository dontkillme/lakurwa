// La Kurwa - the Order of the Holy Flame (Zakon Świętego Płomienia): rent collectors.
// Three invulnerable soldiers come every LK.RENT.everyDays days at noon and collect
// LK.RENT.perTile Mariuszki per tile of the bar building. Not enough money: they take all
// the money plus supplies and give a warning. LK.RENT.maxWarnings warnings = game over.
// Paying LK.RENT.clearAfter visits in a row clears the warnings.
'use strict';

LK.ORDER_NAME = 'Order of the Holy Flame';             // shown texts use LK.t('order.name')
LK.ORDER_NAME_PL = 'Zakon Świętego Płomienia';
LK.ORDER_MEMBERS = ['Kazimierz', 'Zdzisław', 'Bogumił', 'Radomir', 'Wincenty', 'Mścisław'];   // shown as LK.t('name.brother')

// tiles of the bar building (bar room, kitchen, storage)
LK.barSize = function () {
  const w = LK.state.world;
  let n = 0;
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) if (w.isBar(x, y)) n++;
  return n;
};
LK.rentTentCount = () => (LK.rentTents ? LK.rentTents(true).length : 0);
LK.rentDue = () => LK.barSize() * LK.RENT.perTile + LK.rentTentCount() * LK.RENT.perTent;
LK.orderState = function () {
  const S = LK.state;
  if (!S.order) S.order = { warnings: 0, paidStreak: 0, nextDay: LK.RENT.everyDays, squad: null };
  return S.order;
};

function spawnSquad() {
  const S = LK.state, w = S.world, O = LK.orderState();
  const row = w.route[0];
  const names = LK.ORDER_MEMBERS.slice().sort(() => Math.random() - 0.5);
  const members = [0, 1, 2].map(i => {
    const c = new LK.Char('order', { name: LK.t('name.brother', { name: names[i] }), sheet: 'soldier', hue: 0, female: false, x: 0, y: row + (i % 2), str: 9, sta: 9, int: 6,
      skills: { fighting: 80 } });
    c.invulnerable = true;
    c.recalc(); c.hp = c.maxHp;
    S.chars.push(c);
    return c;
  });
  O.squad = { members, state: 'arrive', t: 0 };
  // where to stand: the leader just inside the entrance, the others beside him
  const ent = w.entrances()[0];
  const spot = ent ? ent.inside : [w.def.merchantSpot.x, w.def.merchantSpot.y];
  members[0].goTo(spot[0], spot[1]) || (ent && members[0].goTo(ent.outside[0], ent.outside[1]));
  // the two others stand inside the bar next to the leader (different tiles)
  const taken = new Set([spot[0] + ',' + spot[1]]);
  members.slice(1).forEach(c => {
    const ok = c.goWhere((x, y) => Math.max(Math.abs(x - spot[0]), Math.abs(y - spot[1])) <= 2 && !taken.has(x + ',' + y) &&
      w.isBar(x, y) && w.walkable(x, y) && !w.objAt(x, y), spot[0], spot[1]);
    if (ok && c.path.length) { const [ex, ey] = c.path[c.path.length - 1]; taken.add(ex + ',' + ey); }
    else c.goTo(spot[0], spot[1]);
  });
  LK.log(LK.t('log.orderComing', { order: LK.t('order.name'), orderPl: LK.ORDER_NAME_PL, rent: LK.rentDue() }), 'warn');
  members[0].say(LK.t('say.orderArrive'), 3);
}

// summon the squad right now (developer mode); returns false if they are already here
LK.orderSummon = function () {
  const O = LK.orderState();
  if (O.squad) return false;
  spawnSquad();
  O.squad.dev = true;
  return true;
};

// value of a stock item / good
const unitPrice = (cat, k) => cat === 'stock' ? LK.INGREDIENTS[k].price : (LK.GOODS[k] || {}).price || 0;

// pay the rent; returns a report
LK.collectRent = function () {
  const S = LK.state, O = LK.orderState(), R = LK.RENT;
  const rent = LK.rentDue();
  const rep = { rent, paid: 0, seized: [], warning: false };
  if (S.money >= rent) {
    S.money -= rent; S.today.expense += rent; rep.paid = rent;
    O.paidStreak++;
    if (O.warnings > 0 && O.paidStreak >= R.clearAfter) { O.warnings = 0; rep.cleared = true; }
  } else {
    // take all the money ...
    const cash = Math.max(0, Math.floor(S.money));
    S.money -= cash; S.today.expense += cash; rep.paid = cash;
    // ... and supplies worth the rest (at most seizeShare of the stock)
    let debt = rent - cash;
    const items = [];
    for (const [k, n] of Object.entries(S.stock)) for (let i = 0; i < Math.floor(n); i++) items.push(['stock', k]);
    for (const [k, n] of Object.entries(S.goods)) for (let i = 0; i < n; i++) items.push(['goods', k]);
    items.sort((a, b) => unitPrice(b[0], b[1]) - unitPrice(a[0], a[1]));
    const limit = Math.floor(items.length * R.seizeShare);
    const taken = {};
    for (const [cat, k] of items) {
      if (debt <= 0 || Object.values(taken).reduce((a, v) => a + v, 0) >= limit) break;
      const store = cat === 'stock' ? S.stock : S.goods;
      store[k] = Math.round((store[k] - 1) * 10) / 10;
      debt -= unitPrice(cat, k);
      taken[cat + ':' + k] = (taken[cat + ':' + k] || 0) + 1;
    }
    rep.seized = Object.entries(taken).map(([ck, n]) => { const [cat, k] = ck.split(':'); return n + '× ' + (cat === 'stock' ? LK.ingName(k) : LK.goodName(k)); });
    O.warnings++; O.paidStreak = 0; rep.warning = true;
  }
  rep.warnings = O.warnings;
  return rep;
};

function demand(sq) {
  const leader = sq.members[0], O = LK.orderState();
  const rep = LK.collectRent();
  if (!rep.warning) {
    leader.say(rep.cleared ? LK.t('say.orderForgiven') : LK.t('say.orderThanks', { rent: rep.rent }), 3.5);
    LK.log(LK.t(rep.cleared ? 'log.rentPaidCleared' : 'log.rentPaid', { rent: rep.rent, order: LK.t('order.name') }), rep.cleared ? 'good' : 'warn');
  } else {
    leader.say(LK.t('say.orderWarn', { w: rep.warnings, max: LK.RENT.maxWarnings }), 4);
    sq.members[1].say(LK.t('say.orderTake'), 3);
    LK.log(LK.t(rep.seized.length ? 'log.rentFailedSeized' : 'log.rentFailed', { rent: rep.rent, paid: rep.paid, items: rep.seized.join(', '), w: rep.warnings, max: LK.RENT.maxWarnings }), 'bad');
  }
  if (LK.ui && LK.ui.rentReport) LK.ui.rentReport(rep);
  if (O.warnings >= LK.RENT.maxWarnings) LK.gameOver(LK.t('over.order', { order: LK.t('order.name'), orderPl: LK.ORDER_NAME_PL }));
}

// runs every simulation step
LK.orderUpdate = function (dt) {
  const S = LK.state, w = S.world, O = LK.orderState();
  if (!O.squad) {
    if (S.day >= O.nextDay && LK.hour() >= LK.RENT.hour) spawnSquad();
    return;
  }
  const sq = O.squad;
  sq.t += dt;
  for (const c of sq.members) if (c.hostile) LK.fightStep(c, dt);      // they do hit back...
  // a rat altar within 3 tiles of a soldier: heresy, they smash it (only the rent squad)
  if (LK.ratAltars) for (const o of LK.state.world.objsWithTag('ratAltar', false).slice()) {
    const m = sq.members.find(c => c.active && LK.dist(c.x, c.y, o.x + 0.5, o.y + 0.5) <= LK.RENT.heresyRange);
    if (!m) continue;
    m.faceTo(o.x + 0.5, o.y + 0.5); m.atkAnim = 'attack1'; m.animLock = 0.4;
    m.say(LK.t('say.orderHeresy'), 3);
    LK.fx.push({ type: 'crash', x: o.x + 0.5, y: o.y + 0.5, t: 1.6, text: LK.t('label.heresy') });
    LK.shake = Math.max(LK.shake || 0, 0.4);
    LK.destroyObject(o);
    LK.log(LK.t('log.altarSmashed', { order: LK.t('order.name') }), 'bad');
  }
  const busy = sq.members.some(c => c.hostile);
  if (sq.state === 'arrive') {
    if ((!busy && sq.members.every(c => !c.path.length) && sq.t > 2) || sq.t > 90) {
      sq.state = 'demand'; sq.t = 0;
      sq.members[0].say(LK.t('say.orderDemand', { rent: LK.rentDue() }), 3);
    }
  } else if (sq.state === 'demand') {
    if (sq.t > LK.RENT.demandWait && !busy) {
      demand(sq);
      sq.state = 'leave'; sq.t = 0;
      for (const c of sq.members) c.goTo(w.W - 1, w.route[0]) || c.goTo(0, w.route[0]);
    }
  } else if (sq.state === 'leave') {
    for (const c of sq.members) if (!c.path.length && !c.hostile && sq.t > 1) {
      if (c.tx >= w.W - 1 || c.tx <= 0 || sq.t > 60) c.kind = 'gone';
      else c.goTo(w.W - 1, w.route[0]);
    }
    if (sq.members.every(c => c.kind === 'gone') || sq.t > 90) {
      for (const c of sq.members) c.kind = 'gone';
      O.squad = null;
      if (!sq.dev) O.nextDay = S.day + LK.RENT.everyDays;      // a dev-summoned visit keeps the regular schedule
    }
  }
};
