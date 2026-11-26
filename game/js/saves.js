// La Kurwa - saving and loading: 3 save slots + the morning autosave, stored in IndexedDB
// (localStorage when IndexedDB is not available), only after the storage notice was accepted.
//
// A save is the FULL game: the world (ground, rooms, walls, furniture with its state, puddles), every character
// (guests with their orders and seats, staff, thieves mid-heist, tenants, rats, the merchants, the Order's
// soldiers), orders, recipes, storage, money, the clock, the rent, tents, the rat altar ...
// The game state is a graph (a guest points to his order, the order to the guest and the recipe, a tent to its
// tenant ...). LK.encodeGame turns it into plain JSON: characters, furniture objects, orders and recipes are
// stored once in tables and everything else points to them as { $c: id } / { $o: id } / { $q: id } / { $r: i }.
// Things that cannot be stored (functions = what someone is doing right now: jobs, work in progress) are
// dropped; LK.decodeGame cleans up so everybody simply picks up a new job.
'use strict';

LK.SAVE_SLOTS = ['slot1', 'slot2', 'slot3'];
LK.SAVE_AUTO = 'auto';
LK.SAVE_VERSION = 2;

// ---------------------------------------------------------------- encode / decode
const SKIP_CHAR = new Set(['job', 'work', 'repathT', 'thinkT']);           // what he is doing right now (has functions)
LK.encodeGame = function () {
  const S = LK.state, w = S.world;
  const chars = [...new Set(S.chars.concat(S.applicants || []))];
  const charSet = new Set(chars), objSet = new Set(w.objects), ordSet = new Set(S.orders);
  const recIdx = new Map(S.recipes.map((r, i) => [r, i]));
  const enc = (v, self, skip) => {
    if (v === null || v === undefined) return v === undefined ? undefined : null;
    if (typeof v === 'function') return undefined;
    if (typeof v !== 'object') return typeof v === 'number' && !isFinite(v) ? null : v;
    if (v !== self) {
      if (charSet.has(v)) return { $c: v.id };
      if (objSet.has(v)) return { $o: v.id };
      if (ordSet.has(v)) return { $q: v.id };
      if (recIdx.has(v)) return { $r: recIdx.get(v) };
      if (v instanceof LK.Char) return null;                   // somebody who is not in the game any more
    }
    if (Array.isArray(v)) return v.map(x => { const e = enc(x); return e === undefined ? null : e; });
    if (v instanceof Set || v instanceof Map || (typeof HTMLElement !== 'undefined' && v instanceof HTMLElement)) return undefined;
    const out = {};
    for (const k of Object.keys(v)) {
      if (k[0] === '_' || (skip && skip.has(k))) continue;
      const e = enc(v[k]);
      if (e !== undefined) out[k] = e;
    }
    return out;
  };
  const def = w.toDef();
  delete def.objects;
  const rest = {};
  for (const k of Object.keys(S)) if (!['world', 'chars', 'orders', 'recipes', 'applicants', 'projectiles'].includes(k)) rest[k] = S[k];
  return {
    v: LK.SAVE_VERSION,
    mapId: LK.mapId,
    world: def,
    edgeOverride: Object.assign({}, w.edgeOverride),
    objects: w.objects.map(o => enc(o, o)),
    decals: enc(w.decals),
    chars: chars.map(c => enc(c, c, SKIP_CHAR)),
    applicants: (S.applicants || []).map(c => c.id),
    orders: S.orders.map(o => enc(o, o)),
    recipes: S.recipes.map(r => enc(r, r)),
    state: enc(rest),
    cam: { x: LK.cam.x, y: LK.cam.y, z: LK.cam.z },
    uid: LK.uidPeek ? LK.uidPeek() : 0
  };
};

LK.decodeGame = function (d) {
  if (!d || d.v !== LK.SAVE_VERSION) return LK.restoreLegacy(d);
  LK.mapId = d.mapId || LK.mapId;
  const def = Object.assign({}, d.world, { objects: [], edgeOverride: d.edgeOverride || d.world.edgeOverride });
  LK.newGame(def);
  const S = LK.state, w = S.world;
  // 1. create the things that others point to
  const chars = new Map(), objs = new Map(), ords = new Map();
  for (const cd of d.chars) { const c = Object.create(LK.Char.prototype); Object.assign(c, cd); chars.set(c.id, c); }
  w.objects = d.objects.map(od => { const o = Object.assign({}, od); objs.set(o.id, o); return o; });
  for (const od of d.orders) { const o = Object.assign({}, od); ords.set(o.id, o); }
  const recipes = d.recipes.map(r => Object.assign({}, r));
  // 2. resolve the pointers everywhere
  const dec = v => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = dec(v[i]); return v; }
    if ('$c' in v && Object.keys(v).length === 1) return chars.get(v.$c) || null;
    if ('$o' in v && Object.keys(v).length === 1) return objs.get(v.$o) || null;
    if ('$q' in v && Object.keys(v).length === 1) return ords.get(v.$q) || null;
    if ('$r' in v && Object.keys(v).length === 1) return recipes[v.$r] || null;
    for (const k of Object.keys(v)) v[k] = dec(v[k]);
    return v;
  };
  for (const c of chars.values()) for (const k of Object.keys(c)) c[k] = dec(c[k]);
  for (const o of w.objects) for (const k of Object.keys(o)) o[k] = dec(o[k]);
  for (const o of ords.values()) for (const k of Object.keys(o)) o[k] = dec(o[k]);
  for (const r of recipes) for (const k of Object.keys(r)) r[k] = dec(r[k]);
  const state = dec(d.state || {});
  // 3. put the game together
  Object.assign(S, state);
  S.recipes = recipes;
  S.orders = [...ords.values()];
  const appl = new Set(d.applicants || []);
  S.applicants = [...appl].map(id => chars.get(id)).filter(Boolean);
  S.chars = [...chars.values()].filter(c => !appl.has(c.id));
  S.projectiles = [];
  w.decals = d.decals || [];
  w.markDirty(); w.rebuildWalls();
  // 4. what people were doing right now is gone: everybody picks a new job
  for (const c of S.chars) if (c.dragging && c.kind !== 'player') { const v = c.dragging; LK.dropDrag(c); v.rescued = false; }   // their drag job is gone: let go, someone rescues him again
  for (const c of S.chars) {
    c.job = null; c.work = null; c.path = c.path || [];
    c.frozen = false; c.pose = null; c.whack = null; c.animLock = 0;
    if (c.climb) { c.x = c.climb.fx + 0.5; c.y = c.climb.fy + 0.5; c.climb = null; if (['climbIn', 'climbOut'].includes(c.ai && c.ai.state)) c.ai = { state: 'leaving' }; }
    if (c.ai && c.ai.state === 'whack') c.ai = { state: 'wander', t: 0 };
    if (c.kind === 'employee') c.wage = LK.wageFor(c);
  }
  for (const o of S.orders) {                                // half-made orders go back to the counter / kitchen
    if (o.worker && o.worker.carry === o) o.worker.carry = null;
    if (['prep', 'cooking', 'carry'].includes(o.state)) LK.refundOrder(o);   // the stock was saved after they were used
    if (['prep', 'cooking', 'cooking-wait', 'carry'].includes(o.state)) o.state = o.kind === 'drink' ? 'bar' : 'kitchen';   // taken already: just make it
    if (o.state === 'placed' || o.state === 'bar' || o.state === 'kitchen') o.worker = null;
  }
  for (const c of S.chars) if (c.carry && !S.orders.includes(c.carry)) c.carry = null;
  for (const o of w.objects) o.rummage = false;
  if (LK.whacks) LK.whacks.length = 0;
  if (S.player && !S.chars.includes(S.player)) S.player = S.chars.find(c => c.kind === 'player' && !c.p2);
  if (LK.uidSet) LK.uidSet(Math.max(d.uid || 0, ...S.chars.map(c => c.id), ...w.objects.map(o => o.id), ...S.orders.map(o => o.id), ...S.applicants.map(c => c.id)) + 1);
  if (d.cam) { LK.cam.z = d.cam.z; LK.cam.x = d.cam.x; LK.cam.y = d.cam.y; }
  LK.fx.length = 0; if (LK.particles) LK.particles.length = 0;
  if (LK.ensureCraftState) LK.ensureCraftState(S);           // saves from before crafting
  if ('merchant' in state || !Array.isArray(S.merchants)) {     // saves from before several merchants (S.merchant + S.merchantLeaveAt)
    const m = state.merchant, list = (Array.isArray(S.merchants) ? S.merchants : []).filter(x => x && S.chars.includes(x));
    if (m && S.chars.includes(m) && !list.includes(m)) { m.leaveAt = S.merchantLeaveAt != null ? S.merchantLeaveAt : S.time; m.look = 0; list.push(m); }
    for (const x of list) if (!x.spot) x.spot = [x.tx, x.ty];
    S.merchants = list; delete S.merchant; delete S.merchantLeaveAt;
  }
  if (LK.ui && LK.ui.setSpeed) LK.ui.setSpeed(S.speed || 0);   // the speed buttons show the loaded speed (a paused save stays paused)
  if (LK.ui) { LK.ui.resetModes && LK.ui.resetModes(); LK.ui.close && LK.ui.close(); LK.ui.pstHTML = null; LK.ui.trayHTML = null; }
  return true;
};

// saves from before the full save (version 1: money, storage, staff ... no guests)
LK.restoreLegacy = function (d) {
  if (!d || !d.world) return false;
  LK.newGame(d.world);
  const S = LK.state;
  if (d.tentPrice != null) S.tentPrice = d.tentPrice;
  Object.assign(S, { money: d.money, rep: d.rep, stock: d.stock, goods: d.goods, furn: d.furn, recipes: d.recipes,
    time: d.time, day: d.day, brokeDays: d.brokeDays || 0, history: d.history || [], today: d.today || S.today });
  S.order = Object.assign({ warnings: 0, paidStreak: 0, nextDay: LK.RENT.everyDays }, d.order || {}, { squad: null });
  S.recipes = S.recipes.map(r => { for (const k in r.parts) if (!LK.INGREDIENTS[k]) delete r.parts[k]; return r; }).filter(r => Object.keys(r.parts).length);
  S.chars = [];
  for (const cd of d.chars || []) {
    const c = new LK.Char(cd.kind, cd);
    Object.assign(c, { x: cd.x, y: cd.y, skills: cd.skills, task: cd.task, weapon: cd.weapon, cargo: cd.cargo || LK.emptyCargo(), p2: cd.p2 });
    c.recalc(); c.hp = Math.max(1, cd.hp); c.load = LK.cargoLoad(c.cargo);
    if (c.kind === 'employee') c.wage = LK.wageFor(c);
    if (cd.guardPost) c.guardPost = { x: cd.guardPost.x, y: cd.guardPost.y };
    S.chars.push(c);
    if (c.kind === 'player' && !c.p2) S.player = c;
    if (c.p2) S.player2 = c;
  }
  return true;
};

// short description shown in the slot list
LK.saveMeta = function () {
  const S = LK.state;
  const m = Math.floor(S.time % 1440), clock = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  return { version: LK.VERSION, savedAt: Date.now(), day: S.day, clock, money: Math.round(S.money), rep: Math.round(S.rep),
    guests: S.chars.filter(c => c.kind === 'client' && S.world.isBar(c.tx, c.ty)).length,
    staff: S.chars.filter(c => c.kind === 'employee').length, map: S.world.def.name || LK.mapId };
};

// ---------------------------------------------------------------- storage: IndexedDB, else localStorage
LK.saveStore = {
  DB: 'lakurwa', STORE: 'saves', LS: 'lakurwa_save_',
  allowed() { return !LK.consent || LK.consent.given(); },
  idb() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) return rej(new Error('no IndexedDB'));
      let req;
      try { req = indexedDB.open(this.DB, 1); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => req.result.createObjectStore(this.STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB'));
    }).catch(e => { this._noIdb = true; throw e; });
    return this._db;
  },
  async tx(mode, fn) {
    const db = await this.idb();
    return new Promise((res, rej) => {
      const t = db.transaction(this.STORE, mode), st = t.objectStore(this.STORE), r = fn(st);
      t.oncomplete = () => res(r && r.result);
      t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB'));
    });
  },
  async put(key, rec) {
    if (!this.allowed()) throw new Error(LK.t('save.noConsent'));
    try { return await this.tx('readwrite', st => st.put(rec, key)); }
    catch (e) { if (!this._noIdb) throw e; localStorage.setItem(this.LS + key, JSON.stringify(rec)); }
  },
  async get(key) {
    if (!this.allowed()) return null;
    try { return (await this.tx('readonly', st => st.get(key))) || null; }
    catch (e) { if (!this._noIdb) throw e; try { return JSON.parse(localStorage.getItem(this.LS + key) || 'null'); } catch (e2) { return null; } }
  },
  async del(key) {
    try { return await this.tx('readwrite', st => st.delete(key)); }
    catch (e) { if (!this._noIdb) throw e; localStorage.removeItem(this.LS + key); }
  }
};

// ---------------------------------------------------------------- slots
// every slot: { key, meta } (meta = null for an empty slot); the old single save (localStorage
// 'lakurwa_save', version 1) moves into slot 1 the first time
LK.listSaves = async function () {
  await LK.migrateOldSave();
  const out = [];
  for (const key of LK.SAVE_SLOTS.concat([LK.SAVE_AUTO])) {
    const rec = await LK.saveStore.get(key);
    out.push({ key, meta: rec ? rec.meta : null });
  }
  LK.saveCache = out;
  return out;
};
LK.migrateOldSave = async function () {
  let old = null;
  try { if (LK.saveStore.allowed()) old = localStorage.getItem('lakurwa_save'); } catch (e) { /* ignore */ }
  if (!old) return;
  try {
    const d = JSON.parse(old);
    if (!(await LK.saveStore.get('slot1'))) await LK.saveStore.put('slot1', { meta: { savedAt: Date.now(), day: d.day, money: Math.round(d.money), rep: Math.round(d.rep), old: true }, data: d });
    localStorage.removeItem('lakurwa_save');
  } catch (e) { /* keep it */ }
};
LK.saveTo = async function (key, quiet) {
  const rec = { meta: LK.saveMeta(), data: LK.encodeGame() };
  try {
    await LK.saveStore.put(key, rec);
    if (!quiet) LK.log(LK.t('log.savedSlot', { slot: LK.slotName(key) }), 'good');
    LK.saveCache = null;
    return true;
  } catch (e) {
    LK.log(LK.t('log.saveFailed', { err: e.message }), 'bad');
    return false;
  }
};
LK.loadFrom = async function (key) {
  const rec = await LK.saveStore.get(key);
  if (!rec || !rec.data) { LK.log(LK.t('log.noSave'), 'warn'); return false; }
  if (LK.intro && LK.introAbort) LK.introAbort();          // the loaded game replaces the introduction
  const ok = LK.decodeGame(rec.data);
  if (ok) LK.log(LK.t('log.loadedSlot', { slot: LK.slotName(key) }), 'good');
  return ok;
};
LK.slotName = key => key === LK.SAVE_AUTO ? LK.t('save.auto') : LK.t('save.slot', { n: LK.SAVE_SLOTS.indexOf(key) + 1 });
// the newest save of all (main menu "Continue")
LK.latestSave = async function () {
  const list = await LK.listSaves();
  return list.filter(s => s.meta).sort((a, b) => b.meta.savedAt - a.meta.savedAt)[0] || null;
};
// kept for the old calls: autosave every morning
LK.save = function (auto) { return LK.saveTo(auto ? LK.SAVE_AUTO : 'slot1', !!auto); };
LK.hasSave = () => !!(LK.saveCache && LK.saveCache.some(s => s.meta));
