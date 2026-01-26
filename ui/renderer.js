// ui/renderer.js
// Рендерит "взрослую" карточку награды поверх шаблона reward_realistic_base.png
const fs = require("fs");
const path = require("path");
const PImage = require("pureimage");

const FONT_DIR = path.join(__dirname, "fonts");
const TEMPLATE_DIR = path.join(__dirname, "templates");
const OUT_DIR = path.join(__dirname, "..", "ui_generated");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  const reg = PImage.registerFont(path.join(FONT_DIR, "DejaVuSerif.ttf"), "UI");
  const bold = PImage.registerFont(path.join(FONT_DIR, "DejaVuSerif-Bold.ttf"), "UIBold");
  reg.loadSync();
  bold.loadSync();
  fontsLoaded = true;
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? (line + " " + w) : w;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function renderRewardCard(payload) {
  loadFonts();
  ensureDir(OUT_DIR);

  const basePath = path.join(TEMPLATE_DIR, "reward_realistic_base.png");
  const img = await PImage.decodePNGFromStream(fs.createReadStream(basePath));
  const ctx = img.getContext("2d");

  // Координаты подобраны под вертикальную карточку (примерный safe-area)
  const left = 90;
  const right = 678;
  const maxW = right - left;

  // Верхний заголовок
  ctx.fillStyle = "rgba(240,228,205,0.95)";
  ctx.font = "42pt UIBold";
  ctx.fillText(payload.title_ru || "НАГРАДА", left, 115);

  ctx.fillStyle = "rgba(210,225,245,0.85)";
  ctx.font = "18pt UI";
  ctx.fillText(payload.title_fi || "Palkinto", left, 150);

  // Основной блок текста (в нижней части)
  const y0 = 740;
  ctx.fillStyle = "rgba(245,245,245,0.95)";
  ctx.font = "22pt UIBold";
  ctx.fillText(payload.headline || "Выпало:", left, y0);

  // Название предмета (крупнее)
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.font = "30pt UIBold";
  const item = payload.item_line || "Предмет";
  const itemLines = wrapLines(ctx, item, maxW);
  let y = y0 + 52;
  for (const ln of itemLines.slice(0, 2)) {
    ctx.fillText(ln, left, y);
    y += 44;
  }

  // Мета (редкость/баф/прочность)
  ctx.fillStyle = "rgba(225,235,245,0.9)";
  ctx.font = "16pt UI";
  const metaRu = payload.meta_ru || "";
  const metaFi = payload.meta_fi || "";
  const metaLines = wrapLines(ctx, metaRu, maxW);
  let my = y + 10;
  for (const ln of metaLines.slice(0, 2)) {
    ctx.fillText(ln, left, my);
    my += 26;
  }
  if (metaFi) {
    ctx.fillStyle = "rgba(190,210,235,0.85)";
    ctx.font = "13pt UI";
    ctx.fillText(metaFi, left, my + 8);
  }

  // Нижняя "кнопка" текстом (как в референсе)
  ctx.fillStyle = "rgba(245,235,215,0.95)";
  ctx.font = "20pt UIBold";
  ctx.fillText(payload.btn || "Забрать", 300, 970);

  const outPath = path.join(OUT_DIR, `reward_${Date.now()}.png`);
  await PImage.encodePNGToStream(img, fs.createWriteStream(outPath));
  return outPath;
}

module.exports = { renderRewardCard };
