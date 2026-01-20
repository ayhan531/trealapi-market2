import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Redis from "ioredis";

export const bus = new EventEmitter();

// Son olayın snapshot'unu tutalım (in-memory + disk persist)
export let lastPayload = null;
export const lastByType = {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const persistFile = path.join(__dirname, "lastPayload.json");

try {
  const s = fs.readFileSync(persistFile, "utf-8");
  lastPayload = JSON.parse(s);
  if (lastPayload?.type) lastByType[lastPayload.type] = lastPayload;
} catch {}

// Redis istemcisi - ENV'den yapılandır
let redis = null;
try {
  const url = process.env.REDIS_URL;
  if (url) {
    redis = new Redis(url, { lazyConnect: true, enableReadyCheck: false, enableOfflineQueue: false });
  } else if (process.env.REDIS_HOST) {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT) || 6379,
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      tls: process.env.REDIS_TLS === '1' ? {} : undefined,
      lazyConnect: true,
      enableReadyCheck: false,
      enableOfflineQueue: false
    });
  }
  
  // Hataları sessizce yoksay
  if (redis) {
    redis.on('error', () => {});
  }
} catch {}

if (redis) {
  redis.connect()
    .then(async () => {
      try {
        const s = await redis.get("lastPayload");
        if (s) {
          const json = JSON.parse(s);
          lastPayload = json;
          if (json?.type) lastByType[json.type] = json;
        }
      } catch {}
    })
    .catch(() => {});
}

bus.on("data", (payload) => {
  lastPayload = payload;
  if (payload?.type) lastByType[payload.type] = payload;
  if (redis) {
    redis.set("lastPayload", JSON.stringify(payload)).catch(() => {});
  } else {
    fs.promises.writeFile(persistFile, JSON.stringify(payload)).catch(() => {});
  }
});

export function getLastPayloadByType(type) {
  if (!type) return null;
  return lastByType[type] || null;
}
