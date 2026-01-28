// handlers/gameHandler.js  (MP4 chests + ENERGY system + FIX boss loot + TOOLS BUFFS)
const db = require("../database/db");
const kb = require("../ui/keyboards");
const fmt = require("../utils/formatter");
const speak = require("../utils/tts");

const lessonsRU = require("../data/lessons_ru"); // ✅ your ru file
const lessonsEN = require("../data/lessons_en"); // ✅ your en file

const chests = require("../data/chests");
const rarities = require("../data/rarities");
const toolsData = require("../data/tools");

const fs = require("fs");
const path = require("path");

const { normalizeInv, normalizeEquipped, addItem, decDurability } = require("../utils/inventory");
const { calcEffects, applyCoinsBonus, applyXpBonus, applyBossLuck } = require("../utils/buffsEngine");
const { formatLine } = require("../utils/itemCard");
const energy = require("../utils/energy");
const { t, resolveLang } = require("../utils/i18n");

// ✅ helper: choose lessons by current user language
function getLessonsByLang(lang) {
  const l = resolveLang(lang);
  return l === "en" ? lessonsEN : lessonsRU;
}

function safeParse(v) {
  try {
    return JSON.parse(v || "[]");
  } catch {
    return [];
  }
}

function safeUpper(x) {
  return String(x || "").toUpperCase();
}

function normalizeRarity(x) {
  const r = String(x || "").toLowerCase();
  if (["common", "rare", "epic", "legendary"].includes(r)) return r;
  return "common";
}

// ---- Tools helpers ----
const TOOL_MAP = new Map();
for (const t of toolsData) TOOL_MAP.set(String(t.id), t);

function getTool(toolId) {
  return TOOL_MAP.get(String(toolId || "")) || null;
}
function toolCost(toolId) {
  const t = getTool(toolId);
  const c = parseInt(String(t?.durabilityCost), 10);
  return Number.isFinite(c) && c > 0 ? c : 1;
}
function toolEffect(toolId) {
  return getTool(toolId)?.effect || null;
}
function toolName(toolId) {
  return getTool(toolId)?.name || String(toolId || "");
}

// ---- Chest videos (ui/templates) ----
const CHEST_VID_DIR = path.join(__dirname, "..", "ui", "templates");
const CHEST_VIDEO_BY_RARITY = {
  common: path.join(CHEST_VID_DIR, "common_chest.mp4"),
  rare: path.join(CHEST_VID_DIR, "rare_chest.mp4"),
  epic: path.join(CHEST_VID_DIR, "epic_chest.mp4"),
  legendary: path.join(CHEST_VID_DIR, "legendary_chest.mp4"),
};

async function sendChestVideoCard(bot, chatId, rarity) {
  const r = normalizeRarity(rarity);
  const videoPath = CHEST_VIDEO_BY_RARITY[r] || CHEST_VIDEO_BY_RARITY.common;

  try {
    if (!videoPath || !fs.existsSync(videoPath)) return false;

    await bot.sendVideo(chatId, fs.createReadStream(videoPath), {
      caption: `🎁 Сундук: <b>${safeUpper(r)}</b>`,
      parse_mode: "HTML",
    });
    return true;
  } catch (e1) {
    console.error("sendVideo failed, try sendAnimation:", e1?.message || e1);
    try {
      await bot.sendAnimation(chatId, fs.createReadStream(videoPath), {
        caption: `🎁 Сундук: <b>${safeUpper(r)}</b>`,
        parse_mode: "HTML",
      });
      return true;
    } catch (e2) {
      console.error("sendChestVideoCard error:", e2?.message || e2);
      return false;
    }
  }
}

// ---- anti-spam on same question ----
function makeToolGuardKey(id, lesson, task) {
  return `${id}:${lesson}:${task}`;
}
const toolUsed = new Set();
const lessonToolUsed = new Set();

// ---- retry guard (2nd try) ----
const retryGranted = new Set(); // key: id:lesson:task
function makeRetryKey(id, lesson, task) {
  return `${id}:${lesson}:${task}`;
}

function makeLessonToolKey(id, lesson) {
  return `${id}:${lesson}`;
}

function calcSeasonXp(baseXp, effects, usedTool) {
  const hasXpBuff = (effects?.xpBonusPct || 0) > 0;
  const penalty = hasXpBuff || usedTool ? 0.5 : 1;
  return Math.max(1, Math.round(baseXp * penalty));
}

// ---- build keyboards ----
function buildOptionsKeyboard(options) {
  if (options.length === 1) return [[{ text: options[0], callback_data: `ans_${options[0]}` }]];
  if (options.length === 2) {
    return [[
      { text: options[0], callback_data: `ans_${options[0]}` },
      { text: options[1], callback_data: `ans_${options[1]}` },
    ]];
  }
  return [
    options.slice(0, 2).map((o) => ({ text: o, callback_data: `ans_${o}` })),
    options.slice(2, 4).map((o) => ({ text: o, callback_data: `ans_${o}` })),
  ];
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOptionsKeepN(task, keepCount) {
  const correct = task.answers?.[0];
  const all = Array.isArray(task.options) ? task.options.slice() : [];
  const wrongs = all.filter((o) => !task.answers.includes(o));

  const keep = [];
  if (correct) keep.push(correct);

  const needWrong = Math.max(0, Math.min(wrongs.length, keepCount - keep.length));
  const pool = shuffleArray(wrongs);

  for (let i = 0; i < needWrong; i++) keep.push(pool[i]);

  if (keep.length < Math.min(keepCount, all.length)) {
    for (const o of all) {
      if (keep.length >= keepCount) break;
      if (!keep.includes(o)) keep.push(o);
    }
  }

  return shuffleArray(keep);
}

function hintFirstLetter(task) {
  const correct = task.answers?.[0];
  if (!correct) return null;
  return String(correct).slice(0, 1);
}

const gameHandler = {
  sendProfile(bot, id) {
    db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const synced = energy.syncEnergy(u.energy, u.energy_ts);
      if ((Number(u.energy) || 0) !== synced.energy || (Number(u.energy_ts) || 0) !== synced.energy_ts) {
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [synced.energy, synced.energy_ts, id]);
      }

      const lang = resolveLang(u.lang);
      const next =
        synced.energy >= energy.MAX_ENERGY
          ? ""
          : t(lang, "profile.energy_next", { next: energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts)) });
      const extra = `\n${t(lang, "profile.energy_line", { cur: synced.energy, max: energy.MAX_ENERGY, next })}`;

      bot.sendMessage(id, fmt.formatProfile(u, lang) + extra, { parse_mode: "HTML" });
    });
  },

  sendLeaderboard(bot, id) {
    db.get("SELECT lang FROM users WHERE id=?", [id], (err, u) => {
      const lang = resolveLang(u?.lang);
      db.all("SELECT * FROM users ORDER BY current_lesson DESC, season_xp DESC LIMIT 10", [], (e2, rows) => {
        bot.sendMessage(id, fmt.formatLeaderboard(rows, lang), { parse_mode: "HTML" });
      });
    });
  },

  sendSettings(bot, id) {
    db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
      const lang = resolveLang(u?.lang);
      const menu = kb.settingsMenu(lang, !!u?.audio_enabled);
      bot.sendMessage(id, t(lang, "settings.title"), { parse_mode: "HTML", reply_markup: menu });
    });
  },

  sendChestsMenu(bot, id) {
    db.get("SELECT chests, keys FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const c = safeParse(u.chests);
      const k = safeParse(u.keys);

      const order = ["common", "rare", "epic", "legendary"];

      const keyCounts = order.reduce((acc, r) => {
        acc[r] = 0;
        return acc;
      }, {});
      for (const r of k) {
        if (keyCounts[r] !== undefined) keyCounts[r] += 1;
      }

      const chanceLine = order
        .map((r) => {
          const icon = rarities?.[r]?.icon || "";
          const score = Number(rarities?.[r]?.dropScore || 0);
          const pct = score ? score / 10 : 0;
          return `${icon}${pct}%`;
        })
        .join(" ");

      const lang = resolveLang(u.lang);
      let text = `${t(lang, "chests.storage")}\n\n`;
      text += `${t(lang, "chests.keys")}\n`;
      text += order.map((r) => `${rarities?.[r]?.icon || ""} <b>${keyCounts[r] || 0}</b>`).join(" ");
      text += `\n\n${t(lang, "chests.chances", { chances: chanceLine })}\n\n`;

      text += c.length
        ? c.map((x, i) => `${i + 1}. 🎁 <b>${safeUpper(x?.r)}</b>`).join("\n")
        : t(lang, "chests.empty");

      const kbInline = { inline_keyboard: [] };
      if (c.length) {
        c.forEach((x, i) => {
          kbInline.inline_keyboard.push([
            { text: t(lang, "chests.open_button", { index: i + 1, rarity: safeUpper(x?.r) }), callback_data: `open_ch_${i}` },
          ]);
        });
      }

      bot.sendMessage(id, text, { parse_mode: "HTML", reply_markup: kbInline });
    });
  },

  sendLessonTask(bot, id) {
    db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
      if (!u) return;

      const synced = energy.syncEnergy(u.energy, u.energy_ts);
      if ((Number(u.energy) || 0) !== synced.energy || (Number(u.energy_ts) || 0) !== synced.energy_ts) {
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [synced.energy, synced.energy_ts, id]);
      }

      const lang = resolveLang(u.lang);
      const LESSONS = getLessonsByLang(lang);
      const tasks = LESSONS[String(u.current_lesson)];

      if (!Array.isArray(tasks) || tasks.length === 0) {
        console.error("LESSON NOT FOUND:", u.current_lesson);
        return bot.sendMessage(
          id,
          t(lang, "lessons.not_found", { lesson: u.current_lesson }),
          { parse_mode: "HTML" }
        );
      }

      if (u.current_task < tasks.length) {
        if (synced.energy <= 0) {
          const wait = energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts));
          return bot.sendMessage(
            id,
            `${t(lang, "errors.no_energy")}\n${t(lang, "energy.wait", { wait })}\n\n${t(lang, "energy.menu_hint")}`,
            { parse_mode: "HTML" }
          );
        }

        const task = tasks[u.current_task];
        if (!task) {
          console.error("TASK NOT FOUND:", u.current_lesson, u.current_task);
          return bot.sendMessage(id, t(lang, "lessons.task_not_found"));
        }

        const inv = normalizeInv(u.accessories);
        const eq = normalizeEquipped(u.equipped);

        const toolId = eq.tool;
        let canUseTool = false;

        if (toolId) {
          const it = inv.find((x) => x && x.id === toolId);
          const d = it ? (Number.isFinite(it.d) ? it.d : 10) : 0;
          const eff = toolEffect(toolId);
          if (d > 0 && eff) canUseTool = true;
        }

        const opts = Array.isArray(task.options) ? task.options.slice() : [];
        const inline_keyboard = buildOptionsKeyboard(opts);

        if (canUseTool) {
          inline_keyboard.push([
            { text: t(lang, "tool.use_button"), callback_data: `usebuff_${u.current_lesson}_${u.current_task}` },
          ]);
        }

        const next =
          synced.energy >= energy.MAX_ENERGY
            ? ""
            : ` • next: ${energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts))}`;

        bot.sendMessage(
          id,
          `⚡ <b>${synced.energy}</b>/<b>${energy.MAX_ENERGY}</b>${next}\n\n` +
            `${t(lang, "lesson.title", { lesson: u.current_lesson })}\n${t(lang, "lesson.question", { index: u.current_task + 1, total: tasks.length })}\n\n` +
            `${t(lang, "lessons.word")}: <code>${task.word}</code>`,
          { parse_mode: "HTML", reply_markup: { inline_keyboard } }
        );

        if (u.audio_enabled) {
          speak(task.word, (filePath) => bot.sendVoice(id, filePath).catch(() => {}));
        }
        return;
      }

      // завершение урока
      const inv = normalizeInv(u.accessories);
      const eq = normalizeEquipped(u.equipped);
      const effects = calcEffects({ equipped: eq, inv });

      const baseStageCoins = 50;
      const baseStageXp = 10;

      const coinRes = applyCoinsBonus(baseStageCoins, effects);
      const xpRes = applyXpBonus(baseStageXp, effects);
      const lessonToolKey = makeLessonToolKey(id, u.current_lesson);
      const seasonXpAdd = calcSeasonXp(baseStageXp, effects, lessonToolUsed.has(lessonToolKey));

      let c = safeParse(u.chests);
      let k = safeParse(u.keys);
      let bossMsg = "";

      if (u.current_lesson % 5 === 0) {
        let loot = chests.generateBossLoot(u.current_lesson);
        try {
          loot = applyBossLuck(loot, effects);
        } catch (e) {
          console.error("applyBossLuck error:", e);
        }

        const type = loot?.type;
        const rawRarity = loot?.rarity ?? loot?.r ?? loot?.rarityKey;
        const r = normalizeRarity(rawRarity);

        if (type === "chest") c.push({ r });
        else if (type === "key") k.push(r);

        const emoji = type === "chest" ? "🎁" : "🔑";
        bossMsg =
          `\n\n${t(lang, "boss.defeated")}\n` +
          t(lang, "boss.loot", { emoji, type: type === "chest" ? t(lang, "boss.chest") : t(lang, "boss.key"), rarity: safeUpper(r) });
      }

      // ломаем прочность на HEAD/BODY/CHARM (как было)
      for (const slot of ["head", "body", "charm"]) {
        const itemId = eq[slot];
        if (!itemId) continue;
        decDurability(inv, itemId, 1);
      }

      db.run(
        "UPDATE users SET current_lesson=current_lesson+1, current_task=0, level=level+1, season_level=season_level+1, season_xp=season_xp+?, coins=coins+?, xp=xp+?, chests=?, keys=?, accessories=? WHERE id=?",
        [seasonXpAdd, coinRes.total, xpRes.total, JSON.stringify(c), JSON.stringify(k), JSON.stringify(inv), id],
        () => {
          const coinBonusLine = coinRes.bonus > 0 ? t(lang, "lesson.bonus_coins", { bonus: coinRes.bonus }) : "";
          const xpBonusLine = xpRes.bonus > 0 ? t(lang, "lesson.bonus_xp", { bonus: xpRes.bonus }) : "";

          bot.sendMessage(
            id,
            t(lang, "lesson.complete", {
              coins: coinRes.total,
              coinBonus: coinBonusLine,
              xp: xpRes.total,
              xpBonus: xpBonusLine,
              boss: bossMsg,
            }),
            { parse_mode: "HTML" }
          );

          lessonToolUsed.delete(lessonToolKey);
          this.sendLessonTask(bot, id);
        }
      );
    });
  },

  handleCallbacks(bot, q) {
    const id = q.message.chat.id;
    const data = q.data;
    const mid = q.message.message_id;

    // ---- USE TOOL ----
    if (data.startsWith("usebuff_")) {
      const parts = data.split("_");
      const lesson = parseInt(parts[1], 10);
      const taskIndex = parseInt(parts[2], 10);

      db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
        if (!u) return;

        const lang = resolveLang(u.lang);
        const LESSONS = getLessonsByLang(lang);

        if (u.current_lesson !== lesson || u.current_task !== taskIndex) {
          return bot.answerCallbackQuery(q.id, { text: t(lang, "tool.not_current") }).catch(() => {});
        }

        const task = LESSONS[String(u.current_lesson)]?.[u.current_task];
        if (!task) return;

        const inv = normalizeInv(u.accessories);
        const eq = normalizeEquipped(u.equipped);
        const toolId = eq.tool;
        if (!toolId) return bot.answerCallbackQuery(q.id, { text: t(lang, "tool.not_equipped") }).catch(() => {});

        const eff = toolEffect(toolId);
        if (!eff) return bot.answerCallbackQuery(q.id, { text: t(lang, "tool.no_effect") }).catch(() => {});

        const gk = makeToolGuardKey(id, lesson, taskIndex);
        if (toolUsed.has(gk)) {
          return bot.answerCallbackQuery(q.id, { text: t(lang, "tool.already_used") }).catch(() => {});
        }

        lessonToolUsed.add(makeLessonToolKey(id, lesson));
        const it = inv.find((x) => x && x.id === toolId);
        const d = it ? (Number.isFinite(it.d) ? it.d : 10) : 0;
        if (d <= 0) return bot.answerCallbackQuery(q.id, { text: t(lang, "tool.broken") }).catch(() => {});

        toolUsed.add(gk);

        const cost = toolCost(toolId);
        let newKeyboard = null;

        if (eff === "tool_remove_2") {
          const reduced = pickOptionsKeepN(task, 2);
          newKeyboard = buildOptionsKeyboard(reduced);
        } else if (eff === "tool_remove_1") {
          const reduced = pickOptionsKeepN(task, 3);
          newKeyboard = buildOptionsKeyboard(reduced);
        } else if (eff === "tool_hint" || eff === "tool_hint_first_letter") {
          const h = hintFirstLetter(task);
          bot.answerCallbackQuery(q.id, {
            text: h ? t(lang, "tool.hint_first_letter", { letter: h }) : t(lang, "tool.hint_unavailable"),
            show_alert: true,
          }).catch(() => {});
        } else if (eff === "tool_mark_suspect") {
          const correct = task.answers?.[0];
          const all = Array.isArray(task.options) ? task.options.slice() : [];
          const wrongs = all.filter((o) => !task.answers?.includes(o));
          let pick = null;

          if (wrongs.length && Math.random() < 0.75) {
            pick = wrongs[Math.floor(Math.random() * wrongs.length)];
          } else if (correct) {
            pick = correct;
          } else if (all.length) {
            pick = all[Math.floor(Math.random() * all.length)];
          }

          bot.answerCallbackQuery(q.id, {
            text: pick ? t(lang, "tool.suspect", { option: pick }) : t(lang, "tool.suspect_none"),
            show_alert: true,
          }).catch(() => {});
        } else if (eff === "tool_shuffle" || eff === "tool_shuffle_options") {
          const opts = shuffleArray(Array.isArray(task.options) ? task.options : []);
          newKeyboard = buildOptionsKeyboard(opts);
        } else if (eff === "tool_retry" || eff === "tool_retry_once") {
          const rk = makeRetryKey(id, lesson, taskIndex);
          retryGranted.add(rk);
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.retry_active"), show_alert: true }).catch(() => {});
        } else if (eff === "tool_repeat_audio") {
          if (u.audio_enabled) {
            speak(task.word, (filePath) => bot.sendVoice(id, filePath).catch(() => {}));
          }
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.repeat_audio"), show_alert: false }).catch(() => {});
        } else if (eff === "tool_bookmark" || eff === "tool_bookmark_word") {
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.bookmark"), show_alert: true }).catch(() => {});
        } else if (eff === "tool_skip_free" || eff === "tool_skip") {
          const synced = energy.syncEnergy(u.energy, u.energy_ts);

          if (eff === "tool_skip_free") {
            db.run(
              "UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?",
              [synced.energy, synced.energy_ts, id],
              () => this.sendLessonTask(bot, id)
            );
          } else {
            if (synced.energy <= 0) {
              bot.answerCallbackQuery(q.id, { text: t(lang, "tool.skip_no_energy"), show_alert: true }).catch(() => {});
            } else {
              const spent = energy.spendEnergy(synced.energy, synced.energy_ts);
              db.run(
                "UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?",
                [spent.energy, spent.energy_ts, id],
                () => this.sendLessonTask(bot, id)
              );
            }
          }
        } else if (eff === "tool_lock") {
          const pair = pickOptionsKeepN(task, 2);
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.locked", { pair: pair.join(" / ") }), show_alert: true }).catch(() => {});
        } else if (eff === "tool_show_answer") {
          const correct = task.answers?.[0];
          if (correct) newKeyboard = buildOptionsKeyboard([correct]);
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.answer_shown"), show_alert: true }).catch(() => {});
        } else {
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.effect_unsupported"), show_alert: true }).catch(() => {});
        }

        decDurability(inv, toolId, cost);

        if (newKeyboard) {
          bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: id, message_id: mid }).catch(() => {});
        }

        db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), id], () => {
          bot.answerCallbackQuery(q.id, { text: t(lang, "tool.used", { tool: toolName(toolId), cost }) }).catch(() => {});
        });
      });

      return;
    }

    // ---- ANSWERS ----
    if (data.startsWith("ans_")) {
      const ans = data.replace("ans_", "");

      db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
        if (!u) return;

        const lang = resolveLang(u.lang);
        const LESSONS = getLessonsByLang(lang);
        const task = LESSONS[String(u.current_lesson)]?.[u.current_task];
        if (!task) return;

        const synced = energy.syncEnergy(u.energy, u.energy_ts);
        let e = synced.energy;
        let ts = synced.energy_ts;

        if (e <= 0) {
          const wait = energy.formatWait(energy.secondsToNext(e, ts));
          bot.answerCallbackQuery(q.id, { text: t(lang, "answers.no_energy", { wait }), show_alert: true }).catch(() => {});
          db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
          return;
        }

        const isCorrect = Array.isArray(task.answers) && task.answers.includes(ans);

        if (isCorrect) {
          db.run("UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?", [e, ts, id], () => {
            this.sendLessonTask(bot, id);
          });
          return;
        }

        const rk = makeRetryKey(id, u.current_lesson, u.current_task);
        if (retryGranted.has(rk)) {
          retryGranted.delete(rk);
          bot.answerCallbackQuery(q.id, { text: t(lang, "answers.retry_free"), show_alert: true }).catch(() => {});
          return;
        }

        const spent = energy.spendEnergy(e, ts);
        e = spent.energy;
        ts = spent.energy_ts;

        const wait = e > 0 ? "" : ` Следующая через ${energy.formatWait(energy.secondsToNext(e, ts))}`;
        bot.answerCallbackQuery(
          q.id,
          { text: t(lang, "answers.wrong", { cur: e, max: energy.MAX_ENERGY, wait }), show_alert: true }
        ).catch(() => {});
        db.run("UPDATE users SET energy=?, energy_ts=? WHERE id=?", [e, ts, id]);
      });

      return;
    }

    // ---- CHESTS OPEN ----
    if (data.startsWith("open_ch_")) {
      const idx = parseInt(data.replace("open_ch_", ""), 10);

      db.get("SELECT * FROM users WHERE id=?", [id], async (err, u) => {
        try {
          if (!u) return;
          const lang = resolveLang(u.lang);

          let c = safeParse(u.chests);
          let k = safeParse(u.keys);

          const chest = c[idx];
          if (!chest) return bot.answerCallbackQuery(q.id, { text: t(lang, "chests.not_found") }).catch(() => {});

          let kIdx = -1;
          if (typeof chests.pickBestKeyIndex === "function") {
            kIdx = chests.pickBestKeyIndex(k, chest.r);
          } else {
            kIdx = k.findIndex((key) => chests.canOpen(chest.r, key));
          }

          if (kIdx === -1) {
            return bot.answerCallbackQuery(q.id, { text: t(lang, "chests.need_key", { rarity: safeUpper(chest.r) }), show_alert: true }).catch(() => {});
          }

          c.splice(idx, 1);
          const usedKey = k.splice(kIdx, 1)[0];

          await sendChestVideoCard(bot, id, chest.r);

          const rw = chests.getChestReward(chest.r);

          const inv = normalizeInv(u.accessories);
          let coins = u.coins || 0;

          if (rw.type === "coins") coins += Number(rw.amount) || 0;
          else if (rw.type === "item") addItem(inv, rw.id, 10);

          let dropText = "";
          if (rw.type === "coins") {
            const amt = Number(rw.amount) || 0;
            dropText = t(lang, "chests.drop_coins", { amount: amt.toLocaleString() });
          } else if (rw.type === "item") {
            dropText = t(lang, "chests.drop_item", { item: formatLine(rw.id, 10) });
          } else {
            dropText = t(lang, "chests.drop_other", { name: rw.name || t(lang, "common.ok") });
          }

          const keyText = t(lang, "chests.key_used", { key: safeUpper(usedKey) });
          const chestText = t(lang, "chests.opened", { rarity: safeUpper(chest.r) });

          db.run(
            "UPDATE users SET chests=?, keys=?, accessories=?, coins=? WHERE id=?",
            [JSON.stringify(c), JSON.stringify(k), JSON.stringify(inv), coins, id],
            () => {
              bot.sendMessage(id, `${chestText}\n${keyText}\n\n${dropText}`, { parse_mode: "HTML" }).catch(() => {});
              this.sendChestsMenu(bot, id);
            }
          );
        } catch (e) {
          console.error("open_ch_ fatal:", e);
          const lang = resolveLang(u?.lang);
          bot.sendMessage(id, t(lang, "chests.open_error"), kb.mainMenu(lang)).catch(() => {});
        }
      });

      return;
    }
  },
};

module.exports = gameHandler;
