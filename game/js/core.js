// La Kurwa - core: namespace, utilities, assets, isometric math
'use strict';
var LK = window.LK || {};
window.LK = LK;

// the game's version (semantic: major.minor.patch) - main menu, About, game menu, saves, release README (tools/build.js)
LK.VERSION = '1.0.0';

LK.GFX = '../gfx/';
LK.TW = 128;           // screen tile width at zoom 1
LK.TH = 64;            // screen tile height at zoom 1

// ---------- utils ----------
LK.rand = Math.random;
LK.rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
LK.pick = arr => arr[Math.floor(Math.random() * arr.length)];
LK.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
LK.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
LK.uid = (() => { let n = 1; LK.uidPeek = () => n; LK.uidSet = v => { n = Math.max(n, v); }; return () => n++; })();   // uidSet: after loading a save
LK.fmt = n => (Math.round(n * 10) / 10).toString();
LK.money = n => Math.round(n) + ' M';
// deterministic hash of two integers -> [0, 1). 32-bit integer math (Math.imul): the old float version
// lost precision and only returned values below 0.5
LK.hash = (x, y) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// ---------- assets (lazy loaded) ----------
LK.images = {};
LK.img = function (path) {
  let im = LK.images[path];
  if (!im) { im = new Image(); im.src = LK.GFX + path; LK.images[path] = im; }
  return im.complete && im.naturalWidth ? im : null;
};
// sprite name "base_DIR" -> image; the folder comes from data/sprites.js (gfx/Isometric or gfx/custom)
LK.DIR_RE = /_(N|E|S|W|NE|NW|SE|SW)$/i;   // case-insensitive: _e and _E (the file's own case is used for loading)
LK.spriteBase = name => name.replace(LK.DIR_RE, '');
// path (relative to gfx/) of sprite "base_DIR"
LK.isoPath = function (name) {
  const e = LK.SPRITES && LK.SPRITES[LK.spriteBase(name)];
  return (e ? e.folder : 'Isometric') + '/' + name + '.png';
};
LK.iso = name => LK.img(LK.isoPath(name));
// sprite name for ground/floor tile (x,y): `base` may be a list of variants; sprites without
// rotations are used as they are, Kenney sprites get a rotation (fixed `dir` or varied per tile)
LK.groundName = function (base, x, y, dir) {
  if (Array.isArray(base)) base = base[Math.floor(LK.hash(x * 7 + 3, y * 13 + 1) * base.length) % base.length];
  const e = LK.SPRITES && LK.SPRITES[base];
  if (e && e.dirs.length === 1 && e.dirs[0] === '') return base;
  return base + '_' + (dir || ['E', 'N', 'S', 'W'][Math.floor(LK.hash(x, y) * 4)]);
};
// full sprite name of a furniture definition in rotation `rot`
LK.furnSprite = (d, rot) => {
  const dir = d.dirs && d.dirs.length ? d.dirs[(rot || 0) % d.dirs.length] : '';
  return d.sprite + (dir ? '_' + dir : '');
};

// Draw an isometric sprite whose footprint centre is at screen (sx,sy).
// anchor 'tile': 256x512 Kenney layout, tile centre at (128,437), scaled 0.5 * big
// anchor 'bottom': bottom-centre of the image sits on the tile centre (+dy), scaled by `scale`
// anchor 'auto' (default): 'tile' for 256x512 images, otherwise 'bottom'
const e_base_len = name => LK.spriteBase(name).length;
LK.drawIso = function (ctx, name, sx, sy, z, opt) {
  const im = LK.iso(name);
  if (!im) return;
  opt = opt || {};
  const e = LK.SPRITES && LK.SPRITES[LK.spriteBase(name)];
  const anchor = opt.anchor && opt.anchor !== 'auto' ? opt.anchor
    : e && e.ax != null ? 'point' : (im.width === 256 && im.height === 512 ? 'tile' : 'bottom');
  const dx = (opt.dx || 0) * z, dy = (opt.dy || 0) * z;
  if (anchor === 'point') {
    // sliced sprites (data/sprites.js ax/ay/scale): pixel (ax,ay) sits on the tile centre
    const s = z * ((e && e.scale) || 1) * (opt.big || 1);
    ctx.drawImage(im, sx - (e ? e.ax : im.width / 2) * s + dx, sy - (e ? e.ay : im.height) * s + dy, im.width * s, im.height * s);
  } else if (anchor === 'tile') {
    const s = 0.5 * z * (opt.big || 1);
    // draw only the visible part of the mostly empty 256x512 image (bounding box from data/sprites.js)
    const bb = e && e.bb && e.bb[name.length > e_base_len(name) ? name.slice(e_base_len(name) + 1) : ''];
    if (bb) ctx.drawImage(im, bb[0], bb[1], bb[2], bb[3], sx + (bb[0] - 128) * s + dx, sy + (bb[1] - 437) * s + dy, bb[2] * s, bb[3] * s);
    else ctx.drawImage(im, sx - 128 * s + dx, sy - 437 * s + dy, 256 * s, 512 * s);
  } else {
    const s = (opt.scale || 1.15) * z;
    const w = im.width * s, h = im.height * s;
    ctx.drawImage(im, sx - w / 2 + dx, sy + (opt.dy == null ? 14 : opt.dy) * z - h, w, h);
  }
};
// Furniture may consist of several sprites: `parts: [{ sprite, dx, dy, tx, ty, block }]`.
//   dx, dy  pixel offset of the part's anchor from the main sprite's (screen px at zoom 1), scaled with `big`
//   tx, ty  optional map tile of the part (relative) - used for draw order and, with `block`, for walking
// drawFurn draws everything (thumbnails, previews, ghosts); the map renderer sorts the parts itself.
LK.drawFurnMain = (ctx, d, rot, sx, sy, z) => LK.drawIso(ctx, LK.furnSprite(d, rot), sx, sy, z, d);
LK.drawFurnPart = function (ctx, d, p, sx, sy, z) {
  const k = z * (d.big || 1);
  LK.drawIso(ctx, p.sprite, sx + (p.dx || 0) * k, sy + (p.dy || 0) * k, z, { big: d.big, scale: d.scale });
};
LK.drawFurn = function (ctx, d, rot, sx, sy, z) {
  const parts = d.parts || [];
  // parts on tiles further back are drawn first
  const back = parts.filter(p => (p.tx || 0) + (p.ty || 0) < 0), front = parts.filter(p => (p.tx || 0) + (p.ty || 0) >= 0);
  for (const p of back) LK.drawFurnPart(ctx, d, p, sx, sy, z);
  LK.drawFurnMain(ctx, d, rot, sx, sy, z);
  for (const p of front) LK.drawFurnPart(ctx, d, p, sx, sy, z);
};

// ---------- characters ----------
LK.FRAMES = ('idle jump fall duck hit climb0 climb1 cheer0 cheer1 back slide interact switch0 switch1 kick side shove ' +
  'shoveBack talk attackKick hang hold show behindBack run0 run1 run2 attack0 attack1 attack2 think down drag hurt wide ' +
  'rope walk0 walk1 walk2 walk3 walk4 walk5 walk6 walk7 fallDown').split(' ');
LK.FRAME_INDEX = {};
LK.FRAMES.forEach((n, i) => LK.FRAME_INDEX[n] = i);
LK.SHEETS = {
  maleAdventurer: 'characters/character_maleAdventurer_sheetHD.png',
  femaleAdventurer: 'characters/character_femaleAdventurer_sheetHD.png',
  malePerson: 'characters/character_malePerson_sheetHD.png',
  femalePerson: 'characters/character_femalePerson_sheetHD.png',
  soldier: 'characters/character_soldier_sheetHD.png'   // Order of the Holy Flame (tools/make_soldier_sheet.py)
};
LK.tinted = {};
// returns a canvas/img with hue shift; built once per (sheet,hue)
LK.sheet = function (sheet, hue) {
  const key = sheet + '|' + (hue || 0);
  if (LK.tinted[key]) return LK.tinted[key];
  const im = LK.img(LK.SHEETS[sheet]);
  if (!im) return null;
  if (!hue) { LK.tinted[key] = im; return im; }
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const g = c.getContext('2d');
  g.filter = 'hue-rotate(' + hue + 'deg) saturate(0.8)';
  g.drawImage(im, 0, 0);
  LK.tinted[key] = c;
  return c;
};
LK.drawChar = function (ctx, sheet, hue, frame, sx, sy, z, flip, rot, alpha) {
  const im = LK.sheet(sheet, hue);
  if (!im) return;
  const i = LK.FRAME_INDEX[frame] || 0;
  const fx = (i % 9) * 192, fy = Math.floor(i / 9) * 256;
  const s = 0.36 * z;
  ctx.save();
  ctx.translate(sx, sy);
  if (alpha != null) ctx.globalAlpha = alpha;
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, fx, fy, 192, 256, -96 * s, -250 * s, 192 * s, 256 * s);
  ctx.restore();
};

// a character (how he looks: sheet + hue) standing, fitted into a small canvas - staff / stats windows
LK.drawPortrait = function (cv, c) {
  const g = cv.getContext('2d'), base = LK.img(LK.SHEETS[c.sheet]);
  const draw = () => {
    const im = LK.sheet(c.sheet, c.hue);
    if (!im) return;
    g.clearRect(0, 0, cv.width, cv.height);
    const z = cv.height / 230 / 0.36;                      // drawChar scale 0.36*z, frame 256 px with feet at 250
    LK.drawChar(g, c.sheet, c.hue, 'idle', cv.width / 2, cv.height + 6 * z * 0.36, z);
  };
  if (!base || base.complete) draw(); else base.addEventListener('load', () => { delete LK.tinted[c.sheet + '|' + (c.hue || 0)]; draw(); }, { once: true });
};

// item icons (generic items sheet, coords from the xml)
// item icons: keys of LK.ICON_ATLAS (data/sprites.js, "i001".."i163") or the aliases below
LK.ICON_ALIAS = { aid: 'i102', beer: 'i008', money: 'i158', wine: 'i127', bowl: 'i128', mug: 'i134' };
LK.iconRect = key => LK.ICON_ATLAS && LK.ICON_ATLAS[LK.ICON_ALIAS[key] || key];
LK.ICON_SHEET = 'items/genericItems_spritesheet_colored.png';
LK.drawIcon = function (ctx, key, sx, sy, size) {
  const im = LK.img(LK.ICON_SHEET);
  const r = LK.iconRect(key);
  if (!im || !r) return;
  const s = size / Math.max(r[2], r[3]);
  ctx.drawImage(im, r[0], r[1], r[2], r[3], sx - r[2] * s / 2, sy - r[3] * s, r[2] * s, r[3] * s);
};
// HTML version (CSS sprite) for panels
// small picture of a furniture piece in a <canvas> (UI tables): the opaque part of its main sprite
// (Kenney sprites: bounding box from the sprite index, no pixel reading - works from file://)
LK.furnThumb = function (cv, key) {
  const d = LK.FURNITURE[key];
  if (!d) return;
  const name = LK.furnSprite(d, 0), im = LK.iso(name);
  if (!im) return;
  const draw = () => {
    if (!im.naturalWidth) return;
    const e = LK.SPRITES[LK.spriteBase(name)] || {};
    const dir = name.length > LK.spriteBase(name).length ? name.slice(LK.spriteBase(name).length + 1) : '';
    const bb = (e.bb && e.bb[dir]) || [0, 0, im.naturalWidth, im.naturalHeight];
    const g = cv.getContext('2d'), s = Math.min(cv.width / bb[2], cv.height / bb[3]);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(im, bb[0], bb[1], bb[2], bb[3], (cv.width - bb[2] * s) / 2, (cv.height - bb[3] * s) / 2, bb[2] * s, bb[3] * s);
  };
  if (im.complete) draw(); else im.addEventListener('load', draw, { once: true });
};
LK.iconHTML = function (key, size) {
  const r = LK.iconRect(key);
  if (!r) return '';
  size = size || 20;
  const s = size / Math.max(r[2], r[3]);
  return '<span class="icon" style="width:' + Math.round(r[2] * s) + 'px;height:' + Math.round(r[3] * s) + 'px;background:url(' + LK.GFX + LK.ICON_SHEET +
    ') -' + (r[0] * s) + 'px -' + (r[1] * s) + 'px / ' + (1024 * s) + 'px ' + (2048 * s) + 'px no-repeat"></span>';
};

// ---------- editor test data ----------
// editor.html "Test in game" stores data in localStorage; the game uses it instead of the files.
LK.MOD_KEY = 'lakurwa_mod';
LK.getMod = function () { try { return JSON.parse(localStorage.getItem(LK.MOD_KEY) || 'null'); } catch (e) { return null; } };
LK.applyMods = function () {
  const m = LK.getMod();
  LK.modActive = !!(m && m.active);
  if (!LK.modActive) return false;
  if (m.furniture) LK.FURNITURE = m.furniture;
  if (m.ingredients) LK.INGREDIENTS = m.ingredients;
  if (m.goods) LK.GOODS = m.goods;
  if (m.sprites) Object.assign(LK.SPRITES, m.sprites);
  if (m.maps) Object.assign(LK.MAPS, m.maps);
  // imported graphics not yet written to gfx/custom travel as data URLs
  if (m.images) for (const [path, url] of Object.entries(m.images)) { const im = new Image(); im.src = url; LK.images[path] = im; }
  return true;
};
// derived tables
LK.finalizeData = function () {
  const types = kind => [...new Set(Object.values(LK.INGREDIENTS).filter(d => d.kind === kind).map(d => d.type))];
  LK.DRINK_TYPES = types('drink');
  LK.FOOD_TYPES = types('food');
};

// ---------- isometric camera ----------
LK.cam = { x: 0, y: 0, z: 0.8 };
// tile coords (continuous, tile centre = x+0.5) -> screen
LK.toScreen = function (tx, ty) {
  const z = LK.cam.z;
  return [(tx - ty) * LK.TW / 2 * z - LK.cam.x + LK.view.w / 2, (tx + ty) * LK.TH / 2 * z - LK.cam.y + LK.view.h / 2];
};
LK.toTile = function (sx, sy) {
  const z = LK.cam.z;
  const a = (sx + LK.cam.x - LK.view.w / 2) / (LK.TW / 2 * z);
  const b = (sy + LK.cam.y - LK.view.h / 2) / (LK.TH / 2 * z);
  return [(a + b) / 2, (b - a) / 2];
};
LK.centerOn = function (tx, ty) {
  const z = LK.cam.z;
  LK.cam.x = (tx - ty) * LK.TW / 2 * z;
  LK.cam.y = (tx + ty) * LK.TH / 2 * z;
};
LK.view = { w: 800, h: 600 };

// ---------- message log ----------
LK.log = function (msg, cls) {
  const el = document.getElementById('log');
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'msg ' + (cls || '');
  d.textContent = (LK.state ? LK.clockText() + '  ' : '') + msg;
  el.prepend(d);
  while (el.children.length > 40) el.lastChild.remove();
};
