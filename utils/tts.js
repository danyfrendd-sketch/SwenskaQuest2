const gTTS = require("gtts");
const fs = require("fs");
const path = require("path");

module.exports = function speak(text, callback) {
  // ✅ FIX: на сервере нельзя писать в корень типа /audio
  // Храним временно в /tmp/audio (доступно и без прав).
  const folder = path.join("/tmp", "audio");

  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  const safe = String(text || "").toLowerCase().replace(/[^a-zа-я0-9]/g, "_");
  const fileName = safe.length ? safe : "tts";
  const filePath = path.join(folder, `${fileName}.mp3`);

  if (fs.existsSync(filePath)) return callback(filePath);

  try {
    new gTTS(String(text || ""), "fi").save(filePath, () => callback(filePath));
  } catch (e) {
    console.log("TTS_ERROR:", e?.message || e);
    // fallback: вернём null, чтобы вызывающий код мог не падать
    return callback(null);
  }
};
