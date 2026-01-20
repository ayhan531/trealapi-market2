import fetch from "node-fetch";
import { bus } from "../bus.js";
import { getIntervalMs, getPaused } from "../config.js";

const ENDPOINT = "https://scanner.tradingview.com/global/scan";
const PAYLOAD = {
  filter: [
    { left: "type", operation: "in_range", right: ["forex"] },
    { left: "exchange", operation: "in_range", right: ["FX_IDC", "FX"] }
  ],
  options: { lang: "tr" },
  range: [0, 300],
  sort: { sortBy: "name", sortOrder: "asc" },
  columns: [
    "name", "close", "change", "change_abs", "high", "low", "open",
    "description", "type", "subtype", "exchange", "pricescale", "minmov", "fractional"
  ]
};

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(body, retries = 3, delay = 2000) {
  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8"
    };
    
    // Session ID varsa Cookie header'ına ekle
    if (process.env.TRADINGVIEW_SESSION_ID) {
      headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
    }
    
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeout: 15000
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
  const popular = [
    "EURUSD",
    "USDJPY",
    "GBPUSD",
    "USDCHF",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
    "EURTRY",
    "USDTRY",
    "GBPTRY",
    "XAUUSD",
    "XAGUSD",
    "EURGBP",
    "EURJPY",
    "GBPJPY",
    "CHFJPY",
  ];
  const mapped = rows.map((item) => {
    const out = { symbol: item.s, category: "FOREX", assetType: "FOREX" };
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

  // popülerler önce, kalanlar sonradan eklenir
  const byPopularity = [
    ...popular
      .map((p) => mapped.find((m) => (m.symbol || "").toUpperCase() === p))
      .filter(Boolean),
    ...mapped.filter(
      (m) => !popular.includes((m.symbol || "").toUpperCase())
    ),
  ];

  return byPopularity.slice(0, 100);
}

export async function startTvForexCollector({ interval = 60000, marketKey = "FOREX" } = {}) {
  console.log("[FX] Forex collector (TradingView) basliyor...");
  let isRunning = true;
  let lastImmediateReq = 0;
  let backoffMs = 0;

  async function fetchForex() {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) {
      console.log("[FX] Paused - fetch atlandi");
      return;
    }
    try {
      const json = await fetchWithRetry(PAYLOAD);
      const data = mapRows(json?.data, PAYLOAD.columns);
      const payload = {
        type: "forex_top100",
        ts: Date.now(),
        lastUpdate: new Date().toISOString(),
        count: data.length,
        data,
        source: "tradingview"
      };
      bus.emit("data", payload);
      console.log(`[FX] ${data.length} parite guncellendi.`);
      backoffMs = 0;
    } catch (err) {
      console.error("[FX] Veri cekme hatasi:", err.message);
      backoffMs = backoffMs ? backoffMs * 2 : interval * 2;
      bus.emit("data", { type: "forex_warning", ts: Date.now(), message: err.message, backoffMs });
    }
  }

  await fetchForex();

  const schedule = async () => {
    if (!isRunning) return;
    try {
      await fetchForex();
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
    fetchForex().catch(() => {});
  };

  bus.on("request_update", onRequestUpdate);

  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
  };
}
