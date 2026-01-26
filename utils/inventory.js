// utils/inventory.js

function safeParse(v, def) {
  try {
    return JSON.parse(v || "");
  } catch {
    return def;
  }
}

function toDur(x) {
  const d = parseInt(String(x), 10);
  return Number.isFinite(d) ? Math.max(0, Math.min(10, d)) : 10;
}

function normalizeInv(accessories) {
  let inv = accessories;

  if (typeof inv === "string") inv = safeParse(inv, []);
  if (!Array.isArray(inv)) inv = [];

  // поддержка старых форматов: ["t2", "x1"] или [{id:"t2"}] или {id:"t2", d:8}
  const out = [];
  for (const it of inv) {
    if (!it) continue;

    if (typeof it === "string") {
      out.push({ id: it, d: 10 });
      continue;
    }

    if (typeof it === "object") {
      // формат {id, d}
      if (it.id) {
        out.push({ id: String(it.id), d: toDur(it.d) });
        continue;
      }

      // иногда бывает {item_id, durability}
      if (it.item_id) {
        out.push({ id: String(it.item_id), d: toDur(it.durability ?? it.d) });
        continue;
      }
    }
  }

  return out;
}

function normalizeEquipped(equipped) {
  let eq = equipped;

  if (typeof eq === "string") eq = safeParse(eq, {});
  if (!eq || typeof eq !== "object") eq = {};

  return {
    head: eq.head || null,
    body: eq.body || null,
    tool: eq.tool || null,
    charm: eq.charm || null,
  };
}

function addItem(inv, id, durability = 10) {
  if (!Array.isArray(inv)) return false;
  if (!id) return false;

  inv.push({ id: String(id), d: toDur(durability) });
  return true;
}

function removeOneItem(inv, id) {
  if (!Array.isArray(inv)) return false;
  const target = String(id);

  const idx = inv.findIndex((x) => x && String(x.id) === target);
  if (idx === -1) return false;

  inv.splice(idx, 1);
  return true;
}

function decDurability(inv, id, amount = 1) {
  if (!Array.isArray(inv)) return { ok: false, removed: false, d: 0 };

  const target = String(id);
  const i = inv.findIndex((x) => x && String(x.id) === target);
  if (i === -1) return { ok: false, removed: false, d: 0 };

  const cur = toDur(inv[i].d);
  const next = Math.max(0, cur - Math.max(1, parseInt(amount, 10) || 1));

  inv[i].d = next;

  if (next <= 0) {
    inv.splice(i, 1);
    return { ok: true, removed: true, d: 0 };
  }

  return { ok: true, removed: false, d: next };
}

module.exports = {
  normalizeInv,
  normalizeEquipped,
  addItem,
  removeOneItem,
  decDurability,
};
