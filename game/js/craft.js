// La Kurwa - crafting: the workbench (furniture tag 'workbench'), plans (the library S.plans), the queue, recycling.
//   - craftable: every furniture the merchant can sell except the rat altar, plus the goods (weapons, ring poles) -
//     not world decoration (nosell), not ingredients, not materials. Each has a plan; without its plan it can't be made.
//   - plans: the merchant has one (not owned) with LK.CRAFT.planShopChance, price × 2-3 of the item; a guest who leaves
//     happy (mood >= giftMood) gives one (not owned) with giftChance. Plans go straight into the library.
//   - the queue (max queueMax per workbench): 'craft' takes the materials when queued, 'recycle' takes the item out of the
//     storage when queued; removing an entry gives them back. Maintenance staff (nothing to fix) or the owner (button in
//     the workbench window) work it in chunks (progress kept). Speed: tinkering (+ INT, like other technical work).
//   - crafted furniture goes straight into the storage (S.furnCrafted counts it) and is set up in LK.CRAFT.placeTime s.
//   - recycling gives back 30-90 % of the item's materials: tinkering + INT, with a little luck (LK.recycleShare).
'use strict';

LK.CRAFT = { queueMax: 3, matShare: 0.35, time: [10, 1 / 20], planPrice: [2, 3], planShopChance: 0.3, giftChance: 0.05, giftMood: 70,
  recycle: [0.3, 0.9], placeTime: 3, workbenchChance: 0.9, chunk: 4, merchantMats: [2, 4], matQty: [5, 20] };
// what an item is made of (shares of the material value); a data entry may override it: craft: { mats: { wood: 3 }, time: 20 }
LK.CRAFT_PROFILE = {
  counter: { wood: 0.7, scrap: 0.3 }, stool: { wood: 1 }, chair: { wood: 0.8, textile: 0.2 }, table: { wood: 1 },
  stove: { scrap: 0.8, plastic: 0.2 }, grill: { scrap: 1 }, oven: { scrap: 0.8, plastic: 0.2 }, fridge: { scrap: 0.5, plastic: 0.5 },
  aidkit: { plastic: 0.5, textile: 0.5 }, lamp: { scrap: 0.6, plastic: 0.4 }, candle: { scrap: 0.5, textile: 0.5 },
  plant: { wood: 0.5, plastic: 0.5 }, radio: { plastic: 0.6, scrap: 0.4 }, speaker: { plastic: 0.5, scrap: 0.3, wood: 0.2 },
  rug: { textile: 1 }, toilet: { plastic: 0.7, scrap: 0.3 }, trash: { scrap: 0.5, plastic: 0.5 }, barrel: { wood: 0.8, scrap: 0.2 },
  crates: { wood: 1 }, sacks: { textile: 1 }, sword: { scrap: 0.6, wood: 0.4 }, campfire: { wood: 1 }, tent: { textile: 0.8, wood: 0.2 },
  rentTent: { textile: 0.7, wood: 0.2, plastic: 0.1 }, tent2: { textile: 0.8, wood: 0.2 }, chest: { wood: 0.7, scrap: 0.3 },
  anvil: { scrap: 1 }, cart: { scrap: 0.6, wood: 0.4 }, logs: { wood: 1 }, grave: { wood: 1 }, tombstone: { scrap: 0.5, wood: 0.5 },
  cactusPot: { plastic: 0.5, wood: 0.5 }, bush: { wood: 1 }, workbench: { wood: 0.6, scrap: 0.4 },
  well: { wood: 0.4, scrap: 0.4, textile: 0.2 }, watergather: { plastic: 0.6, textile: 0.2, scrap: 0.2 },
  ringpoles: { scrap: 0.6, textile: 0.4 }, pipe: { scrap: 1 }, bat: { wood: 0.7, scrap: 0.3 }, machete: { scrap: 0.8, wood: 0.2 }
};

LK.ensureCraftState = function (S) {
  S = S || LK.state;
  if (!S.plans) S.plans = {};
  if (!S.furnCrafted) S.furnCrafted = {};
  return S;
};
LK.craftMats = () => Object.keys(LK.GOODS).filter(k => LK.GOODS[k].craftMat);
LK.itemDef = (cat, key) => (cat === 'furn' ? LK.FURNITURE : LK.GOODS)[key];
LK.itemName = (cat, key) => cat === 'furn' ? LK.furnName(key) : LK.goodName(key);
LK.isCraftable = function (cat, key) {
  const d = LK.itemDef(cat, key);
  if (!d || !(d.price > 0)) return false;
  if (cat === 'furn') return !d.nosell && !(d.tags || []).includes('ratAltar');
  return cat === 'goods' && !d.craftMat && key !== 'materials';
};
LK.craftables = () => Object.keys(LK.FURNITURE).filter(k => LK.isCraftable('furn', k)).map(key => ({ cat: 'furn', key }))
  .concat(Object.keys(LK.GOODS).filter(k => LK.isCraftable('goods', k)).map(key => ({ cat: 'goods', key })));
LK.planKey = (cat, key) => cat + ':' + key;
LK.hasPlan = (cat, key) => !!LK.ensureCraftState().plans[LK.planKey(cat, key)];
LK.unownedPlans = () => LK.craftables().filter(i => !LK.hasPlan(i.cat, i.key));
LK.learnPlan = function (cat, key) { LK.ensureCraftState().plans[LK.planKey(cat, key)] = true; };
// materials and base work time (seconds at speed 1) of a craftable item
LK.craftRecipe = function (cat, key) {
  const C = LK.CRAFT, d = LK.itemDef(cat, key) || {}, own = d.craft || {};
  const time = own.time || Math.round(C.time[0] + (d.price || 0) * C.time[1]);
  if (own.mats) return { mats: Object.assign({}, own.mats), time };
  const prof = LK.CRAFT_PROFILE[key] || (cat === 'goods' ? { scrap: 1 } : { wood: 0.5, scrap: 0.5 }), mats = {};
  for (const [m, share] of Object.entries(prof)) if (LK.GOODS[m]) mats[m] = Math.max(1, Math.round((d.price || 0) * C.matShare * share / LK.GOODS[m].price));
  return { mats, time };
};
LK.matsText = mats => Object.entries(mats).map(([m, n]) => n + '× ' + LK.goodName(m)).join(', ');
LK.hasMats = mats => Object.entries(mats).every(([m, n]) => (LK.state.goods[m] || 0) >= n);
LK.planPrice = (cat, key) => Math.round((LK.itemDef(cat, key).price || 0) * (LK.CRAFT.planPrice[0] + Math.random() * (LK.CRAFT.planPrice[1] - LK.CRAFT.planPrice[0])));
// crafted pieces among the furniture in the storage (placed in LK.CRAFT.placeTime s)
LK.craftedCount = type => Math.min(LK.ensureCraftState().furnCrafted[type] || 0, LK.state.furn[type] || 0);

// ---------- getting plans ----------
// a guest leaving happy may give a plan the owner doesn't have yet (ai.js LK.clientLeave)
LK.maybeGiftPlan = function (c) {
  const C = LK.CRAFT;
  if (!c || (c.mood || 0) < C.giftMood || Math.random() >= C.giftChance) return null;
  const left = LK.unownedPlans();
  if (!left.length) return null;
  const p = LK.pick(left);
  LK.learnPlan(p.cat, p.key);
  c.say(LK.t('say.planGift'), 3);
  LK.log(LK.t('log.planGift', { guest: c.name, name: LK.itemName(p.cat, p.key) }), 'good');
  return p;
};

// ---------- the workbench queue ----------
LK.benchQueue = b => (b.queue = b.queue || []);
// queue crafting cat/key on bench b: { ok } or { ok: false, why: 'plan' | 'full' | 'mats' }
LK.queueCraft = function (b, cat, key) {
  const S = LK.state, q = LK.benchQueue(b);
  if (!LK.hasPlan(cat, key)) return { ok: false, why: 'plan' };
  if (q.length >= LK.CRAFT.queueMax) return { ok: false, why: 'full' };
  const r = LK.craftRecipe(cat, key);
  if (!LK.hasMats(r.mats)) return { ok: false, why: 'mats' };
  for (const [m, n] of Object.entries(r.mats)) S.goods[m] -= n;       // taken now, given back if removed from the queue
  q.push({ kind: 'craft', cat, key, mats: r.mats, time: r.time, done: 0 });
  return { ok: true };
};
// queue recycling one cat/key from the storage (not-crafted pieces first): { ok } or { ok: false, why: 'none' | 'full' | 'no' }
LK.queueRecycle = function (b, cat, key) {
  const S = LK.state, q = LK.benchQueue(b);
  if (!LK.isCraftable(cat, key)) return { ok: false, why: 'no' };
  if (q.length >= LK.CRAFT.queueMax) return { ok: false, why: 'full' };
  const store = cat === 'furn' ? S.furn : S.goods;
  if (!(store[key] > 0)) return { ok: false, why: 'none' };
  let crafted = false;
  if (cat === 'furn' && LK.craftedCount(key) >= store[key]) { S.furnCrafted[key]--; crafted = true; }   // only crafted ones left
  store[key]--;
  const r = LK.craftRecipe(cat, key);
  q.push({ kind: 'recycle', cat, key, mats: r.mats, time: r.time, done: 0, crafted });
  return { ok: true };
};
// remove entry i: the materials / the item go back into the storage
LK.unqueue = function (b, i) {
  const S = LK.ensureCraftState(), q = LK.benchQueue(b), e = q[i];
  if (!e) return;
  q.splice(i, 1);
  if (e.kind === 'craft') for (const [m, n] of Object.entries(e.mats)) S.goods[m] = (S.goods[m] || 0) + n;
  else {
    const store = e.cat === 'furn' ? S.furn : S.goods;
    store[e.key] = (store[e.key] || 0) + 1;
    if (e.crafted) S.furnCrafted[e.key] = (S.furnCrafted[e.key] || 0) + 1;
  }
};
LK.benchRefundAll = b => { while (b.queue && b.queue.length) LK.unqueue(b, b.queue.length - 1); };
// share of the materials a recycler gets back: tinkering + INT, a little luck
LK.recycleShare = function (c, luck) {
  const R = LK.CRAFT.recycle;
  const score = LK.clamp((c.skills.tinkering || 0) / 100 * 0.7 + (c.int || 0) / 10 * 0.3, 0, 1);
  const roll = luck != null ? luck : 0.85 + Math.random() * 0.3;
  return R[0] + (R[1] - R[0]) * LK.clamp(score * roll, 0, 1);
};
// the first entry is done: the item / the materials go straight into the storage
LK.finishBenchEntry = function (b, c) {
  const S = LK.ensureCraftState(), e = LK.benchQueue(b).shift();
  if (!e) return;
  const name = LK.itemName(e.cat, e.key);
  if (e.kind === 'craft') {
    if (e.cat === 'furn') { S.furn[e.key] = (S.furn[e.key] || 0) + 1; S.furnCrafted[e.key] = (S.furnCrafted[e.key] || 0) + 1; }
    else S.goods[e.key] = (S.goods[e.key] || 0) + 1;
    c.gainXp('tinkering', 0.6);
    LK.log(LK.t('log.crafted', { who: c.name, name }), 'good');
  } else {
    const f = LK.recycleShare(c), back = {};
    for (const [m, n] of Object.entries(e.mats)) { const k = Math.round(n * f); if (k > 0) { back[m] = k; S.goods[m] = (S.goods[m] || 0) + k; } }
    c.gainXp('tinkering', 0.4);
    LK.log(LK.t('log.recycled', { who: c.name, name, pct: Math.round(f * 100), mats: LK.matsText(back) || '–' }), 'good');
  }
  if (LK.ui && LK.ui.panel === 'bench') LK.ui.renderPanel();
};

// ---------- the work ----------
LK.workbenches = () => LK.state.world.objsWithTag('workbench', true);
LK.benchBusy = (b, except) => LK.state.chars.some(o => o !== except && o.job && o.job.type === 'craft' && o.job.bench === b);
// maintenance staff with nothing to fix: the nearest workbench with something queued that nobody works
LK.findCraftJob = function (c) {
  const b = LK.workbenches().filter(o => (o.queue || []).length && !LK.benchBusy(o, c))
    .sort((p, q) => LK.dist(p.x, p.y, c.x, c.y) - LK.dist(q.x, q.y, c.x, c.y))[0];
  return b ? LK.newJob('craft', { bench: b }) : null;
};
LK.JOBS = LK.JOBS || {};                                   // the editor loads this file without ai.js (recipes only)
LK.JOBS.craft = function (c, j) {
  const w = LK.state.world, b = j.bench;
  if (!w.objects.includes(b) || !b.built || !(b.queue || []).length) return 'done';
  const beside = LK.besideGoal(b);
  if (j.phase === 'go') {
    const r = LK.jobGo(c, j, beside, b.x, b.y);
    if (r === 'fail') return 'fail';
    if (r) j.phase = 'work';
    return;
  }
  if (!beside(c.tx, c.ty)) { j.phase = 'go'; return; }
  const e = b.queue[0], base = Math.min(LK.CRAFT.chunk, e.time - e.done);
  c.faceTo(b.x + 0.5, b.y + 0.5);
  c.startWork(base / c.speedFactor('tinkering'), LK.t(e.kind === 'craft' ? 'work.crafting' : 'work.recycling', { name: LK.itemName(e.cat, e.key) }), () => {
    if (b.queue[0] !== e) return;                              // removed meanwhile
    e.done += base; c.gainXp('tinkering', 0.1);
    if (e.done >= e.time - 1e-6) LK.finishBenchEntry(b, c);
  }, 'interact');
};
// the owner works the queue himself (workbench window button)
LK.ownerCraft = function (p, b) {
  if (!(b.queue || []).length) return false;
  if (LK.benchBusy(b, p)) { p.say(LK.t('say.benchBusy'), 1.5); return false; }
  LK.dropJob(p);
  p.job = LK.newJob('craft', { bench: b });
  return true;
};
