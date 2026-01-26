// seasonReset.js
const db = require("./database/db");

const rewardTable = [
  { min: 1, max: 1, tokens: 50 },
  { min: 2, max: 2, tokens: 35 },
  { min: 3, max: 3, tokens: 25 },
  { min: 4, max: 10, tokens: 10 },
  { min: 11, max: 50, tokens: 3 },
  { min: 51, max: Infinity, tokens: 1 },
];

function rewardForRank(rank) {
  for (const tier of rewardTable) {
    if (rank >= tier.min && rank <= tier.max) return tier.tokens;
  }
  return 1;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows || []);
    });
  });
}

async function resetSeason() {
  const now = Math.floor(Date.now() / 1000);
  const lastSeason = await get("SELECT * FROM seasons ORDER BY id DESC LIMIT 1");

  let seasonId = null;
  if (lastSeason && lastSeason.processed === 0) {
    seasonId = lastSeason.id;
    await run("UPDATE seasons SET end_ts=? WHERE id=?", [now, seasonId]);
  } else {
    const startTs = lastSeason?.end_ts ? Number(lastSeason.end_ts) : now - 86400;
    const created = await run(
      "INSERT INTO seasons (start_ts, end_ts, processed) VALUES (?, ?, 0)",
      [startTs, now]
    );
    seasonId = created.lastID;
  }

  const rows = await all(
    "SELECT id, current_lesson, season_xp FROM users ORDER BY current_lesson DESC, season_xp DESC"
  );

  await run("BEGIN TRANSACTION");
  try {
    for (let i = 0; i < rows.length; i += 1) {
      const rank = i + 1;
      const tokens = rewardForRank(rank);
      const userId = rows[i].id;
      await run("UPDATE users SET tokens=tokens+?, last_season_reward=? WHERE id=?", [tokens, tokens, userId]);
      await run(
        "INSERT OR REPLACE INTO season_rewards (season_id, user_id, rank, tokens) VALUES (?, ?, ?, ?)",
        [seasonId, userId, rank, tokens]
      );
    }

    await run("UPDATE users SET current_lesson=1, current_task=0, season_level=1, season_xp=0");
    await run("UPDATE seasons SET processed=1 WHERE id=?", [seasonId]);
    await run("COMMIT");
  } catch (err) {
    await run("ROLLBACK");
    throw err;
  }
}

resetSeason()
  .then(() => {
    console.log("✅ Season reset complete.");
    db.close();
  })
  .catch((err) => {
    console.error("❌ Season reset failed:", err);
    db.close();
    process.exitCode = 1;
  });
