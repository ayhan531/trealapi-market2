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
  overrides: {}
};

try {
  const s = fs.readFileSync(persistFile, "utf-8");
  const json = JSON.parse(s);
  if (typeof json.intervalMs === 'number') state.intervalMs = json.intervalMs;
  if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
} catch {}

async function loadFromRedis() {
  if (!redis) return;
  try {
    const s = await redis.get("admin:config");
    if (s) {
      const json = JSON.parse(s);
      if (typeof json.intervalMs === 'number') state.intervalMs = json.intervalMs;
      if (json.overrides && typeof json.overrides === 'object') state.overrides = json.overrides;
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
  return state.overrides;
}

export async function setOverride(symbol, override) {
  if (!symbol || typeof override !== 'object') return false;
  state.overrides[symbol] = override; // {type:'percent'|'delta'|'set', value:number}
  await persist();
  return true;
}

export async function removeOverride(symbol) {
  delete state.overrides[symbol];
  await persist();
  return true;
}
