import fetch from "node-fetch";
import { bus } from "../bus.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getIntervalMs, getOverrides, getPaused } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Hata yönetimi için bekleme fonksiyonu
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// TradingView API'sinden veri çekme fonksiyonu
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`[TV-API] Hata oluştu, ${delay}ms sonra tekrar denenecek (${retries} deneme kaldı):`, error.message);
    await wait(delay);
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }
}

// Piyasa açık mı kontrol et (her zaman true döndürür - 7/24 çalışma için)
function isMarketOpen() {
  return true;
}

export async function startTradingviewApiCollector({ market = "turkey", interval = 5000, force = false }) {
  console.log("[TV-API] 7/24 Modunda Başlatılıyor...");
  console.log(`[TV-API] Market: ${market}`);
  console.log(`[TV-API] Temel güncelleme aralığı: ${interval}ms`);
  
  // Durum değişkenleri
  let isMarketClosed = false;
  let lastSuccessTime = Date.now();
  let errorCount = 0;
  let lastMarketData = null;
  let isRunning = true;
  const SLOW_INTERVAL = 30 * 60 * 1000; // 30 dakika

  // TR saatine göre bir sonraki aralığı belirle
  function getNextIntervalMs() {
    const now = new Date();
    const trNow = new Date(now.getTime() + (3 * 60 - now.getTimezoneOffset()) * 60000);
    const open = new Date(trNow);
    open.setHours(9, 0, 0, 0);
    const close = new Date(trNow);
    close.setHours(18, 30, 0, 0);

    const withinMarket = trNow >= open && trNow <= close;
    const adminInterval = Number(getIntervalMs());
    const next = withinMarket ? (adminInterval || interval) : SLOW_INTERVAL;
    return next;
  }
  
  // Market yapılandırması
  const markets = {
    turkey: { 
      url: "https://scanner.tradingview.com/turkey/scan", 
      name: "Turkey (BIST)",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    america: { 
      url: "https://scanner.tradingview.com/america/scan", 
      name: "US Stocks",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    crypto: { 
      url: "https://scanner.tradingview.com/crypto/scan", 
      name: "Crypto",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    forex: { 
      url: "https://scanner.tradingview.com/forex/scan", 
      name: "Forex",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    cfd: { 
      url: "https://scanner.tradingview.com/cfd/scan", 
      name: "CFD",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    futures: { 
      url: "https://scanner.tradingview.com/futures/scan", 
      name: "Futures",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    },
    bond: { 
      url: "https://scanner.tradingview.com/bond/scan", 
      name: "Bonds",
      fallbackUrl: "https://scanner.tradingview.com/global/scan"
    }
  };

  // Seçili marketi al veya varsayılan olarak BIST'i kullan
  const selectedMarket = markets[market] || markets.turkey;
  
  // Sembolleri yükle
  let targetSymbols = [];
  let targetIndices = [];
  
  try {
    const symbolsPath = join(__dirname, "../../symbols.json");
    const symbolsData = JSON.parse(readFileSync(symbolsPath, "utf-8"));
    targetSymbols = symbolsData.stocks_tr || [];
    targetIndices = symbolsData.indices_tr || [];
    console.log(`[TV-API] 🎯 ${targetSymbols.length} hisse senedi ve ${targetIndices.length} endeks yüklendi`);
  } catch (e) {
    console.error("[TV-API] symbols.json okunamadı:", e.message);
  }

  // Tüm sembolleri çek
  async function fetchAllSymbols() {
    if (!isRunning) return 0;
    if (getPaused && getPaused()) {
      console.log("[TV-API] Paused - veri çekimi atlandı");
      return 0;
    }
    
    console.log(`[TV-API] Veri çekiliyor: ${selectedMarket.name} (${new Date().toLocaleTimeString('tr-TR')})`);
    
    try {
      const payload = {
        "filter": [
          {"left": "exchange", "operation": "equal", "right": "BIST"}
        ],
        "options": { "lang": "en" },
        "columns": [
          "name", "close", "change", "change_abs", "high", "low", "open", "prev_close",
          "volume", "market_cap_basic", "sector", "description", "type", "subtype",
          "update_mode", "pricescale", "minmov", "fractional", "minmove2"
        ],
        "range": [0, 1000],
        "sort": {"sortBy": "name", "sortOrder": "asc"}
      };
      
      // Global scanner endpoint daha toleranslıdır; BIST borsasını filtre ile sınırla
      const response = await fetch("https://scanner.tradingview.com/global/scan", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,tr;q=0.8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let bodySnippet = '';
        try {
          bodySnippet = await response.text();
        } catch (_) {}
        console.error(`[TV-API] HTTP ${response.status} yanıtı:`, bodySnippet?.slice(0, 500));
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error("Geçersiz veri formatı alındı");
      }

      const overrides = getOverrides();
      const processedData = data.data.map(item => {
        const symbol = item.s;
        const arr = Array.isArray(item.d) ? [...item.d] : item.d;
        const ovr = overrides && overrides[symbol];
        if (ovr && Array.isArray(arr)) {
          const close = arr[1];
          const prevClose = arr[7];
          let newClose = Number(close) || 0;
          if (ovr.type === 'set') newClose = Number(ovr.value) || newClose;
          if (ovr.type === 'delta') newClose = newClose + Number(ovr.value || 0);
          if (ovr.type === 'percent') newClose = newClose * (1 + Number(ovr.value || 0) / 100);
          if (newClose > 0) {
            arr[1] = newClose;
            if (Number(prevClose)) {
              const chAbs = newClose - Number(prevClose);
              const chPct = (chAbs / Number(prevClose)) * 100;
              arr[2] = chPct;
              arr[3] = chAbs;
            }
          }
        }
        return {
          s: symbol,
          d: arr,
          isMarketClosed: false
        };
      });

      // Veriyi işle ve yayınla
      const marketData = {
        type: "market_data",
        data: processedData,
        isMarketClosed: false,
        timestamp: new Date().toISOString(),
        lastUpdate: new Date().toLocaleTimeString('tr-TR')
      };

      // Son başarılı verileri kaydet
      lastMarketData = marketData;
      lastSuccessTime = Date.now();
      errorCount = 0;
      
      bus.emit("data", marketData);
      
      console.log(`[TV-API] ${processedData.length} adet veri işlendi`);
      return processedData.length;
      
    } catch (error) {
      console.error(`[TV-API] Veri çekme hatası:`, error.message);
      
      // Hata sayısını artır
      errorCount++;
      
      // Çok fazla hata olursa, marketin kapalı olduğunu varsay
      if (errorCount > 3 && !isMarketClosed) {
        console.log(`[TV-API] Çok fazla hata alındı, borsa kapalı olabilir.`);
        isMarketClosed = true;
        
        // Fallback URL varsa, onu kullanarak tekrar dene
        if (selectedMarket.fallbackUrl) {
          console.log(`[TV-API] Fallback URL ile tekrar denenecek: ${selectedMarket.fallbackUrl}`);
          const tempUrl = selectedMarket.url;
          selectedMarket.url = selectedMarket.fallbackUrl;
          selectedMarket.fallbackUrl = tempUrl;
          return fetchAllSymbols();
        }
      }
      
      // Önceki veriler varsa onları gönder
      if (lastMarketData) {
        console.log(`[TV-API] Son alınan veriler kullanılıyor (${lastMarketData.lastUpdate})`);
        bus.emit("data", {
          ...lastMarketData,
          isMarketClosed: true,
          timestamp: new Date().toISOString(),
          lastUpdate: `${new Date().toLocaleTimeString('tr-TR')} (Önceki Veri)`
        });
      }
      
      return 0;
    }
  }

  // İlk çekimi yap
  if (!getPaused || !getPaused()) {
    await fetchAllSymbols();
  } else {
    console.log("[TV-API] Başlangıçta paused - ilk çekim atlandı");
  }
  
  // Periyodik olarak verileri güncelle
  const updateData = async () => {
    if (!isRunning) return;
    
    try {
      if (!getPaused || !getPaused()) {
        await fetchAllSymbols();
      } else {
        console.log("[TV-API] Paused - döngüde çekim atlandı");
      }
    } catch (error) {
      console.error("[TV-API] Güncelleme hatası:", error.message);
    } finally {
      // Bir sonraki güncelleme için zamanlayıcıyı ayarla
      if (isRunning) {
        const nextDelay = getNextIntervalMs();
        console.log(`[TV-API] Bir sonraki çekim ${Math.round(nextDelay / 1000)} sn sonra yapılacak`);
        setTimeout(updateData, nextDelay);
      }
    }
  };
  
  // İlk güncellemeyi başlat
  setTimeout(updateData, getNextIntervalMs());
  
  // Yeni istemci bağlandığında anlık güncelleme isteğini işle
  let lastImmediateReq = 0;
  const onRequestUpdate = () => {
    if (!isRunning) return;
    if (getPaused && getPaused()) return;
    const now = Date.now();
    if (now - lastImmediateReq < 2000) return;
    lastImmediateReq = now;
    fetchAllSymbols().catch(() => {});
  };
  bus.on("request_update", onRequestUpdate);

  // Temizlik fonksiyonu
  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
    console.log("[TV-API] Veri toplayıcı durduruldu");
  };
}
