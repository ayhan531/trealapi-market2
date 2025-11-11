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

const DEFAULT_INTERVAL = Number(process.env.TVAPI_INTERVAL || 1000);

let state = {
  intervalMs: DEFAULT_INTERVAL,
  overrides: {},
  paused: false
};

try {
  const s = fs.readFileSync(persistFile, "utf-8");
  const json = JSON.parse(s);
  if (typeof json.intervalMs === 'number') state.intervalMs = json.intervalMs;
  if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
  if (typeof json.paused === 'boolean') state.paused = json.paused;
} catch {}

async function loadFromRedis() {
  if (!redis) return;
  try {
    const s = await redis.get("admin:config");
    if (s) {
      const json = JSON.parse(s);
      if (typeof json.intervalMs === 'number') state.intervalMs = json.intervalMs;
      if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
      if (typeof json.paused === 'boolean') state.paused = json.paused;
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

export function getIntervalMs() {
  return state.intervalMs;
}

export async function setIntervalMs(ms) {
  const v = Math.max(200, Number(ms)||DEFAULT_INTERVAL);
  state.intervalMs = v;
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

export function getPaused() {
  return !!state.paused;
}

export async function setPaused(paused) {
  state.paused = !!paused;
  await persist();
  return state.paused;
}
