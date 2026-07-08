/* ─────────────────────────────────────────────────────────────────────────
   i18n — таблица локализации. Base language = EN.
   ДОБАВИТЬ ЯЗЫК: 1) добавь код в LANGS; 2) добавь файл js/i18n-<code>.js
   (Object.assign(I18N.<code>, {...})) в список модулей game-hex.html/game.html.
   Внутренние ключи данных (страна/город/…) остаются как есть; здесь — только ДИСПЛЕЙ.

   API:
     t(key, vars?)   — строка UI по ключу ('panel.build'), {vars} подставляются как {name}
     tName(ns, id)   — дисплей-имя данных: tName('country','Британия') → 'Britain' (фолбэк = id)
     setLang(code)   — сменить язык (сохраняется в localStorage), перерисовать UI зовёт вызывающий
     LANG            — текущий код языка
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
var LANGS = ['en', 'ru'];
var I18N = { en: {}, ru: {} };     // словари наполняются из i18n-en.js / i18n-ru.js
var LANG = 'en';
try { var _sv = (typeof localStorage !== 'undefined') && localStorage.getItem('lang'); if (_sv && LANGS.indexOf(_sv) >= 0) LANG = _sv; } catch (e) {}

function setLang(code) {
  if (I18N[code]) { LANG = code; try { localStorage.setItem('lang', code); } catch (e) {} }
  return LANG;
}
function t(key, vars) {
  var d = I18N[LANG] || I18N.en;
  var s = d[key];
  if (s == null) s = I18N.en[key];
  if (s == null) return key;                                  // нет перевода → сам ключ (видно, что забыли)
  if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
function tName(ns, id) {                                       // имя данных: внутренний ключ id → локализованный дисплей
  if (id == null) return id;
  var k = ns + ':' + id, v = t(k);
  return v === k ? id : v;
}
if (typeof window !== 'undefined') { window.t = t; window.tName = tName; window.setLang = setLang; window.I18N = I18N; window.LANGS = LANGS; }
