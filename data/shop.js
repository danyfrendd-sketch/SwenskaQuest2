const ITEMS = [
  // ⚪️ COMMON (Обычные - 20 шт)
  { id: 'c1', name: "🍞 Хлеб", price: 40, rarity: 'common' },
  { id: 'c2', name: "💧 Вода", price: 30, rarity: 'common' },
  { id: 'c3', name: "🍎 Яблоко", price: 45, rarity: 'common' },
  { id: 'c4', name: "🧦 Носки", price: 100, rarity: 'common' },
  { id: 'c5', name: "🧢 Кепка", price: 150, rarity: 'common' },
  { id: 'c6', name: "✏️ Карандаш", price: 20, rarity: 'common' },
  { id: 'c7', name: "🥐 Булочка", price: 80, rarity: 'common' },
  { id: 'c8', name: "🥛 Молоко", price: 70, rarity: 'common' },
  { id: 'c9', name: "🧤 Варежки", price: 130, rarity: 'common' },
  { id: 'c10', name: "🧼 Мыло", price: 60, rarity: 'common' },
  { id: 'c11', name: "🥨 Крендель", price: 110, rarity: 'common' },
  { id: 'c12', name: "🫐 Черника", price: 90, rarity: 'common' },
  { id: 'c13', name: "🪑 Стул", price: 300, rarity: 'common' },
  { id: 'c14', name: "🕯 Свеча", price: 50, rarity: 'common' },
  { id: 'c15', name: "🧶 Нитки", price: 40, rarity: 'common' },
  { id: 'c16', name: "🍪 Печенье", price: 85, rarity: 'common' },
  { id: 'c17', name: "🥪 Сэндвич", price: 120, rarity: 'common' },
  { id: 'c18', name: "☕️ Кружка", price: 180, rarity: 'common' },
  { id: 'c19', name: "🧵 Игла", price: 25, rarity: 'common' },
  { id: 'c20', name: "🥔 Картошка", price: 35, rarity: 'common' },

  // 🔵 RARE (Редкие - 15 шт)
  { id: 'r1', name: "🔪 Нож Пуукко", price: 1500, rarity: 'rare' },
  { id: 'r2', name: "🎣 Удочка", price: 2200, rarity: 'rare' },
  { id: 'r3', name: "🎒 Рюкзак", price: 3500, rarity: 'rare' },
  { id: 'r4', name: "🧭 Компас", price: 1800, rarity: 'rare' },
  { id: 'r5', name: "⛺️ Палатка", price: 5000, rarity: 'rare' },
  { id: 'r6', name: "🔦 Фонарь", price: 1200, rarity: 'rare' },
  { id: 'r7', name: "🪵 Топор", price: 2800, rarity: 'rare' },
  { id: 'r8', name: "🥾 Ботинки", price: 4200, rarity: 'rare' },
  { id: 'r9', name: "📟 Рация", price: 3100, rarity: 'rare' },
  { id: 'r10', name: "🧥 Куртка", price: 6000, rarity: 'rare' },
  { id: 'r11', name: "🏹 Лук", price: 7500, rarity: 'rare' },
  { id: 'r12', name: "📱 Телефон", price: 9000, rarity: 'rare' },
  { id: 'r13', name: "🔭 Бинокль", price: 4800, rarity: 'rare' },
  { id: 'r14', name: "🎸 Гитара", price: 5500, rarity: 'rare' },
  { id: 'r15', name: "🛹 Скейт", price: 3900, rarity: 'rare' },

  // 🟣 EPIC (Эпические - 10 шт)
  { id: 'e1', name: "🎸 Кантеле", price: 15000, rarity: 'epic' },
  { id: 'e2', name: "🍀 Талисман", price: 12000, rarity: 'epic' },
  { id: 'e3', name: "🐻 Шкура медведя", price: 25000, rarity: 'epic' },
  { id: 'e4', name: "💍 Перстень", price: 30000, rarity: 'epic' },
  { id: 'e5', name: "📜 Свиток", price: 18000, rarity: 'epic' },
  { id: 'e6', name: "🛶 Лодка", price: 45000, rarity: 'epic' },
  { id: 'e7', name: "🎭 Маска", price: 22000, rarity: 'epic' },
  { id: 'e8', name: "💎 Аметист", price: 35000, rarity: 'epic' },
  { id: 'e9', name: "🛡 Щит", price: 40000, rarity: 'epic' },
  { id: 'e10', name: "⚡️ Медальон", price: 28000, rarity: 'epic' },

  // 🟡 LEGENDARY (Легендарные - 5 шт)
  { id: 'l1', name: "⚙️ Мельница Сампо", price: 150000, rarity: 'legendary' },
  { id: 'l2', name: "👑 Корона", price: 250000, rarity: 'legendary' },
  { id: 'l3', name: "⚔️ Меч Героя", price: 500000, rarity: 'legendary' },
  { id: 'l4', name: "🌌 Осколок Сияния", price: 750000, rarity: 'legendary' },
  { id: 'l5', name: "🦌 Золотой Олень", price: 1000000, rarity: 'legendary' }

];

// сортировка от дешёвых к дорогим
ITEMS.sort((a,b)=>(a.price||0)-(b.price||0));

module.exports = ITEMS;
