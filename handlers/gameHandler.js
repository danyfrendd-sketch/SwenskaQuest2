// handlers/gameHandler.js  (MP4 chests + ENERGY system + FIX boss loot + TOOLS BUFFS)
const db = require("../database/db");
const kb = require("../ui/keyboards");
const fmt = require("../utils/formatter");
const speak = require("../utils/tts");
const lessons = require("../data/lessons");
const chests = require("../data/chests");
const rarities = require("../data/rarities");
const toolsData = require("../data/tools");

const fs = require("fs");
const path = require("path");

const { normalizeInv, normalizeEquipped, addItem, decDurability } = require("../utils/inventory");
const { calcEffects, applyCoinsBonus, applyXpBonus, applyBossLuck } = require("../utils/buffsEngine");
const { formatLine } = require("../utils/itemCard");
const energy = require("../utils/energy");

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

  // сколько неверных оставить
  const needWrong = Math.max(0, Math.min(wrongs.length, keepCount - keep.length));
  const pool = shuffleArray(wrongs);

  for (let i = 0; i < needWrong; i++) keep.push(pool[i]);

  // если вдруг вариантов мало
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

      const next =
        synced.energy >= energy.MAX_ENERGY
          ? ""
          : ` (next: ${energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts))})`;
      const extra = `\n⚡ Энергия: <b>${synced.energy}</b>/<b>${energy.MAX_ENERGY}</b>${next}`;

      bot.sendMessage(id, fmt.formatProfile(u) + extra, { parse_mode: "HTML" });
    });
  },

  sendLeaderboard(bot, id) {
    db.all("SELECT * FROM users ORDER BY current_lesson DESC, season_xp DESC LIMIT 10", [], (err, rows) => {
      bot.sendMessage(id, fmt.formatLeaderboard(rows), { parse_mode: "HTML" });
    });
  },

  sendSettings(bot, id) {
    db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
      const btns = [
        [{ text: "✏️ Имя", callback_data: "set_name" }, { text: "🙂 Аватар", callback_data: "set_avatar" }],
        [{ text: u?.audio_enabled ? "🔊 Звук: ВКЛ" : "🔇 Звук: ВЫКЛ", callback_data: "toggle_audio" }],
        [{ text: "🎫 Промокод", callback_data: "use_promo" }],
      ];
      bot.sendMessage(id, "⚙️ <b>НАСТРОЙКИ</b>", { parse_mode: "HTML", reply_markup: { inline_keyboard: btns } });
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

      let text = `🎁 <b>ХРАНИЛИЩЕ</b>\n\n`;
      text += `🔑 <b>КЛЮЧИ:</b>\n`;
      text += order.map((r) => `${rarities?.[r]?.icon || ""} <b>${keyCounts[r] || 0}</b>`).join(" ");
      text += `\n\nШАНСЫ: ${chanceLine}\n\n`;

      text += c.length
        ? c.map((x, i) => `${i + 1}. 🎁 <b>${safeUpper(x?.r)}</b>`).join("\n")
        : "Пока пусто.";

      const kbInline = { inline_keyboard: [] };
      if (c.length) {
        c.forEach((x, i) => {
          kbInline.inline_keyboard.push([
            { text: `Открыть ${i + 1} (${safeUpper(x?.r)})`, callback_data: `open_ch_${i}` },
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

      const tasks = lessons[String(u.current_lesson)];
      if (!Array.isArray(tasks) || tasks.length === 0) {
        console.error("LESSON NOT FOUND:", u.current_lesson);
        return bot.sendMessage(
          id,
          `❌ Урок <b>${u.current_lesson}</b> не найден в lessons.js`,
          { parse_mode: "HTML" }
        );
      }

      if (u.current_task < tasks.length) {
        if (synced.energy <= 0) {
          const wait = energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts));
          return bot.sendMessage(
            id,
            `⚡ Энергия закончилась.\nСледующая через: <b>${wait}</b>\n\nЗайди в 🛒 Магазин чтобы купить энергию.`,
            { parse_mode: "HTML" }
          );
        }

        const task = tasks[u.current_task];
        if (!task) {
          console.error("TASK NOT FOUND:", u.current_lesson, u.current_task);
          return bot.sendMessage(id, "❌ Вопрос не найден. Открой урок заново.");
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
            { text: "🧰 Использовать инструмент", callback_data: `usebuff_${u.current_lesson}_${u.current_task}` },
          ]);
        }

        const next =
          synced.energy >= energy.MAX_ENERGY
            ? ""
            : ` • next: ${energy.formatWait(energy.secondsToNext(synced.energy, synced.energy_ts))}`;

        bot.sendMessage(
          id,
          `⚡ <b>${synced.energy}</b>/<b>${energy.MAX_ENERGY}</b>${next}\n\n` +
            `📘 <b>УРОК ${u.current_lesson}</b>\n🧠 Вопрос ${u.current_task + 1}/${tasks.length}\n\nСлово: <code>${task.word}</code>`,
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
          `\n\n⚔️ <b>Босс повержен!</b>\n` +
          `${emoji} Найдено: <b>${type === "chest" ? "СУНДУК" : "КЛЮЧ"} [${safeUpper(r)}]</b>`;
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
          const coinBonusLine = coinRes.bonus > 0 ? ` (бонус +${coinRes.bonus} 🪙)` : "";
          const xpBonusLine = xpRes.bonus > 0 ? ` (бонус +${xpRes.bonus} XP)` : "";

          bot.sendMessage(
            id,
            `✅ <b>Урок пройден!</b>\n🪙 +${coinRes.total}${coinBonusLine}\n📘 +${xpRes.total}${xpBonusLine}${bossMsg}`,
            { parse_mode: "HTML" }
          );

          lessonToolUsed.delete(lessonToolKey);
          this.sendLessonTask(bot, id);
        }
      );
    });
  },

  handleCallbacks(bot, q, userState) {
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

        if (u.current_lesson !== lesson || u.current_task !== taskIndex) {
          return bot.answerCallbackQuery(q.id, { text: "⏳ Уже не актуально." }).catch(() => {});
        }

        const task = lessons[String(u.current_lesson)]?.[u.current_task];
        if (!task) return;

        const inv = normalizeInv(u.accessories);
        const eq = normalizeEquipped(u.equipped);
        const toolId = eq.tool;
        if (!toolId) return bot.answerCallbackQuery(q.id, { text: "🧰 Инструмент не надет." }).catch(() => {});

        const eff = toolEffect(toolId);
        if (!eff) return bot.answerCallbackQuery(q.id, { text: "🧰 Инструмент без эффекта." }).catch(() => {});

        const gk = makeToolGuardKey(id, lesson, taskIndex);
        if (toolUsed.has(gk)) {
          return bot.answerCallbackQuery(q.id, { text: "✅ Уже использовано на этом вопросе." }).catch(() => {});
        }

        lessonToolUsed.add(makeLessonToolKey(id, lesson));
        const it = inv.find((x) => x && x.id === toolId);
        const d = it ? (Number.isFinite(it.d) ? it.d : 10) : 0;
        if (d <= 0) return bot.answerCallbackQuery(q.id, { text: "🧰 Инструмент сломан." }).catch(() => {});

        // применяем эффект
        toolUsed.add(gk);

        // cost
        const cost = toolCost(toolId);

        // базовые клавиши
        let newKeyboard = null;

        if (eff === "tool_remove_2") {
          // оставить 2 варианта (1 верный + 1 неверный)
          const reduced = pickOptionsKeepN(task, 2);
          newKeyboard = buildOptionsKeyboard(reduced);
        } else if (eff === "tool_remove_1") {
          // оставить 3 варианта (1 верный + 2 неверных)
          const reduced = pickOptionsKeepN(task, 3);
          newKeyboard = buildOptionsKeyboard(reduced);
        } else if (eff === "tool_hint" || eff === "tool_hint_first_letter") {
          const h = hintFirstLetter(task);
          bot
            .answerCallbackQuery(q.id, {
              text: h ? `🔍 Подсказка: первая буква = ${h}` : "🔍 Подсказка недоступна",
              show_alert: true,
            })
            .catch(() => {});
        } else if (eff === "tool_mark_suspect") {
          const correct = task.answers?.[0];
          const all = Array.isArray(task.options) ? task.options.slice() : [];
          const wrongs = all.filter((o) => !task.answers?.includes(o));
          let pick = null;

          // чаще выбираем неверный (если есть), но иногда "подставляем" верный
          if (wrongs.length && Math.random() < 0.75) {
            pick = wrongs[Math.floor(Math.random() * wrongs.length)];
          } else if (correct) {
            pick = correct;
          } else if (all.length) {
            pick = all[Math.floor(Math.random() * all.length)];
          }

          bot
            .answerCallbackQuery(q.id, {
              text: pick ? `🔍 Подозрительный вариант: ${pick}` : "🔍 Нет вариантов для подсветки",
              show_alert: true,
            })
            .catch(() => {});
        } else if (eff === "tool_shuffle" || eff === "tool_shuffle_options") {
          const opts = shuffleArray(Array.isArray(task.options) ? task.options : []);
          newKeyboard = buildOptionsKeyboard(opts);
        } else if (eff === "tool_retry" || eff === "tool_retry_once") {
          // даём "вторую попытку" на этот вопрос
          const rk = makeRetryKey(id, lesson, taskIndex);
          retryGranted.add(rk);
          bot.answerCallbackQuery(q.id, { text: "🔁 Активно: вторая попытка на этом вопросе", show_alert: true }).catch(() => {});
        } else if (eff === "tool_repeat_audio") {
          if (u.audio_enabled) {
            speak(task.word, (filePath) => bot.sendVoice(id, filePath).catch(() => {}));
          }
          bot.answerCallbackQuery(q.id, { text: "🎧 Повтор аудио", show_alert: false }).catch(() => {});
        } else if (eff === "tool_bookmark" || eff === "tool_bookmark_word") {
          // без БД-колонки — просто подтверждение (можно потом расширить)
          bot.answerCallbackQuery(q.id, { text: "🧷 Слово сохранено (пока без списка)", show_alert: true }).catch(() => {});
        } else if (eff === "tool_skip_free" || eff === "tool_skip") {
          const synced = energy.syncEnergy(u.energy, u.energy_ts);

          if (eff === "tool_skip_free") {
            // пропуск вопроса без траты энергии
            db.run(
              "UPDATE users SET current_task=current_task+1, energy=?, energy_ts=? WHERE id=?",
              [synced.energy, synced.energy_ts, id],
              () => this.sendLessonTask(bot, id)
            );
          } else {
            // пропуск вопроса со штрафом энергии (1)
            if (synced.energy <= 0) {
              bot.answerCallbackQuery(q.id, { text: "⚡ Нет энергии для пропуска", show_alert: true }).catch(() => {});
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
          // "фиксатор": показывает 2 закреплённых варианта (верный + 1 неверный), но не убирает остальные.
          // Делает подсказку, не ломая вопрос.
          const pair = pickOptionsKeepN(task, 2);
          bot.answerCallbackQuery(q.id, { text: `🔒 Закреплено: ${pair.join(" / ")}`, show_alert: true }).catch(() => {});
        } else if (eff === "tool_show_answer") {
          const correct = task.answers?.[0];
          if (correct) {
            // делаем 1 кнопку с верным ответом
            newKeyboard = buildOptionsKeyboard([correct]);
          }
          bot.answerCallbackQuery(q.id, { text: "✨ Ответ показан", show_alert: true }).catch(() => {});
        } else {
          bot.answerCallbackQuery(q.id, { text: "🧰 Эффект не поддерживается.", show_alert: true }).catch(() => {});
        }

        // списываем прочность (кроме ситуаций когда tool_skip уже переключил вопрос — но всё равно списываем)
        decDurability(inv, toolId, cost);

        // если нужно обновить клавиатуру — применяем
        if (newKeyboard) {
          // если инструмент ещё можно использовать? нет, только 1 раз на вопрос — поэтому кнопку уже не добавляем
          bot.editMessageReplyMarkup({ inline_keyboard: newKeyboard }, { chat_id: id, message_id: mid }).catch(() => {});
        }

        db.run("UPDATE users SET accessories=? WHERE id=?", [JSON.stringify(inv), id], () => {
          // общая фраза
          bot.answerCallbackQuery(q.id, { text: `🧰 ${toolName(toolId)} применён (-${cost} прочн.)` }).catch(() => {});
        });
      });

      return;
    }

    // ---- ANSWERS ----
    if (data.startsWith("ans_")) {
      const ans = data.replace("ans_", "");

      db.get("SELECT * FROM users WHERE id=?", [id], (err, u) => {
        if (!u) return;
        const task = lessons[String(u.current_lesson)]?.[u.current_task];
        if (!task) return;

        const synced = energy.syncEnergy(u.energy, u.energy_ts);
        let e = synced.energy;
        let ts = synced.energy_ts;

        if (e <= 0) {
          const wait = energy.formatWait(energy.secondsToNext(e, ts));
          bot.answerCallbackQuery(q.id, { text: `⚡ Нет энергии. Следующая через ${wait}`, show_alert: true }).catch(() => {});
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

        // ❌ неправильный ответ: если активен tool_retry и ещё не потрачен — даём вторую попытку бесплатно
        const rk = makeRetryKey(id, u.current_lesson, u.current_task);
        if (retryGranted.has(rk)) {
          retryGranted.delete(rk);
          bot.answerCallbackQuery(q.id, { text: "🔁 Вторая попытка! (без штрафа)", show_alert: true }).catch(() => {});
          return;
        }

        const spent = energy.spendEnergy(e, ts);
        e = spent.energy;
        ts = spent.energy_ts;

        const wait = e > 0 ? "" : ` Следующая через ${energy.formatWait(energy.secondsToNext(e, ts))}`;
        bot.answerCallbackQuery(q.id, { text: `❌ Ошибка! -1⚡ (${e}/${energy.MAX_ENERGY}).${wait}`, show_alert: true }).catch(() => {});
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

          let c = safeParse(u.chests);
          let k = safeParse(u.keys);

          const chest = c[idx];
          if (!chest) return bot.answerCallbackQuery(q.id, { text: "❌ Сундук не найден." }).catch(() => {});

          // ✅ приоритет ключа: сначала равный, потом выше
          let kIdx = -1;
          if (typeof chests.pickBestKeyIndex === "function") {
            kIdx = chests.pickBestKeyIndex(k, chest.r);
          } else {
            // fallback
            kIdx = k.findIndex((key) => chests.canOpen(chest.r, key));
          }

          if (kIdx === -1) {
            return bot.answerCallbackQuery(q.id, { text: `❌ Нужен ключ ${safeUpper(chest.r)}`, show_alert: true }).catch(() => {});
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
            dropText = `🪙 Выпало: <b>${amt.toLocaleString()} монет</b>`;
          } else if (rw.type === "item") {
            dropText = `🎁 Выпал предмет: <b>${formatLine(rw.id, 10)}</b>`;
          } else {
            dropText = `🎊 Выпало: <b>${rw.name || "Награда"}</b>`;
          }

          const keyText = `🔑 Потрачен ключ: <b>${safeUpper(usedKey)}</b>`;
          const chestText = `🎁 Открыт сундук: <b>${safeUpper(chest.r)}</b>`;

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
          bot.sendMessage(id, "❌ Ошибка при открытии сундука. Проверь mp4 в ui/templates.", kb.mainMenu).catch(() => {});
        }
      });

      return;
    }
  },
};

module.exports = gameHandler;
