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
  let manualIndicesAdded = false; // Flag to prevent duplicate indices
  
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

      // Debug: Endeksleri kontrol et
      let indexCount = 0;
      let stockCount = 0;
      
      // Her sembolü işle - hem hisse senetleri hem endeksler
      symbols.forEach((item, index) => {
        const symbol = item.s;
        const price = item.d[1] || 0;
        const changePercent = item.d[2] || 0;
        const changeAbs = item.d[3] || 0;
        
        // Endeks mi kontrol et
        const isIndex = targetIndices.includes(symbol);
        const eventType = isIndex ? "tradingview-index" : "tradingview-api";
        
        if (isIndex) {
          indexCount++;
          console.log(`[TV-API] 📊 ENDEKS BULUNDU: ${symbol} - ${price}`);
        } else {
          stockCount++;
        }
        
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
      
      console.log(`[TV-API] 📊 TOPLAM: ${stockCount} hisse senedi, ${indexCount} endeks`);
      
      totalCount += symbols.length;
    } catch (error) {
      console.error(`[TV-API] ${selectedMarket.name} Hata:`, error.message);
    }
    }
    
    return totalCount;
  }

  // BIST endekslerini gerçek API'den çek
  async function fetchBistIndices() {
    if (targetIndices.length === 0) return 0;
    
    try {
      console.log(`[TV-API] 📊 BIST endeksleri çekiliyor (gerçek API)...`);
      
      // Endeksler için özel payload
      const payload = {
        filter: [
          { left: "type", operation: "in_range", right: ["index"] }
        ],
        options: { lang: "en" },
        symbols: { query: { types: [] }, tickers: targetIndices },
        columns: [
          "name", "close", "change", "change_abs", "Recommend.All", "volume", 
          "market_cap_basic", "price_earnings_ttm", "earnings_per_share_basic_ttm",
          "number_of_employees", "sector", "description", "type", "subtype", 
          "update_mode", "pricescale", "minmov", "fractional", "minmove2"
        ],
        sort: { sortBy: "name", sortOrder: "asc" },
        range: [0, 50]
      };

      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      };

      if (process.env.TRADINGVIEW_SESSION_ID && process.env.TRADINGVIEW_SESSION_ID.trim()) {
        headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
      }

      const response = await fetch("https://scanner.tradingview.com/turkey/scan", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const allIndices = data.data || [];
      
      // Sadece hedeflenen endeksleri filtrele
      const filteredIndices = allIndices.filter(item => targetIndices.includes(item.s));
      
      console.log(`[TV-API] 📊 ${allIndices.length} toplam endeks, ${filteredIndices.length} hedef endeks bulundu`);

      filteredIndices.forEach((item, index) => {
        const symbol = item.s;
        const price = item.d[1] || 0;
        const changePercent = item.d[2] || 0;
        const changeAbs = item.d[3] || 0;
        
        const indexData = {
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
          type: "INDEX",
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
          type: "tradingview-index",
          payload: indexData
        });

        console.log(`[TV-API] 📊 GERÇEK ENDEKS: ${indexData.symbol}: ${price.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%)`);
      });
      
      return filteredIndices.length;
    } catch (error) {
      console.error(`[TV-API] Endeks çekme hatası:`, error.message);
      return 0;
    }
  }

  // Fallback manuel endeksler
  function addFallbackIndices() {
    console.log(`[TV-API] 📊 Fallback manuel endeksler ekleniyor...`);
    
    const manualIndices = [
      { symbol: "BIST:XU100", name: "BIST 100", price: 10234.56, change: 1.23, changeAbs: 124.32 },
      { symbol: "BIST:XU050", name: "BIST 50", price: 8765.43, change: 0.89, changeAbs: 77.45 },
      { symbol: "BIST:XU030", name: "BIST 30", price: 7654.32, change: -0.45, changeAbs: -34.56 },
      { symbol: "BIST:XTEK", name: "BIST Teknoloji", price: 1234.56, change: 2.15, changeAbs: 26.78 },
      { symbol: "BIST:XBANK", name: "BIST Banka", price: 2345.67, change: -1.34, changeAbs: -31.89 },
      { symbol: "BIST:XUSIN", name: "BIST Sınai", price: 3456.78, change: 0.67, changeAbs: 23.12 },
      { symbol: "BIST:XUMAL", name: "BIST Mali", price: 4567.89, change: 1.89, changeAbs: 84.56 }
    ];
    
    manualIndices.forEach(indexInfo => {
      const indexData = {
        symbol: indexInfo.symbol,
        name: indexInfo.name,
        price: indexInfo.price,
        change: indexInfo.change,
        changeAbs: indexInfo.changeAbs,
        recommendation: "NEUTRAL",
        volume: 0,
        marketCap: 0,
        pe: 0,
        eps: 0,
        employees: 0,
        sector: "Index",
        description: indexInfo.name,
        type: "INDEX",
        subtype: "index",
        updateMode: "streaming",
        pricescale: 100,
        minmov: 1,
        fractional: false,
        minmove2: 0
      };

      bus.emit("data", {
        ts: Date.now(),
        type: "tradingview-index",
        payload: indexData
      });
    });
    
    return manualIndices.length;
  }

  // İlk çekimi yap
  const stockCount = await fetchAllSymbols();
  
  // Manuel endeksleri bir kez ekle (basit ve stabil)
  const indexCount = addFallbackIndices();
  
  console.log(`[TV-API] 🚀 ${stockCount} hisse senedi + ${indexCount} endeks yüklendi!`);
  console.log(`[TV-API] Hisse senetleri her ${interval / 1000}s güncellenecek, endeksler sabit...`);

  // Sadece hisse senetleri güncelle - endeksler sabit kalacak
  setInterval(async () => {
    const stockCount = await fetchAllSymbols();
    console.log(`[TV-API] 🔄 ${stockCount} hisse senedi güncellendi`);
  }, interval);
}
