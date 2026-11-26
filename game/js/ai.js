// La Kurwa - AI: orders, clients, employees, fights, the ring, merchant, spawning
'use strict';

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// ======================================================================
//  ORDERS
// ======================================================================
LK.placeOrder = function (client, recipe) {
  const o = { id: LK.uid(), client, recipe, kind: recipe.kind, state: 'placed', worker: null, t: 0 };
  LK.state.orders.push(o);
  client.order = o;
  return o;
};
LK.removeOrder = o => { LK.state.orders = LK.state.orders.filter(q => q !== o); };
LK.failOrder = function (o, reason) {
  if (!o || o.state === 'done' || o.state === 'failed') return;
  o.state = 'failed';
  LK.removeOrder(o);
  if (o.worker && o.worker.carry === o) o.worker.carry = null;
  const c = o.client;
  if (c && c.order === o) {
    c.order = null;
    if (reason === 'stock') { c.mood -= 15; c.say(LK.t('say.outOfStock')); }
    if (reason === 'dropped') { c.mood -= 8; c.say(LK.t('say.whereOrder')); }
    if (c.ai.state === 'waiting') c.ai = { state: 'seated', thinkT: 3 };
  }
};
// worker c stops working on order o (knocked out, fired, away, task changed, job dropped …): someone else can take it.
// Half-made orders (prep / cooking / carry) give their ingredients back and return to the counter ('bar' = already
// taken, just mix it) or the kitchen. keepCarry: an order c carries stays with him (the owner delivers it with E).
LK.releaseOrder = function (o, c, keepCarry) {
  if (!o || o.state === 'done' || o.state === 'failed' || !LK.state.orders.includes(o)) return;
  if (c && o.worker !== c && c.carry !== o) return;          // someone else's order by now
  if (keepCarry && o.state === 'carry' && c && c.carry === o) return;
  if (['prep', 'cooking', 'carry'].includes(o.state)) LK.refundOrder(o);
  if (o.worker && o.worker.carry === o) o.worker.carry = null;
  if (c && c.carry === o) c.carry = null;
  if (['prep', 'cooking', 'cooking-wait', 'carry'].includes(o.state)) o.state = o.kind === 'drink' ? 'bar' : 'kitchen';
  o.worker = null;
};
// drop what character c is doing right now and release its order (the owner keeps what he carries)
// a rescue (drag job) that ended before the colleague got to the aid kit: someone else may rescue him
const rescueEnded = j => { if (j && j.type === 'drag' && !j.delivered && j.victim) j.victim.rescued = false; };
LK.dropJob = function (c) {
  rescueEnded(c.job);
  if (c.job && c.job.order) LK.releaseOrder(c.job.order, c, c.kind === 'player');
  if (c.carry && c.kind !== 'player') LK.releaseOrder(c.carry, c);
  if (c.dragging && c.kind !== 'player') LK.dropDrag(c);    // staff drag only as a job (the owner drags by hand with E)
  c.job = null; c.work = null;
};
LK.deliverOrder = function (o, worker) {
  const S = LK.state, c = o.client, r = o.recipe;
  LK.removeOrder(o);
  o.state = 'done';
  if (worker && worker.carry === o) worker.carry = null;
  if (!c || !c.active || c.order !== o) { worker && worker.say(LK.t('say.nobodyToServe')); return; }
  c.order = null;
  // payment
  S.money += r.price; S.today.income += r.price; S.today.served++;
  r.soldToday = (r.soldToday || 0) + 1;                      // shown in the menu window
  // the owner made it himself: 1-5 % bonus, at most 10 M
  let bonus = 0;
  if (o.preparedBy && o.preparedBy.kind === 'player') {
    bonus = Math.min(10, Math.round(r.price * (0.01 + Math.random() * 0.04) * 10) / 10);
    S.money += bonus; S.today.income += bonus; S.today.bonus = (S.today.bonus || 0) + bonus;
  }
  // a bartender's tips: his vendor skill (up to LK.TIP.max of the price), only from guests who liked it
  let tip = 0;
  if (worker && worker.kind === 'employee' && worker.task === 'bartender') {
    const like = LK.prefScore(c.prefs, r) * 18 + 6 + LK.clamp((c.budget - r.price / LK.fairPrice(r)) * 18, -25, 12);
    if (like > 0) tip = Math.round(r.price * LK.TIP.max * Math.min(100, worker.skills.vendor) / 100 * 10) / 10;
    if (tip >= 0.5) { S.money += tip; S.today.income += tip; S.today.tips = (S.today.tips || 0) + tip; worker.gainXp('vendor', 0.15); } else tip = 0;
  }
  LK.fx.push({ type: 'money', x: c.x, y: c.y, t: 1.2, text: '+' + r.price + (bonus ? ' (+' + bonus + ' bonus)' : '') + (tip ? ' (+' + LK.fmt(tip) + ' ' + LK.t('label.tip') + ')' : '') });
  // satisfaction
  const pref = LK.prefScore(c.prefs, r);
  const ratio = r.price / LK.fairPrice(r);
  const portion = LK.clamp((LK.recipeTotal(r) - (r.kind === 'drink' ? 0.6 : 0.7)) * 8, -10, 8);
  const quality = ((o.quality || 0.6) - 0.6) * 30;
  const priceDelta = LK.clamp((c.budget - ratio) * 18, -25, 12);
  const waitPenalty = c.ai.waitT > c.patience * 0.5 ? -5 : 4;
  const delta = 6 + pref * 18 + portion + quality + priceDelta + waitPenalty;
  c.mood = LK.clamp(c.mood + delta, 0, 100);
  c.drunk = (c.drunk || 0) + LK.recipeAlcohol(r);
  c.lastKind = r.kind;
  c.say(LK.t(delta > 15 ? 'say.tasteGreat' : delta > 4 ? 'say.tasteGood' : delta > -5 ? 'say.tasteMeh' : 'say.tasteBad'), 2.5);
  c.ai = { state: 'eating', eatT: LK.rint(12, 30), waitT: 0 };
  if (worker) worker.gainXp(r.kind === 'drink' ? 'bartending' : 'cooking', 0.5);
};
// can `w` (at tile x,y) hand something to client c?  (directly or across a counter)
// tiles (ax,ay) and (bx,by) are neighbours with no wall between them (straight or around the corner)
LK.openNeighbour = function (ax, ay, bx, by) {
  const w = LK.state.world;
  if (cheb(ax, ay, bx, by) !== 1) return false;
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1 ? w.edgeOkOnly(ax, ay, bx, by) : !w.wallBetweenDiag(ax, ay, bx, by);
};
LK.reachGoal = function (c) {
  const w = LK.state.world, cx = c.tx, cy = c.ty;
  // across a counter: no wall between the guest and the counter, nor between the counter and the worker
  const counters = w.objsWithTag('counter', true).filter(o => LK.openNeighbour(o.x, o.y, cx, cy));
  return (x, y) => {
    if (!w.walkable(x, y)) return false;
    if (cheb(x, y, cx, cy) === 1 && (Math.abs(x - cx) + Math.abs(y - cy) === 1 ? w.edgeOkOnly(x, y, cx, cy) : !w.wallBetweenDiag(x, y, cx, cy))) return true;
    return counters.some(o => LK.openNeighbour(x, y, o.x, o.y) && !(x === cx && y === cy));
  };
};
LK.canReach = (worker, c) => LK.reachGoal(c)(worker.tx, worker.ty);

// goal fn: stand next to object o (not on a seat)
// strict: also avoid the guests' side (tiles with a seat right next to them) - "behind the counter"
const hasSeat = (w, x, y) => { const q = w.objAt(x, y); return q && LK.FURNITURE[q.type].tags.includes('seat'); };
LK.besideGoal = function (o, strict) {
  const w = LK.state.world;
  return (x, y) => {
    if (cheb(x, y, o.x, o.y) !== 1 || !w.walkable(x, y)) return false;
    if (hasSeat(w, x, y)) return false;
    if (strict && (hasSeat(w, x + 1, y) || hasSeat(w, x - 1, y) || hasSeat(w, x, y + 1) || hasSeat(w, x, y - 1))) return false;
    return Math.abs(x - o.x) + Math.abs(y - o.y) === 1 ? w.edgeOkOnly(x, y, o.x, o.y) : !w.wallBetweenDiag(x, y, o.x, o.y);
  };
};
LK.isBeside = (c, o) => LK.besideGoal(o)(c.tx, c.ty);

// ======================================================================
//  FURNITURE DAMAGE
// ======================================================================
// all damage to furniture goes through here; at 0 hp the piece is destroyed
LK.damageObject = function (o, amount) {
  const w = LK.state.world;
  if (!o || !w.objects.includes(o)) return false;
  o.hp = Math.max(0, o.hp - amount);
  if (o.hp <= 0) { LK.destroyObject(o); return true; }
  return false;
};
LK.destroyObject = function (o) {
  const S = LK.state, w = S.world, def = LK.FURNITURE[o.type] || { name: o.type };
  if (o.queue && LK.benchRefundAll) LK.benchRefundAll(o);   // a workbench: its queue goes back into the storage
  w.removeObject(o);
  w.decals.push({ x: o.x, y: o.y, type: 'debris', t: 0 });
  for (const c of S.chars) {
    if (c.seat === o) {                                   // the guest sitting on it falls off
      LK.releaseSeat(c);
      c.mood -= 10; c.say(LK.t('say.myChair'));
      // waiting / eating guests just keep standing there; others look for a new seat
      if (c.ai.state === 'seated' || c.ai.state === 'toSeat') { c.ai = { state: 'seek' }; c.path = []; }
    }
    if (c.job && (c.job.target === o || c.job.stove === o || c.job.counter === o)) LK.dropJob(c);
  }
  LK.log(LK.t('log.destroyed', { name: LK.furnName(o.type) }), 'bad');
  if (LK.ui && LK.ui.buildMode) LK.ui.renderBuildBar();
};

// ======================================================================
//  JOBS  (used by employees AND by the players via the interact key)
// ======================================================================
// walk helper: returns 'fail' | false (walking) | true (arrived)
function go(c, j, goal, hx, hy) {
  if (goal(c.tx, c.ty) && !c.path.length) { j.pathed = false; return true; }
  if (!j.pathed) {
    if (!c.goWhere(goal, hx, hy)) return 'fail';
    j.pathed = true;
  }
  if (c.path.length) return false;
  j.pathed = false;
  return goal(c.tx, c.ty) ? true : 'fail';
}
function skillTime(base, c, skill) { return base / c.speedFactor(skill); }
LK.jobGo = go; LK.skillTime = skillTime;                    // for jobs defined in other files (craft.js)

LK.JOBS = {
  // take an order at the counter; drinks are mixed and delivered, dishes go to the kitchen
  // take an order and (for drinks) mix it at the counter, then deliver.
  //  phases: go (to counter) -> take -> taken -> mix -> carry
  //  j.skipTake: the order was already taken (state 'bar'), only mix + deliver
  //  phase 'takeHere': a player takes the order at the guest; it goes onto the order tray (state 'bar'/'kitchen')
  serve(c, j) {
    const o = j.order;
    if (o.state === 'failed' || o.state === 'done' || !o.client.active) { if (o.worker === c) o.worker = null; return 'done'; }
    // a new order: first walk to the guest (next to him, or across the counter) and note it down there
    if (j.phase === 'go' && !j.skipTake) j.phase = 'toGuest';
    if (j.phase === 'toGuest') {
      const r = go(c, j, LK.reachGoal(o.client), o.client.tx, o.client.ty);
      if (r === 'fail') {
        if ((j.retries = (j.retries || 0) + 1) <= 2 && o.client.active) { j.pathed = false; return; }   // he moved: try again
        o.worker = null; return 'fail';
      }
      if (r) {
        c.faceTo(o.client.x, o.client.y);
        j.phase = 'wait';
        c.startWork(skillTime(1.5, c, 'bartending'), LK.t('work.takeOrder'), () => j.phase = 'noted');
      }
      return;
    }
    if (j.phase === 'noted') {
      o.client.say(LK.t('say.oneItem', { item: o.recipe.name }), 1.5);
      c.gainXp('bartending', 0.2);
      if (o.kind === 'dish') { o.state = 'kitchen'; o.worker = null; return 'done'; }   // the cook takes it from here
      o.state = 'bar';                                            // noted down: now behind the counter to mix it
      j.skipTake = true; j.phase = 'go'; j.goal = null; j.pathed = false;
      return;
    }
    if (j.phase === 'go') {
      const counter = j.counter || (j.counter = LK.state.world.nearestObj('counter', o.client.tx, o.client.ty));
      if (!counter) { c.say(LK.t('say.needCounter')); o.worker = null; return 'fail'; }
      if (!j.goal) j.goal = LK.besideGoal(counter, true)(c.tx, c.ty) || c.kind === 'player' || LK.state.world.findPath(c.tx, c.ty, LK.besideGoal(counter, true), counter.x, counter.y) === null ? LK.besideGoal(counter) : LK.besideGoal(counter, true);
      const r = go(c, j, j.goal, counter.x, counter.y);
      if (r === 'fail') { o.worker = null; return 'fail'; }
      if (r) {
        if (j.skipTake) j.phase = 'taken';
        else { j.phase = 'wait'; c.startWork(skillTime(1.5, c, 'bartending'), LK.t('work.takeOrder'), () => j.phase = 'taken'); }
      }
    } else if (j.phase === 'takeHere') {
      c.faceTo(o.client.x, o.client.y);
      j.phase = 'wait';
      c.startWork(skillTime(1.5, c, 'bartending'), LK.t('work.takeOrder'), () => j.phase = 'tray');
    } else if (j.phase === 'tray') {
      // the order is noted down: anyone (player, bartender, cook) can now make it
      o.byPlayer = c.kind === 'player';
      o.takenBy = c;
      o.worker = null;
      o.state = o.kind === 'dish' ? 'kitchen' : 'bar';
      o.client.say(LK.t('say.oneItem', { item: o.recipe.name }), 1.5);
      c.gainXp('bartending', 0.2);
      return 'done';
    } else if (j.phase === 'taken') {
      if (!j.skipTake) {
        o.client.say(LK.t('say.oneItem', { item: o.recipe.name }), 1.5);
        if (o.kind === 'dish') { o.state = 'kitchen'; o.worker = null; c.gainXp('bartending', 0.2); return 'done'; }
      }
      if (!LK.consumeFor(o)) { LK.failOrder(o, 'stock'); c.say(LK.t('say.weAreOut')); return 'done'; }
      o.state = 'prep';
      o.preparedBy = c;
      o.quality = LK.clamp(0.45 + c.skills.bartending / 150 + Object.keys(o.recipe.parts).length * 0.04, 0, 1.2);
      j.phase = 'wait';
      c.startWork(skillTime(2.5 + LK.recipeTotal(o.recipe) * 1.5, c, 'bartending'), LK.t('work.mixing', { item: o.recipe.name }), () => {
        if (o.state === 'failed') { j.phase = 'carry'; return; }   // the guest left meanwhile: deliver ends at once (o.state stays failed)
        o.state = 'carry'; c.carry = o; j.phase = 'carry';
      });
    } else if (j.phase === 'carry') return LK.JOBS.deliver(c, j);
  },
  // cook a dish ordered in the kitchen, then deliver it
  cook(c, j) {
    const o = j.order;
    if (o.state === 'failed' || o.state === 'done' || !o.client.active) { if (o.worker === c) o.worker = null; return 'done'; }
    if (j.phase === 'go') {
      const st = j.stove;
      if (!st || !st.built || st.hp <= 0 || !LK.state.world.objects.includes(st)) { o.worker = null; o.state = 'kitchen'; return 'fail'; }
      const r = go(c, j, LK.besideGoal(st), st.x, st.y);
      if (r === 'fail') { o.worker = null; o.state = 'kitchen'; return 'fail'; }
      if (r) {
        if (!LK.consumeFor(o)) { LK.failOrder(o, 'stock'); c.say(LK.t('say.noIngredients')); return 'done'; }
        o.state = 'cooking';
        o.preparedBy = c;
        const fresh = LK.state.world.objsWithTag('fresh', true).length ? 0.1 : 0;
        o.quality = LK.clamp(0.4 + c.skills.cooking / 140 + fresh + Object.keys(o.recipe.parts).length * 0.04, 0, 1.3);
        j.phase = 'wait';
        const speed = LK.FURNITURE[st.type].speed || 1;
        c.startWork(skillTime(6 + LK.recipeTotal(o.recipe) * 4, c, 'cooking') / speed, LK.t('work.cooking', { item: o.recipe.name }), () => {
          if (o.state === 'failed') { j.phase = 'carry'; return; }   // the guest left meanwhile
          o.state = 'carry'; c.carry = o; j.phase = 'carry'; c.gainXp('cooking', 0.4);
        }, 'interact');
      }
    } else if (j.phase === 'carry') return LK.JOBS.deliver(c, j);
  },
  deliver(c, j) {
    const o = j.order;
    if (!o.client.active || o.state === 'failed') { c.carry = null; return 'done'; }
    const now = LK.state.simT;                                 // simulation time: the same at every speed (was: -1/60 per call)
    if (j.goalAt == null || now >= j.goalAt) { j.goalAt = now + 1.5; j.pathed = false; c.path = []; } // client may move
    const r = go(c, j, LK.reachGoal(o.client), o.client.tx, o.client.ty);
    if (r === 'fail') { if ((j.tries = (j.tries || 0) + 1) > 5) { LK.failOrder(o, 'dropped'); return 'fail'; } return; }
    if (r) { c.faceTo(o.client.x, o.client.y); LK.deliverOrder(o, c); return 'done'; }
  },
  // build a blueprint, repair a damaged object, or clean a mess
  fix(c, j) {
    const t = j.target, w = LK.state.world;
    if (j.decal) {
      if (!w.decals.includes(t)) return 'done';
      if (j.phase === 'go') {
        const r = go(c, j, (x, y) => cheb(x, y, t.x, t.y) <= 1 && w.walkable(x, y), t.x, t.y);
        if (r === 'fail') return 'fail';
        if (r && LK.isDeadRat(t)) { j.phase = 'wait'; c.startWork(LK.RAT.pickTime, LK.t('work.ratPick'), () => { LK.pickDeadRat(c, t); j.phase = 'end'; }); }   // rat meat into his hands
        else if (r) { j.phase = 'wait'; c.startWork(skillTime(4, c, 'tinkering'), LK.t('work.cleaning'), () => { w.decals = w.decals.filter(d => d !== t); c.gainXp('tinkering', 0.1); j.phase = 'end'; }); }
      }
      return j.phase === 'end' ? 'done' : undefined;
    }
    if (!w.objects.includes(t) || (t.built && t.hp >= 100 && !t.dirty)) return 'done';
    const def = LK.FURNITURE[t.type], skill = def.tech || 'tinkering';
    if (j.phase === 'go') {
      const goal = def.block ? LK.besideGoal(t) : (x, y) => cheb(x, y, t.x, t.y) <= 1 && w.walkable(x, y);
      const r = go(c, j, goal, t.x, t.y);
      if (r === 'fail') return 'fail';
      if (r) {
        j.phase = 'wait';
        let dur, label;
        const quick = !t.built && t.crafted;                // crafted at the workbench: set up in a few seconds
        if (!t.built) { dur = (def.work || 4) * 2; label = LK.t('work.building', { name: LK.furnName(t.type) }); }
        else if (t.dirty) { dur = 4; label = LK.t('work.scrubbing', { name: LK.furnName(t.type) }); }
        else { dur = (100 - t.hp) / 10 + 1; label = LK.t('work.repairing', { name: LK.furnName(t.type) }); }
        // electric devices need at least a bit of electric skill
        if (skill === 'electric' && c.skills.electric < 5) dur *= 2.5;
        c.startWork(quick ? LK.CRAFT.placeTime : skillTime(dur, c, skill), label, () => {
          if (!t.built) { t.built = true; LK.log(LK.t('log.built', { who: c.name, name: LK.furnName(t.type) }), 'good'); }
          t.hp = 100; t.dirty = 0;
          c.gainXp(skill, 0.8);
          j.phase = 'end';
        }, 'interact');
      }
    }
    return j.phase === 'end' ? 'done' : undefined;
  },
  // drag an unconscious body somewhere
  drag(c, j) {
    const v = j.victim, w = LK.state.world;
    if (j.phase === 'go') {
      if (v.ko <= 0 || (v.dragBy && v.dragBy !== c)) return 'done';
      const r = go(c, j, (x, y) => cheb(x, y, v.tx, v.ty) <= 1 && w.walkable(x, y), v.tx, v.ty);
      if (r === 'fail') return 'fail';
      if (r) {
        if (!LK.startDrag(c, v)) return 'done';
        j.phase = 'drag';
        c.say(v.kind === 'client' ? LK.t('say.outYouGo') : LK.t('say.hangOn', { name: v.name.split(' ')[0] }));
      }
    } else if (j.phase === 'drag') {
      if (!c.dragging) return 'done';
      const r = go(c, j, j.dest, j.hx, j.hy);
      if (r === 'fail') { LK.dropDrag(c); return 'fail'; }
      if (r) { LK.dropDrag(c); j.delivered = true; if (v.kind === 'client') { v.thrownOut = true; } return 'done'; }
    }
  },
  ring(c, j) {
    const S = LK.state, f = j.fighter;
    if (S.ring || !f.hostile || !f.active) return 'done';
    if (j.phase === 'go') {
      const r = go(c, j, (x, y) => cheb(x, y, f.tx, f.ty) <= 2 && S.world.walkable(x, y), f.tx, f.ty);
      if (r === 'fail') return 'fail';
      if (r) {
        j.phase = 'wait';
        c.say(LK.t('say.ring'));
        c.startWork(skillTime(2.5, c, 'tinkering'), LK.t('work.ring'), () => { LK.makeRing(f); j.phase = 'end'; });
      }
    }
    return j.phase === 'end' ? 'done' : undefined;
  },
  escort(c, j) {
    const v = j.client;
    if (!v.active || v.kind !== 'client' || ['leaving', 'toExit', 'travel', 'fight'].includes(v.ai.state)) return 'done';
    const r = go(c, j, (x, y) => cheb(x, y, v.tx, v.ty) === 1 && LK.state.world.walkable(x, y), v.tx, v.ty);
    if (r === 'fail') return 'fail';
    if (r) {
      c.say(LK.t('say.throwOut'));
      if (Math.random() < 0.25 + (v.drunk || 0) * 0.04) { v.hostile = c; v.say(LK.t('say.makeMe')); LK.fightStarted(v); }
      else { v.mood -= 5; v.say(LK.t('say.fineFine')); LK.clientLeave(v); }
      return 'done';
    }
  },
  // bartender's trip to the merchant: buy what is low, carry it into the storage
  restock(c, j) {
    const S = LK.state, w = S.world, m = j.merchant;
    if (j.phase === 'go') {
      if (!m || !LK.merchantList().includes(m) || m.state !== 'wait' || !m.active) { j.phase = 'carry'; return; }
      const r = go(c, j, (x, y) => cheb(x, y, m.tx, m.ty) <= 1 && w.walkable(x, y), m.tx, m.ty);
      if (r === 'fail') return 'fail';
      if (r) {
        if (!m.shop) m.shop = LK.makeMerchantStock(c.skills.vendor);      // his vendor skill decides what the merchant shows
        j.phase = 'wait';
        c.faceTo(m.x, m.y);
        c.startWork(LK.RESTOCK.tradeTime, LK.t('work.trading'), () => {
          const plan = LK.planRestock(c, m.shop);
          for (const [it, n] of plan.items) LK.buy(it, c, n);
          const items = plan.items.map(([it, n]) => n + '× ' + (it.cat === 'stock' ? LK.ingName(it.key) : LK.goodName(it.key))).join(', ');
          LK.log(items ? LK.t('log.restockBought', { name: c.name, items, cost: plan.cost }) : LK.t('log.restockNothing', { name: c.name }), items ? 'good' : 'warn');
          if (LK.ui && LK.ui.panel === 'shop') LK.ui.renderPanel();
          j.phase = 'carry';
        }, 'interact');
      }
      return;
    }
    if (j.phase === 'carry') {
      if (!c.cargo || c.load <= 0) return 'done';
      if (w.room(c.tx, c.ty) === 'S' && !c.path.length) { LK.unloadCargo(c); return 'done'; }
      const r = go(c, j, (x, y) => w.room(x, y) === 'S' && w.walkable(x, y) && !w.objAt(x, y), ...(w.roomTiles('S')[0] || [c.tx, c.ty]));
      if (r === 'fail') return 'fail';
      if (r) { LK.unloadCargo(c); return 'done'; }
    }
  },
  wander(c, j) {
    if (j.phase === 'go') {
      if (!j.dest) return 'done';
      const r = go(c, j, (x, y) => x === j.dest[0] && y === j.dest[1], j.dest[0], j.dest[1]);
      if (r === 'fail') return 'fail';
      if (r) { j.phase = 'wait'; c.startWork(LK.rint(3, 7), '', () => j.phase = 'end', 'idle'); }
    }
    return j.phase === 'end' ? 'done' : undefined;
  }
};
LK.runJob = function (c) {
  const j = c.job;
  if (!j || c.work) return;
  const r = LK.JOBS[j.type](c, j);
  if (r === 'done' || r === 'fail') {
    rescueEnded(j);
    if (r === 'fail' && j.order) LK.releaseOrder(j.order, c, c.kind === 'player');
    c.job = null;
  }
};
LK.newJob = (type, data) => Object.assign({ type, phase: 'go', pathed: false }, data);

// ======================================================================
//  EMPLOYEES
// ======================================================================
LK.employeeAI = function (c, dt) {
  if (!c.active) return;
  if (c.trip && LK.supplyAI(c)) return;                     // on a supply trip (supplies.js)
  const S = LK.state, w = S.world;
  if (c.hostile) { if (c.job && c.job.type !== 'drag') LK.dropJob(c); LK.fightStep(c, dt); return; }
  if (c.job || c.work) { LK.runJob(c); if (c.job) return; }
  // a restock trip (LK.startRestock) or goods still on his back: that first
  if (c.restockFor) { const m = c.restockFor; c.restockFor = null; c.say(LK.t('say.restockGo'), 2); c.job = LK.newJob('restock', { merchant: m }); return; }
  if (c.load > 0 && c.cargo) { c.job = LK.newJob('restock', { phase: 'carry' }); return; }
  c.thinkT = (c.thinkT || 0) - dt;
  if (c.thinkT > 0) return;
  c.thinkT = 0.4;

  // 1. rescue knocked-out colleagues (everyone helps, security last)
  const downed = S.chars.find(v => v.isStaff() && v !== c && v.ko > 0 && !v.dragBy && !v.rescued &&
    !S.chars.some(o => o.job && o.job.type === 'drag' && o.job.victim === v));
  if (downed && (c.task !== 'security' || !S.chars.some(o => o.kind === 'employee' && o.task !== 'security' && o.active && !o.hostile))) {
    const aid = w.nearestObj('aid', downed.tx, downed.ty);
    let dest, hx, hy;
    if (aid) { dest = (x, y) => cheb(x, y, aid.x, aid.y) === 1 && w.walkable(x, y); hx = aid.x; hy = aid.y; }
    else { const st = w.roomTiles('S'); dest = (x, y) => w.room(x, y) === 'S' && w.walkable(x, y); hx = st.length ? st[0][0] : c.tx; hy = st.length ? st[0][1] : c.ty; }
    downed.rescued = true;
    c.job = LK.newJob('drag', { victim: downed, dest, hx, hy });
    return;
  }
  const t = c.task;
  if (t === 'bartender') {
    // already-taken drinks (e.g. noted down by the owner) first, then new orders
    const o = S.orders.filter(o => (o.state === 'placed' || o.state === 'bar') && !o.worker).sort((a, b) => (b.state === 'bar') - (a.state === 'bar') || a.id - b.id)[0];
    if (o) { o.worker = c; c.idleFail = false; c.job = LK.newJob('serve', { order: o, skipTake: o.state === 'bar' }); return; }
    // dishes ready but cook is busy? the cook delivers them himself
    const counter = w.nearestObj('counter', c.tx, c.ty);
    if (counter && !LK.besideGoal(counter, true)(c.tx, c.ty) && !c.path.length && !c.idleFail) {
      if (!c.goWhere(LK.besideGoal(counter, true), counter.x, counter.y)) c.idleFail = true;
    }
    return;
  } else if (t === 'cook') {
    const o = S.orders.find(o => o.state === 'kitchen' && !o.worker);
    if (o) {
      const st = w.nearestObj('cook', c.tx, c.ty);
      if (st) { o.worker = c; o.state = 'cooking-wait'; c.job = LK.newJob('cook', { order: o, stove: st }); return; }
      if (!c.bubble) c.say(LK.t('say.noStove'));
    }
    const st = w.nearestObj('cook', c.tx, c.ty);
    if (st && !LK.isBeside(c, st) && !c.path.length) c.goAdjacent(st.x, st.y, true);
    return;
  } else if (t === 'maintenance') {
    const job = LK.findFixJob(c) || (LK.findActionJob && LK.findActionJob(c)) || (LK.findCraftJob && LK.findCraftJob(c));   // nothing to fix: gather (produce.js), then the workbench queue
    if (job) { c.job = job; return; }
  } else if (t === 'security') {
    if (LK.securityAI(c)) return;
  }
  // idle: wander around the bar from time to time
  if (!c.path.length && Math.random() < 0.08) {
    const room = t === 'cook' ? 'K' : 'B';
    const dest = w.randomFree(room, (x, y) => !S.chars.some(o => o !== c && o.tx === x && o.ty === y));
    if (dest) c.job = LK.newJob('wander', { dest });
  }
};
LK.findFixJob = function (c) {
  const S = LK.state, w = S.world;
  const taken = new Set(S.chars.filter(o => o !== c && o.job && o.job.type === 'fix').map(o => o.job.target));
  let best = null, bd = 1e9;
  const consider = (target, decal, prio) => {
    if (taken.has(target)) return;
    const d = LK.dist(c.x, c.y, target.x, target.y) - prio;
    if (d < bd) { bd = d; best = { target, decal }; }
  };
  for (const o of w.objects) {
    if (!o.built) consider(o, false, 20);
    else if (o.hp < 100 || o.dirty) consider(o, false, 10);
  }
  for (const d of w.decals) if (w.isBar(d.x, d.y) || LK.isDeadRat(d)) consider(d, true, 5);   // dead rats: anywhere (meat)
  return best ? LK.newJob('fix', best) : null;
};

// ======================================================================
//  SECURITY
// ======================================================================
LK.securityAI = function (c) {
  const S = LK.state, w = S.world;
  const busy = new Set(S.chars.filter(o => o !== c && o.job).map(o => o.job.victim || o.job.client || o.job.fighter || o.job.thief));
  // a thief was spotted: get him
  const thief = S.chars.filter(o => LK.knownThief(o) && o.active).sort((a, b) => LK.dist(a.x, a.y, c.x, c.y) - LK.dist(b.x, b.y, c.x, c.y))[0];
  if (thief) { if (c.job) LK.dropJob(c); c.hostile = thief; c.say(LK.t('say.stopThief')); return true; }
  // a rat in the building (not the altar's guardian): chase it off
  if (!LK.altarActive()) {           // stocked altar: the rats are friends
    const rat = S.chars.find(o => o.kind === 'rat' && !o.guardian && o.active && LK.ratCatchable(o) && w.isBar(o.tx, o.ty) && LK.dist(o.x, o.y, c.x, c.y) < 8);
    if (rat) { c.hostile = rat; c.say(LK.t('say.ratChase')); return true; }
  }
  // a knocked-out thief: call the Order of the Holy Flame to take him away
  const downThief = S.chars.find(o => LK.canCallOrder(o) && !busy.has(o));
  if (downThief) { c.job = LK.newJob('callOrder', { thief: downThief, tries: 0 }); return true; }
  // a fight is going on
  const aggressors = S.chars.filter(o => o.kind === 'client' && o.hostile && o.active && w.isBar(o.tx, o.ty) || (o.kind === 'client' && o.hostile && o.hostile.isStaff() && o.active));
  if (aggressors.length) {
    // build the ring if we own ring poles
    const ringF = aggressors.find(a => a.hostile && a.hostile.kind !== 'player' && a.hostile !== c && !a.thief && !a.hostile.thief);
    if (ringF && !S.ring && (S.goods.ringpoles || 0) > 0 && !S.chars.some(o => o.job && o.job.type === 'ring')) {
      c.job = LK.newJob('ring', { fighter: ringF });
      return true;
    }
    // otherwise stop the aggressors (fighters inside the ring are left alone)
    const targets = aggressors.filter(a => !(S.ring && S.ring.ids.includes(a.id)) || (a.hostile && a.hostile.isStaff()));
    if (targets.length) {
      targets.sort((a, b) => LK.dist(a.x, a.y, c.x, c.y) - LK.dist(b.x, b.y, c.x, c.y));
      c.hostile = targets[0];
      c.say(LK.t('say.breakUp'));
      return true;
    }
  }
  // throw out unconscious troublemakers
  const ko = S.chars.find(o => o.kind === 'client' && o.ko > 0 && !o.dragBy && !LK.knownThief(o) && w.isBar(o.tx, o.ty) && !busy.has(o) && !(S.ring && S.ring.ids.includes(o.id)));
  if (ko) {
    const ent = w.entrances()[0];
    if (ent) {
      const route = w.route[0];
      const [ox, oy] = ent.outside;
      const ty = oy < route ? route - 1 : route + 1;
      c.job = LK.newJob('drag', { victim: ko, dest: (x, y) => x === ox && y === ty && w.walkable(x, y) || (cheb(x, y, ox, ty) <= 1 && !w.isInside(x, y) && w.walkable(x, y)), hx: ox, hy: ty });
      return true;
    }
  }
  // escort annoying (drunk / grumpy) clients out
  const annoying = S.chars.find(o => o.kind === 'client' && o.active && !o.hostile && w.isBar(o.tx, o.ty) && !busy.has(o) &&
    ((o.drunk || 0) >= 4 || (o.mood < 25 && o.ai.state !== 'eating')) && !['leaving', 'toExit'].includes(o.ai.state));
  if (annoying) { c.job = LK.newJob('escort', { client: annoying }); return true; }
  // stand guard at the post the player chose (if he can get there), otherwise next to the entrance
  const gp = c.guardPost;
  if (gp && w.walkable(gp.x, gp.y)) {
    if (c.path.length || (c.tx === gp.x && c.ty === gp.y)) return true;
    const someone = S.chars.some(o => o !== c && o.tx === gp.x && o.ty === gp.y);
    if (someone && cheb(c.tx, c.ty, gp.x, gp.y) <= 1) return true;             // close enough while someone stands there
    if (someone ? c.goWhere((x, y) => cheb(x, y, gp.x, gp.y) === 1 && w.walkable(x, y), gp.x, gp.y) : c.goTo(gp.x, gp.y)) return true;
  }
  const ent = w.entrances()[0];
  if (ent && !c.path.length) {
    const [ix, iy] = ent.inside;
    if (cheb(c.tx, c.ty, ix, iy) > 1) {
      c.goWhere((x, y) => cheb(x, y, ix, iy) === 1 && w.isBar(x, y) && w.walkable(x, y) && !w.objAt(x, y), ix, iy);
      return true;
    }
  }
  return true;
};

// ======================================================================
//  FIGHTS & THE RING
// ======================================================================
LK.fightStep = function (c, dt) {
  const t = c.hostile;
  if (!t || !t.active || t.kind === 'gone') { c.hostile = null; c.path = []; return; }
  const d = LK.dist(c.x, c.y, t.x, t.y);
  // in reach: 1.3 tiles, or standing still on a diagonal neighbour tile (1.41 apart; goAdjacent would not move)
  // and never through a wall: if one is in the way, walk around to a tile next to him
  const reach = (d <= 1.3 || !c.path.length && (Math.max(Math.abs(c.tx - t.tx), Math.abs(c.ty - t.ty)) === 1 || t.climb && d <= 1.6)) && LK.canHit(c, t);
  if (!reach) {
    c.repathT = (c.repathT || 0) - dt;
    if (c.repathT <= 0 || !c.path.length) {
      c.repathT = 0.6;
      c.running = d > 4;
      // a thief climbing through a window: go to the closer side of it
      let gx = t.tx, gy = t.ty;
      if (t.climb && LK.dist(c.x, c.y, t.climb.fx + 0.5, t.climb.fy + 0.5) < LK.dist(c.x, c.y, t.climb.tx + 0.5, t.climb.ty + 0.5)) { gx = t.climb.fx; gy = t.climb.fy; }
      else if (t.climb) { gx = t.climb.tx; gy = t.climb.ty; }
      if (!c.goAdjacent(gx, gy)) { c.hostile = null; c.path = []; }
    }
  } else {
    c.path = []; c.running = false;
    c.attack(t);
  }
};
LK.onHit = function (a, t) {
  const S = LK.state;
  if (t.climb && LK.thiefStopClimb) LK.thiefStopClimb(t);      // hit while climbing through a window: that's over
  if (t.kind === 'prophet') { LK.prophetHit(t); return; }      // he does not fight, he runs
  if (t.kind === 'merchant') { t.say(LK.t('say.merchantLeaving')); t.leaveAt = S.time; return; }
  // fight back (players never act on their own)
  if (t.kind !== 'player' && t.active && !t.hostile && t.hp > 0) {
    t.hostile = a;
    if (t.kind === 'client') { t.mood = Math.min(t.mood, 20); LK.fightStarted(t); }
  }
  if (a.kind === 'client') LK.fightStarted(a);
  // bystanders get scared (unless it happens in the ring)
  const inRing = S.ring && S.ring.ids.includes(a.id);
  if (!inRing) for (const o of S.chars) if (o.kind === 'client' && o !== a && o !== t && LK.dist(o.x, o.y, a.x, a.y) < 6) o.mood -= 0.8;
};
LK.fightStarted = function (c) {
  if (c.fightStart) return;
  c.fightStart = LK.state.simT;
  LK.state.today.fights++;
  c.ai.state = 'fight';
  if (c.order) LK.failOrder(c.order);
  LK.releaseSeat(c);
};
// keep a fighter inside the ropes - but never onto a blocked tile or through a wall
const ringClamp = (c, x0, x1, y0, y1) => {
  const nx = LK.clamp(c.x, x0, x1), ny = LK.clamp(c.y, y0, y1);
  if (nx === c.x && ny === c.y) return;
  const w = LK.state.world, tx = Math.floor(nx), ty = Math.floor(ny);
  if ((tx === c.tx && ty === c.ty) || (cheb(tx, ty, c.tx, c.ty) === 1 && w.walkable(tx, ty) && w.canStep(c.tx, c.ty, tx, ty))) { c.x = nx; c.y = ny; }
};
LK.makeRing = function (f) {
  const S = LK.state;
  const opp = f.hostile;
  const cx = Math.round((f.x + (opp ? opp.x : f.x)) / 2), cy = Math.round((f.y + (opp ? opp.y : f.y)) / 2);
  S.ring = { x: cx, y: cy, r: 1.6, ids: [f.id].concat(opp ? [opp.id] : []), t: 0 };
  S.goods.ringpoles = Math.max(0, (S.goods.ringpoles || 0)); // poles are reusable
  LK.log(LK.t('log.ringUp'), 'good');
  for (const id of S.ring.ids) {
    const c = S.chars.find(o => o.id === id);
    if (c) ringClamp(c, cx - 1, cx + 1.9, cy - 1, cy + 1.9);
  }
};
// runs every frame
LK.fightDirector = function (dt) {
  const S = LK.state;
  const anyFight = S.chars.some(c => c.hostile && c.active);
  if (!anyFight && !S.ring) { if (S.cheering) { for (const c of S.chars) c.cheer = false; S.cheering = false; } return; }   // nothing to direct
  S.cheering = true;
  const fighters = S.chars.filter(c => c.hostile && c.active);
  // ring
  if (S.ring) {
    const R = S.ring;
    R.t += dt;
    const inR = R.ids.map(id => S.chars.find(c => c.id === id)).filter(Boolean);
    // fighters stay inside the ropes
    for (const c of inR) if (c.active) ringClamp(c, R.x - 0.9, R.x + 1.9, R.y - 0.9, R.y + 1.9);
    const done = inR.length < 2 || inR.some(c => c.ko > 0) || !inR.some(c => c.hostile) || R.t > 45;
    if (done) {
      const winner = inR.find(c => c.active);
      if (winner) {
        winner.hostile = null; winner.mood = Math.min(100, (winner.mood || 50) + 30); winner.fightStart = null;
        winner.say(LK.t('say.whoIsNext'));
        if (winner.kind === 'client') { winner.ai = { state: 'seek' }; }
      }
      for (const c of inR) c.hostile = null;
      LK.log(winner ? LK.t('log.ringWin', { name: winner.name }) : LK.t('log.ringOver'), 'good');
      S.ring = null;
    } else {
      // the crowd loves it
      for (const c of S.chars) {
        if (c.kind !== 'client' || R.ids.includes(c.id) || !c.active) continue;
        if (LK.state.world.isBar(c.tx, c.ty)) {
          c.mood = Math.min(100, c.mood + (c.mood < 40 ? 4 : 1) * dt);
          c.cheer = true;
        }
      }
    }
  }
  for (const c of S.chars) if (!S.ring) c.cheer = false;
  // brawls spread if nobody contains them
  S.brawlT = (S.brawlT || 0) - dt;
  if (S.brawlT <= 0) {
    S.brawlT = 1;
    const loose = fighters.filter(c => !(S.ring && S.ring.ids.includes(c.id)) && c.kind === 'client' && !c.thief && !(c.hostile && c.hostile.thief));   // thief fights don't spread: guests step away
    const contained = S.chars.some(c => c.kind === 'employee' && c.task === 'security' && c.active && c.hostile);
    for (const f of loose) {
      if (S.simT - f.fightStart < 6 || contained) continue;   // fights older than 6 s spread
      for (const o of S.chars) {
        if (o.kind !== 'client' || o.hostile || !o.active || o.inTent || o.mood > 55 || LK.dist(o.x, o.y, f.x, f.y) > 6) continue;   // a tenant in his tent doesn't see it
        if (Math.random() < 0.12) {
          o.hostile = Math.random() < 0.5 ? f : (f.hostile || f);
          if (o.hostile === o) o.hostile = f;
          o.say(LK.t('say.brawl'));
          LK.fightStarted(o);
        }
      }
    }
  }
};

// ======================================================================
//  CLIENTS
// ======================================================================
// how likely a traveller stops: { total, rep, decor, size, decorN, tiles } (LK.APPEAL)
LK.stopChance = function () {
  const S = LK.state, w = S.world, A = LK.APPEAL;
  const decorN = w.objsWithTag('decor', true).filter(o => !o.dirty && w.isBar(o.x, o.y)).length;   // built, whole, clean, inside
  const tiles = LK.barSize();
  const rep = A.base + S.rep * A.perRep;
  const decor = A.decorMax * (1 - Math.exp(-decorN / A.decorScale));
  const size = A.sizeMax * (1 - Math.exp(-Math.max(0, tiles - A.sizeFrom) / A.sizeScale));
  return { total: LK.clamp(rep + decor + size, A.min, A.max), rep, decor, size, decorN, tiles };
};
// forceThief: dev / tests - this guest is a thief and goes to the bar
LK.makeClient = function (forceThief) {
  const S = LK.state, w = S.world;
  const fromW = Math.random() < 0.5;
  const row = LK.pick(w.route);
  const c = new LK.Char('client', { x: fromW ? 0 : w.W - 1, y: row });
  c.prefs = LK.makePrefs();
  c.mood = LK.rint(50, 70);
  c.budget = LK.GUEST_BUDGET.min + Math.random() * (LK.GUEST_BUDGET.max - LK.GUEST_BUDGET.min);
  c.patience = LK.rint(45, 100);
  c.rounds = Math.random() < 0.3 ? LK.rint(3, 6) : LK.rint(1, 2);
  c.longStay = c.rounds > 2;
  c.drunk = 0;
  c.exitX = fromW ? w.W - 1 : 0; c.exitY = LK.pick(w.route);
  const ent = w.entrances()[0];
  const wantStop = ent && (forceThief || Math.random() < LK.stopChance().total) && w.objsWithTag('counter', true).length;
  if (wantStop && c.goTo(ent.inside[0], ent.inside[1])) { c.ai = { state: 'toBar' }; if (forceThief || Math.random() < LK.THIEF.chance) LK.makeThief(c); }
  else { c.goTo(c.exitX, c.exitY); c.ai = { state: 'travel' }; }
  S.chars.push(c);
  return c;
};
LK.releaseSeat = function (c) {
  if (c.seat) { c.seat.reserved = null; c.seat = null; }
};
LK.clientLeave = function (c) {
  const S = LK.state;
  if (LK.tenantLeave && LK.tenantLeave(c)) return;            // a tenant goes back to his tent instead
  LK.releaseSeat(c);
  if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); }
  if (!c.recorded && c.visited) {
    c.recorded = true;
    S.rep = LK.clamp(S.rep * 0.9 + LK.clamp(c.mood, 0, 100) * 0.1, 0, 100);
    S.today.clients++;
    if (LK.maybeGiftPlan) LK.maybeGiftPlan(c);               // a happy guest may leave a plan (craft.js)
  }
  c.ai = { state: 'toExit' };
  c.path = [];
};
LK.chooseRecipe = function (c) {
  const S = LK.state;
  const wantFood = !c.ateFood && Math.random() < 0.45;
  let best = null, bs = -1e9;
  for (const r of S.recipes) {
    if (!r.enabled || !LK.canMake(r)) continue;
    const ratio = r.price / LK.fairPrice(r);
    if (ratio > c.budget * LK.GUEST_BUDGET.maxRatio) continue;     // too expensive for this guest
    let s = LK.prefScore(c.prefs, r) * 2 + (c.budget - ratio) + Math.random() * 0.6;
    if ((r.kind === 'dish') === wantFood) s += 0.8;
    if (s > bs) { bs = s; best = r; }
  }
  return best;
};
LK.getAngry = function (c) {
  const S = LK.state, w = S.world;
  const counter = w.nearestObj('counter', c.tx, c.ty);
  const table = w.nearestObj('table', c.tx, c.ty);
  const opts = [['leave', 45], ['fight', 22 + (c.drunk || 0) * 6]];
  if (counter && w.isBar(c.tx, c.ty)) opts.push(['throw', 14]);
  const tent = LK.angryTent(c);
  if (table && w.isBar(c.tx, c.ty) || tent) opts.push(['piss', 12]);
  if (tent) opts.push(['wreck', 10]);
  let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), act = 'leave';
  for (const [k, v] of opts) { if ((r -= v) <= 0) { act = k; break; } }
  if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); }
  if (act === 'leave') { c.say(LK.t('say.leaveAngry')); LK.clientLeave(c); }
  else if (act === 'fight') {
    const staff = S.chars.filter(o => o.isStaff() && o.active && LK.dist(o.x, o.y, c.x, c.y) < 12);
    const others = S.chars.filter(o => o.kind === 'client' && o !== c && o.active && !o.inTent && LK.dist(o.x, o.y, c.x, c.y) < 6);
    const t = staff.length && Math.random() < 0.6 ? LK.pick(staff) : others.length ? LK.pick(others) : staff[0];
    if (!t) { LK.clientLeave(c); return; }
    c.say(LK.t('say.fightAngry'));
    c.hostile = t; LK.fightStarted(c);
  } else if (act === 'throw') {
    // wind up (clientAI 'throw'), then LK.launchCup (fx.js) sends the mug flying
    c.say(LK.t('say.throwCup'), 2.2);
    c.ai = { state: 'throw', t: 0, target: counter };
    c.faceTo(counter.x + 0.5, counter.y + 0.5);
    LK.log(LK.t('log.cupThrown', { name: c.name }), 'bad');
  } else if (act === 'piss') {
    LK.startPiss(c, table, tent);
  } else if (act === 'wreck') {
    LK.releaseSeat(c);
    c.say(LK.t('say.wreck'), 2);
    LK.log(LK.t('log.tentWreck', { name: c.name }), 'bad');
    c.ai = { state: 'wreck', tent };
    if (!c.goAdjacent(tent.x, tent.y)) LK.clientLeave(c);
  }
};
// the piss easter egg: on the table, or on a rental tent (also used by the dev tool); false if there is nothing to piss on
LK.startPiss = function (c, table, tent) {
  const w = LK.state.world;
  if (table === undefined) table = w.nearestObj('table', c.tx, c.ty);
  if (tent === undefined) tent = LK.angryTent ? LK.angryTent(c) : null;
  if (!table && !tent) return false;
  if (c.order) { const o = c.order; c.order = null; LK.failOrder(o); }
  LK.releaseSeat(c);
  c.say(LK.t('say.unzip'));
  const onTent = tent && (!table || !w.isBar(c.tx, c.ty) || Math.random() < 0.5);   // a rental tent will do too
  const target = onTent ? tent : table;
  c.ai = onTent ? { state: 'piss', tent } : { state: 'piss', table };
  if (!c.goAdjacent(target.x, target.y)) { LK.clientLeave(c); return false; }
  return true;
};
LK.clientAI = function (c, dt) {
  const S = LK.state, w = S.world, a = c.ai;
  if (!c.active) return;
  if (c.hostile) { c.dodge = null; LK.fightStep(c, dt); return; }
  if (c.dodge) { LK.dodgeAI(c, dt); return; }                 // stepping away from a thief fight (thief.js)
  if (c.thief && LK.thiefAI(c, dt)) return;                   // thieves (thief.js)
  if (c.tenant && LK.tenantAI(c, dt)) return;                 // tenants of a rental tent (tents.js)
  if (a.state === 'wreck') { LK.wreckAI(c, dt); return; }       // angry: kicking a tent
  if (a.state === 'fight') {
    // fight over: the winner calms down a bit, then leaves
    c.fightStart = null;
    c.say(LK.t('say.hmph')); LK.clientLeave(c); return;
  }
  if (c.thrownOut) { c.thrownOut = false; c.mood = Math.min(c.mood, 15); LK.clientLeave(c); return; }
  // general mood drift inside the bar
  if (w.isBar(c.tx, c.ty)) {
    c.visited = true;
    c.moodT = (c.moodT || 0) - dt;
    if (c.moodT <= 0) {
      c.moodT = 2;
      c.mood += LK.ambience(c) * 2;
      if ((c.drunk || 0) >= 3 && Math.random() < 0.15) c.say(LK.t('say.drunk'));
    }
  }
  c.mood = LK.clamp(c.mood, 0, 100);
  switch (a.state) {
    case 'travel':
      if (!c.path.length) {
        if (cheb(c.tx, c.ty, c.exitX, c.exitY) <= 1) { c.kind = 'gone'; return; }
        if (!c.goTo(c.exitX, c.exitY)) c.kind = 'gone';
      }
      break;
    case 'toBar':
      if (!c.path.length) {
        if (w.isBar(c.tx, c.ty)) { a.state = 'seek'; c.visited = true; LK.maybeRentTent(c); }
        else { c.goTo(c.exitX, c.exitY); a.state = 'travel'; }
      }
      break;
    case 'seek': {
      const seats = w.objsWithTag('seat', true).filter(o => !o.reserved && w.room(o.x, o.y) === 'B' &&
        !S.chars.some(q => q !== c && q.active && q.tx === o.x && q.ty === o.y));
      seats.sort((p, q) => LK.dist(p.x, p.y, c.x, c.y) - LK.dist(q.x, q.y, c.x, c.y));
      const seat = seats.find(s => c.goTo(s.x, s.y));
      if (seat) { seat.reserved = c.id; c.seat = seat; a.state = 'toSeat'; }
      else {
        const t = w.randomFree('B', (x, y) => !S.chars.some(q => q.tx === x && q.ty === y));
        if (t) c.goTo(t[0], t[1]);
        if (a.standT == null) { a.standT = 0; c.say(LK.t('say.noSeats')); }   // the time standing counts on across re-seeks
        a.state = 'stand';
      }
      break;
    }
    case 'stand':
      a.standT += dt; c.mood -= 0.4 * dt;
      if (a.standT > 25) { c.say(LK.t('say.forgetIt')); LK.clientLeave(c); }
      else if (!c.path.length && Math.random() < dt * 0.5) {
        // standing guests may still order at the counter
        if (!c.order && a.standT > 3 && LK.canReachCounter(c)) { const r = LK.chooseRecipe(c); if (r) { LK.placeOrder(c, r); c.ai = { state: 'waiting', waitT: 0 }; break; } }
        a.state = 'seek';
      }
      break;
    case 'toSeat':
      if (!c.path.length) {
        if (c.seat && c.tx === c.seat.x && c.ty === c.seat.y) { c.ai = { state: 'seated', thinkT: S.ring ? 1 : LK.rint(2, 5) }; }
        else { LK.releaseSeat(c); a.state = 'seek'; }
      }
      break;
    case 'seated':
      a.thinkT -= dt;
      if (a.thinkT <= 0) {
        const r = LK.chooseRecipe(c);
        if (!r) { c.mood -= 12; c.say(LK.t(S.recipes.some(q => q.enabled) ? 'say.tooPricey' : 'say.emptyMenu')); LK.clientLeave(c); break; }
        LK.placeOrder(c, r);
        c.say(LK.t('say.callService'), 1.5);
        c.ai = { state: 'waiting', waitT: 0 };
      }
      break;
    case 'waiting':
      a.waitT += dt * (S.ring ? 0.4 : 1);
      if (a.waitT > c.patience * 0.5) c.mood -= dt * 14 / c.patience;
      if (a.waitT > c.patience || c.mood < 12) { c.mood = Math.min(c.mood, 20); LK.getAngry(c); }
      break;
    case 'eating':
      a.eatT -= dt;
      if (a.eatT <= 0) {
        if (c.lastKind === 'dish') c.ateFood = true;
        c.rounds--;
        if ((c.rounds > 0 || (S.ring && Math.random() < 0.6)) && c.mood > 35) c.ai = { state: 'seated', thinkT: S.ring ? 1 : LK.rint(3, 8) };
        else { c.say(LK.t(c.mood > 65 ? 'say.byeGreat' : c.mood > 40 ? 'say.bye' : 'say.neverAgain')); LK.clientLeave(c); }
      }
      break;
    case 'throw':
      // angry guest: the throw itself is handled by fx.js (LK.startThrow), then the guest leaves
      a.t += dt;
      if (!a.started) { a.started = true; LK.startThrow(c, a.target, true); }
      if (a.t >= LK.CUP.windup + 1.2 && !c.throwing) { c.mood += 10; LK.clientLeave(c); }
      break;
    case 'piss':
      if (!c.path.length && !c.work) {
        c.startWork(4, '', () => {
          w.decals.push({ x: c.tx, y: c.ty, type: 'puddle', t: 0 });
          if (a.table) a.table.dirty = 1;
          if (a.tent && w.objects.includes(a.tent)) {
            a.tent.dirty = 1;
            if (a.tent.rent && a.tent.rent.tenant) a.tent.rent.tenant.mood -= 10;
            LK.damageObject(a.tent, LK.TENT.pissDmg);
          }
          LK.log(LK.t(a.tent ? 'log.pissedTent' : 'log.pissed', { name: c.name }), 'bad');
          c.mood += 15;
          LK.clientLeave(c);
        }, 'interact');
      }
      break;
    case 'toExit':
      if (!c.path.length) {
        if (cheb(c.tx, c.ty, c.exitX, c.exitY) <= 1 || c.tx === 0 || c.tx === w.W - 1) { c.kind = 'gone'; return; }
        if (!c.goTo(c.exitX, c.exitY)) { c.failExit = (c.failExit || 0) + 1; if (c.failExit > 3) c.kind = 'gone'; }
      }
      break;
    case 'leaving': LK.clientLeave(c); break;
  }
};
LK.canReachCounter = function (c) {
  return LK.state.world.objsWithTag('counter', true).some(o => cheb(o.x, o.y, c.tx, c.ty) === 1);
};
// how nice is it around this client? (-1..+1 per tick)
LK.ambience = function (c) {
  const S = LK.state, w = S.world;
  let s = 0;
  for (const o of w.objects) {
    const d = LK.dist(o.x, o.y, c.tx, c.ty);
    if (d > 5) continue;
    const def = LK.FURNITURE[o.type];
    if (!o.built) { s -= 0.05; continue; }
    if (o.hp < 50) s -= 0.1;
    if (o.dirty) s -= 0.3;
    if (def.tags.includes('decor')) s += 0.08;
    if (def.tags.includes('music')) s += 0.15;
    if (def.tags.includes('light') && LK.darkness() > 0.2) s += 0.1;
  }
  for (const d of w.decals) if (LK.dist(d.x, d.y, c.tx, c.ty) < 4) s -= 0.4;
  if (LK.darkness() > 0.3 && !w.objsWithTag('light', true).some(o => LK.dist(o.x, o.y, c.tx, c.ty) < (LK.FURNITURE[o.type].light || 2))) s -= 0.2;
  return LK.clamp(s, -1, 0.6);
};

// ======================================================================
//  MERCHANT
// ======================================================================
// Several merchants may wait at the same time (S.merchants); each has his own goods (m.shop), spot (m.spot)
// and leaving time (m.leaveAt). Visits: LK.MERCHANT (data.js) - one every game day, sometimes followed by more.
LK.MERCHANT_LOOKS = [{ sheet: 'maleAdventurer', hue: 30 }, { sheet: 'femaleAdventurer', female: true, hue: 300 }, { sheet: 'maleAdventurer', hue: 160 }];
LK.merchantList = () => LK.state.merchants || (LK.state.merchants = []);
// the waiting merchant closest to c (within `range` tiles), or null
LK.nearMerchant = function (c, range) {
  let best = null, bd = range == null ? 1e9 : range;
  for (const m of LK.merchantList()) {
    if (m.state !== 'wait' || !m.active) continue;
    const d = LK.dist(c.x, c.y, m.x, m.y);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
};
// where the next merchant stands: the map's merchant spot, else the nearest free outside tile 2+ tiles from the others
LK.merchantSpotFor = function () {
  const w = LK.state.world, sp = w.def.merchantSpot || { x: 1, y: w.route[0] };
  const taken = LK.merchantList().map(m => m.spot).filter(Boolean);
  const free = (x, y) => w.inb(x, y) && w.walkable(x, y) && !w.isBar(x, y) && !w.objAt(x, y) &&
    taken.every(([tx, ty]) => Math.max(Math.abs(tx - x), Math.abs(ty - y)) >= 2);
  let best = null, bd = 1e9;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = sp.x + dx, y = sp.y + dy, d = Math.hypot(dx, dy * 1.5);     // rather along the road than across it
    if (d < bd && free(x, y)) { bd = d; best = [x, y]; }
  }
  return best;
};
// a merchant walks in from the road now (null: all spots taken)
LK.spawnMerchant = function () {
  const S = LK.state, w = S.world, M = LK.MERCHANT, list = LK.merchantList();
  if (list.length >= M.max) return null;
  const spot = LK.merchantSpotFor();
  if (!spot) return null;
  const used = new Set(list.map(m => m.look));
  const look = LK.MERCHANT_LOOKS.findIndex((l, i) => !used.has(i)), L = LK.MERCHANT_LOOKS[Math.max(0, look)];
  const names = LK.tList('name.merchants');
  const m = new LK.Char('merchant', { name: names[Math.max(0, look) % names.length], sheet: L.sheet, female: !!L.female, hue: L.hue, x: 0, y: w.route[0], str: 8, sta: 8, skills: { fighting: 40 } });
  m.recalc(); m.hp = m.maxHp;
  m.look = Math.max(0, look); m.spot = spot;
  m.goTo(spot[0], spot[1]);
  m.shop = null; m.state = 'arrive'; m.leaveAt = S.time + M.stay;
  list.push(m); S.chars.push(m);
  LK.log(LK.t(list.length > 1 ? 'log.merchantAnother' : 'log.merchantComing', { name: m.name }), 'good');
  return m;
};
// game time of the first merchant of the next game day (days start at 06:00)
LK.nextMerchantDay = function () {
  const S = LK.state, M = LK.MERCHANT, k = Math.floor((S.time - 360) / 1440) + 1;
  return k * 1440 + LK.rint(M.arrive[0] * 60, M.arrive[1] * 60);
};
LK.merchantAI = function (dt) {
  const S = LK.state, w = S.world, M = LK.MERCHANT, list = LK.merchantList();
  if (S.time >= S.nextMerchant) {
    if (list.length >= M.max || !LK.spawnMerchant()) S.nextMerchant = S.time + 30;   // no free spot: a bit later
    else {
      const k = S.merchantChain = (S.merchantChain || 0) + 1;           // how many came in this visit so far
      if (Math.random() < (M.extra[k - 1] || 0)) S.nextMerchant = S.time + LK.rint(M.extraDelay[0], M.extraDelay[1]);
      else { S.merchantChain = 0; S.nextMerchant = LK.nextMerchantDay(); }
    }
  }
  for (const m of list) {
    if (m.ko > 0) continue;
    if (m.state === 'arrive' && !m.path.length) { m.state = 'wait'; m.say(LK.t('say.trade'), 4); LK.startRestock(m); }
    if (m.state === 'wait') {
      if (!m.restockDone) LK.startRestock(m);
      if (Math.random() < dt * 0.05) m.say(LK.t('say.merchantAd'), 3);
      if (S.time >= m.leaveAt) { m.state = 'leave'; m.goTo(w.W - 1, w.route[0]); m.say(LK.t('say.seeYou')); if (LK.ui) LK.ui.closeShop(m); }
    }
    if (m.state === 'leave' && !m.path.length) m.kind = 'gone';
  }
  if (list.some(m => m.kind === 'gone' || !S.chars.includes(m))) S.merchants = list.filter(m => m.kind !== 'gone' && S.chars.includes(m));
};

// ======================================================================
//  SPAWNING
// ======================================================================
LK.spawner = function (dt) {
  const S = LK.state;
  const h = LK.hour();
  const hf = h < 6 ? 0.25 : h < 11 ? 0.6 : h < 14 ? 1.0 : h < 18 ? 0.7 : 1.35;
  const rate = hf * (0.04 + S.rep * 0.0009);
  let clients = 0; for (const c of S.chars) if (c.kind === 'client') clients++;
  if (clients < 28 && Math.random() < rate * dt) LK.makeClient();
};
