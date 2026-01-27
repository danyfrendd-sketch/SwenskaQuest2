const ru = require("../locales/ru");
const en = require("../locales/en");

const LOCALES = { ru, en };
const DEFAULT_LANG = "ru";

function resolveLang(lang) {
  if (lang && LOCALES[lang]) return lang;
  return DEFAULT_LANG;
}

function interpolate(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    return m;
  });
}

function t(lang, key, vars = {}) {
  const useLang = resolveLang(lang);
  const table = LOCALES[useLang] || LOCALES[DEFAULT_LANG];
  const fallback = LOCALES[DEFAULT_LANG] || {};
  const raw = table[key] ?? fallback[key] ?? key;
  return interpolate(raw, vars);
}

function getUserLang(db, userId) {
  return new Promise((resolve) => {
    db.get("SELECT lang FROM users WHERE id=?", [userId], (err, row) => {
      if (err) return resolve(DEFAULT_LANG);
      const lang = row?.lang || DEFAULT_LANG;
      return resolve(resolveLang(lang));
    });
  });
}

function allLocales() {
  return Object.keys(LOCALES);
}

function matchesLocaleText(text, key) {
  const tText = String(text || "").trim();
  return allLocales().some((lng) => t(lng, key) === tText);
}

module.exports = {
  t,
  getUserLang,
  matchesLocaleText,
  resolveLang,
  DEFAULT_LANG,
};
