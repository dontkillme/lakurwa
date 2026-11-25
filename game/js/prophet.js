// La Kurwa - the crazy prophet. Once a day he walks to a spot on the road near the bar's entrance and preaches
// until the evening: end-of-the-world nonsense mixed with real hints about the game. He never goes into the bar.
// E next to him = a hint right away. Hit him and he runs off. Dev: X / LK.dev.callProphet().
'use strict';

LK.PROPHET = {
  arrive: [9, 12],          // he comes between these hours ...
  leave: 19,                // ... and leaves at this hour
  sayEvery: [7, 13],        // seconds between his lines
  hintShare: 0.65,          // the rest is nonsense
  spotRange: 7              // his spot: on the road, this close to the entrance
};
// his lines: lang keys prophet.hint1, hint2 … and prophet.weird1 … - counted in English (every language has the same keys),
// so a new line only needs the next number in the language files
LK.prophetCount = pool => { const L = (LK.LANGS && LK.LANGS.en) || {}; let n = 0; while (('prophet.' + pool + (n + 1)) in L) n++; return n; };
Object.defineProperty(LK, 'PROPHET_HINTS', { get: () => LK.prophetCount('hint'), configurable: true });
Object.defineProperty(LK, 'PROPHET_WEIRD', { get: () => LK.prophetCount('weird'), configurable: true });

LK.isProphet = c => !!(c && c.kind === 'prophet');
// one of his lines: a hint (not one of the last few) or nonsense
LK.prophetLine = function (p, hint) {
  p.recent = p.recent || [];
  const pool = hint ? 'hint' : 'weird', n = hint ? LK.PROPHET_HINTS : LK.PROPHET_WEIRD;
  let i, tries = 0;
  do { i = LK.rint(1, n); } while (p.recent.includes(pool + i) && tries++ < 20);
  p.recent.push(pool + i); if (p.recent.length > 6) p.recent.shift();
  return LK.t('prophet.' + pool + i);
};
LK.prophetSay = function (p, hint) {
  p.say(LK.prophetLine(p, hint != null ? hint : Math.random() < LK.PROPHET.hintShare), 4.5);
  p.preachT = 1.2;                                            // arms up while he shouts
};
// where he stands: a free road tile near the entrance (outside, not right in the door)
LK.prophetSpot = function () {
  const w = LK.state.world, ent = w.entrances()[0];
  if (!ent) return null;
  const [ox, oy] = ent.outside, R = LK.PROPHET.spotRange;
  let best = null, bd = 1e9;
  for (let y = oy - R; y <= oy + R; y++) for (let x = ox - R; x <= ox + R; x++) {
    if (!w.inb(x, y) || w.room(x, y) !== '.' || !w.walkable(x, y) || w.objAt(x, y)) continue;
    const d = Math.abs(x - ox) + Math.abs(y - oy);
    if (d < 3) continue;                                      // not in the doorway
    const score = d + (w.route.includes(y) ? 0 : 1.5) + (w.route.includes(y) && w.route.length > 1 && y !== w.route[0] ? 0 : 0);
    if (score < bd) { bd = score; best = [x, y]; }
  }
  return best;
};
LK.spawnProphet = function () {
  const S = LK.state, w = S.world;
  if (S.prophet && S.chars.includes(S.prophet)) return S.prophet;
  const spot = LK.prophetSpot();
  if (!spot) return null;
  const fromW = spot[0] < w.W / 2;
  const p = new LK.Char('prophet', { name: LK.t('name.prophet'), sheet: 'malePerson', hue: 275, female: false,
    x: fromW ? 0 : w.W - 1, y: w.route[0], str: 3, sta: 5, int: 9 });
  p.ai = { state: 'arrive', spot };
  p.goTo(spot[0], spot[1]);
  S.chars.push(p);
  S.prophet = p; S.prophetDay = S.day;
  LK.log(LK.t('log.prophetComes'), 'warn');
  return p;
};
function prophetLeave(p, fast) {
  const w = LK.state.world;
  p.ai = { state: 'leave' };
  if (fast) p.speedMul = 2;
  if (!p.goTo(p.tx < w.W / 2 ? 0 : w.W - 1, w.route[0])) p.kind = 'gone';
}
// the hit reaction (LK.onHit): no fighting, he runs
LK.prophetHit = function (p) {
  if (p.ai.state === 'leave') return;
  p.say(LK.t('say.prophetHit'), 3);
  prophetLeave(p, true);
};

LK.prophetAI = function (p, dt) {
  const S = LK.state, a = p.ai;
  if (!p.active) return;
  if (p.preachT > 0) p.preachT -= dt;
  if (a.state === 'arrive') {
    if (!p.path.length) { a.state = 'preach'; p.sayT = 1; }
    return;
  }
  if (a.state === 'leave') {
    if (!p.path.length) { p.kind = 'gone'; if (S.prophet === p) S.prophet = null; }
    return;
  }
  // preaching
  const ent = S.world.entrances()[0];
  if (ent && !p.path.length) p.faceTo(ent.outside[0] + 0.5, ent.outside[1] + 0.5);
  if (!p.devCalled && (LK.hour() >= LK.PROPHET.leave || LK.hour() < 6)) { p.say(LK.t('say.prophetBye'), 3); prophetLeave(p); return; }
  p.sayT = (p.sayT || 0) - dt;
  if (p.sayT <= 0) { p.sayT = LK.rint(LK.PROPHET.sayEvery[0], LK.PROPHET.sayEvery[1]); LK.prophetSay(p); }
};
// once a day, sometime in his hours
LK.prophetUpdate = function (dt) {
  const S = LK.state, h = LK.hour(), P = LK.PROPHET;
  if (S.prophet && !S.chars.includes(S.prophet)) S.prophet = null;
  if (S.prophet || S.prophetDay === S.day) return;
  if (h >= P.arrive[0] && h < P.arrive[1] && Math.random() < dt / ((P.arrive[1] - h) * 30)) LK.spawnProphet();
};
