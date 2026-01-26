// utils/itemCard.js
const shopRaw = require("../data/shop");
const tools = require("../data/tools");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}

const SHOP = normalizeShop(shopRaw);

// --- maps ---
const SHOP_MAP = new Map();
for (const it of SHOP) {
  if (it && it.id) SHOP_MAP.set(it.id, it);
}

const TOOL_MAP = new Map();
for (const t of tools) {
  if (t && t.id) TOOL_MAP.set(t.id, t);
}

function toDur(x) {
  const d = parseInt(String(x), 10);
  return Number.isFinite(d) ? Math.max(0, Math.min(10, d)) : 10;
}

function toolEffectLabel(effect) {
  switch (effect) {
    case "tool_remove_1": return "🧽 -1 неверный";
    case "tool_remove_2": return "✏️ -2 неверных";
    case "tool_hint_first_letter": return "🔦 1-я буква";
    case "tool_mark_suspect": return "🔍 подозрительный";
    case "tool_shuffle_options": return "🧩 shuffle";
    case "tool_retry_once": return "🔁 2-я попытка";
    case "tool_repeat_audio": return "🎧 повтор аудио";
    case "tool_bookmark_word": return "🧷 закладка";
    case "tool_skip_free": return "🛹 пропуск";
    case "tool_show_answer": return "✨ ответ";
    default: return null;
  }
}

// возвращает нормальное имя предмета (с эмодзи), без (d/10)
function prettyName(id) {
  const sid = String(id || "");
  if (!sid) return "Unknown";

  // tools (приоритет)
  const t = TOOL_MAP.get(sid);
  if (t?.name) return t.name;

  // shop items
  const s = SHOP_MAP.get(sid);
  if (s?.name) return s.name;

  // fallback
  return sid;
}

// кратко: "Название (d/10)" + баф для tools
function formatLine(id, durability = 10) {
  const sid = String(id || "");
  const d = toDur(durability);

  const baseName = prettyName(sid);

  // tool buff label
  let buff = null;
  const t = TOOL_MAP.get(sid);
  if (t?.effect) buff = toolEffectLabel(t.effect);

  if (buff) {
    return `${baseName} (${d}/10) • ${buff}`;
  }
  return `${baseName} (${d}/10)`;
}

// если нужно только красиво вывести, но без бафа (иногда удобно)
function formatLineNoBuff(id, durability = 10) {
  const sid = String(id || "");
  const d = toDur(durability);
  return `${prettyName(sid)} (${d}/10)`;
}

module.exports = {
  prettyName,
  formatLine,
  formatLineNoBuff,
};
