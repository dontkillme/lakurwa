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
// give back what LK.consume took (a half-made order that is started again)
LK.refund = function (r) {
  for (const [k, v] of Object.entries(r.parts)) LK.state.stock[k] = Math.round(((LK.state.stock[k] || 0) + v) * 10) / 10;
};
// an order's ingredients were taken: remember exactly what (the recipe may be edited before a refund)
LK.consumeFor = function (o) {
  if (!LK.consume(o.recipe)) return false;
  o.used = Object.assign({}, o.recipe.parts);
  return true;
};
// give an order's ingredients back - what was really taken (old saves: the recipe's parts)
LK.refundOrder = function (o) {
  LK.refund({ parts: o.used || o.recipe.parts });
  o.used = null;
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

// ---------- staff invent recipes (menu window: "make new drinks / meals from what we have") ----------
// The best bartender (drinks) / cook (dishes) makes LK.INVENT.count new recipes from what is in the storage and
// replaces the ones the staff made before (r.auto); the player's own recipes stay. His bartending / cooking skill =
// how many ideas he tries and how well he guesses what guests like (the guests' own taste + portion rules);
// his vendor skill = how close the price lands to the sweet spot (LK.INVENT.bestRatio × fair price).
LK.INVENT = { count: 5, samples: 40, ideas: [10, 60], noise: 14, bestRatio: 1.05, priceSpread: 0.5, maxParts: 3 };
LK.INVENT_SKILL = { drink: ['bartender', 'bartending'], dish: ['cook', 'cooking'] };
// who would do it: the best active employee with the task (null = nobody hired / available)
LK.inventor = function (kind) {
  const [task, skill] = LK.INVENT_SKILL[kind];
  return LK.state.chars.filter(c => c.kind === 'employee' && c.task === task && c.active && !c.trip)
    .sort((a, b) => b.skills[skill] - a.skills[skill])[0] || null;
};
LK.hasStaffFor = kind => LK.state.chars.some(c => c.kind === 'employee' && c.task === LK.INVENT_SKILL[kind][0]);
// ingredients of this kind in the storage (at least 0.1)
LK.inventStock = kind => Object.keys(LK.state.stock).filter(k => LK.INGREDIENTS[k] && !LK.INGREDIENTS[k].raw && (LK.INGREDIENTS[k].kind === 'drink') === (kind === 'drink') && LK.state.stock[k] >= 0.1 - 1e-6);
// what a guest thinks of the taste and the portion (the same terms as his mood when served, ai.js deliverOrder)
LK.inventValue = function (r, prefsList) {
  const base = r.kind === 'drink' ? 0.6 : 0.7, tot = LK.recipeTotal(r);
  const portion = LK.clamp((tot - base) * 8, -10, 8);
  const waste = Math.max(0, tot - (base + 1)) * 8;           // more than guests notice = stock poured away
  return prefsList.reduce((a, p) => a + LK.prefScore(p, r) * 18, 0) / prefsList.length + portion - waste;
};
LK.inventName = function (r, also) {                        // also: names given in the same batch
  const keys = Object.keys(r.parts).sort((a, b) => r.parts[b] - r.parts[a]);
  const word = k => { const v = LK.lookupT('gen.ing.' + k); return v != null ? v : LK.ingName(k); };
  const adj = LK.pick(LK.tList('gen.adj'));
  let name = LK.t(keys.length > 1 ? 'gen.name2' : 'gen.name', { adj, ing: word(keys[0]), ing2: keys[1] ? word(keys[1]) : '' });
  const taken = new Set(LK.state.recipes.filter(q => !(q.auto && q.kind === r.kind)).map(q => q.name).concat(also || []));   // the old staff ones go away
  for (let i = 2; taken.has(name); i++) name = name.replace(/ \d+$/, '') + ' ' + i;
  return name;
};
// returns { ok: true, by, recipes } or { ok: false, why: 'nobody' | 'empty', by }
LK.inventRecipes = function (kind) {
  const S = LK.state, I = LK.INVENT, by = LK.inventor(kind);
  if (!by) return { ok: false, why: 'nobody' };
  const avail = LK.inventStock(kind);
  if (!avail.length) { by.say(LK.t('say.withWhat'), 2.5); LK.log(LK.t('log.inventEmpty', { name: by.name }), 'warn'); return { ok: false, why: 'empty', by }; }
  const k = LK.clamp(by.skills[LK.INVENT_SKILL[kind][1]] / 100, 0, 1), v = LK.clamp(by.skills.vendor / 100, 0, 1);
  const guests = Array.from({ length: I.samples }, () => LK.makePrefs());
  const ideas = Math.round(I.ideas[0] + (I.ideas[1] - I.ideas[0]) * k);
  const cands = [], seen = new Set();
  const idea = () => {
    const pool = avail.slice(), parts = {}, n = LK.rint(1, Math.min(I.maxParts, pool.length));
    for (let i = 0; i < n; i++) {
      const key = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const most = Math.min(2, Math.floor(S.stock[key] * 10 + 1e-6) / 10);          // never more than we have
      parts[key] = LK.clamp(Math.round((0.1 + Math.random() * 1.1) * 10) / 10, 0.1, most);
    }
    return { kind, parts };
  };
  // he tries `ideas` combinations (at least enough for the count) and judges them - the better he is, the less he guesses
  for (let i = 0; cands.length < Math.max(ideas, I.count) && i < ideas * 6; i++) {
    const r = idea(), sig = Object.entries(r.parts).sort().map(e => e.join(':')).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    r.value = LK.inventValue(r, guests);
    r.judged = r.value + (Math.random() * 2 - 1) * I.noise * (1 - k);
    cands.push(r);
  }
  cands.sort((a, b) => b.judged - a.judged);
  const names = [];
  const made = cands.slice(0, I.count).map(c => {
    const r = { kind, parts: c.parts, enabled: true, auto: { by: by.name } };
    const ratio = I.bestRatio + (Math.random() * 2 - 1) * I.priceSpread * (1 - v);       // the vendor's feel for prices
    r.price = Math.max(1, Math.round(LK.fairPrice(r) * ratio));
    r.name = LK.inventName(r, names); names.push(r.name);
    return r;
  });
  S.recipes = S.recipes.filter(r => !(r.auto && r.kind === kind)).concat(made);
  if (by.inventXpDay !== S.day) { by.inventXpDay = S.day; by.gainXp(LK.INVENT_SKILL[kind][1], 0.5); by.gainXp('vendor', 0.3); }   // learns once a day (no free XP by clicking)
  by.say(LK.t('say.invented'), 2.5);
  LK.log(LK.t(kind === 'drink' ? 'log.inventedDrinks' : 'log.inventedDishes', { name: by.name, n: made.length }), 'good');
  return { ok: true, by, recipes: made };
};

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
// ---------- building with what the owner carries (build mode) ----------
// furniture / materials in the owner's hands (bought from the merchant, not yet stored) can be built directly;
// building uses what is in his hands first (he gets lighter), then the storage
LK.handsOf = () => { const p = LK.state.player; return p && p.cargo ? p.cargo : null; };
LK.handFurn = type => { const h = LK.handsOf(); return h ? h.furn[type] || 0 : 0; };
LK.furnAvail = type => (LK.state.furn[type] || 0) + LK.handFurn(type);
LK.materialsAvail = () => (LK.state.goods.materials || 0) + ((LK.handsOf() || { goods: {} }).goods.materials || 0);
// every furniture type we could build now: { type: [total, inHands] }
LK.buildableFurn = function () {
  const S = LK.state, h = LK.handsOf(), out = {};
  for (const [k, n] of Object.entries(S.furn)) if (n > 0) out[k] = [n, 0];
  if (h) for (const [k, n] of Object.entries(h.furn)) if (n > 0) { out[k] = out[k] || [0, 0]; out[k][0] += n; out[k][1] = n; }
  return out;
};
// take n of a carried / stored thing for building: hands first. false (nothing taken) when there is not enough
LK.useForBuild = function (cat, key, n) {
  const S = LK.state, h = LK.handsOf(), into = cat === 'furn' ? S.furn : S.goods;
  const inH = h ? h[cat][key] || 0 : 0;
  if (inH + (into[key] || 0) < n) return false;
  const fromH = Math.min(inH, n);
  if (fromH) { h[cat][key] -= fromH; if (h[cat][key] <= 0) delete h[cat][key]; S.player.load = LK.cargoLoad(h); }
  if (n - fromH) into[key] -= n - fromH;
  return true;
};

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
  if (c === LK.state.player && LK.ui && LK.ui.buildMode) LK.ui.renderBuildBar();   // the ✋ counts in the build bar
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
  const ings = Object.entries(LK.INGREDIENTS).filter(([, d]) => !d.raw && (d.vendor || 0) <= vendor);   // raw: made in the bar
  for (const [k, d] of some(ings, M.ingredients)) st.push({ cat: 'stock', key: k, name: d.name, base: d.price, f: f(), qty: LK.rint(M.qty[0], M.qty[1]) });
  const furn = Object.entries(LK.FURNITURE).filter(([, d]) => !d.nosell && !d.tags.includes('rent') && !d.tags.includes('ratAltar') && !d.tags.includes('workbench') && (d.vendor || 0) <= vendor);
  for (const [k, d] of some(furn, M.furniture)) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: f(), qty: LK.rint(1, 2) });
  // rental tents: always on offer, fixed price
  for (const [k, d] of Object.entries(LK.FURNITURE)) if (d.tags.includes('rent') && !d.nosell) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: 1, qty: 1 });
  // the rat altar: sometimes, fixed price; with an altar the merchant always brings orzechówka for it
  for (const [k, d] of Object.entries(LK.FURNITURE)) if (d.tags.includes('ratAltar') && !d.nosell && Math.random() < LK.RAT.altarChance) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: 1, qty: 1 });
  if (LK.INGREDIENTS.orzechowka && LK.ownsAltar() && !st.some(s => s.key === 'orzechowka')) st.push({ cat: 'stock', key: 'orzechowka', name: LK.INGREDIENTS.orzechowka.name, base: LK.INGREDIENTS.orzechowka.price, f: f(), qty: LK.rint(3, 8) });
  if (Math.random() < M.materialsChance && LK.GOODS.materials) st.push({ cat: 'goods', key: 'materials', name: LK.GOODS.materials.name, base: LK.GOODS.materials.price, f: f(), qty: LK.rint(8, 30) });
  // crafting (craft.js): the workbench (often), some crafting materials (always), sometimes a plan the owner doesn't have
  const C = LK.CRAFT;
  if (C) {
    for (const [k, d] of Object.entries(LK.FURNITURE)) if (d.tags.includes('workbench') && !d.nosell && Math.random() < C.workbenchChance) st.push({ cat: 'furn', key: k, name: d.name, base: d.price, f: 1, qty: 1 });
    for (const k of some(LK.craftMats(), C.merchantMats)) st.push({ cat: 'goods', key: k, name: LK.GOODS[k].name, base: LK.GOODS[k].price, f: f(), qty: LK.rint(C.matQty[0], C.matQty[1]) });
    const left = LK.unownedPlans();
    if (left.length && Math.random() < C.planShopChance) { const p = LK.pick(left); st.push({ cat: 'plan', key: LK.planKey(p.cat, p.key), name: p.key, base: LK.planPrice(p.cat, p.key), f: 1, qty: 1 }); }
  }
  const other = Object.entries(LK.GOODS).filter(([k, d]) => k !== 'materials' && !d.craftMat && (d.vendor || 0) <= vendor);
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
  if (item.cat === 'plan') {                                  // a plan: straight into the library, nothing to carry
    const [pc, pk] = item.key.split(':');
    if (LK.hasPlan(pc, pk)) { item.qty = 0; LK.log(LK.t('log.planOwned', { name: LK.itemName(pc, pk) }), 'warn'); return false; }
    if (S.money < price) { LK.log(LK.t('log.noMoney'), 'bad'); return false; }
    S.money -= price; S.today.expense += price; item.qty = 0;
    LK.learnPlan(pc, pk);
    buyer.gainXp('vendor', 0.3);
    LK.log(LK.t('log.planBought', { name: LK.itemName(pc, pk) }), 'good');
    return true;
  }
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
LK.refreshApplicants = function () {
  LK.state.applicants = [LK.makeApplicant(), LK.makeApplicant(), LK.makeApplicant()];
  if (LK.ui && LK.ui.panel === 'staff') LK.ui.renderPanel();   // an open Staff window shows the new people
};
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
// returns false when he can't be fired now (away on a supply trip: he isn't here)
LK.fire = function (c) {
  const S = LK.state;
  if (!c || c.kind !== 'employee') return false;
  const t = c.trip;
  if (t && t.state === 'away') { LK.log(LK.t('log.fireAway', { name: c.name }), 'warn'); return false; }
  if (t) {                                                  // just leaving: the money back; on the way back: the change
    if (t.state === 'leaving') S.money += t.money;
    else { S.money += t.change || 0; S.today.expense += t.spent || 0; }
    c.trip = null; c.away = false;
  }
  // he leaves what is ours: the weapon and the goods he carries go into the storage (even over its space)
  if (c.weapon) { S.goods[c.weapon] = (S.goods[c.weapon] || 0) + 1; c.weapon = null; }
  if (c.cargo && LK.cargoLoad(c.cargo) > 0) {
    for (const cat of ['stock', 'goods', 'furn']) {
      const into = cat === 'stock' ? S.stock : cat === 'goods' ? S.goods : S.furn;
      for (const [k, n] of Object.entries(c.cargo[cat])) into[k] = Math.round(((into[k] || 0) + n) * 10) / 10;
    }
    c.cargo = LK.emptyCargo(); c.load = 0;
  }
  c.restockFor = null;
  if (c.dragging) LK.dropDrag(c);
  LK.dropJob(c);
  c.kind = 'client'; c.task = null;
  c.prefs = LK.makePrefs(); c.mood = 30; c.budget = 1;
  const w = S.world;                                         // he walks off the map along the road
  c.exitX = c.tx < w.W / 2 ? 0 : w.W - 1; c.exitY = w.route[0]; c.failExit = 0;
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
