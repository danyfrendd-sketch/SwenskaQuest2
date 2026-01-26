async function sendRewardCard(bot, chatId, payload) {
  // Просто отправляем текст, без PNG
  if (payload?.caption) {
    await bot.sendMessage(chatId, payload.caption, { parse_mode: "HTML" });
  }
  return true;
}

module.exports = { sendRewardCard };
