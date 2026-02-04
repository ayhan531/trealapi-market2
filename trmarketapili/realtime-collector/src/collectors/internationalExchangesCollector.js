import fetch from "node-fetch";
import { bus } from "../bus.js";
import { getIntervalMs, getPaused } from "../config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exchangeDataPath = path.join(__dirname, "internationalExchanges.json");
const exchangeData = JSON.parse(fs.readFileSync(exchangeDataPath, "utf-8"));

// Load country companies whitelist (only show top companies from each country)
const countryCompaniesPath = path.join(__dirname, "countryCompanies.json");
const countryCompanies = JSON.parse(fs.readFileSync(countryCompaniesPath, "utf-8"));

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// TL Conversion - 1 USD = ~43.51 TL (güncellenebilir, her 30 saniyede bir çekiliyor)
let exchangeRate = 43.51;
async function fetchExchangeRate() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (res.ok) {
      const data = await res.json();
      exchangeRate = data.rates?.TRY || 43.51;
      console.log(`[INTL] Exchange Rate Updated: 1 USD = ${exchangeRate.toFixed(2)} TL`);
    }
  } catch (err) {
    console.log("[INTL] Exchange rate API başarısız, son bilineni kullanıyor");
  }
}

// Her 30 saniyede kuru güncelle (canlı fiyatlar için)
setInterval(fetchExchangeRate, 30000);
fetchExchangeRate(); // Başlangıçta hemen çek

// Eksik marketler için alternatif ID'ler
const ALTERNATIVE_IDS = {
  "ENXBE": ["BRU", "EURONEXT"],
  "HEX": ["FIHEX", "TASE"],
  "ENXPA": ["PAR", "EURONEXT"],
  "ENXAM": ["AMS", "EURONEXT"],
  "ENXDU": ["DUB", "EURONEXT"],
  "BES": ["BUD", "BSE"],
  "QE": ["QAT", "DOHA", "TADAWUL", "QATAR MAIN"],
  "ENXLI": ["LIS", "EURONEXT"],
  // Muscat: Çok sınırlı - tüm kombinasyonlar
  "MSM": ["MSM", "MUSCAT", "OMX", "MSM_MAIN", "MUSCAT_MAIN", "OMAN_MAIN", "SOHAR", "OMX_MSM", "OMAN", "OMR", "MUS", "MUSCAT_SECURITIES", "OMANI"],
  "XETRA": ["XETR"],  // Bulunan ID
  "STO": ["OMXS", "STOCKHOLM", "OMX STOCKHOLM", "NASDAQ"]
};

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

async function fetchExchangeData(exchange) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
  };

  if (process.env.TRADINGVIEW_SESSION_ID) {
    headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
  }

  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [exchange.tvExchange] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 1000],
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
      "exchange"
    ]
  };

  // DEBUG: Muscat ve Frankfurt için extra log
  if (["MSM", "XETRA"].includes(exchange.id)) {
    console.log(`[INTL-DEBUG] ${exchange.id} - TV ID test: "${exchange.tvExchange}"`);
  }

  // Retry logic for rate limiting (429)
  let retryCount = 0;
  const maxRetries = 2;
  let resp;

  while (retryCount <= maxRetries) {
    try {
      resp = await fetch(TV_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: 15000,
      });

      if (resp.status === 429) {
        // Rate limited - wait and retry
        retryCount++;
        if (retryCount <= maxRetries) {
          const waitTime = 3000 * retryCount; // 3s, 6s, 9s
          console.log(`[INTL] ${exchange.id}: Rate limited (429) - ${waitTime}ms bekleniyor (retry ${retryCount}/${maxRetries})`);
          await wait(waitTime);
          continue;
        }
      }

      if (!resp.ok) throw new Error(`TV HTTP ${resp.status}`);
      break; // Başarılı
    } catch (err) {
      if (retryCount < maxRetries) {
        retryCount++;
        const waitTime = 3000 * retryCount;
        console.log(`[INTL] ${exchange.id}: Hata - ${waitTime}ms bekleniyor (retry ${retryCount}/${maxRetries})`);
        await wait(waitTime);
        continue;
      }
      throw err;
    }
  }

  const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data.slice(0, 1000) : [];

    // Filter symbols: only keep those belonging to the target country.
    // Use countryCompanies whitelist to filter symbols by country.
    let acceptedCount = 0;
    let skippedCount = 0;
    let whitelistSkipped = 0;

    const filtered = rows.map((item) => {
      const symbol = item.s || "";
      const d = Array.isArray(item.d) ? item.d : [];
      const cols = payload.columns;
      const map = {};
      d.forEach((v, i) => {
        map[cols[i]] = v;
      });

      // Step 1: Check if symbol is in the country's whitelist
      const countryCode = exchange.countryCode; // e.g., "AT" for Austria
      const countryData = countryCompanies[countryCode];
      if (!countryData) {
        // No whitelist for this country code; skip this symbol
        skippedCount++;
        return null;
      }

      const symbolClean = symbol.split(":")[symbol.includes(":") ? 1 : 0].toUpperCase();
      const isInWhitelist = (countryData.companies || []).some((comp) =>
        comp.toUpperCase().includes(symbolClean) || symbolClean.includes(comp.toUpperCase())
      );

      if (!isInWhitelist) {
        // Symbol not in country whitelist; skip it
        whitelistSkipped++;
        return null;
      }

      acceptedCount++;

      return {
        symbol,
        name: map.description || map.name || symbol,
        price: map.close || 0,
        priceInTL: map.close ? Math.round(map.close * exchangeRate * 100) / 100 : 0,
        change: map.change_abs ?? map.change,
        changePct: map.change,
        volume: map.volume,
        marketCap: map.market_cap_basic,
        exchange: exchange.id,
        currency: exchange.currency,
        currencyDisplay: exchange.currency === "USD" ? "USD→TL" : exchange.currency,
        country: exchange.country,
        assetType: "STOCK",
        category: exchange.id,
        raw: map,
      };
    }).filter(Boolean);

  // Log acceptance ratio for debugging
  try {
    console.log(`[INTL] ${exchange.id} - accepted ${acceptedCount}, whitelist-filtered ${whitelistSkipped}, other-skipped ${skippedCount}/${rows.length}`);
  } catch (e) {}

  return filtered;}

export async function startInternationalExchangesCollector({ interval = 30000, marketKey = "INTL" } = {}) {
  console.log("[INTL] Uluslararası Borsalar collector basliyor...");
  let isRunning = true;
  let lastImmediateReq = 0;
  let backoffMs = 0;
  const allData = {};

  async function fetchAllExchanges() {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) {
      console.log("[INTL] Paused - fetch atlandi");
      return;
    }

    const exchanges = exchangeData.exchanges || [];
    const results = [];
    console.log(`[INTL] ${exchanges.length} borsadan veri çekiliyor...`);

    // Her borsa için SIRASAL istekler (rate limiting'i azaltmak için)
    // Paralel yerine 2'lik batch'ler ve aralarında uzun delay
    for (let i = 0; i < exchanges.length; i += 2) {
      const batch = exchanges.slice(i, i + 2);
      console.log(`[INTL] Batch ${Math.floor(i/2) + 1}/${Math.ceil(exchanges.length/2)}: ${batch.map(e => e.id).join(', ')}`);
      
      const promises = batch.map((exchange) =>
        fetchExchangeData(exchange)
          .then((data) => {
            allData[exchange.id] = data;
            console.log(`[INTL] ✓ ${exchange.id}: ${data.length} hisse`);
            return { exchange, success: true, count: data.length };
          })
          .catch((err) => {
            console.error(`[INTL] ✗ ${exchange.id} hatasi:`, err.message);
            return { exchange, success: false, error: err.message };
          })
      );

      await Promise.all(promises);
      await wait(2500); // 2.5 saniye delay batch'ler arasında (rate limiting)
    }

    // Toplamış verileri gönder
    const totalCount = Object.values(allData).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

    if (totalCount > 0) {
      const payload = {
        type: "intl_exchanges",
        ts: Date.now(),
        lastUpdate: new Date().toISOString(),
        count: totalCount,
        exchanges: Object.keys(allData).length,
        data: allData,
        source: "tradingview",
      };

      bus.emit("data", payload);
      console.log(`[INTL] ${Object.keys(allData).length} borsadan ${totalCount} hisse guncellendi.`);
      backoffMs = 0;
    } else {
      throw new Error("Hisse verisi alinamadi");
    }
  }

  try {
    console.log("[INTL] İlk fetch başlıyor...");
    await fetchAllExchanges();
    console.log("[INTL] İlk fetch tamamlandı");
  } catch (err) {
    console.error("[INTL] Ilk cekme hatasi:", err.message);
    console.error("[INTL] Stack:", err.stack);
  }

  const schedule = async () => {
    if (!isRunning) return;
    try {
      await fetchAllExchanges();
    } catch (err) {
      console.error("[INTL] Veri cekme hatasi:", err.message);
      backoffMs = backoffMs ? backoffMs * 2 : interval * 2;
      bus.emit("data", {
        type: "intl_warning",
        ts: Date.now(),
        message: err.message,
        backoffMs,
      });
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
    if (now - lastImmediateReq < 5000) return;
    lastImmediateReq = now;
    fetchAllExchanges().catch(() => {});
  };

  bus.on("request_update", onRequestUpdate);

  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
  };
}

