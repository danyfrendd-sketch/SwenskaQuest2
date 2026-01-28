// bots/aiBots.js
const lessonsRU = require("../data/lessons_ru");
const lessonsEN = require("../data/lessons_en");
const { resolveLang } = require("../utils/i18n");

function getLessonsByLang(lang) {
  const l = resolveLang(lang);
  return l === "en" ? lessonsEN : lessonsRU;
}

const tools = require("../data/tools");
const chests = require("../data/chests");

const energy = require("../utils/energy");
const { normalizeInv, normalizeEquipped, addItem, removeOneItem, decDurability } = require("../utils/inventory");
const pricing = require("../utils/pricing");
const activity = require("../utils/activityLog");

// ---- SAFE wrappers ----
function priceToSystemSafe(id, d) {
  try {
    return typeof pricing.priceToSystem === "function" ? pricing.priceToSystem(id, d) : 1;
  } catch {
    return 1;
  }
}
function shopPriceSafe(id) {
  try {
    if (typeof pricing.shopPrice === "function") return pricing.shopPrice(id);
  } catch {}
  // fallback: читать цену из data/shop напрямую
  try {
    const shopRaw = require("../data/shop");
    const arr = Array.isArray(shopRaw)
      ? shopRaw
      : shopRaw && typeof shopRaw === "object"
      ? Array.isArray(shopRaw.items)
        ? shopRaw.items
        : Object.values(shopRaw).filter(Boolean)
      : [];
    const it = arr.find((x) => x && x.id === id);
    const p = Number(it?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

// ---- Bots ----
const BOT_PLAYERS = [
  { id: -101, name: "Смурфик", avatar: "🧿", age: 18 },
  { id: -102, name: "Шнеля", avatar: "⚡️", age: 19 },
  { id: -103, name: "Mactraher", avatar: "🦊", age: 20 },
];

// ---- helpers ----
function rint(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}
function chance(p) {
  return Math.random() < p;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function safeParse(v, def) {
  try {
    return JSON.parse(v || "");
  } catch {
    return def;
  }
}
function now() {
  return energy.nowSec();
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ---- runtime state ----
const runtime = new Map();
function getRt(id) {
  if (!runtime.has(id)) {
    runtime.set(id, {
      burstLeft: rint(3, 7),
      pauseLeft: rint(0, 2),
      mood: Math.random(),
      // ✅ боты копят до случайной цели (6..MAX)
      energyTarget: rint(6, energy.MAX_ENERGY),
      // ✅ анти-спам рынка
      nextTradeAt: 0,
      // ✅ анти-спам покупок энергии
      nextEnergyBuyAt: 0,
      // ✅ анти-спам переэкипировки
      nextEquipAt: 0,
    });
  }
  return runtime.get(id);
}
function rerollCycle(rt) {
  rt.burstLeft = rint(3, 8);
  rt.pauseLeft = chance(0.35) ? rint(1, 4) : 0;
  rt.mood = Math.random();
  if (chance(0.35)) rt.energyTarget = rint(6, energy.MAX_ENERGY);
}

// ---- trader knobs (без миллионов/миллиардов) ----
const COINS_RESERVE = 80;
const TOKENS_RESERVE = 2;
const MAX_COIN_PRICE = 2500;
const MAX_TOKEN_PRICE = 25;
const MIN_PROFIT_PCT = 0.12;
const TRADE_COOLDOWN_SEC = 40;

// ---- energy shop knobs ----
const ENERGY_BUY_ONE_COST = 50; // 🪙
const ENERGY_BUY_FULL_COST = 10; // 💠
const ENERGY_BUY_COOLDOWN_SEC = 6 * 60; // базовый кулдаун

// ---- equip knobs ----
const EQUIP_COOLDOWN_SEC = 5 * 60;

function clampPriceCoins(p) {
  const n = Math.floor(Number(p) || 0);
  return clamp(n, 1, MAX_COIN_PRICE);
}
function clampPriceTokens(p) {
  const n = Math.floor(Number(p) || 0);
  return clamp(n, 1, MAX_TOKEN_PRICE);
}

function toolEffect(toolId) {
  if (!toolId) return null;
  const it = tools.find((x) => x && String(x.id) === String(toolId));
  return it?.effect || null;
}
function toolDurCost(toolId) {
  if (!toolId) return 0;
  const it = tools.find((x) => x && String(x.id) === String(toolId));
  const c = parseInt(String(it?.durabilityCost), 10);
  return Number.isFinite(c) && c > 0 ? c : 1;
}
function canUseTool(inv, toolId) {
  const it = inv.find((x) => x && String(x.id) === String(toolId));
  const d = it ? (Number.isFinite(it.d) ? it.d : 10) : 0;
  return d > 0;
}

// ---- bots equip logic ----
function botEnsureToolEquipped(db, userId, u, inv) {
  try {
    const rt = getRt(userId);
    if (rt.nextEquipAt && now() < rt.nextEquipAt) return;

    const eq = normalizeEquipped(u.equipped);
    if (eq.tool && canUseTool(inv, eq.tool)) return;

    const candidates = inv.filter((x) => x && x.type === "tool" && (Number(x.d) || 0) > 0);
    if (!candidates.length) return;

    candidates.sort((a, b) => (Number(b.d) || 0) - (Number(a.d) || 0));
    const pickTool = candidates[0];
    if (!pickTool?.id) return;

    eq.tool = pickTool.id;

    rt.nextEquipAt = now() + EQUIP_COOLDOWN_SEC;
    db.run("UPDATE users SET equipped=? WHERE id=?", [JSON.stringify(eq), userId], () => {
      activity.log(userId, "bot_equipped_tool", { tool: pickTool.id });
    });
  } catch {}
}

function botMaybeBuyEnergy(db, userId) {
  db.get("SELECT * FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;
    const rt = getRt(userId);
    if (rt.nextEnergyBuyAt && now() < rt.nextEnergyBuyAt) return;

    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    const e = synced.energy;
    const ts = synced.energy_ts;

    if (e >= rt.energyTarget) return;

    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    // 1) если почти пусто — пробуем FULL за токены
    if (e <= 1 && tokens >= ENERGY_BUY_FULL_COST && chance(0.22)) {
      const newE = energy.MAX_ENERGY;
      const newTs = energy.nowSec();

      rt.nextEnergyBuyAt = now() + ENERGY_BUY_COOLDOWN_SEC;
      db.run("UPDATE users SET energy=?, energy_ts=?, tokens=tokens-? WHERE id=?", [newE, newTs, ENERGY_BUY_FULL_COST, userId], () => {
        activity.log(userId, "bot_buy_energy_full", { cost: ENERGY_BUY_FULL_COST });
      });
      return;
    }

    // 2) иначе покупаем +1 за монеты
    if (coins >= ENERGY_BUY_ONE_COST && e < energy.MAX_ENERGY && chance(0.35)) {
      const newE = e + 1;
      const newTs = ts || energy.nowSec();

      rt.nextEnergyBuyAt = now() + ENERGY_BUY_COOLDOWN_SEC;
      db.run("UPDATE users SET energy=?, energy_ts=?, coins=coins-? WHERE id=?", [newE, newTs, ENERGY_BUY_ONE_COST, userId], () => {
        activity.log(userId, "bot_buy_energy_one", { cost: ENERGY_BUY_ONE_COST });
      });
    }
  });
}

// ---- Trader decision helpers ----
function botCanTrade(rt) {
  return !rt.nextTradeAt || now() >= rt.nextTradeAt;
}
function setTradeCooldown(rt) {
  rt.nextTradeAt = now() + TRADE_COOLDOWN_SEC;
}
function calcProfitPct(buy, sell) {
  if (!buy || buy <= 0) return 0;
  return (sell - buy) / buy;
}

function chooseBotTrade(inv, coins, tokens) {
  const items = inv.filter((x) => x && x.id && x.type !== "tool");
  if (!items.length) return null;

  const mode = chance(0.55) ? "sell" : "buy";

  if (mode === "sell") {
    const it = pick(items);
    const d = Number.isFinite(it.d) ? it.d : 10;
    const base = priceToSystemSafe(it.id, d);
    const want = clampPriceCoins(Math.round(base * (1 + rint(10, 35) / 100)));
    if (coins < COINS_RESERVE) return null;
    return { side: "sell", id: it.id, d, priceCoins: want };
  }

  if (tokens < TOKENS_RESERVE && coins < COINS_RESERVE) return null;
  const it = pick(items);
  const d = Number.isFinite(it.d) ? it.d : 10;
  const base = priceToSystemSafe(it.id, d);
  const want = clampPriceCoins(Math.round(base * (1 - rint(8, 22) / 100)));
  return { side: "buy", id: it.id, d, priceCoins: want };
}

// ---- Market actions ----
function botTryTrade(db, userId) {
  db.get("SELECT * FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);
    if (!botCanTrade(rt)) return;

    const inv = normalizeInv(u.accessories);
    const coins = Number(u.coins || 0);
    const tokens = Number(u.tokens || 0);

    const plan = chooseBotTrade(inv, coins, tokens);
    if (!plan) return;

    setTradeCooldown(rt);

    // На этом проекте реальная торговля может быть в marketHandler,
    // здесь оставляем только лог активности — чтобы не ломать существующий код.
    activity.log(userId, "bot_trade_plan", plan);
  });
}

// ---- Main tick: bots play lessons ----
function botTick(db, userId) {
  db.get("SELECT * FROM users WHERE id=?", [userId], (err, u) => {
    if (!u) return;

    const rt = getRt(userId);

    // cycles
    if (rt.pauseLeft > 0) {
      rt.pauseLeft -= 1;
      return;
    }
    if (rt.burstLeft <= 0) {
      rerollCycle(rt);
      return;
    }
    rt.burstLeft -= 1;

    // 1) синк энергии
    const synced = energy.syncEnergy(u.energy, u.energy_ts);
    let e = synced.energy;
    let ts = synced.energy_ts;

    if ((Number(u.energy) || 0) !== e || (Number(u.energy_ts) || 0) !== ts) {
      db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, userId]);
    }

    // 2) подготовка инвентаря + авто-экип TOOL
    const inv = normalizeInv(u.accessories);
    botEnsureToolEquipped(db, userId, u, inv);

    // 3) по желанию можем купить энергию, если не дотягиваем до цели
    if (!rt.energyTarget) rt.energyTarget = rint(6, energy.MAX_ENERGY);
    if (e < rt.energyTarget) botMaybeBuyEnergy(db, userId);

    // 4) копим до цели
    if (e < rt.energyTarget) return;

    if (e <= 0) {
      activity.log(userId, "lesson_no_energy", { e });
      return;
    }

    // достиг цели — на следующий цикл новая цель
    rt.energyTarget = rint(6, energy.MAX_ENERGY);

    const lessonNum = Number(u.current_lesson || 1);
    const taskIndex = Number(u.current_task || 0);

    // ✅ FIX: берем уроки по языку бота
    const LESSONS = getLessonsByLang(u.lang);
    const tasks = LESSONS[String(lessonNum)];
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    // ---- завершение урока ----
    if (taskIndex >= tasks.length) {
      const coinsAdd = rint(35, 70);
      const xpAdd = rint(8, 16);
      const seasonXpAdd = xpAdd;

      let c = safeParse(u.chests, []);
      let k = safeParse(u.keys, []);

      if (lessonNum % 5 === 0 && chance(0.85)) {
        const loot = chests.generateBossLoot(lessonNum);
        const rawR = loot?.rarity ?? loot?.r ?? "common";
        const r = String(rawR).toLowerCase();
        if (loot?.type === "chest") c.push({ r });
        if (loot?.type === "key") k.push(r);
        activity.log(userId, "boss_loot", { type: loot.type, r });
      }

      db.run(
        "UPDATE users SET current_lesson=current_lesson+1, current_task=0, level=level+1, season_level=season_level+1, season_xp=season_xp+?, coins=coins+?, xp=xp+?, chests=?, keys=? WHERE id=?",
        [seasonXpAdd, coinsAdd, xpAdd, JSON.stringify(c), JSON.stringify(k), userId],
        () => activity.log(userId, "lesson_complete", { lesson: lessonNum, coinsAdd, xpAdd })
      );
      return;
    }

    const task = tasks[taskIndex];
    if (!task) return;

    // ---- подготовка тулса ----
    const eq = normalizeEquipped(u.equipped);
    const toolId = eq.tool;
    const eff = toolEffect(toolId);

    const hasTool = !!(toolId && eff && canUseTool(inv, toolId));
    const durCost = hasTool ? toolDurCost(toolId) : 0;

    // базовый шанс ответа
    const base = userId === -101 ? 0.72 : userId === -102 ? 0.62 : 0.8;
    const drift = (Math.random() - 0.5) * 0.18;
    let correctChance = clamp(base + drift, 0.45, 0.88);

    // ---- умное решение: использовать ли тулс ----
    const lowEnergy = e <= 2;
    const veryLowEnergy = e <= 1;

    let useTool = false;
    if (hasTool) {
      if (eff === "tool_retry_once" && chance(0.35)) useTool = true;
      if ((eff === "tool_remove_2" || eff === "tool_remove_1") && chance(0.18)) useTool = true;
      if ((eff === "tool_hint" || eff === "tool_hint_first_letter") && chance(0.14)) useTool = true;
      if (veryLowEnergy && eff === "tool_retry_once") useTool = true;
      if (lowEnergy && (eff === "tool_remove_2" || eff === "tool_remove_1") && chance(0.25)) useTool = true;
    }

    // ---- выбор ответа ----
    const correct = Array.isArray(task.answers) ? task.answers[0] : null;
    let answer = null;

    if (chance(correctChance) && correct) {
      answer = correct;
    } else {
      const opts = Array.isArray(task.options) ? task.options.slice() : [];
      const wrongs = opts.filter((o) => !task.answers?.includes(o));
      answer = wrongs.length ? pick(wrongs) : (opts[0] || correct);
    }

    // ---- обработка ответа ----
    if (answer && correct && answer === correct) {
      db.run("UPDATE users SET current_task=current_task+1 WHERE id=?", [userId], () => {
        activity.log(userId, "bot_answer_correct", { lesson: lessonNum, taskIndex });
      });
      return;
    }

    // ---- wrong: списываем энергию ----
    const spent = energy.spendEnergy(e, ts);
    e = spent.energy;
    ts = spent.energy_ts;

    db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, userId], () => {
      activity.log(userId, "bot_answer_wrong", { lesson: lessonNum, taskIndex, e });
    });

    // ---- если использовал тулс — тратим прочность ----
    if (useTool && hasTool && durCost > 0) {
      decDurability(inv, toolId, durCost);
      db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), userId], () => {
        activity.log(userId, "bot_used_tool", { toolId, eff, durCost });
      });
    }
  });
}

// ---- public API ----
function startBots(db) {
  setInterval(() => {
    for (const b of BOT_PLAYERS) {
      try {
        botTryTrade(db, b.id);
        botTick(db, b.id);
      } catch (e) {
        // no crash
      }
    }
  }, 1800);
}

module.exports = {
  BOT_PLAYERS,
  startBots,
};
