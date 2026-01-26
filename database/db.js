// database/db.js
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(__dirname, "bot_database.db");

const db = new sqlite3.Database(DB_PATH);

function addColumnIfMissing(table, colName, colDefSql, onDone = null) {
  db.all(`PRAGMA table_info(${table})`, (err, cols) => {
    if (err) {
      console.error("PRAGMA error:", err);
      return onDone && onDone(false);
    }

    const exists = Array.isArray(cols) && cols.some((c) => c && c.name === colName);
    if (exists) return onDone && onDone(false);

    db.run(`ALTER TABLE ${table} ADD COLUMN ${colDefSql}`, (e) => {
      if (e) {
        console.error(`ALTER TABLE ${table} error:`, e);
        return onDone && onDone(false);
      }
      console.log(`✅ Added column ${table}.${colName}`);
      return onDone && onDone(true);
    });
  });
}

db.serialize(() => {

  // ===== USERS =====
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE,
    age INTEGER,
    avatar TEXT,
    emoji TEXT,
    coins INTEGER DEFAULT 100,
    tokens INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    current_lesson INTEGER DEFAULT 1,
    current_task INTEGER DEFAULT 0,
    chests TEXT DEFAULT '[]',
    keys TEXT DEFAULT '[]',
    accessories TEXT DEFAULT '[]',
    equipped TEXT DEFAULT '{}',
    audio_enabled INTEGER DEFAULT 1,
    practice_rewards TEXT DEFAULT '{}',
    reg_step TEXT,
    energy INTEGER DEFAULT 30,
    energy_ts INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // compatibility columns
  addColumnIfMissing("users", "tokens", "tokens INTEGER DEFAULT 0");
  addColumnIfMissing("users", "audio_enabled", "audio_enabled INTEGER DEFAULT 1");
  addColumnIfMissing("users", "practice_rewards", "practice_rewards TEXT DEFAULT '{}'");
  addColumnIfMissing("users", "equipped", "equipped TEXT DEFAULT '{}'");
  addColumnIfMissing("users", "accessories", "accessories TEXT DEFAULT '[]'");

  // energy
  addColumnIfMissing("users", "energy", "energy INTEGER DEFAULT 30");
  addColumnIfMissing("users", "energy_ts", "energy_ts INTEGER DEFAULT 0", (added) => {
    if (added) {
      db.run(
        "UPDATE users SET energy_ts = CAST(strftime('%s','now') AS INTEGER) WHERE energy_ts IS NULL OR energy_ts = 0"
      );
    }
  });

  // ===== SEASON SYSTEM (NEW) =====
  addColumnIfMissing("users", "season_xp", "season_xp INTEGER DEFAULT 0");
  addColumnIfMissing("users", "last_season_reward", "last_season_reward INTEGER DEFAULT 0");

  db.run(`CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_ts INTEGER,
    end_ts INTEGER,
    processed INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS season_rewards (
    season_id INTEGER,
    user_id INTEGER,
    rank INTEGER,
    tokens INTEGER,
    PRIMARY KEY (season_id, user_id)
  )`);

  // ===== PROMO =====
  db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
    code TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0,
    uses_left INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS promo_uses (
    user_id INTEGER,
    code TEXT,
    used_at INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, code)
  )`);

  // ===== MARKET =====
  db.run(`CREATE TABLE IF NOT EXISTS market (
    lot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    item_id TEXT,
    item_d INTEGER DEFAULT 10,
    price INTEGER,
    currency TEXT DEFAULT 'coins',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  addColumnIfMissing("market", "item_d", "item_d INTEGER DEFAULT 10");
  addColumnIfMissing("market", "currency", "currency TEXT DEFAULT 'coins'");

  db.run(`CREATE INDEX IF NOT EXISTS idx_market_price ON market(price)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_market_seller ON market(seller_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_promo_uses_user ON promo_uses(user_id)`);

  console.log("💾 База данных инициализирована.");
  console.log("💾 DB_PATH =", DB_PATH);
});

module.exports = db;
