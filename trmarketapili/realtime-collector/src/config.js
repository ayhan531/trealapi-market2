import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Redis from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const persistFile = path.join(__dirname, "adminConfig.json");

let redis = null;
try {
  const url = process.env.REDIS_URL;
  if (url) {
    redis = new Redis(url, { lazyConnect: true });
  } else if (process.env.REDIS_HOST) {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT) || 6379,
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === '1' ? {} : undefined,
      lazyConnect: true
    });
  }
} catch {}

if (redis) {
  redis.connect().catch(() => {});
}

const DEFAULT_INTERVAL = Number(process.env.COINGECKO_INTERVAL_MS || process.env.TVAPI_INTERVAL || 10000);
const DEFAULTS = {
  GLOBAL: DEFAULT_INTERVAL,
  CRYPTO: Number(process.env.CRYPTO_INTERVAL_MS) || DEFAULT_INTERVAL,
  FOREX: Number(process.env.FOREX_INTERVAL_MS) || DEFAULT_INTERVAL,
  COMMODITY: Number(process.env.COMMODITY_INTERVAL_MS) || DEFAULT_INTERVAL,
  STOCK: Number(process.env.BIST_INTERVAL_MS) || 15000
};

let state = {
  intervals: {
    GLOBAL: DEFAULTS.GLOBAL,
    CRYPTO: DEFAULTS.CRYPTO,
    FOREX: DEFAULTS.FOREX,
    COMMODITY: DEFAULTS.COMMODITY,
    STOCK: DEFAULTS.STOCK
  },
  overrides: {},
  paused: {
    GLOBAL: false,
    CRYPTO: false,
    FOREX: false,
    COMMODITY: false,
    STOCK: false
  }
};

try {
  const s = fs.readFileSync(persistFile, "utf-8");
  const json = JSON.parse(s);
  if (json.intervals && typeof json.intervals === 'object') {
    state.intervals = { ...state.intervals, ...json.intervals };
  } else if (typeof json.intervalMs === 'number') {
    state.intervals.GLOBAL = json.intervalMs;
  }
  if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
  if (json.paused && typeof json.paused === 'object') {
    state.paused = { ...state.paused, ...json.paused };
  } else if (typeof json.paused === 'boolean') {
    state.paused.GLOBAL = json.paused;
  }
} catch {}

async function loadFromRedis() {
  if (!redis) return;
  try {
    const s = await redis.get("admin:config");
    if (s) {
      const json = JSON.parse(s);
      if (json.intervals && typeof json.intervals === 'object') {
        state.intervals = { ...state.intervals, ...json.intervals };
      }
      if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
      if (json.paused && typeof json.paused === 'object') {
        state.paused = { ...state.paused, ...json.paused };
      }
    }
  } catch {}
}

function persistLocal() {
  fs.promises.writeFile(persistFile, JSON.stringify(state)).catch(() => {});
}

async function persist() {
  if (redis) {
    try { await redis.set("admin:config", JSON.stringify(state)); } catch {}
  } else {
    persistLocal();
  }
}

await loadFromRedis();

function purgeExpired() {
  const now = Date.now();
  let changed = false;
  for (const [sym, ov] of Object.entries(state.overrides)) {
    const exp = ov && Number(ov.expiresAt);
    if (exp && now >= exp) {
      delete state.overrides[sym];
      changed = true;
    }
  }
  if (changed) persist();
}

export function getIntervalMs(market = "GLOBAL") {
  const key = String(market || "GLOBAL").toUpperCase();
  return state.intervals[key] ?? state.intervals.GLOBAL ?? DEFAULT_INTERVAL;
}

export async function setIntervalMs(ms, market = "GLOBAL") {
  const key = String(market || "GLOBAL").toUpperCase();
  const v = Math.max(200, Number(ms)||DEFAULTS[key]||DEFAULT_INTERVAL);
  state.intervals[key] = v;
  await persist();
  return v;
}

export function getOverrides() {
  purgeExpired();
  return state.overrides;
}

export async function setOverride(symbol, override) {
  if (!symbol || typeof override !== 'object') return false;
  state.overrides[symbol] = override; // {type, value, expiresAt?}
  await persist();
  return true;
}

export async function removeOverride(symbol) {
  delete state.overrides[symbol];
  await persist();
  return true;
}

export function getPaused(market = "GLOBAL") {
  const key = String(market || "GLOBAL").toUpperCase();
  return !!state.paused[key];
}

export async function setPaused(paused, market = "GLOBAL") {
  const key = String(market || "GLOBAL").toUpperCase();
  state.paused[key] = !!paused;
  await persist();
  return state.paused[key];
}
