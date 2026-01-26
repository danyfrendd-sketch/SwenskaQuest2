// utils/energy.js
const MAX_ENERGY = 30;
const REGEN_SECONDS = 10 * 60;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Синхронизирует энергию по времени (без таймеров).
 * Возвращает { energy, energy_ts, gained }.
 */
function syncEnergy(energyRaw, tsRaw) {
  let energy = Number.isFinite(Number(energyRaw)) ? Number(energyRaw) : MAX_ENERGY;
  let energy_ts = Number.isFinite(Number(tsRaw)) ? Number(tsRaw) : nowSec();

  const t = nowSec();

  // если фулл — держим якорь сейчас (чтобы не копить diff)
  if (energy >= MAX_ENERGY) {
    return { energy: MAX_ENERGY, energy_ts: t, gained: 0 };
  }

  const diff = Math.max(0, t - energy_ts);
  const gained = Math.floor(diff / REGEN_SECONDS);
  if (gained <= 0) return { energy, energy_ts, gained: 0 };

  energy = Math.min(MAX_ENERGY, energy + gained);
  energy_ts = energy_ts + gained * REGEN_SECONDS;

  if (energy >= MAX_ENERGY) energy_ts = t;

  return { energy, energy_ts, gained };
}

/**
 * Тратит 1 энергию. Если энергия была фулл — реген стартует с момента траты.
 */
function spendEnergy(energy, energy_ts) {
  const t = nowSec();
  const wasFull = energy >= MAX_ENERGY;
  const nextEnergy = Math.max(0, energy - 1);
  const nextTs = wasFull ? t : energy_ts;
  return { energy: nextEnergy, energy_ts: nextTs };
}

function secondsToNext(energy, energy_ts) {
  if (energy >= MAX_ENERGY) return 0;
  const t = nowSec();
  const passed = Math.max(0, t - energy_ts);
  const rem = REGEN_SECONDS - (passed % REGEN_SECONDS);
  return rem === REGEN_SECONDS ? 0 : rem;
}

function formatWait(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m <= 0) return `${sec}с`;
  return `${m}м ${sec}с`;
}

module.exports = {
  MAX_ENERGY,
  REGEN_SECONDS,
  syncEnergy,
  spendEnergy,
  secondsToNext,
  formatWait,
  nowSec,
};
