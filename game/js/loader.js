// La Kurwa - loading screen: preloads every image the game needs before the main menu appears.
'use strict';

// everything the game draws: ground, floors, walls, furniture (+ parts), ring fence, characters, item icons
LK.assetList = function () {
  const set = new Set();
  const sprite = (base, dirs) => {
    const e = LK.SPRITES[base];
    if (!e) return;
    for (const d of dirs || e.dirs) if (e.dirs.includes(d)) set.add(LK.isoPath(base + (d ? '_' + d : '')));
  };
  for (const v of Object.values(LK.GROUND)) for (const b of [].concat(v)) sprite(b);
  for (const f of Object.values(LK.FLOORS)) for (const b of [].concat(f.sprite)) sprite(b);
  for (const r of Object.values(LK.ROOMS)) if (r.floor) sprite(r.floor);
  for (const m of Object.values(LK.WALLSPR)) for (const b of Object.values(m)) sprite(b, ['E', 'S']);   // walls use these two sides
  for (const d of Object.values(LK.FURNITURE)) {
    sprite(d.sprite, d.dirs && d.dirs.length ? d.dirs : null);
    for (const p of d.parts || []) set.add(LK.isoPath(p.sprite));
  }
  sprite('fenceLow', ['E', 'S']);                        // the fight ring
  // wall pieces placed in the editor (only those the maps use)
  for (const m of Object.values(LK.MAPS || {})) for (const v of Object.values(m.edgeOverride || {})) if (LK.WALL_PIECES[v]) sprite(v, ['E', 'S']);
  for (const p of Object.values(LK.SHEETS)) set.add(p);
  set.add(LK.ICON_SHEET);
  return [...set];
};

// the tips are in the language files: 'load.tips'

// show the loading screen, load everything, then call done()
LK.loadAssets = function (done) {
  const el = document.getElementById('loading');
  const list = LK.assetList();
  const bar = document.getElementById('loadBar'), txt = document.getElementById('loadText');
  document.getElementById('loadTip').textContent = LK.t('load.tips');
  el.classList.remove('hidden');
  const t0 = performance.now();
  let ok = 0, failed = [];
  const update = () => {
    const n = ok + failed.length;
    bar.style.width = Math.round(n / list.length * 100) + '%';
    txt.textContent = LK.t('load.text', { n, total: list.length });
    if (n < list.length) return;
    LK.loadFailed = failed;                               // checked by tools/build.js --verify
    if (failed.length) console.warn('La Kurwa: ' + failed.length + ' images could not be loaded:', failed);
    // keep the screen up a moment so it doesn't just flash
    if (/loadshot/.test(location.hash)) return;           // dev/screenshots: stay on the loading screen
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.classList.add('hidden'), 300); done(); },
      Math.max(0, 350 - (performance.now() - t0)));
  };
  if (!list.length) { update(); return; }
  for (const path of list) {
    LK.img(path);                                         // creates + caches the Image
    const im = LK.images[path];
    if (im.complete) { if (im.naturalWidth) ok++; else failed.push(path); continue; }
    im.addEventListener('load', () => { ok++; update(); }, { once: true });
    im.addEventListener('error', () => { failed.push(path); update(); }, { once: true });
  }
  update();
};
