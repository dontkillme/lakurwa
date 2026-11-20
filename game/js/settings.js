// La Kurwa - player settings (game menu -> Options): text size. The language is in i18n.js.
// Stored in localStorage ('lakurwa_settings') only after the storage notice was accepted.
'use strict';

LK.SETTINGS_KEY = 'lakurwa_settings';
LK.FONT_SCALE = { min: 0.8, max: 1.6, step: 0.05, def: 1 };
LK.settings = { fontScale: LK.FONT_SCALE.def };
LK.fontScale = LK.FONT_SCALE.def;     // used by the canvas texts (render.js): names, labels, speech bubbles

LK.clampFontScale = v => {
  const F = LK.FONT_SCALE;
  v = Math.round((+v || F.def) / F.step) * F.step;
  return Math.round(Math.min(F.max, Math.max(F.min, v)) * 100) / 100;
};
// CSS: every text size is calc(Npx * var(--fs)) (style.css)
LK.applySettings = function () {
  LK.fontScale = LK.settings.fontScale;
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.style)
    document.documentElement.style.setProperty('--fs', String(LK.fontScale));
};
LK.loadSettings = function () {
  try {
    if (LK.consent && LK.consent.given()) {
      const s = JSON.parse(localStorage.getItem(LK.SETTINGS_KEY) || 'null');
      if (s && typeof s === 'object') Object.assign(LK.settings, s);
    }
  } catch (e) { /* ignore broken settings */ }
  LK.settings.fontScale = LK.clampFontScale(LK.settings.fontScale);
  LK.applySettings();
};
LK.saveSettings = function () {
  try { if (LK.consent && LK.consent.given()) localStorage.setItem(LK.SETTINGS_KEY, JSON.stringify(LK.settings)); } catch (e) { /* ignore */ }
};
// change the text size (live); persist = remember it
LK.setFontScale = function (v, persist) {
  LK.settings.fontScale = LK.clampFontScale(v);
  LK.applySettings();
  if (persist) LK.saveSettings();
  return LK.settings.fontScale;
};
