// La Kurwa - touch controls for phones / tablets.
//   joystick (bottom left) -> LK.input.joy, the owner walks like with WASD
//   buttons next to it: E use, F attack, Run (toggle), R rotate (build mode only), V see-through walls, C camera
//   the map: tap = left click, drag = move the camera, pinch = zoom, long press = walk there (right click);
//            build mode with the room / erase tool: drag paints (two fingers move the camera)
//   the selected field (PC: the tile under the mouse) is the tile the owner faces (LK.facingTile, main.js)
// On / off: Options -> Touch controls (auto = the device's main pointer is a finger); dev hashes `touch` / `notouch`.
'use strict';

LK.touchMode = false;
LK.TOUCH = { dead: 0.18, tapMove: 12, longPress: 0.55 };   // joystick dead zone (share of the radius), px a tap may move, s for a long press

LK.touch = {
  // should the touch controls be on?
  detect() {
    const h = (typeof location !== 'undefined' && location.hash || '').slice(1).split(',');
    if (h.includes('notouch')) return false;
    if (h.includes('touch')) return true;
    const s = LK.settings && LK.settings.touch;
    if (s === 'on' || s === 'off') return s === 'on';
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
  },
  // switch on / off after a settings change
  apply() {
    LK.touchMode = this.detect();
    if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('touch', LK.touchMode);
    if (!LK.touchMode) { this.release(); LK.input.runToggle = false; }
    this.frame();
  },
  release() {
    LK.input.joy = null; this.joyId = null;
    if (this.knob) this.knob.style.transform = '';
  },
  // a button press (same as the keyboard key)
  press(k) {
    const S = LK.state;
    if (LK.splashOpen || LK.intro || !S || S.over) return;
    if (k === 'e') LK.interact(S.player);
    else if (k === 'f') LK.playerAttack(S.player);
    else if (k === 'run') LK.input.runToggle = !LK.input.runToggle;
    else if (k === 'r' && LK.ui.buildMode) LK.ui.build.rot = (LK.ui.build.rot + 1) % 4;
    else if (k === 'v') LK.ui.cutaway = !LK.ui.cutaway;
    else if (k === 'c') LK.follow = true;
    this.frame();
  },
  // every frame (main loop): button states, touched only on change
  frame() {
    if (!this.btn) return;
    const st = (LK.input.runToggle ? 'R' : '') + (LK.ui && LK.ui.buildMode ? 'B' : '') + (LK.ui && LK.ui.cutaway ? 'V' : '') + (LK.ui && LK.ui.panel ? 'P' : '');
    if (st === this.st) return;
    this.st = st;
    const panel = !!(LK.ui && LK.ui.panel);
    if (document.body) document.body.classList.toggle('panel-open', panel);   // windows cover the controls (style.css)
    if (panel) this.release();
    if (this.btn.run) this.btn.run.classList.toggle('on', LK.input.runToggle);
    if (this.btn.r) this.btn.r.classList.toggle('hidden', !(LK.ui && LK.ui.buildMode));
    if (this.btn.v) this.btn.v.classList.toggle('on', !!(LK.ui && LK.ui.cutaway));
  },

  init(cv) {
    const $ = id => document.getElementById(id);
    this.joyEl = $('joy'); this.knob = $('joyKnob'); this.btn = {};
    document.querySelectorAll('#tKeys [data-tkey]').forEach(b => {
      this.btn[b.dataset.tkey] = b;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.press(b.dataset.tkey); });
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    this.initJoystick();
    this.initGestures(cv);
    this.apply();
    if (window.matchMedia) {                 // a tablet with a keyboard / mouse attached and back
      try { window.matchMedia('(pointer: coarse)').addEventListener('change', () => this.apply()); } catch (e) { /* old browsers */ }
    }
  },

  // ---------------- joystick ----------------
  initJoystick() {
    const el = this.joyEl;
    if (!el) return;
    const move = e => {
      const r = el.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.knob.style.transform = 'translate(' + (dx * R * 0.6).toFixed(1) + 'px,' + (dy * R * 0.6).toFixed(1) + 'px)';
      LK.input.joy = l < LK.TOUCH.dead ? null : [dx, dy];
    };
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.joyId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      move(e);
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === this.joyId) move(e); });
    const up = e => { if (e.pointerId === this.joyId) this.release(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', () => this.release());
  },

  // ---------------- map gestures ----------------
  initGestures(cv) {
    const T = LK.TOUCH;
    const tile = (x, y) => { const [fx, fy] = LK.toTile(x, y); return [Math.floor(fx), Math.floor(fy)]; };
    const paintTool = () => LK.ui.buildMode && (LK.ui.build.tool === 'room' || LK.ui.build.tool === 'erase');
    const two = e => { const a = e.targetTouches[0], b = e.targetTouches[1]; return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }; };
    // only the fingers on the map count (e.targetTouches): a thumb on the joystick / a button is not part of a gesture
    let g = null;                            // the gesture: { mode: 'tap' | 'pan' | 'paint' | 'pinch' | 'done', x0, y0, x, y, t0, timer, d, mx, my }
    const clearLong = () => { if (g && g.timer) { clearTimeout(g.timer); g.timer = null; } };

    cv.addEventListener('touchstart', e => {
      if (!LK.touchMode) return;
      e.preventDefault();
      if (LK.intro || LK.splashOpen) return;
      if (e.targetTouches.length >= 2) {           // second finger: pinch / two-finger pan
        clearLong();
        LK.input.drag = false;
        const p = two(e);
        g = { mode: 'pinch', d: p.d, mx: p.x, my: p.y };
        return;
      }
      const t = e.targetTouches[0], x = t.clientX, y = t.clientY;
      LK.input.mouse = [x, y]; LK.input.hover = tile(x, y);
      g = { mode: 'tap', x0: x, y0: y, x, y, t0: Date.now(), timer: null };
      if (paintTool()) { g.mode = 'paint'; LK.input.click(x, y, false); return; }
      g.timer = setTimeout(() => {           // long press = walk there
        if (g && g.mode === 'tap') { g.mode = 'done'; LK.input.click(g.x, g.y, true); }
      }, T.longPress * 1000);
    }, { passive: false });

    cv.addEventListener('touchmove', e => {
      if (!LK.touchMode || !g) return;
      e.preventDefault();
      if (g.mode === 'pinch') {
        if (e.targetTouches.length < 2) return;
        const p = two(e);
        LK.cam.x -= p.x - g.mx; LK.cam.y -= p.y - g.my; LK.follow = false;
        LK.zoomAt(p.x, p.y, p.d / g.d);
        g.d = p.d; g.mx = p.x; g.my = p.y;
        return;
      }
      const t = e.targetTouches[0], x = t.clientX, y = t.clientY;
      LK.input.mouse = [x, y];
      if (LK.ui.buildMode || LK.ui.pickPost) LK.input.hover = tile(x, y);   // the build ghost follows the finger
      if (g.mode === 'paint') {
        const [fx, fy] = LK.toTile(x, y);
        LK.ui.buildClick(Math.floor(fx), Math.floor(fy), fx, fy, true);
      } else if (g.mode === 'tap' && Math.hypot(x - g.x0, y - g.y0) > T.tapMove) { clearLong(); g.mode = 'pan'; }
      if (g.mode === 'pan') { LK.cam.x -= x - g.x; LK.cam.y -= y - g.y; LK.follow = false; }
      g.x = x; g.y = y;
    }, { passive: false });

    const end = e => {
      if (!LK.touchMode || !g) return;
      e.preventDefault();
      if (e.targetTouches.length) return;          // wait until every finger is up
      clearLong();
      if (g.mode === 'tap') LK.input.click(g.x, g.y, false);     // a tap = left click
      LK.input.drag = false;
      g = null;
    };
    cv.addEventListener('touchend', end, { passive: false });
    cv.addEventListener('touchcancel', e => { clearLong(); LK.input.drag = false; g = null; }, { passive: false });
  }
};
