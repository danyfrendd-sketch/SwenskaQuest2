// handlers/equipmentHandler.js
const db = require("../database/db");
const kb = require("../ui/keyboards");

const { normalizeInv, normalizeEquipped } = require("../utils/inventory");
const { formatLine } = require("../utils/itemCard");

function toDur(x) {
  const d = parseInt(String(x), 10);
  return Number.isFinite(d) ? Math.max(0, Math.min(10, d)) : 10;
}

function durOf(inv, itemId) {
  const it = inv.find((x) => x && x.id === itemId);
  if (!it) return 10;
  return Number.isFinite(it.d) ? toDur(it.d) : 10;
}

function isToolId(id) {
  return /^t\d+$/i.test(String(id || ""));
}

function ensureState(userState, id) {
  userState[id] = userState[id] || {};
  userState[id].equip = userState[id].equip || {};
  return userState[id].equip;
}

function slotLabel(slot) {
  if (slot === "head") return "🧢 HEAD";
  if (slot === "body") return "🧥 BODY";
  if (slot === "tool") return "🧰 TOOL";
  if (slot === "charm") return "🍀 CHARM";
  return slot;
}

function sendEquipMenu(bot, id, userState) {
  db.get("SELECT accessories, equipped FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;

    const inv = normalizeInv(u.accessories);
    const eq = normalizeEquipped(u.equipped);

    const headText = eq.head ? formatLine(eq.head, durOf(inv, eq.head)) : "(пусто)";
    const bodyText = eq.body ? formatLine(eq.body, durOf(inv, eq.body)) : "(пусто)";
    const toolText = eq.tool ? formatLine(eq.tool, durOf(inv, eq.tool)) : "(пусто)";
    const charmText = eq.charm ? formatLine(eq.charm, durOf(inv, eq.charm)) : "(пусто)";

    const text =
      `🎒 <b>ЭКИПИРОВКА</b>\n\n` +
      `🧢 HEAD: ${headText}\n` +
      `🧥 BODY: ${bodyText}\n` +
      `🧰 TOOL: ${toolText}\n` +
      `🍀 CHARM: ${charmText}\n\n` +
      `Выбери слот:`;

    const ik = [
      [
        { text: "🧢 HEAD", callback_data: "eq_slot_head" },
        { text: "🧥 BODY", callback_data: "eq_slot_body" },
      ],
      [
        { text: "🧰 TOOL", callback_data: "eq_slot_tool" },
        { text: "🍀 CHARM", callback_data: "eq_slot_charm" },
      ],
      [{ text: "🔙 В меню", callback_data: "eq_back" }],
    ];

    bot.sendMessage(id, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: ik } });
  });
}

function renderSlotPick(bot, id, userState, slot) {
  db.get("SELECT accessories, equipped FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return;

    const inv = normalizeInv(u.accessories);
    const eq = normalizeEquipped(u.equipped);

    // фильтрация по слоту:
    // tool -> только tools
    // остальные -> всё кроме tools
    const pool = inv
      .filter((x) => x && x.id)
      .map((x) => ({ id: String(x.id), d: toDur(x.d) }))
      .filter((x) => x.d > 0)
      .filter((x) => (slot === "tool" ? isToolId(x.id) : !isToolId(x.id)));

    const currentId = eq[slot];

    const header =
      `🎒 <b>${slotLabel(slot)}</b>\n\n` +
      `Сейчас: ${currentId ? formatLine(currentId, durOf(inv, currentId)) : "(пусто)"}\n\n` +
      `Выбери предмет для экипировки:`;

    if (!pool.length) {
      const ik0 = [
        [{ text: "❌ Снять предмет", callback_data: `eq_unequip_${slot}` }],
        [{ text: "🔙 Назад", callback_data: "eq_menu" }],
      ];
      return bot.sendMessage(id, header + `\n\n(Нет подходящих предметов в инвентаре)`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: ik0 },
      });
    }

    const st = ensureState(userState, id);
    st.pick = { slot, items: pool };

    const lines = pool.slice(0, 25).map((it, i) => `${i + 1}. ${formatLine(it.id, it.d)}`);
    const ik = pool.slice(0, 25).map((_, i) => [{ text: `Надеть #${i + 1}`, callback_data: `eq_pick_${i}` }]);

    ik.unshift([{ text: "❌ Снять предмет", callback_data: `eq_unequip_${slot}` }]);
    ik.push([{ text: "🔙 Назад", callback_data: "eq_menu" }]);

    bot.sendMessage(id, `${header}\n\n${lines.join("\n")}`, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: ik },
    });
  });
}

function setEquippedSlot(id, slot, itemId, cb) {
  db.get("SELECT equipped FROM users WHERE id=?", [id], (err, u) => {
    if (!u) return cb?.(false);

    const eq = normalizeEquipped(u.equipped);
    eq[slot] = itemId || null;

    db.run("UPDATE users SET equipped=? WHERE id=?", [JSON.stringify(eq), id], () => cb?.(true));
  });
}

function handleCallbacks(bot, q, userState) {
  const id = q.message.chat.id;
  const data = q.data || "";

  // menu/back
  if (data === "eq_menu") return sendEquipMenu(bot, id, userState);
  if (data === "eq_back") return bot.sendMessage(id, "🎮 Меню:", kb.mainMenu);

  // open slot picker
  if (data === "eq_slot_head") return renderSlotPick(bot, id, userState, "head");
  if (data === "eq_slot_body") return renderSlotPick(bot, id, userState, "body");
  if (data === "eq_slot_tool") return renderSlotPick(bot, id, userState, "tool");
  if (data === "eq_slot_charm") return renderSlotPick(bot, id, userState, "charm");

  // unequip
  if (data.startsWith("eq_unequip_")) {
    const slot = data.replace("eq_unequip_", "");
    if (!["head", "body", "tool", "charm"].includes(slot)) return;

    setEquippedSlot(id, slot, null, () => {
      bot.answerCallbackQuery(q.id, { text: "✅ Снято" }).catch(() => {});
      sendEquipMenu(bot, id, userState);
    });
    return;
  }

  // pick item from stored list
  if (data.startsWith("eq_pick_")) {
    const idx = parseInt(data.replace("eq_pick_", ""), 10);
    const st = userState?.[id]?.equip?.pick;
    if (!st || !Array.isArray(st.items)) return sendEquipMenu(bot, id, userState);

    if (!Number.isFinite(idx) || idx < 0 || idx >= st.items.length) return;

    const slot = st.slot;
    const it = st.items[idx];
    if (!it?.id) return;

    // защита на слот tool
    if (slot === "tool" && !isToolId(it.id)) {
      bot.answerCallbackQuery(q.id, { text: "❌ В TOOL можно только инструменты." }).catch(() => {});
      return;
    }
    if (slot !== "tool" && isToolId(it.id)) {
      bot.answerCallbackQuery(q.id, { text: "❌ Инструменты надеваются только в TOOL." }).catch(() => {});
      return;
    }

    setEquippedSlot(id, slot, it.id, () => {
      bot.answerCallbackQuery(q.id, { text: "✅ Надето" }).catch(() => {});
      sendEquipMenu(bot, id, userState);
    });
    return;
  }
}

module.exports = {
  sendEquipMenu,
  handleCallbacks,
};
