// data/chests.js
const shopRaw = require("./shop");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}

const shopItems = normalizeShop(shopRaw);
const rarityOrder = ["common", "rare", "epic", "legendary"];

function idx(r) {
  const i = rarityOrder.indexOf(String(r || "").toLowerCase());
  return i === -1 ? 0 : i;
}

// ✅ ключ >= сундука
function canOpen(chestRarity, keyRarity) {
  return idx(keyRarity) >= idx(chestRarity);
}

/**
 * ✅ Приоритет ключа:
 * 1) точь-в-точь такой же
 * 2) иначе минимально более высокий
 */
function pickBestKeyIndex(keys, chestRarity) {
  if (!Array.isArray(keys) || keys.length === 0) return -1;

  const cr = String(chestRarity || "").toLowerCase();

  const same = keys.findIndex((k) => String(k || "").toLowerCase() === cr);
  if (same !== -1) return same;

  const chestI = idx(cr);
  let bestI = -1;
  let bestRank = 999;

  for (let i = 0; i < keys.length; i++) {
    const r = idx(keys[i]);
    if (r > chestI && r < bestRank) {
      bestRank = r;
      bestI = i;
    }
  }
  return bestI;
}

// -------------------- DROP TUNING --------------------

// Веса редкости награды в зависимости от редкости сундука
const rewardWeightsByChest = {
  common: { common: 60, rare: 30, epic: 9, legendary: 1 },
  rare: { common: 25, rare: 50, epic: 22, legendary: 3 },
  epic: { common: 10, rare: 35, epic: 45, legendary: 10 },
  legendary: { common: 5, rare: 20, epic: 45, legendary: 30 },
};

// Шанс монет по редкости сундука (чем выше — тем меньше монет)
const coinChanceByChest = {
  common: 0.40,
  rare: 0.30,
  epic: 0.20,
  legendary: 0.10,
};

function rollWeighted(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + (Number(w) || 0), 0) || 1;
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= Number(w) || 0;
    if (r <= 0) return key;
  }
  return entries[0][0];
}

function pickItemByRarity(r) {
  const pool = shopItems.filter((i) => i && i.rarity === r);
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];

  // fallback: если вдруг нет предметов такой редкости
  const any = shopItems.filter(Boolean);
  if (!any.length) return null;
  return any[Math.floor(Math.random() * any.length)];
}

// -------------------- BOSS LOOT (подкручено) --------------------
// Каждые 10 уроков: главный босс -> сундук
// Остальные каждые 5: мини босс -> ключ
function generateBossLoot(lessonNumber) {
  const n = Number(lessonNumber || 1);

  const roll = Math.random() * 100;
  let rarity = "common";

  if (n % 10 === 0) {
    // 🎁 Сундук (сделали вкуснее)
    if (roll <= 5) rarity = "legendary";
    else if (roll <= 22) rarity = "epic";
    else if (roll <= 55) rarity = "rare";
    return { type: "chest", rarity };
  }

  // 🔑 Ключ (тоже вкуснее)
  if (roll <= 2) rarity = "legendary";
  else if (roll <= 12) rarity = "epic";
  else if (roll <= 35) rarity = "rare";
  return { type: "key", rarity };
}

// -------------------- CHEST REWARD --------------------
function getChestReward(chestRarity) {
  const cr = String(chestRarity || "common").toLowerCase();
  const chestR = rarityOrder.includes(cr) ? cr : "common";

  const coinChance = coinChanceByChest[chestR] ?? 0.35;
  const isCoin = Math.random() < coinChance;

  if (isCoin) {
    const mult = idx(chestR) + 1;
    // монеты тоже слегка подняли, чтобы не было “копейки”
    const amount = Math.floor(Math.random() * (mult * 220)) + 80;
    return { type: "coins", amount, name: `${amount} 🪙` };
  }

  const weights = rewardWeightsByChest[chestR] || rewardWeightsByChest.common;
  const rewardRarity = rollWeighted(weights);

  const item = pickItemByRarity(rewardRarity);
  if (!item) return { type: "coins", amount: 100, name: "100 🪙" };

  return { type: "item", ...item };
}

module.exports = {
  generateBossLoot,
  canOpen,
  pickBestKeyIndex,
  getChestReward,
  shopItems,
};
