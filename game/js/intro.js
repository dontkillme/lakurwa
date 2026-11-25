// La Kurwa - introduction mode: a bot plays the basics on the default map while a caption box explains each
// step and shows the key to press (main menu → Introduction). Player input is off; Esc / Skip ends it.
// Each step: { text: lang key, keys: [shown key caps], start(I), done(I) → true when finished, min: seconds }.
'use strict';

LK.INTRO_MIN_STEP = 3.2;          // every caption stays at least this long (seconds)

// the bot "presses" a key: a big key cap pops up over the owner
LK.introKey = function (key) {
  const p = LK.state.player;
  LK.fx.push({ type: 'key', x: p.x, y: p.y, t: 1.3, text: key });
};
function introSteps() {
  const S = () => LK.state, P = () => LK.state.player, W = () => LK.state.world;
  const walkTo = goal => { const p = P(); return p.goWhere(goal, p.tx, p.ty); };
  return [
    { text: 'intro.welcome', keys: [], min: 4.5 },
    { text: 'intro.move', keys: ['W', 'A', 'S', 'D'],
      start(I) { const p = P(), w = W(); const t = w.roomTiles('B').filter(([x, y]) => w.walkable(x, y) && !w.objAt(x, y)).sort((a, b) => LK.dist(b[0], b[1], p.tx, p.ty) - LK.dist(a[0], a[1], p.tx, p.ty))[0]; if (t) p.goTo(t[0], t[1]); },
      done: () => !P().path.length, min: 4 },
    { text: 'intro.guest', keys: [],
      start(I) {                                              // a guest comes in, sits down and wants to order
        const w = W(), seat = w.objsWithTag('seat', true).filter(o => !o.reserved && w.room(o.x, o.y) === 'B' && !w.objsWithTag('counter', true).some(c => LK.dist(c.x, c.y, o.x, o.y) < 1.5))
          .sort((a, b) => LK.dist(a.x, a.y, P().x, P().y) - LK.dist(b.x, b.y, P().x, P().y))[0] || w.objsWithTag('seat', true)[0];
        const ent = w.entrances()[0];
        const c = new LK.Char('client', { x: ent.inside[0], y: ent.inside[1] });
        Object.assign(c, { prefs: LK.makePrefs(), mood: 70, budget: 1.5, patience: 999, rounds: 1, exitX: 0, exitY: w.route[0], drunk: 0, visited: true });
        seat.reserved = c.id; c.seat = seat; c.goTo(seat.x, seat.y);
        c.ai = { state: 'toSeat' };
        S().chars.push(c);
        I.guest = c;
      },
      done: I => I.guest.ai.state === 'waiting' && I.guest.order, min: 3 },
    { text: 'intro.take', keys: ['E'],
      start(I) { I.walked = walkTo(LK.reachGoal(I.guest)); },
      done(I) {
        const p = P();
        if (p.path.length) return false;
        if (!I.pressed) { I.pressed = true; LK.introKey('E'); LK.interact(p); I.t = 0; }
        return I.guest.order && I.guest.order.state === 'bar';
      }, min: 3.5 },
    { text: 'intro.ticket', keys: [], min: 4.5 },
    { text: 'intro.mix', keys: ['E'],
      start(I) { const w = W(), counter = w.objsWithTag('counter', true).sort((a, b) => LK.dist(a.x, a.y, P().x, P().y) - LK.dist(b.x, b.y, P().x, P().y))[0];
        I.counter = counter; walkTo(LK.besideGoal(counter, true)) || walkTo(LK.besideGoal(counter)); I.pressed = false; },
      done(I) {
        const p = P();
        if (p.path.length) return false;
        if (!I.pressed) { I.pressed = true; LK.introKey('E'); LK.interact(p); }
        return I.guest.order && ['prep', 'carry'].includes(I.guest.order.state);
      }, min: 3 },
    { text: 'intro.deliver', keys: [],
      start(I) { I.money = S().money; },
      done: I => !I.guest.order && I.guest.ai.state === 'eating', min: 3 },
    { text: 'intro.paid', keys: [], min: 4.5 },
    { text: 'intro.staff', keys: ['H'], start() { LK.introKey('H'); LK.ui.toggle('staff'); }, min: 5.5, end() { LK.ui.close(); } },
    { text: 'intro.storage', keys: ['I'], start() { LK.introKey('I'); LK.ui.toggle('storage'); }, min: 5.5, end() { LK.ui.close(); } },
    { text: 'intro.menu', keys: ['M'], start() { LK.introKey('M'); LK.ui.toggle('menu'); }, min: 5.5, end() { LK.ui.close(); } },
    { text: 'intro.build', keys: ['B'], start() { LK.introKey('B'); LK.ui.toggleBuild(); }, min: 4.5, end() { if (LK.ui.buildMode) LK.ui.toggleBuild(); } },
    { text: 'intro.more', keys: ['F', 'F1', 'Esc'], min: 5.5 },
    { text: 'intro.end', keys: [], min: 4 }
  ];
}

LK.intro = null;
LK.introStart = function () {
  LK.mapId = LK.MAPS.default ? 'default' : LK.mapId;
  LK.newGame();
  if (LK.hideSplash) LK.hideSplash();
  const S = LK.state;
  S.chars = S.chars.filter(c => c.kind === 'player');
  S.nextMerchant = 1e12; S.prophetDay = S.day; S.nextRat = 1e12;
  LK.intro = { steps: introSteps(), i: -1, t: 0, saved: { spawner: LK.spawner } };
  if (document.body && document.body.classList) document.body.classList.add('intro');   // HUD / windows ignore clicks (style.css)
  LK.spawner = () => {};                                       // no random guests while the bot shows the basics
  LK.ui.setSpeed(1);
  LK.follow = true;
  LK.introNext();
};
LK.introNext = function () {
  const I = LK.intro;
  const old = I.steps[I.i];
  if (old && old.end) old.end(I);
  I.i++; I.t = 0;
  const st = I.steps[I.i];
  if (!st) { LK.introStop(true); return; }
  if (st.start) st.start(I);
  LK.introShow();
};
LK.introShow = function () {
  const I = LK.intro, st = I && I.steps[I.i];
  let el = document.getElementById('introBox');
  if (!el && document.body && document.body.appendChild && document.createElement) {
    el = document.createElement('div'); el.id = 'introBox'; document.body.appendChild(el);
  }
  if (!el) return;
  if (!st) { el.classList && el.classList.add('hidden'); return; }
  el.classList && el.classList.remove('hidden');
  el.innerHTML = '<div class="ihead">' + LK.t('intro.title') + ' <small>' + (I.i + 1) + ' / ' + I.steps.length + '</small></div>' +
    '<div class="itext">' + LK.t(st.text) + '</div>' +
    (st.keys.length ? '<div class="ikeys">' + st.keys.map(k => '<kbd>' + k + '</kbd>').join(' ') + '</div>' : '') +
    '<button id="introSkip">' + LK.t('intro.skip') + '</button>';
  const sk = el.querySelector && el.querySelector('#introSkip');
  if (sk) sk.onclick = () => LK.introStop(false);
};
// every LK.step (real seconds × game speed, like the simulation)
LK.introUpdate = function (dt) {
  const I = LK.intro;
  if (!I) return;
  I.t += dt;
  const st = I.steps[I.i];
  if (!st) return;
  if (I.t >= (st.min || LK.INTRO_MIN_STEP) && (!st.done || st.done(I))) LK.introNext();
  else if (I.t > 60) LK.introNext();                           // never get stuck
};
// end the introduction without starting anything (a new game / a loaded game replaces it)
LK.introAbort = function () {
  const I = LK.intro;
  if (!I) return;
  const st = I.steps[I.i];
  if (st && st.end) st.end(I);
  LK.spawner = I.saved.spawner;
  LK.intro = null;
  if (document.body && document.body.classList) document.body.classList.remove('intro');
  const el = document.getElementById('introBox');
  if (el && el.classList) el.classList.add('hidden');
};
LK.introStop = function (finished) {
  if (!LK.intro) return;
  LK.introAbort();
  LK.ui.close();
  if (LK.ui.buildMode) LK.ui.toggleBuild();
  LK.introFinished = !!finished;
  LK.newGame();
  if (LK.showSplash) LK.showSplash(false);
};
