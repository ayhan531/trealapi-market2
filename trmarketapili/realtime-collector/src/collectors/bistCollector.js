import fetch from "node-fetch";
import { bus } from "../bus.js";
import { getIntervalMs, getPaused } from "../config.js";

const PAGE_URL = "https://www.getmidas.com/canli-borsa/xu100-bist-100-hisseleri";
const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const TV_PAYLOAD = {
  filter: [
    { left: "exchange", operation: "in_range", right: ["BIST"] },
    { left: "type", operation: "in_range", right: ["stock"] }
  ],
  options: { lang: "tr" },
  range: [0, 150],
  sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
  columns: [
    "name",
    "description",
    "close",
    "change",
    "change_abs",
    "high",
    "low",
    "open",
    "market_cap_basic",
    "volume",
    "type",
    "subtype",
    "exchange"
  ]
};

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  try {
    const resp = await fetch(url, { ...options, timeout: 15000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } catch (err) {
    if (retries <= 0) throw err;
    await wait(delay);
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }
}

function extractJsonFromHtml(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function findQuotes(node) {
  if (Array.isArray(node)) {
    if (node.length >= 20 && node.every((x) => typeof x === "object" && x)) {
      return node;
    }
    for (const item of node) {
      const found = findQuotes(item);
      if (found) return found;
    }
  } else if (node && typeof node === "object") {
    for (const val of Object.values(node)) {
      const found = findQuotes(val);
      if (found) return found;
    }
  }
  return null;
}

function mapQuote(q) {
  const symbol = q.symbol || q.ticker || q.code || q.isin || q.name;
  const name = q.name || q.companyName || q.description || symbol;
  const price = q.lastPrice || q.price || q.close || q.currentPrice || q.last || q.value;
  const changePct = q.changePercentage ?? q.changePercent ?? q.change_pct ?? q.percentage ?? null;
  const change = q.change ?? q.changeAmount ?? null;
  const volume = q.volume ?? q.volumeTraded ?? null;

  return {
    symbol,
    name,
    price,
    change,
    changePct,
    volume,
    raw: q,
  };
}

async function fetchTvBist() {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
  };
  
  if (process.env.TRADINGVIEW_SESSION_ID) {
    headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
  }
  
  const resp = await fetch(TV_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(TV_PAYLOAD),
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`TV HTTP ${resp.status}`);
  const json = await resp.json();
  const rows = Array.isArray(json?.data) ? json.data.slice(0, 100) : [];
  return rows.map((item) => {
    const symbol = item.s || "";
    const d = Array.isArray(item.d) ? item.d : [];
    const cols = TV_PAYLOAD.columns;
    const map = {};
    d.forEach((v, i) => {
      map[cols[i]] = v;
    });
    return {
      symbol,
      name: map.description || map.name || symbol,
      price: map.close,
      change: map.change_abs ?? map.change,
      changePct: map.change,
      volume: map.volume,
      marketCap: map.market_cap_basic,
      raw: map,
    };
  });
}

export async function startBistCollector({ interval = 15000, marketKey = "STOCK" } = {}) {
  console.log("[BIST] BIST 100 collector (GetMidas) basliyor...");
  let isRunning = true;
  let lastImmediateReq = 0;
  let backoffMs = 0;

  async function fetchBist() {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) {
      console.log("[BIST] Paused - fetch atlandi");
      return;
    }
    try {
      // GetMidas'tan dene
      const html = await fetchWithRetry(PAGE_URL, { method: "GET" });
      const json = extractJsonFromHtml(html);
      let mapped = [];
      
      if (json) {
        const quotes = findQuotes(json) || [];
        mapped = quotes
          .map(mapQuote)
          .filter((q) => q.price && q.symbol)
          .slice(0, 100);
      }

      // Eğer GetMidas başarısız olursa TradingView backup
      if (mapped.length === 0) {
        console.log("[BIST] GetMidas başarısız, TradingView'e fallback...");
        mapped = await fetchTvBist();
      }

      const payload = {
        type: "bist_top100",
        ts: Date.now(),
        lastUpdate: new Date().toISOString(),
        count: mapped.length,
        data: mapped.map((m) => ({
          symbol: m.symbol,
          name: m.name,
          price: m.price,
          change: m.change,
          changePct: m.changePct,
          volume: m.volume,
          marketCap: m.marketCap,
          assetType: "STOCK",
          category: "BIST"
        })),
        source: "getmidas",
      };

      bus.emit("data", payload);
      console.log(`[BIST] ${mapped.length} hisse guncellendi.`);
      backoffMs = 0;
    } catch (err) {
      console.error("[BIST] Veri cekme hatasi:", err.message);
      backoffMs = backoffMs ? backoffMs * 2 : interval * 2;
      bus.emit("data", {
        type: "bist_warning",
        ts: Date.now(),
        message: err.message,
        backoffMs,
      });
    }
  }

  await fetchBist();

  const schedule = async () => {
    if (!isRunning) return;
    try {
      await fetchBist();
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
    fetchBist().catch(() => {});
  };

  bus.on("request_update", onRequestUpdate);

  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
  };
}
