const gTTS = require("gtts");
const fs = require("fs");
const path = require("path");

module.exports = function speak(text, callback) {
    // Выходим из utils, выходим из src (если есть) в корень к папке audio
    const folder = path.join(__dirname, "../../audio");
    if(!fs.existsSync(folder)) fs.mkdirSync(folder);

    const fileName = text.toLowerCase().replace(/[^a-zа-я0-9]/g, '_');
    const filePath = path.join(folder, `${fileName}.mp3`);

    if(fs.existsSync(filePath)) return callback(filePath);
    
    new gTTS(text, 'fi').save(filePath, () => callback(filePath));
};
