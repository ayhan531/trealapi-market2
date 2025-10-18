import fetch from "node-fetch";
import { bus } from "../bus.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * TradingView Screener API'sinden sadece belirtilen sembolleri çek
 * Puppeteer'dan çok daha hızlı ve güvenilir
 */
export async function startTradingviewApiCollector({ market = "all", interval = 5000 }) {
  console.log("[TV-API] Başlatılıyor...");
  console.log(`[TV-API] Market: ${market}`);
  console.log(`[TV-API] Güncelleme aralığı: ${interval}ms`);
  
  // symbols.json'dan BIST sembolleri ve endeksleri yükle
  let targetSymbols = [];
  let targetIndices = [];
  try {
    const symbolsPath = join(__dirname, "../../symbols.json");
    const symbolsData = JSON.parse(readFileSync(symbolsPath, "utf-8"));
    targetSymbols = symbolsData.stocks_tr || [];
    targetIndices = symbolsData.indices_tr || [];
    console.log(`[TV-API] 🎯 BIST hisse senetleri yüklendi: ${targetSymbols.length} adet`);
    console.log(`[TV-API] 📊 BIST endeksleri yüklendi: ${targetIndices.length} adet`);
  } catch (e) {
    console.error("[TV-API] symbols.json okunamadı:", e.message);
  }

  const markets = {
    america: { url: "https://scanner.tradingview.com/america/scan", name: "US Stocks" },
    crypto: { url: "https://scanner.tradingview.com/crypto/scan", name: "Crypto" },
    forex: { url: "https://scanner.tradingview.com/forex/scan", name: "Forex" },
    cfd: { url: "https://scanner.tradingview.com/cfd/scan", name: "CFD" },
    futures: { url: "https://scanner.tradingview.com/futures/scan", name: "Futures" },
    bond: { url: "https://scanner.tradingview.com/bond/scan", name: "Bonds" },
    turkey: { url: "https://scanner.tradingview.com/turkey/scan", name: "Turkey (BIST)" }
  };

  // "all" seçilirse tüm marketleri çek
  const selectedMarkets = market === "all" 
    ? Object.values(markets) 
    : [markets[market] || markets.america];


  // Tüm sembolleri çek
  async function fetchAllSymbols() {
    let totalCount = 0;
    
    for (const selectedMarket of selectedMarkets) {
    try {
      const payload = {
        "filter": [
          { "left": "type", "operation": "in_range", "right": ["stock", "crypto", "forex", "cfd", "futures", "bond", "index"] }
        ],
        "options": { "lang": "en" },
        "symbols": {},
        "columns": [
          "name", "close", "change", "change_abs", "Recommend.All", "volume", 
          "market_cap_basic", "price_earnings_ttm", "earnings_per_share_basic_ttm",
          "number_of_employees", "sector", "description", "type", "subtype",
          "update_mode", "pricescale", "minmov", "fractional", "minmove2"
        ],
        "sort": { "sortBy": "volume", "sortOrder": "desc" },
        "range": [0, 5000] // İlk 5000 sembol (en yüksek volume)
      };

      console.log(`[TV-API] ${selectedMarket.name} sembolleri çekiliyor...`);

      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.tradingview.com/",
        "Origin": "https://www.tradingview.com"
      };

      // Session ID varsa ekle
      if (process.env.TRADINGVIEW_SESSION_ID && process.env.TRADINGVIEW_SESSION_ID.trim()) {
        headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
        console.log(`[TV-API] Session ID kullanılıyor...`);
      } else {
        console.log(`[TV-API] Session ID yok, genel erişim deneniyor...`);
      }

      const response = await fetch(selectedMarket.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const symbols = data.data || [];

      console.log(`[TV-API] ✅ ${symbols.length} sembol çekildi!`);

      // Her sembolü işle - hem hisse senetleri hem endeksler
      symbols.forEach((item, index) => {
        const symbol = item.s;
        const price = item.d[1] || 0;
        const changePercent = item.d[2] || 0;
        const changeAbs = item.d[3] || 0;
        
        // Endeks mi kontrol et
        const isIndex = targetIndices.includes(symbol);
        const eventType = isIndex ? "tradingview-index" : "tradingview-api";
        
        const symbolData = {
          symbol: symbol,
          name: item.d[0],
          price: price,
          change: changePercent,
          changeAbs: changeAbs,
          recommendation: item.d[4],
          volume: item.d[5] || 0,
          marketCap: item.d[6],
          pe: item.d[7],
          eps: item.d[8],
          employees: item.d[9],
          sector: item.d[10],
          description: item.d[11],
          type: isIndex ? "INDEX" : item.d[12],
          subtype: item.d[13],
          updateMode: item.d[14],
          pricescale: item.d[15],
          minmov: item.d[16],
          fractional: item.d[17],
          minmove2: item.d[18]
        };

        // Bus'a gönder
        bus.emit("data", {
          ts: Date.now(),
          type: eventType,
          payload: symbolData
        });

        // İlk 20'yi logla
        if (index < 20) {
          const prefix = isIndex ? "📊" : "";
          console.log(`[TV-API] ${prefix} ${symbolData.symbol}: $${price.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
        }
      });
      
      totalCount += symbols.length;
    } catch (error) {
      console.error(`[TV-API] ${selectedMarket.name} Hata:`, error.message);
    }
    }
    
    return totalCount;
  }

  // İlk çekimi yap - hisse senetleri ve endeksler birlikte
  const totalCount = await fetchAllSymbols();
  console.log(`[TV-API] 🚀 ${totalCount} sembol yüklendi (hisse senetleri + endeksler)!`);
  console.log(`[TV-API] Her ${interval / 1000} saniyede bir güncellenecek...`);

  // Periyodik güncelleme
  setInterval(async () => {
    const totalCount = await fetchAllSymbols();
    console.log(`[TV-API] 🔄 ${totalCount} sembol güncellendi`);
  }, interval);
}
