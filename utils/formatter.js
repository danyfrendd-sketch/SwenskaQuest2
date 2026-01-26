// utils/formatter.js
const shopRaw = require("../data/shop");
const { normalizeInv, normalizeEquipped } = require("./inventory");
const { formatLine } = require("./itemCard");
const energy = require("./energy");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}
normalizeShop(shopRaw); // оставлено для совместимости, даже если не используется напрямую

function esc(s) {
  return String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

function durOf(inv, itemId) {
  const it = inv.find((x) => x && x.id === itemId);
  if (!it) return 10;
  return Number.isFinite(it.d) ? it.d : 10;
}

function equipIcon(slotEmoji, inv, itemId) {
  if (!itemId) return `${slotEmoji}—`;
  const d = durOf(inv, itemId);
  return `${slotEmoji}${formatLine(itemId, d)}`;
}

function formatProfile(u) {
  const inv = normalizeInv(u.accessories);
  const eq = normalizeEquipped(u.equipped);

  const name = esc(u.name);
  const avatar = esc(u.avatar || "🙂");
  const sound = u.audio_enabled ? "🔊 ВКЛ" : "🔇 ВЫКЛ";

  const lines = [];
  lines.push(`👤 ${avatar} <b>${name}</b>`);
  if (u.age) lines.push(`🎂 Возраст: <b>${u.age}</b>`);
  lines.push(`🏅 Уровень: <b>${u.level || 1}</b>`);
  lines.push(`🌦️ Сезон: уровень <b>${u.season_level || 1}</b> • XP <b>${Number(u.season_xp || 0).toLocaleString()}</b>`);
  lines.push(`🪙 Монеты: <b>${Number(u.coins || 0).toLocaleString()}</b>`);
  lines.push(`💠 Токены: <b>${Number(u.tokens || 0).toLocaleString()}</b>`);
  lines.push(`📘 Прогресс: урок <b>${u.current_lesson || 1}</b>, шаг <b>${u.current_task || 0}</b>`);
  lines.push(`🔈 Звук: <b>${sound}</b>`);
  lines.push(``);

  lines.push(`🎒 <b>Экипировка</b>`);
  lines.push(`🧢 HEAD: ${eq.head ? formatLine(eq.head, durOf(inv, eq.head)) : "(пусто)"}`);
  lines.push(`🧥 BODY: ${eq.body ? formatLine(eq.body, durOf(inv, eq.body)) : "(пусто)"}`);
  lines.push(`🧰 TOOL: ${eq.tool ? formatLine(eq.tool, durOf(inv, eq.tool)) : "(пусто)"}`);
  lines.push(`🍀 CHARM: ${eq.charm ? formatLine(eq.charm, durOf(inv, eq.charm)) : "(пусто)"}`);
  lines.push(``);

  lines.push(`🎒 <b>Инвентарь</b>`);
  const invList = inv
    .filter((x) => x && x.id)
    .slice(0, 30)
    .map((x) => formatLine(x.id, Number.isFinite(x.d) ? x.d : 10))
    .join(", ");
  lines.push(invList || "(пусто)");

  return lines.join("\n");
}

function formatLeaderboard(rows) {
  const list = rows || [];
  if (!list.length) return "🏆 Пока нет лидеров.";

  const lines = [];
  lines.push("🏆 <b>ЛИДЕРЫ</b>\n");

  list.forEach((u, i) => {
    const avatar = esc(u.avatar || "🙂");
    const name = esc(u.name || "Player");
    const lesson = Number(u.current_lesson || 1);
    const seasonXp = Number(u.season_xp || 0).toLocaleString();

    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    const eText = `${synced.energy}/${energy.MAX_ENERGY}`;

    const inv = normalizeInv(u.accessories);
    const eq = normalizeEquipped(u.equipped);

    // ✅ было: только иконки слотов
    // ✅ стало: вся экипировка с названием + (d/10)
    const gear =
      [
        equipIcon("🧢", inv, eq.head),
        equipIcon("🧥", inv, eq.body),
        equipIcon("🧰", inv, eq.tool),
        equipIcon("🍀", inv, eq.charm),
      ].join("  ");

    lines.push(`${i + 1}. ${avatar} <b>${name}</b> — 📘 урок <b>${lesson}</b> • ✨ сезон XP <b>${seasonXp}</b> • ⚡ <b>${eText}</b>\n${gear}`);
  });

  return lines.join("\n");
}

module.exports = {
  formatProfile,
  formatLeaderboard,
};
