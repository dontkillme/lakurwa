// La Kurwa - translations.
// Texts live in game/lang/<code>.js as   LK.LANGS.<code> = { 'some.key': 'Text with {placeholders}', ... }
// (one file per language, listed in game/lang/index.js). A value may also be a list of variants: one is
// picked at random (used for the characters' speech lines).
//   LK.t('key', { name: 'Zbyszek' })   -> text in the current language, else English, else the key itself
//   LK.tn('furn', 'counter', 'Bar counter') -> name of a data item (furniture, ingredient...) with fallback
// In HTML:  data-i18n="key" (text), data-i18n-html="key" (HTML), data-i18n-title="key" (tooltip)
'use strict';

LK.LANGS = LK.LANGS || {};
LK.lang = 'en';
LK.LANG_KEY = 'lakurwa_lang';

LK.lookupT = function (key) {
  const cur = LK.LANGS[LK.lang];
  if (cur && cur[key] != null) return cur[key];
  const en = LK.LANGS.en;
  if (en && en[key] != null) return en[key];
  return null;
};
LK.hasT = key => LK.lookupT(key) != null;
LK.fillT = (s, params) => params ? String(s).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m)) : String(s);
LK.t = function (key, params) {
  let v = LK.lookupT(key);
  if (v == null) return key;                                  // missing everywhere: show the key (easy to spot)
  if (Array.isArray(v)) v = v[Math.floor(Math.random() * v.length)];
  return LK.fillT(v, params);
};
// all variants of a list entry (single texts become a one-element list)
LK.tList = key => { const v = LK.lookupT(key); return v == null ? [key] : [].concat(v); };
// translated name of a data item, falling back to the name stored in the data files (e.g. furniture
// added in the editor that has no translation yet)
LK.tn = (kind, id, fallback) => { const v = LK.lookupT(kind + '.' + id); return v != null ? LK.fillT(v) : (fallback != null ? fallback : id); };
LK.furnName = k => LK.tn('furn', k, (LK.FURNITURE[k] || {}).name);
LK.ingName = k => LK.tn('ing', k, (LK.INGREDIENTS[k] || {}).name);
LK.goodName = k => LK.tn('goods', k, (LK.GOODS[k] || {}).name);

// fill [data-i18n...] elements under root
LK.applyI18n = function (root) {
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = LK.t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = LK.t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = LK.t(el.dataset.i18nTitle); });
  if (document.documentElement) document.documentElement.lang = LK.lang;
};
// the languages that are loaded: [{ code, name }]
LK.languages = () => Object.keys(LK.LANGS).map(code => ({ code, name: LK.LANGS[code]['lang.name'] || code }));
// pick the start language: saved choice (only readable after consent) > browser language > English
LK.detectLang = function () {
  let saved = null;
  try { if (LK.consent && LK.consent.given()) saved = localStorage.getItem(LK.LANG_KEY); } catch (e) { /* ignore */ }
  if (saved && LK.LANGS[saved]) return saved;
  const nav = (typeof navigator !== 'undefined' && (navigator.language || '')).slice(0, 2).toLowerCase();
  return LK.LANGS[nav] ? nav : 'en';
};
LK.setLang = function (code, persist) {
  if (!LK.LANGS[code]) return;
  LK.lang = code;
  if (persist) { try { if (LK.consent && LK.consent.given()) localStorage.setItem(LK.LANG_KEY, code); } catch (e) { /* ignore */ } }
  if (typeof document !== 'undefined' && document.querySelectorAll) LK.applyI18n(document);
  if (LK.onLangChange) LK.onLangChange();
};
