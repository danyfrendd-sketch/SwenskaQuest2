// utils/activityLog.js
const db = require("../database/db");
const { formatLine } = require("./itemCard");

const TABLE = "bot_activity_logs";

// ❗ ВАЖНО: тут НЕЛЬЗЯ require("../bots/aiBots") — будет круговая зависимость.
// Поэтому имена ботов задаём локально.
const BOT_NAME = new Map([
  [-101, "🤵🏿 Смурфик"],
  [-102, "☠️ Шнеля"],
  [-103, "🦊 Mactraher"],
]);

db.run(
  `CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    meta TEXT
  )`
);

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function log(userId, action, meta = {}) {
  const ts = nowSec();
  const uid = Number(userId);
  const act = String(action || "unknown");
  let metaStr = null;

  try {
    metaStr = JSON.stringify(meta && typeof meta === "object" ? meta : { meta: String(meta) });
  } catch {
    metaStr = JSON.stringify({ meta: "unserializable" });
  }

  db.run(`INSERT INTO ${TABLE} (ts, user_id, action, meta) VALUES (?, ?, ?, ?)`, [ts, uid, act, metaStr]);
}

function getRecent(limit = 20, cb) {
  const n = Math.max(1, Math.min(50, Number(limit) || 20));
  db.all(`SELECT ts, user_id, action, meta FROM ${TABLE} ORDER BY id DESC LIMIT ?`, [n], (err, rows) => cb?.(err, rows || []));
}

function getRecentByUser(userId, limit = 20, cb) {
  const uid = Number(userId);
  const n = Math.max(1, Math.min(50, Number(limit) || 20));
  db.all(
    `SELECT ts, user_id, action, meta FROM ${TABLE} WHERE user_id=? ORDER BY id DESC LIMIT ?`,
    [uid, n],
    (err, rows) => cb?.(err, rows || [])
  );
}

function tsToText(ts) {
  try {
    return new Date((Number(ts) || 0) * 1000).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return String(ts);
  }
}

function parseMeta(metaStr) {
  try {
    const obj = metaStr ? JSON.parse(metaStr) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function whoName(userId) {
  const uid = Number(userId);
  return BOT_NAME.get(uid) || `USER ${uid}`;
}

function humanize(action, meta) {
  switch (action) {
    case "bot_spawn":
      return `запущен (создан профиль)`;

    case "pause":
      return `сделал паузу`;

    case "lesson_no_energy":
      return `хотел пройти урок, но нет энергии (⚡ ${meta.e ?? "?"})`;

    case "lesson_answer_ok":
      return `ответил ✅ в уроке ${meta.lesson} (вопрос ${meta.task}) • ⚡ ${meta.e ?? "?"}`;

    case "lesson_answer_bad":
      return `ошибся ❌ в уроке ${meta.lesson} (вопрос ${meta.task}) • ⚡ ${meta.e ?? "?"}`;

    case "lesson_complete":
      return `прошёл 📘 урок ${meta.lesson} → уровень +1 • 🪙 +${meta.coinsAdd ?? "?"} • XP +${meta.xpAdd ?? "?"}`;

    case "boss_loot":
      return `победил босса ⚔️ и получил ${meta.type === "chest" ? "🎁 сундук" : "🔑 ключ"} (${String(meta.r || "").toUpperCase()})`;

    case "chest_open": {
      const rw = String(meta.rw || "");
      let drop = rw;
      if (rw.startsWith("coins:")) drop = `🪙 ${rw.replace("coins:", "")}`;
      if (rw.startsWith("item:")) drop = `🎁 ${formatLine(rw.replace("item:", ""), 10)}`;
      return `открыл 🎁 сундук (${String(meta.chestR || "").toUpperCase()}) ключом (${String(meta.usedKey || "").toUpperCase()}) и получил: ${drop}`;
    }

    case "buy_tool":
      return `купил 🧰 инструмент ${formatLine(meta.tool || "?", 10)} за 💠 ${meta.cost ?? "?"}`;

    case "market_list":
      return `выставил на рынок: ${formatLine(meta.item || "?", meta.d ?? 10)} за ${meta.cur === "tokens" ? "💠" : "🪙"} ${meta.price ?? "?"}`;

    case "market_buy":
      return `купил с рынка: ${formatLine(meta.item || "?", meta.d ?? 10)} за ${meta.cur === "tokens" ? "💠" : "🪙"} ${meta.price ?? "?"}`;

    case "system_sell":
      return `продал системе 🏦: ${formatLine(meta.item || "?", meta.d ?? 10)} за 🪙 ${meta.price ?? "?"}`;

    default: {
      const keys = Object.keys(meta || {});
      const tail = keys.length ? " " + keys.map((k) => `${k}=${String(meta[k])}`).join(" ") : "";
      return `${action}${tail}`;
    }
  }
}

function format(rows) {
  if (!rows || !rows.length) return "Пока пусто.";

  return rows
    .map((r) => {
      const dt = tsToText(r.ts);
      const meta = parseMeta(r.meta);
      const who = whoName(r.user_id);
      const text = humanize(String(r.action || "unknown"), meta);
      return `• ${dt} | <b>${who}</b> — ${text}`;
    })
    .join("\n");
}

module.exports = {
  log,
  getRecent,
  getRecentByUser,
  format,
};
