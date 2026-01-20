import fetch from "node-fetch";
import { bus } from "../bus.js";
import { getIntervalMs, getPaused } from "../config.js";

const ENDPOINT = "https://scanner.tradingview.com/global/scan";
const PAYLOAD = {
  filter: [{ left: "subtype", operation: "in_range", right: ["crypto"] }],
  options: { lang: "tr" },
  range: [0, 300],
  sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
  columns: [
    "name",
    "close",
    "change",
    "change_abs",
    "high",
    "low",
    "open",
    "volume",
    "market_cap_basic",
    "description",
    "type",
    "subtype",
    "exchange",
  ],
};

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(body, retries = 3, delay = 2000) {
  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
    };
    
    // Session ID varsa Cookie header'ına ekle
    if (process.env.TRADINGVIEW_SESSION_ID) {
      headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
    }
    
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeout: 15000,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    if (retries <= 0) throw err;
    await wait(delay);
    return fetchWithRetry(body, retries - 1, delay * 2);
  }
}

function mapRows(rows, columns) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 100).map((item) => {
    const out = { symbol: item.s, category: "CRYPTO", assetType: "CRYPTO" };
    if (Array.isArray(item.d)) {
      item.d.forEach((v, idx) => {
        const key = columns[idx] || `col_${idx}`;
        out[key] = v;
      });
    }
    out.price = out.close;
    out.changePct = out.change;
    return out;
  });
}

export async function startTvCryptoCollector({ interval = 10000, marketKey = "CRYPTO" } = {}) {
  console.log("[CRYPTO] TradingView crypto collector basliyor...");
  let isRunning = true;
  let lastImmediateReq = 0;
  let backoffMs = 0;

  async function fetchCrypto() {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) {
      console.log("[CRYPTO] Paused - fetch atlandi");
      return;
    }
    try {
      const json = await fetchWithRetry(PAYLOAD);
      const data = mapRows(json?.data, PAYLOAD.columns);
      const payload = {
        type: "crypto_top100",
        ts: Date.now(),
        lastUpdate: new Date().toISOString(),
        count: data.length,
        data,
        source: "tradingview",
      };
      bus.emit("data", payload);
      console.log(`[CRYPTO] ${data.length} kripto guncellendi.`);
      backoffMs = 0;
    } catch (err) {
      console.error("[CRYPTO] Veri cekme hatasi:", err.message);
      backoffMs = backoffMs ? backoffMs * 2 : interval * 2;
      bus.emit("data", {
        type: "crypto_warning",
        ts: Date.now(),
        message: err.message,
        backoffMs,
      });
    }
  }

  await fetchCrypto();

  const schedule = async () => {
    if (!isRunning) return;
    try {
      await fetchCrypto();
    } finally {
      const base = Number(getIntervalMs ? getIntervalMs(marketKey) : interval) || interval;
      const next = backoffMs > 0 ? backoffMs : base;
      setTimeout(schedule, next);
      backoffMs = 0;
    }
  };

  setTimeout(schedule, interval);

  const onRequestUpdate = () => {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) return;
    const now = Date.now();
    if (now - lastImmediateReq < 2000) return;
    lastImmediateReq = now;
    fetchCrypto().catch(() => {});
  };

  bus.on("request_update", onRequestUpdate);

  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
  };
}
