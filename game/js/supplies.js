// La Kurwa - supply trips: send an employee out to buy supplies (storage window, Food & drink tab).
// The wish list is made when he is sent: everything below the desired amount (storage window), split into
// drinks and food. Half the money is for drinks, half for food (all of it when only one kind is missing).
// The trip length is not chosen: a random trip of 60-360 game minutes is rolled (how far he has to go), then his
// vendor skill cuts the part above the 60 min minimum (skill 25 = 25 % of it less). A longer rolled trip = he went
// further = cheaper prices and a better chance to find each thing. He buys only what he can carry (his strength)
// and brings the rest of the money back.
'use strict';

LK.SUPPLY = {
  minutes: [60, 360],      // rolled trip length in game minutes (also the shortest possible trip)
  price: [1.15, 0.85],     // × the normal price, shortest -> longest rolled trip (linear)
  find: [0.7, 1.0],        // chance to find each item on the list, shortest -> longest rolled trip
  deal: [0.85, 1.15]       // luck per item (good deal = spare change)
};

// how long employee c is away for a rolled trip `roll` (game minutes): the vendor skill (0-100 %) cuts the
// time above the minimum. E.g. roll 120, skill 25: 120 - (120 - 60) × 25 % = 105 min.
LK.supplyMinutes = function (c, roll) {
  const lo = LK.SUPPLY.minutes[0], skill = LK.clamp((c.skills && c.skills.vendor) || 0, 0, 100);
  return Math.round(roll - Math.max(0, roll - lo) * skill / 100);
};
LK.rollSupplyTrip = () => LK.rint(LK.SUPPLY.minutes[0], LK.SUPPLY.minutes[1]);
// price / find factors of a rolled trip; old saves stored the chosen hours 1-4 (= 60, 160, 260, 360 min)
LK.supplyFactors = function (t) {
  const [lo, hi] = LK.SUPPLY.minutes, roll = t.roll != null ? t.roll : lo + ((t.hours || 1) - 1) / 3 * (hi - lo);
  const k = LK.clamp((roll - lo) / (hi - lo), 0, 1), L = (a) => a[0] + (a[1] - a[0]) * k;
  return { price: L(LK.SUPPLY.price), find: L(LK.SUPPLY.find) };
};
// "2 h 15 min"
LK.fmtMinutes = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return (h ? h + ' h' : '') + (h && r ? ' ' : '') + (r || !h ? r + ' min' : ''); };

// what is missing (desired − in storage − on the way), per kind: [{ key, n }]
LK.supplyNeeds = function () {
  const S = LK.state, out = { drink: [], food: [] };
  for (const [k, d] of Object.entries(LK.INGREDIENTS)) {
    const want = LK.desiredOf('stock', k);
    if (!want) continue;
    const coming = S.chars.reduce((a, c) => a + (c.trip && c.trip.list ? (c.trip.list.find(i => i.key === k) || { n: 0 }).n : 0), 0);
    const n = Math.ceil(want - (S.stock[k] || 0) - coming - 1e-6);
    if (n > 0 && out[d.kind]) out[d.kind].push({ key: k, n });
  }
  return out;
};
// rough cost of the whole wish list at normal prices (for the "money" suggestion; trips average about that)
LK.supplyEstimate = function () {
  const need = LK.supplyNeeds();
  return Math.ceil([].concat(need.drink, need.food).reduce((a, i) => a + i.n * LK.INGREDIENTS[i.key].price, 0));
};
LK.canGoForSupplies = c => c && c.kind === 'employee' && !c.trip && c.active;

// send him: the list is fixed now, the money leaves the cash box now, the trip length is rolled now
// roll: a fixed rolled trip in minutes (tests / dev), otherwise random
LK.sendForSupplies = function (c, money, roll) {
  const S = LK.state, w = S.world;
  money = Math.floor(Math.min(money, S.money));
  if (!LK.canGoForSupplies(c)) return { ok: false, why: 'busy' };
  const need = LK.supplyNeeds();
  if (!need.drink.length && !need.food.length) return { ok: false, why: 'nothing' };
  if (money <= 0) return { ok: false, why: 'money' };
  S.money -= money;
  roll = roll != null ? LK.clamp(Math.round(roll), LK.SUPPLY.minutes[0], LK.SUPPLY.minutes[1]) : LK.rollSupplyTrip();
  const minutes = LK.supplyMinutes(c, roll);
  c.job = null; c.work = null; c.hostile = null;
  if (c.dragging) LK.dropDrag(c);
  c.trip = { money, roll, minutes, list: need.drink.concat(need.food), drinks: need.drink.length > 0, food: need.food.length > 0,
    state: 'leaving', back: S.time + minutes };
  const ex = c.tx < w.W / 2 ? 0 : w.W - 1;
  if (!c.goTo(ex, w.route[0])) c.goTo(w.W - 1 - ex, w.route[0]);
  c.say(LK.t('say.supplyGo'), 2.5);
  LK.log(LK.t('log.supplyGo', { name: c.name, money, time: LK.fmtMinutes(minutes), back: LK.supplyBackText(c) }), 'warn');
  return { ok: true };
};
LK.supplyBackText = c => { const m = Math.floor(c.trip.back % 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// the shopping itself (when he comes back): half the money for drinks, half for food, then the rest for
// whatever is still missing; each item found with a chance, price × trip factor × his vendor discount × luck
LK.doSupplyShopping = function (c) {
  const T = LK.SUPPLY, t = c.trip, fac = LK.supplyFactors(t), f = fac.price, find = fac.find;
  const disc = 1 - LK.vendorDiscount(c);
  let money = t.money, kg = Math.max(0, c.carryCap - (c.load || 0));
  const bought = {}, found = t.list.filter(() => Math.random() < find).map(i => Object.assign({}, i, {
    unit: Math.max(1, Math.round(LK.INGREDIENTS[i.key].price * f * disc * (T.deal[0] + Math.random() * (T.deal[1] - T.deal[0])))) }));
  found.sort(() => Math.random() - 0.5);
  const buy = (items, budget) => {
    for (const i of items) {
      const n = Math.min(i.n - (bought[i.key] || 0), Math.floor(budget / i.unit), Math.floor(kg / LK.WEIGHT.stock));
      if (n <= 0) continue;
      bought[i.key] = (bought[i.key] || 0) + n; budget -= n * i.unit; money -= n * i.unit; kg -= n * LK.WEIGHT.stock;
    }
  };
  const drinks = found.filter(i => LK.INGREDIENTS[i.key].kind === 'drink'), food = found.filter(i => LK.INGREDIENTS[i.key].kind === 'food');
  if (drinks.length && food.length) { buy(drinks, money / 2); buy(food, money); }   // half for drinks, the rest (≥ half) for food
  else buy(drinks.length ? drinks : food, money);
  buy(found, money);                                         // anything left: whatever is still missing
  c.cargo = c.cargo || LK.emptyCargo();
  for (const [k, n] of Object.entries(bought)) c.cargo.stock[k] = (c.cargo.stock[k] || 0) + n;
  c.load = LK.cargoLoad(c.cargo);
  t.change = Math.max(0, Math.floor(money));
  t.spent = t.money - t.change;
  t.bought = bought;
};

// every simulation step
LK.supplyUpdate = function () {
  const S = LK.state, w = S.world;
  for (const c of S.chars) {
    const t = c.trip;
    if (!t) continue;
    if (t.state === 'leaving' && !c.path.length) { t.state = 'away'; c.away = true; c.path = []; }
    else if (t.state === 'away' && S.time >= t.back) {
      LK.doSupplyShopping(c);
      t.state = 'back'; c.away = false;
      c.x = (c.tx < w.W / 2 ? 0 : w.W - 1) + 0.5; c.y = w.route[0] + 0.5; c.path = [];
      c.say(LK.t('say.supplyBack'), 2.5);
    } else if (t.state === 'back' && w.room(c.tx, c.ty) === 'S' && !c.path.length) {
      if (c.load > 0) LK.unloadCargo(c);
      S.money += t.change; S.today.expense += t.spent;
      const items = Object.entries(t.bought).map(([k, n]) => n + '× ' + LK.ingName(k)).join(', ');
      LK.log(LK.t(items ? 'log.supplyBack' : 'log.supplyEmpty', { name: c.name, items, spent: t.spent, change: t.change }), items ? 'good' : 'warn');
      c.trip = null;
    }
  }
};
// employeeAI: away = nothing; back = walk to the storage
LK.supplyAI = function (c) {
  const t = c.trip, w = LK.state.world;
  if (!t) return false;
  if (t.state === 'back' && !c.path.length && w.room(c.tx, c.ty) !== 'S') {
    const st = w.roomTiles('S').filter(([x, y]) => w.walkable(x, y) && !w.objAt(x, y));
    if (!st.length || !c.goTo(st[0][0], st[0][1])) { t.state = 'back'; LK.state.money += t.change; LK.state.today.expense += t.spent; c.trip = null; }
  }
  return true;
};
