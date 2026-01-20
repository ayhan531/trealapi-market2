import fetch from "node-fetch";
import { bus } from "../bus.js";
import { getIntervalMs, getPaused } from "../config.js";

const API_URL = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h,24h,7d";

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  try {
    const resp = await fetch(url, { ...options, timeout: 15000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (err) {
    if (retries <= 0) throw err;
    await wait(delay);
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }
}

export async function startCoinGeckoCollector({ interval = 60000 } = {}) {
  console.log("[CG] CoinGecko top 100 collector basliyor...");
  let isRunning = true;
  let lastImmediateReq = 0;
  let backoffMs = 0;
  let consecutiveErrors = 0;

  async function fetchTopCoins() {
    if (!isRunning) return;
    if (getPaused && getPaused()) {
      console.log("[CG] Paused - fetch atlandi");
      return;
    }

    try {
      const data = await fetchWithRetry(API_URL, { method: "GET" });
      if (!Array.isArray(data)) throw new Error("Invalid response");
      consecutiveErrors = 0;
      backoffMs = 0;

      const mapped = data.map((c) => ({
        id: c.id,
        symbol: c.symbol,
        name: c.name,
        image: c.image,
        current_price: c.current_price,
        market_cap: c.market_cap,
        market_cap_rank: c.market_cap_rank,
        total_volume: c.total_volume,
        high_24h: c.high_24h,
        low_24h: c.low_24h,
        price_change_24h: c.price_change_24h,
        price_change_percentage_24h: c.price_change_percentage_24h,
        price_change_percentage_1h_in_currency: c.price_change_percentage_1h_in_currency,
        price_change_percentage_7d_in_currency: c.price_change_percentage_7d_in_currency,
        circulating_supply: c.circulating_supply,
        total_supply: c.total_supply,
        ath: c.ath,
        ath_change_percentage: c.ath_change_percentage,
        last_updated: c.last_updated,
      }));

      const payload = {
        type: "coingecko_top100",
        ts: Date.now(),
        lastUpdate: new Date().toISOString(),
        count: mapped.length,
        data: mapped,
      };

      bus.emit("data", payload);
      console.log(`[CG] ${mapped.length} coin guncellendi.`);
    } catch (err) {
      console.error("[CG] Veri cekme hatasi:", err.message);
      consecutiveErrors += 1;
      if (err.message.includes("HTTP 429")) {
        backoffMs = Math.max(backoffMs, interval * 2); // rate limit uyarisi: iki kat bekle
        bus.emit("data", { type: "coingecko_warning", ts: Date.now(), message: "CoinGecko rate limit, beklemeye geciliyor", backoffMs });
      }
      if (consecutiveErrors >= 3) {
        bus.emit("data", { type: "coingecko_warning", ts: Date.now(), message: `Ard arda ${consecutiveErrors} hata alindi`, error: err.message });
      }
    }
  }

  // initial fetch
  await fetchTopCoins();

  const schedule = async () => {
    if (!isRunning) return;
    try {
      await fetchTopCoins();
    } finally {
      const base = Number(getIntervalMs ? getIntervalMs() : interval) || interval;
      const next = backoffMs > 0 ? backoffMs : base;
      backoffMs = 0;
      setTimeout(schedule, next);
    }
  };

  setTimeout(schedule, Number(getIntervalMs ? getIntervalMs() : interval) || interval);

  const onRequestUpdate = () => {
    if (!isRunning) return;
    if (getPaused && getPaused()) return;
    const now = Date.now();
    if (now - lastImmediateReq < 2000) return;
    lastImmediateReq = now;
    fetchTopCoins().catch(() => {});
  };

  bus.on("request_update", onRequestUpdate);

  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
  };
}
