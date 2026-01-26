const shopItems = require("./shop");
const rarityOrder = ['common', 'rare', 'epic', 'legendary'];

function generateBossLoot(lessonNumber) {
    const chance = Math.random() * 100;
    let rarity = 'common';

    if (lessonNumber % 10 === 0) { // Главный босс - СУНДУК
        if (chance <= 3) rarity = 'legendary';
        else if (chance <= 15) rarity = 'epic';
        else if (chance <= 40) rarity = 'rare';
        return { type: 'chest', rarity };
    } else { // Мини босс - КЛЮЧ
        if (chance <= 1) rarity = 'legendary';
        else if (chance <= 7) rarity = 'epic';
        else if (chance <= 25) rarity = 'rare';
        return { type: 'key', rarity };
    }
}

function canOpen(chestRarity, keyRarity) {
    return rarityOrder.indexOf(keyRarity) >= rarityOrder.indexOf(chestRarity);
}

function getChestReward(chestRarity) {
    const isCoin = Math.random() < 0.85; // 85% шанс на коины
    if (isCoin) {
        const mult = (rarityOrder.indexOf(chestRarity) + 1);
        const amount = Math.floor(Math.random() * (mult * 100)) + 50; 
        return { type: 'coins', amount, name: `${amount} 🪙` };
    }
    const pool = shopItems.filter(i => i.rarity === chestRarity);
    const item = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : shopItems[0];
    return { type: 'item', ...item };
}

module.exports = { generateBossLoot, canOpen, getChestReward };
