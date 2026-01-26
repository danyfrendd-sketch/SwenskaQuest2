const shopRaw = require("../data/shop");

function normalizeShop(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    return Object.values(raw).filter(Boolean);
  }
  return [];
}

const SHOP = normalizeShop(shopRaw);

function itemRarity(id) {
  return SHOP.find((x) => x && x.id === id)?.rarity || "common";
}

function shopPrice(id) {
  const item = SHOP.find((x) => x && x.id === id);
  if (!item) return null;
  const price = parseInt(String(item.price ?? 0), 10);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function priceToSystem(id, durability = 10) {
  const r = itemRarity(id);
  const base = (
    r === "legendary" ? 400 :
    r === "epic" ? 200 :
    r === "rare" ? 90 : 35
  );

  const d = Math.max(0, Math.min(10, parseInt(durability, 10) || 0));
  const mult = 0.3 + (d / 10) * 0.7; // 0.3..1.0
  return Math.max(1, Math.round(base * mult));
}

module.exports = { priceToSystem, itemRarity, shopPrice };
