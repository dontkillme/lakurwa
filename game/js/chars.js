// La Kurwa - characters: stats, skills, movement, combat, knock-outs, dragging
'use strict';

LK.BODY_RADIUS = 0.3;   // how close (in tiles) a freely moving character may get to a wall

LK.Char = class {
  constructor(kind, opt) {
    opt = opt || {};
    this.id = LK.uid();
    this.kind = kind;                 // player | employee | client | merchant
    const female = opt.female != null ? opt.female : Math.random() < 0.4;
    this.female = female;
    this.name = opt.name || (LK.pick(female ? LK.NAMES_F : LK.NAMES_M) + ' ' + LK.pick(LK.SURNAMES));
    this.sheet = opt.sheet || (female ? 'femalePerson' : 'malePerson');
    this.hue = opt.hue != null ? opt.hue : LK.pick([0, 0, 40, 90, 160, 220, 300]);
    this.x = (opt.x || 0) + 0.5; this.y = (opt.y || 0) + 0.5;
    this.str = opt.str || LK.rint(2, 8); this.sta = opt.sta || LK.rint(2, 8); this.int = opt.int || LK.rint(2, 8);
    this.skills = {};
    LK.SKILLS.forEach(s => this.skills[s] = (opt.skills && opt.skills[s]) || 0);
    this.recalc(); this.hp = this.maxHp; this.stam = this.maxStam;
    this.path = []; this.vx = 0; this.vy = 0;
    this.ko = 0; this.dragBy = null; this.dragging = null;
    this.anim = 'idle'; this.animT = Math.random() * 3; this.flip = false; this.back = false;
    this.work = null; this.job = null; this.carry = null; this.bubble = null;
    this.attackCd = 0; this.hurtT = 0; this.hostile = null; this.weapon = opt.weapon || null;
    this.task = opt.task || 'idle'; this.wage = opt.wage || 0;
    this.running = false; this.load = 0;
    this.ai = { state: 'idle' };
  }
  recalc() {
    this.maxHp = Math.round(20 + this.str * 5 + this.sta * 5);
    this.maxStam = Math.round(40 + this.sta * 10);
    this.carryCap = 10 + this.str * 5;          // kg before slowing down
  }
  get tx() { return Math.floor(this.x); }
  get ty() { return Math.floor(this.y); }
  get active() { return this.ko <= 0 && !this.dragBy; }
  isStaff() { return this.kind === 'employee' || this.kind === 'player'; }
  say(text, t) {
    t = t || 2.5;
    // the Order of the Holy Flame speaks slowly and solemnly: longer bubbles, long lines longer still
    if (this.kind === 'order') t = Math.max(t * LK.ORDER_SAY.factor, LK.ORDER_SAY.base + String(text).length * LK.ORDER_SAY.perChar);
    this.bubble = { text, t };
  }

  // ---- skills ----
  // speed factor of a task using `skill`; technical tasks also use intelligence
  speedFactor(skill) {
    let f = 1 + this.skills[skill] / 50;
    if (skill === 'tinkering' || skill === 'electric' || skill === 'vendor') f *= 1 + this.int * 0.05;
    return f;
  }
  gainXp(skill, amount) {
    const s = this.skills[skill];
    this.skills[skill] = Math.min(100, s + amount * (1 + this.int * 0.1) / (1 + s / 25));
  }
  weaponBonus() { return this.weapon ? (LK.GOODS[this.weapon].weapon || 0) : 0; }

  // ---- movement ----
  goTo(tx, ty) {
    const p = LK.state.world.pathTo(this.tx, this.ty, tx, ty);
    if (p === null) return false;
    this.path = p; return true;
  }
  goAdjacent(tx, ty, avoidSeats) {
    const w = LK.state.world;
    const p = w.findPath(this.tx, this.ty, (x, y) => {
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== 1 || !w.walkable(x, y)) return false;
      if (avoidSeats) { const o = w.objAt(x, y); if (o && LK.FURNITURE[o.type].tags.includes('seat')) return false; }
      return Math.abs(x - tx) + Math.abs(y - ty) === 1 ? w.edgeOkOnly(x, y, tx, ty) : !w.wallBetweenDiag(x, y, tx, ty);
    }, tx, ty);
    if (p === null) return false;
    this.path = p; return true;
  }
  findPathOk(t) { return LK.state.world.pathTo(this.tx, this.ty, t[0], t[1]) !== null; }
  goWhere(goalFn, hx, hy) {
    const p = LK.state.world.findPath(this.tx, this.ty, goalFn, hx, hy);
    if (p === null) return false;
    this.path = p; return true;
  }
  stop() { this.path = []; }
  baseSpeed() {
    let s = 2.4;
    if (this.load > this.carryCap) s *= Math.max(0.4, this.carryCap / this.load);
    if (this.dragging) s *= 0.55;
    if (this.kind === 'client' && this.drunk >= 3) s *= 0.8;
    if (this.speedMul) s *= this.speedMul;                    // rats: sneaking, fleeing, rushing
    return s;
  }
  update(dt) {
    const S = LK.state;
    this.animT += dt;
    if (this.frozen) { if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null; return; }   // in a scene (the rat's bat)
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.animLock > 0) this.animLock -= dt;
    if (this.ko > 0) {
      // unconscious: at least 60 s, half that near an aid kit
      const aid = S.world.nearestObj('aid', this.tx, this.ty);
      const near = aid && LK.dist(aid.x, aid.y, this.tx, this.ty) <= 1.6 && !this.dragBy;
      this.ko -= dt * (near ? 2 : 1);
      this.anim = 'down';
      if (this.ko <= 0) this.wake();
      return;
    }
    if (this.dragBy) return;
    // stamina: running and carrying too much drain it, resting regenerates
    let drain = 0;
    const moving = this.path.length || this.vx || this.vy;
    const overload = this.load > this.carryCap;
    let speed = this.baseSpeed();
    if (moving && this.running && this.stam > 3) { speed *= 1.7; drain += 12; }
    if (moving && overload) drain += 4;
    if (drain) this.stam = Math.max(0, this.stam - drain * dt / (1 + this.sta * 0.05));
    else this.stam = Math.min(this.maxStam, this.stam + (moving ? 4 : 8) * dt);
    if (!moving && this.hp < this.maxHp && !this.hostile) this.hp = Math.min(this.maxHp, this.hp + 0.15 * dt);

    if (this.path.length) {
      this.work = null;
      const [nx, ny] = this.path[0];
      const gx = nx + 0.5, gy = ny + 0.5;
      const dx = gx - this.x, dy = gy - this.y, d = Math.hypot(dx, dy);
      const step = speed * dt;
      if (d <= step) { this.x = gx; this.y = gy; this.path.shift(); }
      else { this.x += dx / d * step; this.y += dy / d * step; }
      this.face(dx, dy);
      this.anim = this.running && this.stam > 3 ? 'run' : 'walk';
    } else if (this.vx || this.vy) {
      this.moveFree(this.vx * speed * dt, this.vy * speed * dt);
      this.face(this.vx, this.vy);
      this.anim = this.running && this.stam > 3 ? 'run' : 'walk';
    } else if (this.work) {
      this.anim = this.work.anim || 'interact';
    } else if (this.anim === 'walk' || this.anim === 'run') this.anim = 'idle';

    if (this.dragging) {
      const v = this.dragging;
      v.x = this.x - (this.flip ? -0.35 : 0.35) * 0.7; v.y = this.y - 0.25;
      this.anim = this.path.length ? 'drag' : this.anim;
    }
    // work progress
    if (this.work && !this.path.length) {
      this.work.t += dt;
      if (this.work.t >= this.work.dur) {
        const w = this.work; this.work = null;
        if (w.onDone) w.onDone();
      }
    }
  }
  face(dx, dy) {
    const sx = dx - dy, sy = dx + dy;     // screen direction
    if (Math.abs(sx) > 0.01) this.flip = sx < 0;
    this.back = sy < -0.01 && Math.abs(sy) > Math.abs(sx) * 0.5;
  }
  faceTo(x, y) { this.face(x - this.x, y - this.y); this.back = false; }
  // free (keyboard) movement with wall/object collision
  moveFree(dx, dy) {
    const w = LK.state.world;
    const tryMove = (nx, ny) => {
      const ox = this.tx, oy = this.ty, ntx = Math.floor(nx), nty = Math.floor(ny);
      if (ntx === ox && nty === oy) { this.x = nx; this.y = ny; return true; }
      if (!w.inb(ntx, nty) || !w.canStep(ox, oy, ntx, nty)) return false;
      this.x = nx; this.y = ny; return true;
    };
    if (!tryMove(this.x + dx, this.y + dy)) { if (!tryMove(this.x + dx, this.y)) tryMove(this.x, this.y + dy); }
    this.keepOffWalls();
  }
  // body radius: stay this far from blocking edges (walls have thickness on screen)
  keepOffWalls() {
    const w = LK.state.world, r = LK.BODY_RADIUS, tx = this.tx, ty = this.ty;
    if (!w.canStep(tx, ty, tx, ty - 1)) this.y = Math.max(this.y, ty + r);
    if (!w.canStep(tx, ty, tx, ty + 1)) this.y = Math.min(this.y, ty + 1 - r);
    if (!w.canStep(tx, ty, tx - 1, ty)) this.x = Math.max(this.x, tx + r);
    if (!w.canStep(tx, ty, tx + 1, ty)) this.x = Math.min(this.x, tx + 1 - r);
  }
  startWork(dur, label, onDone, anim) { this.path = []; this.work = { t: 0, dur, label, onDone, anim }; }

  // ---- combat ----
  attack(target) {
    if (this.attackCd > 0 || !this.active || !target.active) return false;
    if (!LK.canHit(this, target)) return false;              // never through a wall
    if (this.stam < 5) { this.say(LK.t('say.pant'), 1); this.attackCd = 0.6; return false; }
    this.stam -= 7;
    this.attackCd = Math.max(0.55, 1.2 - this.skills.fighting * 0.006);
    this.atkAnim = LK.pick(['attack0', 'attack1', 'attack2', 'kick']); this.animLock = 0.35;
    this.faceTo(target.x, target.y);
    const hit = Math.random() < 0.65 + (this.skills.fighting - target.skills.fighting) / 200;
    this.gainXp('fighting', 0.4);
    target.gainXp('fighting', 0.2);
    if (!hit) { target.say(LK.t('say.missed'), 0.6); return true; }
    if (target.kind === 'rat') { LK.ratHit(target, this); return true; }   // a hit rat drops its food and runs
    if (target.invulnerable) {                               // the Order of the Holy Flame takes no damage
      LK.fx && LK.fx.push({ type: 'hit', x: target.x, y: target.y, t: 0.8, text: '0' });
      if (Math.random() < 0.5) target.say(LK.t('say.orderTaunt'), 1.5);
      if (LK.onHit) LK.onHit(this, target);
      return true;
    }
    const dmg = (2 + this.skills.fighting / 12 + this.weaponBonus()) * (0.6 + this.str * 0.12) * (0.8 + Math.random() * 0.4);
    target.hp -= dmg; target.hurtT = 0.3;
    LK.fx && LK.fx.push({ type: 'hit', x: target.x, y: target.y, t: 0.4, text: '-' + Math.round(dmg) });
    if (LK.onHit) LK.onHit(this, target);
    if (target.hp <= 0) LK.knockOut(target, this);
    return true;
  }
  wake() {
    this.ko = 0; this.hp = Math.max(1, Math.round(this.maxHp * 0.3)); this.anim = 'idle';
    this.say(LK.t(this.kind === 'client' ? 'say.wakeClient' : 'say.wakeStaff'));
    if (LK.onWake) LK.onWake(this);
  }
};

// can a hit you from where you stand? same or neighbouring tile and no wall in between
// (diagonal: at least one of the two L-shaped ways around the corner is open)
// someone climbing through a window is in the frame: reachable from both sides (both tiles count)
LK.canHit = function (a, t) {
  if (t.climb) return LK.canHitTile(a, t.climb.fx, t.climb.fy) || LK.canHitTile(a, t.climb.tx, t.climb.ty);
  return LK.canHitTile(a, t.tx, t.ty);
};
LK.canHitTile = function (a, bx, by) {
  const w = LK.state.world, ax = a.tx, ay = a.ty;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
  if (!dx && !dy) return true;
  if (!dx || !dy) return !w.wallBetween(ax, ay, bx, by);
  return !w.wallBetweenDiag(ax, ay, bx, by);
};
LK.ORDER_SAY = { factor: 1.8, base: 2, perChar: 0.08 };   // bubble seconds for the Order's soldiers

LK.knockOut = function (c, by) {
  const S = LK.state;
  if (c.invulnerable) return;
  c.hp = 0; c.ko = 60; c.path = []; c.work = null; c.hostile = null; c.job = null; c.vx = c.vy = 0;
  if (c.dragging) { c.dragging.dragBy = null; c.dragging = null; }
  if (c.carry) { LK.failOrder(c.carry, 'dropped'); c.carry = null; }
  for (const o of S.chars) if (o.hostile === c) o.hostile = null;
  LK.log(by ? LK.t('log.koBy', { name: c.name, by: by.name }) : LK.t('log.ko', { name: c.name }), 'bad');
  if (LK.onKO) LK.onKO(c, by);
};

// start dragging an unconscious character
LK.startDrag = function (dragger, victim) {
  if (victim.dragBy || dragger.dragging) return false;
  dragger.dragging = victim; victim.dragBy = dragger;
  return true;
};
LK.dropDrag = function (dragger) {
  const v = dragger.dragging;
  if (!v) return;
  v.dragBy = null; dragger.dragging = null;
  v.x = dragger.tx + 0.5 + (Math.random() - 0.5) * 0.3; v.y = dragger.ty + 0.5;
};

// generate a random job applicant with one stronger skill
LK.makeApplicant = function () {
  const main = LK.pick(['bartending', 'cooking', 'tinkering', 'electric', 'fighting', 'fighting', 'bartending', 'cooking']);
  const skills = {};
  LK.SKILLS.forEach(s => skills[s] = LK.rint(0, 12));
  skills[main] = LK.rint(15, 55);
  const c = new LK.Char('employee', { skills });
  if (main === 'fighting') c.str = Math.min(10, c.str + 2);
  if (main === 'tinkering' || main === 'electric') c.int = Math.min(10, c.int + 2);
  c.recalc(); c.hp = c.maxHp; c.stam = c.maxStam;
  c.task = { bartending: 'bartender', cooking: 'cook', tinkering: 'maintenance', electric: 'maintenance', fighting: 'security' }[main];
  c.wage = LK.wageFor(c);
  c.mainSkill = main;
  return c;
};
