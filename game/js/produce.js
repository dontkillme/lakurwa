// La Kurwa - furniture that makes things over time and special actions on furniture.
//
// PRODUCERS - a furniture entry with `produce` (data/furniture.js):
//   produce: { cat: 'stock', item: 'dirtyWater',   what it makes (cat 'stock' = ingredient, 'goods')
//              every: 180,                        game minutes between rolls
//              amount: [1, 2],                    made per roll (random whole number in the range)
//              chance: 0.6,                       chance per roll (default 1)
//              max: 10,                           most it holds (1 = it doesn't pile up)
//              needs: { potatoes: 1, water: 1 },  optional: taken per roll from the object's own input store o.input
//              icon: '💧', unit: 'L' }             shown over the object with the amount (unit: else the item's unit)
//   State on the object: o.prod (amount waiting), o.prodNext (game time of the next roll), o.input (for `needs`).
//   Only built objects produce; a roll that finds the object full (or without inputs) makes nothing.
//
// SPECIAL ACTIONS - a furniture entry with `actions: ['gather', …]`, keys of LK.OBJ_ACTIONS:
//   { label(o) → text (item menu, log), can(o, c) → bool, work: base seconds, skill: speeds it up,
//     run(o, c) → does it, staff: maintenance staff do it by themselves when nothing needs fixing }
//   The owner uses them with E (outside the bar: the item menu, main.js LK.itemActions; inside: E next to it).
//   Future ideas fit here: 'load' (put potatoes + water into a distiller → o.input), 'harvest' (corn), …
'use strict';

LK.OBJ_ACTIONS = {
  // take what a producer made into your hands (carried into the storage like bought goods)
  gather: {
    work: 3, skill: 'tinkering', staff: true,
    label(o) {
      const p = LK.FURNITURE[o.type].produce, n = Math.floor(o.prod || 0);
      return LK.t('act.gather', { n, unit: LK.prodUnit(p), name: LK.prodName(p) });
    },
    can: o => o.built && (o.prod || 0) >= 1,
    run(o, c) {
      const p = LK.FURNITURE[o.type].produce, n = Math.floor(o.prod || 0);
      if (n < 1) return false;
      o.prod -= n;
      c.cargo = c.cargo || LK.emptyCargo();
      c.cargo[p.cat][p.item] = (c.cargo[p.cat][p.item] || 0) + n;
      c.load = LK.cargoLoad(c.cargo);
      LK.log(LK.t('log.gathered', { who: c.name, n, unit: LK.prodUnit(p), name: LK.prodName(p) }), 'good');
      if (c.kind === 'player') c.say(LK.t('say.gathered', { n, unit: LK.prodUnit(p) }), 1.5);
      return true;
    }
  }
};

LK.prodName = p => p.cat === 'stock' ? LK.ingName(p.item) : LK.goodName(p.item);
LK.prodUnit = p => { if (p.unit) return p.unit; const u = p.cat === 'stock' ? (LK.INGREDIENTS[p.item] || {}).unit : ''; return u ? LK.tn('unit', u, u) : '×'; };
// the special actions object o offers to character c right now (keys)
LK.objActions = (o, c) => ((LK.FURNITURE[o.type] || {}).actions || []).filter(a => LK.OBJ_ACTIONS[a] && LK.OBJ_ACTIONS[a].can(o, c));
LK.actionLabel = (o, a) => LK.OBJ_ACTIONS[a] ? LK.OBJ_ACTIONS[a].label(o) : LK.t('item.' + a);

// ---------- production (every simulation step, main.js) ----------
LK.produceUpdate = function () {
  const S = LK.state;
  for (const o of S.world.objects) {
    const p = (LK.FURNITURE[o.type] || {}).produce;
    if (!p || !o.built) continue;
    if (o.prodNext == null) { o.prodNext = S.time + p.every; o.prod = o.prod || 0; continue; }
    let guard = 50;                                           // a long jump in time: catch up (bounded)
    while (S.time >= o.prodNext && guard-- > 0) {
      o.prodNext += p.every;
      LK.produceRoll(o, p);
    }
  }
};
LK.produceRoll = function (o, p) {
  const max = p.max || 1;
  if ((o.prod || 0) >= max) return 0;                         // full: this roll is lost
  if (p.needs) {                                               // inputs from the object's own store
    o.input = o.input || {};
    if (!Object.entries(p.needs).every(([k, n]) => (o.input[k] || 0) >= n)) return 0;
  }
  if (Math.random() >= (p.chance == null ? 1 : p.chance)) return 0;
  if (p.needs) for (const [k, n] of Object.entries(p.needs)) o.input[k] -= n;
  const a = p.amount || [1, 1], n = LK.rint(a[0], a[1]);
  const before = o.prod || 0;
  o.prod = Math.min(max, before + n);
  return o.prod - before;
};

// ---------- doing an action (owner and staff): job 'objAction' { target, act } ----------
LK.JOBS = LK.JOBS || {};
LK.JOBS.objAction = function (c, j) {
  const w = LK.state.world, o = j.target, A = LK.OBJ_ACTIONS[j.act];
  if (!A || !w.objects.includes(o) || !A.can(o, c)) return 'done';
  if (j.phase === 'go') {
    const def = LK.FURNITURE[o.type] || {};
    const goal = def.block ? LK.besideGoal(o) : (x, y) => Math.max(Math.abs(x - o.x), Math.abs(y - o.y)) <= 1 && w.walkable(x, y);
    const r = LK.jobGo(c, j, goal, o.x, o.y);
    if (r === 'fail') return 'fail';
    if (r) {
      j.phase = 'wait';
      c.faceTo(o.x + 0.5, o.y + 0.5);
      c.startWork(LK.skillTime(A.work || 2, c, A.skill || 'tinkering'), A.label(o), () => {
        if (w.objects.includes(o) && A.can(o, c)) { A.run(o, c); if (A.skill) c.gainXp(A.skill, 0.1); }
        j.phase = 'end';
      }, 'interact');
    }
  }
  return j.phase === 'end' ? 'done' : undefined;
};
// maintenance staff with nothing to fix: the nearest object with a staff action nobody else is doing
LK.findActionJob = function (c) {
  const S = LK.state;
  const taken = new Set(S.chars.filter(o => o !== c && o.job && o.job.type === 'objAction').map(o => o.job.target));
  let best = null, bd = 1e9;
  for (const o of S.world.objects) {
    if (taken.has(o)) continue;
    const act = LK.objActions(o, c).find(a => LK.OBJ_ACTIONS[a].staff);
    if (!act) continue;
    const d = LK.dist(c.x, c.y, o.x, o.y);
    if (d < bd) { bd = d; best = { target: o, act }; }
  }
  return best ? LK.newJob('objAction', best) : null;
};
// E on furniture with special actions that has none available now (an empty well…): a short reply instead of nothing / picking it up
LK.idleObjSay = function (p, o) {
  const def = LK.FURNITURE[o.type] || {};
  if (!(def.actions || []).length || LK.objActions(o, p).length) return false;
  if (!o.built) return false;                                  // a blueprint: E builds it (fix)
  p.say(def.produce ? LK.t('say.nothingYet', { name: LK.prodName(def.produce) }) : LK.t('say.nothingHere'), 1.5);
  return true;
};
// the owner: do action `act` on object o
LK.startObjAction = function (p, o, act) {
  if (!LK.OBJ_ACTIONS[act] || !LK.OBJ_ACTIONS[act].can(o, p)) return false;
  LK.dropJob(p);
  p.job = LK.newJob('objAction', { target: o, act });
  return true;
};
