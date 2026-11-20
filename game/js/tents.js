// La Kurwa - rental tents ("apartments").
// The owner buys a Rental tent from the merchant (always offered, 500 M) and places it outside. A guest who
// comes into the bar may rent a free tent for a few days at the price set in the menu window (Apartments tab,
// LK.state.tentPrice, 120 M/day by default; paid on check-in and every morning). A tenant lives like a guest
// in the bar and from time to time goes to his tent (he is inside = not drawn), at night longer.
// Thieves may rob a rented tent while the tenant is away: the tenant breaks the deal, leaves, reputation drops.
// Angry guests may piss on a tent (easter egg) or kick it; maintenance repairs it. A destroyed tent ends the deal.
'use strict';

LK.TENT = {
  fair: 120,             // a normal price per day (guests judge the price against this, like recipes)
  defaultPrice: 120,
  rentChance: 0.3,       // chance that a guest coming into the bar wants a free tent
  days: [1, 4],          // how long he rents
  visitEvery: [40, 90],  // seconds in the bar between trips to his tent
  stay: [25, 60],        // seconds inside the tent (longer at night)
  nightStay: [90, 160],
  minHp: 40,             // nobody rents a tent in worse shape
  robRep: 8,             // reputation lost when a tenant is robbed
  robChance: 0.5,        // a thief picks a rented, empty tent instead of the storage this often
  pissDmg: 12, wreckDmg: 25
};

const tcheb2 = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
LK.isRentTent = o => !!(o && LK.FURNITURE[o.type] && LK.FURNITURE[o.type].tags.includes('rent'));
LK.rentTents = (onlyBuilt) => LK.state.world.objsWithTag('rent', !!onlyBuilt);   // cached per tag (world.js)
LK.tentPrice = () => LK.state.tentPrice != null ? LK.state.tentPrice : LK.TENT.defaultPrice;
// share of guests who would pay this price (same budget rule as for recipes)
LK.tentAcceptance = price => {
  const B = LK.GUEST_BUDGET, need = (price != null ? price : LK.tentPrice()) / LK.TENT.fair / B.maxRatio;
  return LK.clamp((B.max - need) / (B.max - B.min), 0, 1);
};
LK.tentLevel = price => { const a = LK.tentAcceptance(price); return a >= LK.PRICE_LEVELS.fair ? 'fair' : a >= LK.PRICE_LEVELS.pricey ? 'pricey' : 'expensive'; };
LK.tenantActive = c => !!(c && c.tenant && !c.tenant.ending && c.tenant.tent.rent && c.tenant.tent.rent.tenant === c);

// a guest coming in: maybe he rents a free tent
LK.maybeRentTent = function (c) {
  const S = LK.state, T = LK.TENT;
  if (c.thief || c.tenant || Math.random() > T.rentChance) return false;
  const price = LK.tentPrice();
  if (price / T.fair > c.budget * LK.GUEST_BUDGET.maxRatio) return false;            // too expensive for him
  const tent = LK.rentTents(true).find(o => !o.rent && o.hp >= T.minHp && S.world.pathAdjacent(c.tx, c.ty, o.x, o.y) !== null);
  if (!tent) return false;
  const days = LK.rint(T.days[0], T.days[1]);
  tent.rent = { tenant: c, until: S.day + days - 1, days, paid: 0, since: S.day };
  c.tenant = { tent, visitT: LK.rint(T.visitEvery[0], T.visitEvery[1]) };
  c.longStay = true;
  LK.payRent(tent);
  c.say(LK.t('say.rentTent'), 2.5);
  LK.log(LK.t('log.tentRented', { name: c.name, days, price }), 'good');
  return true;
};
LK.payRent = function (tent) {
  const S = LK.state, p = LK.tentPrice();
  S.money += p; S.today.income += p;
  tent.rent.paid += p; tent.rentIncome = (tent.rentIncome || 0) + p;
  LK.fx.push({ type: 'money', x: tent.x + 0.5, y: tent.y + 0.5, t: 1.4, text: '+' + p });
};
// the deal ends: checkout (normal) or broken (robbed / tent destroyed)
LK.endRent = function (tent, why) {
  const S = LK.state, r = tent.rent;
  if (!r) return;
  const c = r.tenant;
  tent.rent = null;
  if (!c || !c.tenant) return;
  c.tenant.ending = true;
  if (c.inTent) LK.leaveTent(c);
  if (why === 'robbed' || why === 'destroyed') {
    S.rep = LK.clamp(S.rep - LK.TENT.robRep, 0, 100);
    c.mood = 5;
    c.say(LK.t(why === 'robbed' ? 'say.tentRobbed' : 'say.tentDestroyed'), 3.5);
    LK.log(LK.t(why === 'robbed' ? 'log.tentRobbed' : 'log.tentDestroyed', { name: c.name, rep: LK.TENT.robRep }), 'bad');
  } else {
    c.say(LK.t('say.tentCheckout'), 2.5);
    LK.log(LK.t('log.tentCheckout', { name: c.name, paid: r.paid }), 'good');
  }
  if (c.active) LK.clientLeave(c);
};
LK.enterTent = function (c) {
  const T = LK.TENT;
  c.inTent = true; c.path = []; c.bubble = null;
  const night = LK.darkness() > 0.4;
  c.ai = { state: 'inTent', t: LK.rint(...(night ? T.nightStay : T.stay)) };
};
LK.leaveTent = function (c) {
  c.inTent = false;
  const o = c.tenant && c.tenant.tent, w = LK.state.world;
  if (o) {                                                   // step out next to the tent
    const p = w.findPath(o.x, o.y, (x, y) => tcheb2(x, y, o.x, o.y) === 1 && w.walkable(x, y), o.x, o.y);
    const t = p && p.length ? p[p.length - 1] : [o.x, o.y + 1];
    c.x = t[0] + 0.5; c.y = t[1] + 0.5;
  }
};
// clientLeave for a tenant: back to his tent instead of leaving the map
LK.tenantLeave = function (c) {
  if (!LK.tenantActive(c)) return false;
  LK.releaseSeat(c);
  if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); }
  const o = c.tenant.tent;
  if (!c.goAdjacent(o.x, o.y)) { LK.endRent(o, 'checkout'); return false; }
  c.ai = { state: 'toTent' };
  return true;
};

// runs at the top of LK.clientAI for tenants; true = handled this tick
LK.tenantAI = function (c, dt) {
  const S = LK.state, w = S.world, a = c.ai, tn = c.tenant;
  if (!LK.tenantActive(c)) return false;
  const o = tn.tent;
  if (a.state === 'toTent') {
    if (!c.path.length) { if (tcheb2(c.tx, c.ty, o.x, o.y) <= 1) LK.enterTent(c); else if (!c.goAdjacent(o.x, o.y)) LK.endRent(o, 'checkout'); }
    return true;
  }
  if (a.state === 'inTent') {
    a.t -= dt;
    if (o.hp < 50 && Math.random() < dt * 0.05) c.mood -= 5;           // a shabby tent
    if (a.t > 0) return true;
    LK.leaveTent(c);
    c.mood = Math.min(100, c.mood + 10);                                // rested
    c.rounds = LK.rint(1, 3); c.ateFood = false;
    tn.visitT = LK.rint(LK.TENT.visitEvery[0], LK.TENT.visitEvery[1]);
    const ent = w.entrances()[0];
    if (ent && c.goTo(ent.inside[0], ent.inside[1])) c.ai = { state: 'toBar' };
    else c.ai = { state: 'seek' };
    return true;
  }
  // in the bar: from time to time back to the tent (not while waiting for an order)
  if (['seated', 'eating', 'stand'].includes(a.state)) {
    tn.visitT -= dt;
    if (tn.visitT <= 0) { LK.tenantLeave(c); return true; }
  }
  return false;
};

// angry guests and the tent: 'wreck' (kick it) - the piss variant is in LK.getAngry / clientAI 'piss'
LK.angryTent = c => LK.rentTents(true).filter(o => LK.state.world.pathAdjacent(c.tx, c.ty, o.x, o.y) !== null)
  .sort((p, q) => LK.dist(p.x, p.y, c.x, c.y) - LK.dist(q.x, q.y, c.x, c.y))[0] || null;
LK.wreckAI = function (c, dt) {
  const a = c.ai, o = a.tent;
  if (!o || !LK.state.world.objects.includes(o)) { LK.clientLeave(c); return; }
  if (c.path.length) return;
  if (tcheb2(c.tx, c.ty, o.x, o.y) > 1) { if (!c.goAdjacent(o.x, o.y)) LK.clientLeave(c); return; }
  a.t = (a.t || 0) + dt; a.hitT = (a.hitT || 0) - dt;
  c.faceTo(o.x + 0.5, o.y + 0.5);
  if (a.hitT <= 0) {
    a.hitT = 0.7;
    c.atkAnim = LK.pick(['kick', 'attack0', 'attack1']); c.animLock = 0.35;
    const dmg = LK.TENT.wreckDmg / 4;
    LK.fx.push({ type: 'hit', x: o.x + 0.5, y: o.y + 0.5, t: 0.5, text: '-' + Math.round(dmg) });
    LK.damageObject(o, dmg);
    if (o.rent && o.rent.tenant) o.rent.tenant.mood -= 3;
  }
  if (a.t >= 2.8 || !LK.state.world.objects.includes(o)) { c.mood += 15; LK.clientLeave(c); }
};

// a thief may choose a rented tent whose tenant is away
LK.thiefTentTarget = function (c) {
  const w = LK.state.world;
  if (Math.random() > LK.TENT.robChance) return null;
  const t = LK.rentTents(true).filter(o => o.rent && o.rent.tenant && !o.rent.tenant.inTent && w.findPath(c.tx, c.ty, LK.besideGoal(o), o.x, o.y) !== null);
  if (!t.length) return null;
  const o = LK.pick(t);
  return { obj: o, x: o.x, y: o.y, tent: true };
};

// every simulation step: deals whose tent or tenant is gone
LK.tentUpdate = function () {
  const S = LK.state;
  for (const o of LK.rentTents(false)) {
    if (!o.rent) continue;
    const c = o.rent.tenant;
    if (!c || c.kind === 'gone' || !S.chars.includes(c)) o.rent = null;
  }
  for (const c of S.chars) {
    if (!c.tenant || c.tenant.ending) continue;
    const o = c.tenant.tent;
    if (!S.world.objects.includes(o)) { o.rent = o.rent || { tenant: c, paid: 0 }; LK.endRent(o, 'destroyed'); }
  }
};
// every morning: pay or check out
LK.tentNewDay = function () {
  const S = LK.state;
  let total = 0;
  for (const o of LK.rentTents(false)) {
    if (!o.rent) continue;
    if (S.day > o.rent.until) LK.endRent(o, 'checkout');
    else { LK.payRent(o); total += LK.tentPrice(); }
  }
  if (total) LK.log(LK.t('log.tentRentDay', { total }), 'good');
};
