// utils/buffsEngine.js
const shopRaw = require("../data/shop");
const buffs = require("../data/buffs");

// ---------- helpers ----------
function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}

const SHOP = normalizeShop(shopRaw);

function getShopItem(id) {
  return SHOP.find((x) => x && x.id === id) || null;
}

function safeBuffMeta(itemId, rarity) {
  // Не используем itemCard тут, чтобы не ловить циклы/падения
  return (
    (buffs && buffs.byItemId && buffs.byItemId[itemId]) ||
    (buffs && buffs.byRarity && buffs.byRarity[rarity]) ||
    { key: "none", text: "нет" }
  );
}

// диапазоны цен по редкости, чтобы проценты масштабировались внутри редкости
const PRICE_RANGE = (() => {
  const byR = {};
  for (const it of SHOP) {
    if (!it || !it.rarity || !Number.isFinite(Number(it.price))) continue;
    const r = it.rarity;
    const p = Number(it.price);
    byR[r] = byR[r] || { min: p, max: p };
    byR[r].min = Math.min(byR[r].min, p);
    byR[r].max = Math.max(byR[r].max, p);
  }
  return byR;
})();

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function priceFactor(rarity, price) {
  const rr = PRICE_RANGE[rarity];
  if (!rr) return 0.5;
  const min = rr.min,
    max = rr.max;
  if (min === max) return 0.5;
  return clamp01((price - min) / (max - min));
}

// динамические проценты от цены (tools не трогаем)
function scaledEffectForItem(key, item) {
  const rarity = item?.rarity || "common";
  const price = Number(item?.price || 0);
  const t = priceFactor(rarity, price);

  if (key === "gold") {
    // 4% .. 16%
    const pct = 0.04 + t * (0.16 - 0.04);
    return { coinsBonusPct: pct, xpBonusPct: 0, chestLuckPct: 0 };
  }
  if (key === "xp") {
    // 2% .. 10%
    const pct = 0.02 + t * (0.10 - 0.02);
    return { coinsBonusPct: 0, xpBonusPct: pct, chestLuckPct: 0 };
  }
  if (key === "luck") {
    // 1% .. 5% (проценты)
    const pct = 1 + t * (5 - 1);
    return { coinsBonusPct: 0, xpBonusPct: 0, chestLuckPct: pct };
  }

  // tool / none
  return { coinsBonusPct: 0, xpBonusPct: 0, chestLuckPct: 0 };
}

function mergeEffects(a, b) {
  return {
    coinsBonusPct: (a.coinsBonusPct || 0) + (b.coinsBonusPct || 0),
    xpBonusPct: (a.xpBonusPct || 0) + (b.xpBonusPct || 0),
    chestLuckPct: (a.chestLuckPct || 0) + (b.chestLuckPct || 0),
  };
}

/**
 * Эффекты от HEAD/BODY/CHARM
 * Баф работает только если d > 0.
 */
function calcEffects({ equipped, inv }) {
  let fx = { coinsBonusPct: 0, xpBonusPct: 0, chestLuckPct: 0 };
  const slots = ["head", "body", "charm"];

  for (const slot of slots) {
    const itemId = equipped?.[slot];
    if (!itemId) continue;

    const invIt = inv.find((x) => x && x.id === itemId);
    const d = invIt ? (Number.isFinite(invIt.d) ? invIt.d : 10) : 0;
    if (d <= 0) continue;

    const shopIt = getShopItem(itemId) || { id: itemId, rarity: "common", price: 0 };
    const bm = safeBuffMeta(itemId, shopIt.rarity);
    const eff = scaledEffectForItem(bm.key, shopIt);

    fx = mergeEffects(fx, eff);
  }

  return fx;
}

function applyCoinsBonus(baseCoins, effects) {
  const pct = effects?.coinsBonusPct || 0;
  const add = Math.floor((baseCoins || 0) * pct);
  return { total: (baseCoins || 0) + add, bonus: add };
}

function applyXpBonus(baseXp, effects) {
  const pct = effects?.xpBonusPct || 0;
  const add = Math.floor((baseXp || 0) * pct);
  return { total: (baseXp || 0) + add, bonus: add };
}

function applyBossLuck(loot, effects) {
  const p = Math.max(0, effects?.chestLuckPct || 0); // проценты
  if (!loot || loot.type !== "key" || p <= 0) return loot;
  if (Math.random() * 100 < p) return { type: "chest", rarity: loot.rarity };
  return loot;
}

function getBuffKey(itemId) {
  const shopIt = getShopItem(itemId);
  const rarity = shopIt?.rarity || "common";
  const bm = safeBuffMeta(itemId, rarity);
  return bm?.key || "none";
}

function describeBuff(itemId) {
  const it = getShopItem(itemId) || { id: itemId, rarity: "common", price: 0 };
  const bm = safeBuffMeta(itemId, it.rarity);
  const key = bm.key;

  if (key === "simplify_manual") return "🧰 кнопка: убрать 2 ответа";
  if (key === "none") return "—";

  const eff = scaledEffectForItem(key, it);
  if (key === "gold") return `🪙 +${Math.round((eff.coinsBonusPct || 0) * 100)}% монет`;
  if (key === "xp") return `📘 +${Math.round((eff.xpBonusPct || 0) * 100)}% XP`;
  if (key === "luck") return `🍀 +${Math.round(eff.chestLuckPct || 0)}% удачи`;

  return bm.text || "—";
}

module.exports = {
  calcEffects,
  applyCoinsBonus,
  applyXpBonus,
  applyBossLuck,
  getBuffKey,
  describeBuff,
};
