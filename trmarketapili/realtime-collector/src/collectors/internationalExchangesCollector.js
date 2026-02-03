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

// TL Conversion - 1 USD = ~33 TL (güncellenebilir)
let exchangeRate = 33;
async function fetchExchangeRate() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (res.ok) {
      const data = await res.json();
      exchangeRate = data.rates?.TRY || 33;
      console.log(`[INTL] Exchange Rate: 1 USD = ${exchangeRate.toFixed(2)} TL`);
    }
  } catch (err) {
    console.log("[INTL] Exchange rate API başarısız, default kullanılıyor");
  }
}

// Her saatte bir kuru güncelle
setInterval(fetchExchangeRate, 3600000);
fetchExchangeRate();

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
    range: [0, 100],
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

  const resp = await fetch(TV_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeout: 15000,
  });

  if (!resp.ok) throw new Error(`TV HTTP ${resp.status}`);
    const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data.slice(0, 100) : [];

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
        price: map.close ? Math.round(map.close * exchangeRate * 100) / 100 : null,
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

  // Eksik market ID'lerini test et
  async function testMissingExchanges() {
    console.log("[INTL] === Eksik Market ID'leri Test Ediliyor ===");
    const missingExchanges = [
      "ENXBE", "HEX", "ENXPA", "ENXAM", "ENXDU", "BES", "QE", "ENXLI", "MSM", "XETRA", "STO"
    ];

    for (const exchId of missingExchanges) {
      const alternatives = ALTERNATIVE_IDS[exchId] || [];
      console.log(`\n[INTL-TEST] ${exchId} - Denenen ID'ler: ${alternatives.join(", ")}`);

      for (const altId of alternatives) {
        try {
          const testExchange = {
            id: exchId,
            tvExchange: altId,
            currency: "USD"
          };

          const data = await fetchExchangeData(testExchange);
          if (data.length > 0) {
            console.log(`[INTL-TEST] ✓ ${exchId} başarılı! ID: ${altId} → ${data.length} hisse`);
            break; // Bulundu, sonrakini deneme
          }
        } catch (err) {
          // Sessiz hata
        }
      }
    }

    // === BULK TEST: Muscat ve Frankfurt için kapsamlı ID listesi ===
    console.log("\n[INTL-BULK] ===== MUSCAT VE FRANKFURT KAPSAMLI SCAN =====");
    
    const bulkTests = [
      { code: "MSM", names: ["MSM", "MUSCAT", "OMR", "OMAN", "MUSCAT_SECURITIES", "SOHAR", "OMAN_MAIN", "OMANI", "MUSCAT_MAIN", "OMAN_MARKET", "SECURITIES_MUSCAT", "OSM", "OMS"] },
      { code: "XETRA", names: ["XETRA", "FRA", "FRANKFURT", "DB", "XETRA_MAIN", "DEUTSCHE", "XETRA_TRADING", "GER", "GERMAN", "GERM", "EUREX", "EURA", "XETR"] }
    ];

    for (const bulk of bulkTests) {
      console.log(`\n[INTL-BULK] ${bulk.code} - ${bulk.names.length} alternatif test ediliyor...`);
      for (const altId of bulk.names) {
        try {
          const testExchange = {
            id: bulk.code,
            tvExchange: altId,
            currency: "USD"
          };

          const data = await fetchExchangeData(testExchange);
          if (data.length > 0) {
            console.log(`[INTL-BULK] ✓✓✓ BULUNDU! ${bulk.code} → ID: "${altId}" = ${data.length} hisse`);
            // Başarılı ID'yi ekstra log et
            console.log(`[INTL-BULK-SUCCESS] Güncelle: "${bulk.code}": tvExchange="${altId}"`);
            break;
          }
        } catch (err) {
          // Sessiz hata
        }
      }
    }
  }

  async function fetchAllExchanges() {
    if (!isRunning) return;
    if (getPaused && getPaused(marketKey)) {
      console.log("[INTL] Paused - fetch atlandi");
      return;
    }

    const exchanges = exchangeData.exchanges || [];
    const results = [];
    console.log(`[INTL] ${exchanges.length} borsadan veri çekiliyor...`);

    // Her borsa için paralel istekler yapalım (5 tanesini aynı anda)
    for (let i = 0; i < exchanges.length; i += 5) {
      const batch = exchanges.slice(i, i + 5);
      console.log(`[INTL] Batch ${i/5 + 1}/${Math.ceil(exchanges.length/5)}: ${batch.map(e => e.id).join(', ')}`);
      const promises = batch.map((exchange) =>
        fetchExchangeData(exchange)
          .then((data) => {
            allData[exchange.id] = data;
            console.log(`[INTL] ${exchange.id}: ${data.length} hisse`);
            return { exchange, success: true, count: data.length };
          })
          .catch((err) => {
            console.error(`[INTL] ${exchange.id} hatasi:`, err.message);
            return { exchange, success: false, error: err.message };
          })
      );

      await Promise.all(promises);
      await wait(1000); // Rate limiting için ara
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
    // Eksik market'leri test et
    await testMissingExchanges();
    // Sonra normal fetch
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

