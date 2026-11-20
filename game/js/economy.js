// La Kurwa - economy: recipes, stock, merchant shop, hiring, day cycle, save/load
'use strict';

// ---------- recipes ----------
LK.recipeCost = r => Object.entries(r.parts).reduce((a, [k, v]) => a + v * LK.INGREDIENTS[k].price, 0);
LK.recipeTotal = r => Object.values(r.parts).reduce((a, v) => a + v, 0);
LK.recipeAlcohol = r => Object.entries(r.parts).reduce((a, [k, v]) => a + v * (LK.INGREDIENTS[k].alcohol || 0), 0);
LK.recipeProfile = function (r) {
  const tot = LK.recipeTotal(r) || 1, p = {};
  for (const [k, v] of Object.entries(r.parts)) { const t = LK.INGREDIENTS[k].type; p[t] = (p[t] || 0) + v / tot; }
  return p;
};
LK.canMake = r => Object.entries(r.parts).every(([k, v]) => (LK.state.stock[k] || 0) >= v - 1e-6);
LK.consume = function (r) {
  if (!LK.canMake(r)) return false;
  for (const [k, v] of Object.entries(r.parts)) LK.state.stock[k] = Math.round(((LK.state.stock[k] || 0) - v) * 10) / 10;
  return true;
};
// a "fair" price the wasteland is used to
// low stock alerts: total food / total drinks (units) below LK.LOW_STOCK -> a toast (ui.alert); once per drop,
// again after it was refilled or on a new day
LK.LOW_STOCK = { food: 6, drink: 6 };
LK.stockTotal = kind => Object.entries(LK.state.stock).reduce((a, [k, n]) => a + (LK.INGREDIENTS[k] && LK.INGREDIENTS[k].kind === kind ? n : 0), 0);
LK.checkLowStock = function () {
  const S = LK.state, w = S.lowWarned || (S.lowWarned = {});
  for (const kind of ['food', 'drink']) {
    const n = LK.stockTotal(kind), low = n < LK.LOW_STOCK[kind];
    if (low && !w[kind]) {
      w[kind] = true;
      if (LK.ui && LK.ui.alert) LK.ui.alert('low-' + kind, LK.t('alert.low.' + kind, { n: LK.fmt(n) }), LK.t('alert.tip'));
    } else if (!low) w[kind] = false;
  }
};
// how many servings the storage still allows
LK.servingsLeft = r => Math.floor(Math.min(...Object.entries(r.parts).map(([k, v]) => (LK.state.stock[k] || 0) / v)) + 1e-6);
// guests' budget: random in [min, max]; a guest buys only if price / fair price <= budget * maxRatio (LK.chooseRecipe)
LK.GUEST_BUDGET = { min: 0.8, max: 1.5, maxRatio: 1.4 };
// share of guests (0..1) whose budget allows this price - the same rule the guests use
LK.priceAcceptance = r => {
  const B = LK.GUEST_BUDGET, need = r.price / LK.fairPrice(r) / B.maxRatio;   // the budget a guest needs
  return LK.clamp((B.max - need) / (B.max - B.min), 0, 1);
};
// price check for the menu window: 'fair' (≥ 80 % of guests would pay) | 'pricey' (≥ 30 %) | 'expensive'
LK.PRICE_LEVELS = { fair: 0.8, pricey: 0.3 };
LK.priceLevel = r => { const a = LK.priceAcceptance(r); return a >= LK.PRICE_LEVELS.fair ? 'fair' : a >= LK.PRICE_LEVELS.pricey ? 'pricey' : 'expensive'; };
LK.fairPrice = r => Math.max(4, LK.recipeCost(r) * 2.6 + LK.recipeTotal(r) * 2);

// ---------- clients' taste ----------
LK.makePrefs = function () {
  const p = {};
  LK.DRINK_TYPES.concat(LK.FOOD_TYPES).forEach(t => p[t] = Math.random() * 0.6 - 0.3);
  // one or two favourite drink types and food types (whatever types the item data defines)
  const fav = list => { const n = Math.random() < 0.4 ? 2 : 1; for (let i = 0; i < n && list.length; i++) p[LK.pick(list)] = 0.6 + Math.random() * 0.4; };
  fav(LK.DRINK_TYPES); fav(LK.FOOD_TYPES);
  if (LK.DRINK_TYPES.includes('beer') && Math.random() < 0.35) p.beer = 0.8;   // the wasteland loves beer
  return p;
};
LK.prefScore = function (prefs, r) {
  let s = 0;
  for (const [t, f] of Object.entries(LK.recipeProfile(r))) s += (prefs[t] || 0) * f;
  return s;
};

// ---------- weight of cargo ----------
LK.WEIGHT = { stock: 1, goods: 4, furn: 12 };
LK.cargoLoad = function (cargo) {
  let w = 0;
  for (const k in cargo.stock) w += cargo.stock[k] * LK.WEIGHT.stock;
  for (const k in cargo.goods) w += cargo.goods[k] * LK.WEIGHT.goods;
  for (const k in cargo.furn) w += cargo.furn[k] * LK.WEIGHT.furn;
  return w;
};
LK.emptyCargo = () => ({ stock: {}, goods: {}, furn: {} });
// someone walking around with bought goods (drawn holding a barrel / chest, render.js)
LK.carryingGoods = c => !!(c.cargo && c.load > 0 && (Object.keys(c.cargo.stock).length || Object.keys(c.cargo.goods).length || Object.keys(c.cargo.furn).length));
// ---------- storage space ----------
LK.itemCount = (stock, goods, furn) =>
  Object.values(stock || {}).reduce((a, v) => a + Math.ceil(v - 1e-6), 0) +
  Object.values(goods || {}).reduce((a, v) => a + v, 0) + Object.values(furn || {}).reduce((a, v) => a + v, 0);
LK.storageUsed = () => { const S = LK.state; return LK.itemCount(S.stock, S.goods, S.furn); };
// built furniture inside storage rooms that adds space
LK.storageFurniture = function () {
  const w = LK.state.world;
  return w.objects.filter(o => o.built && o.hp > 0 && w.room(o.x, o.y) === 'S' && (LK.FURNITURE[o.type] || {}).capacity > 0);
};
LK.storageCapacity = () => LK.STORAGE_BASE + LK.storageFurniture().reduce((a, o) => a + LK.FURNITURE[o.type].capacity, 0);
LK.storageFree = () => Math.max(0, LK.storageCapacity() - LK.storageUsed());

// move carried goods into storage, as much as fits
LK.unloadCargo = function (c) {
  const S = LK.state, cg = c.cargo;
  if (!cg || LK.cargoLoad(cg) <= 0) return;
  let free = LK.storageFree(), moved = 0;
  if (free <= 0) {
    if (!c.fullWarned) { c.say(LK.t('say.storageFull')); LK.log(LK.t('log.storageFull', { used: LK.storageUsed(), cap: LK.storageCapacity() }), 'bad'); }
    c.fullWarned = true;
    return;
  }
  for (const cat of ['stock', 'goods', 'furn']) {
    const into = cat === 'stock' ? S.stock : cat === 'goods' ? S.goods : S.furn;
    for (const k of Object.keys(cg[cat])) {
      const n = Math.min(cg[cat][k], free);     // bought goods are always whole units
      if (n <= 0) continue;
      into[k] = Math.round(((into[k] || 0) + n) * 10) / 10;
      cg[cat][k] -= n; if (cg[cat][k] <= 1e-6) delete cg[cat][k];
      free = LK.storageFree(); moved += n;
    }
  }
  c.load = LK.cargoLoad(cg);
  if (c.load > 0) {
    c.say(LK.t('say.storedPart'));
    LK.log(LK.t('log.storedPart', { name: c.name, n: moved, used: LK.storageUsed(), cap: LK.storageCapacity() }), 'warn');
    c.fullWarned = true;
  } else {
    c.say(LK.t('say.stored'));
    LK.log(LK.t('log.stored', { name: c.name, n: moved, used: LK.storageUsed(), cap: LK.storageCapacity() }), 'good');
    c.fullWarned = false;
  }
};

// ---------- merchant ----------
LK.vendorDiscount = c => Math.min(0.3, c.skills.vendor * 0.004);
// The wasteland is not a supermarket: each visit the merchant carries only a few random kinds of goods.
// LK.MERCHANT (js/data.js) sets how many; a better vendor skill adds a little variety.
LK.makeMerchantStock = function (vendor) {
  const M = LK.MERCHANT, st = [];
  const bonus = vendor >= 30 ? 1 : 0;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const some = (list, [lo, hi]) => shuffle(list).slice(0, Math.min(list.length, LK.rint(lo, hi) + bonus));
  const f = () => 0.9 + Math.random() * 0.35;
  const ings = Object.entries(LK.INGREDIENTS).filter(([, d]) => (d.vendor || 0) <= vendor);
  for (const [k, d] of some(ings, M.ingredients)) st.push({ cat: 'stock', key: k, name: d.name, base: d.price, f: f(), qty: LK.rint(M.qty[0], M.qty[1]) });
  const furn = Object.entries(LK.FURNITURE).filter(([, d]) => !d.nosell && !d.tags.includes('rent') && !d.tags.includes('ratAltar') && (d.vendor || 0) <= vendor);
  for (const [k, d] of some(furn, M.furniture)) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: f(), qty: LK.rint(1, 2) });
  // rental tents: always on offer, fixed price
  for (const [k, d] of Object.entries(LK.FURNITURE)) if (d.tags.includes('rent') && !d.nosell) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: 1, qty: 1 });
  // the rat altar: sometimes, fixed price; with an altar the merchant always brings orzechówka for it
  for (const [k, d] of Object.entries(LK.FURNITURE)) if (d.tags.includes('ratAltar') && !d.nosell && Math.random() < LK.RAT.altarChance) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: 1, qty: 1 });
  if (LK.INGREDIENTS.orzechowka && LK.ownsAltar() && !st.some(s => s.key === 'orzechowka')) st.push({ cat: 'stock', key: 'orzechowka', name: LK.INGREDIENTS.orzechowka.name, base: LK.INGREDIENTS.orzechowka.price, f: f(), qty: LK.rint(3, 8) });
  if (Math.random() < M.materialsChance && LK.GOODS.materials) st.push({ cat: 'goods', key: 'materials', name: LK.GOODS.materials.name, base: LK.GOODS.materials.price, f: f(), qty: LK.rint(8, 30) });
  const other = Object.entries(LK.GOODS).filter(([k, d]) => k !== 'materials' && (d.vendor || 0) <= vendor);
  if (other.length && Math.random() < M.specialChance) {
    const [k, d] = LK.pick(other);
    st.push({ cat: 'goods', key: k, name: d.name, base: d.price, f: f(), qty: 1 });
  }
  return st;
};
// ---------- auto-restock: a bartender buys what is below the desired amount (storage window) ----------
LK.RESTOCK = { tradeTime: 3 };
LK.desiredOf = (cat, k) => ((LK.state.desired || {})[cat + ':' + k]) || 0;
// what `buyer` buys now from the merchant's goods: everything below the desired amount, as far as the money
// and the free storage space go (prices with his vendor skill). Returns { items: [[item, n]], cost }
LK.planRestock = function (buyer, shop) {
  const S = LK.state, out = [];
  let money = S.money, free = LK.storageFree(), cost = 0;
  for (const it of shop) {
    if ((it.cat !== 'stock' && it.cat !== 'goods') || !it.qty) continue;
    const have = it.cat === 'stock' ? (S.stock[it.key] || 0) : (S.goods[it.key] || 0);
    let n = Math.min(it.qty, Math.ceil(LK.desiredOf(it.cat, it.key) - have - 1e-6), free);
    const p = LK.shopPrice(it, buyer);
    n = Math.min(n, Math.floor(money / p));
    if (n <= 0) continue;
    out.push([it, n]); money -= n * p; cost += n * p; free -= n;
  }
  return { items: out, cost };
};
// the merchant arrived: once per visit one bartender who may restock (random if several) goes
LK.startRestock = function (m) {
  if (m.restockDone) return null;
  m.restockDone = true;
  const S = LK.state;
  const can = S.chars.filter(c => c.kind === 'employee' && c.task === 'bartender' && c.canRestock && c.active && !c.hostile);
  if (!can.length || !Object.values(S.desired || {}).some(v => v > 0)) return null;
  const c = LK.pick(can);
  c.restockFor = m;
  return c;
};
LK.shopPrice = (item, buyer) => Math.max(1, Math.round(item.base * item.f * (1 - LK.vendorDiscount(buyer))));
LK.buy = function (item, buyer, n) {
  const S = LK.state;
  n = Math.min(n || 1, item.qty);
  if (n <= 0) return;
  const price = LK.shopPrice(item, buyer) * n;
  if (S.money < price) { LK.log(LK.t('log.noMoney'), 'bad'); return false; }
  S.money -= price; S.today.expense += price;
  item.qty -= n;
  buyer.cargo = buyer.cargo || LK.emptyCargo();
  buyer.cargo[item.cat][item.key] = (buyer.cargo[item.cat][item.key] || 0) + n;
  buyer.load = LK.cargoLoad(buyer.cargo);
  buyer.gainXp('vendor', 0.3 * n);
  if (buyer.load > buyer.carryCap) buyer.say(LK.t('say.heavy', { load: Math.round(buyer.load), cap: buyer.carryCap }));
  if (buyer.kind === 'player' && S.merchant) S.merchant.say(LK.t('say.merchantStorage'), 3.5);   // the owner bought something
  return true;
};

// ---------- employees ----------
// the skill value that sets the wage for a task (maintenance: the better of tinkering / electric)
LK.wageSkill = (c, task) => Math.max(0, ...(LK.TASK_SKILLS[task || c.task] || []).map(s => Math.floor(c.skills[s] || 0)));
LK.wageFor = (c, task) => LK.WAGE.min + Math.round(LK.wageSkill(c, task) * LK.WAGE.perSkill);
LK.refreshApplicants = function () { LK.state.applicants = [LK.makeApplicant(), LK.makeApplicant(), LK.makeApplicant()]; };
LK.hire = function (app) {
  const S = LK.state;
  S.applicants = S.applicants.filter(a => a !== app);
  const r = S.world.route[0];
  app.x = 0.5; app.y = r + 0.5;
  app.kind = 'employee';
  S.chars.push(app);
  app.wage = LK.wageFor(app);
  LK.log(LK.t('log.hired', { name: app.name, task: LK.tn('task', app.task, app.task), wage: app.wage }), 'good');
};
LK.fire = function (c) {
  const S = LK.state;
  if (c.dragging) LK.dropDrag(c);
  c.kind = 'client'; c.task = null; c.job = null;
  c.prefs = LK.makePrefs(); c.mood = 30; c.budget = 1;
  c.ai = { state: 'leaving' };
  LK.log(LK.t('log.fired', { name: c.name }), 'warn');
};

// ---------- time ----------
LK.clockText = function () {
  const S = LK.state, m = Math.floor(S.time % 1440);
  return LK.t('hud.clock', { day: S.day, time: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') });
};
LK.hour = () => (LK.state.time % 1440) / 60;
LK.darkness = function () {
  const h = LK.hour();
  if (h >= 7 && h < 18) return 0;
  if (h >= 18 && h < 21) return (h - 18) / 3 * 0.68;
  if (h >= 5 && h < 7) return (7 - h) / 2 * 0.68;
  return 0.68;
};
LK.newDay = function () {
  const S = LK.state;
  const staff = S.chars.filter(c => c.kind === 'employee');
  for (const c of staff) c.wage = LK.wageFor(c);            // skills grew yesterday: so does the wage
  const wages = staff.reduce((a, c) => a + c.wage, 0);
  const upkeep = 10;
  S.money -= wages + upkeep; S.today.expense += wages + upkeep;
  LK.log(LK.t('log.newDay', { wages, upkeep }), 'warn');
  S.history.push(Object.assign({ day: S.day }, S.today, { rep: Math.round(S.rep), money: Math.round(S.money) }));
  if (LK.ui) LK.ui.dayReport(S.today, wages + upkeep);
  S.day++; S.today = { income: 0, expense: 0, served: 0, clients: 0, fights: 0 };
  if (LK.tentNewDay) LK.tentNewDay();                       // tenants pay (or check out)
  if (LK.ratNewDay) LK.ratNewDay();                         // the rat drank the altar's bottle
  S.lowWarned = {};                                         // still low in the morning: alert again
  for (const r of S.recipes) { r.soldYesterday = r.soldToday || 0; r.soldToday = 0; }
  LK.refreshApplicants();
  const O = LK.orderState();
  if (S.day >= O.nextDay) LK.log(LK.t(O.warnings ? 'log.rentTodayWarn' : 'log.rentToday', { order: LK.t('order.name'), rent: LK.rentDue(), w: O.warnings, max: LK.RENT.maxWarnings }), 'warn');
  if (S.money < 0) {
    S.brokeDays++;
    if (S.brokeDays >= 2) { LK.gameOver(LK.t('over.broke')); return; }
    LK.log(LK.t('log.debt'), 'bad');
  } else S.brokeDays = 0;
  LK.save(true);
};

// ---------- save / load: js/saves.js (3 slots + autosave, full game state) ----------
