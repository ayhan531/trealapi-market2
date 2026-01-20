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
    const response = await fetch(url, {
      ...options,
      timeout: 10000 // 10 saniye zaman aşımı
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.json();
  } catch (error) {
    if (retries === 0) throw error;
    console.log(`[TV-API] Hata oluştu, ${delay}ms sonra tekrar denenecek (${retries} deneme kaldı):`, error.message);
    await wait(delay);
    return fetchWithRetry(url, options, retries - 1, delay * 2);
  }
}

// Piyasa her zaman açık kabul ediliyor (7/24 çalışma için)
function isMarketOpen() {
  return true;
}

export async function startTradingviewApiCollector({ interval = 5000, force = false }) {
  console.log("[TV-API] 7/24 Modunda Başlatılıyor...");
  console.log(`[TV-API] Tüm piyasa verileri için güncelleme aralığı: ${interval}ms`);
  
  // Durum değişkenleri
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
  
  // Tüm piyasa yapılandırmaları
  const markets = {
    crypto: {
      name: "Kripto Paralar",
      payload: {
        "filter": [{"left": "subtype", "operation": "in_range", "right": ["crypto"]}],
        "columns": [
          "name", "close", "change", "change_abs", "high", "low", "open", "volume",
          "market_cap_calc", "description", "type", "subtype", "exchange"
        ]
      }
    },
    forex: {
      name: "Döviz Çiftleri",
      payload: {
        "filter": [{"left": "type", "operation": "in_range", "right": ["forex"]}],
        "columns": [
          "name", "close", "change", "change_abs", "high", "low", "open", "description",
          "type", "subtype", "exchange", "pricescale", "minmov", "fractional"
        ]
      }
    },
    commodity: {
      name: "Emtialar",
      payload: {
        "filter": [{"left": "type", "operation": "in_range", "right": ["commodity"]}],
        "columns": [
          "name", "close", "change", "change_abs", "high", "low", "open", "description",
          "type", "subtype", "exchange"
        ]
      }
    },
    us_stocks: {
      name: "ABD Hisse Senetleri",
      payload: {
        "filter": [{"left": "exchange", "operation": "in_range", "right": ["NYSE", "NASDAQ"]}],
        "columns": [
          "name", "close", "change", "change_abs", "high", "low", "open", "prev_close",
          "volume", "market_cap_basic", "sector", "description", "type", "subtype"
        ]
      }
    }
  };

  // Tüm piyasa verilerini çek
  async function fetchAllMarkets() {
    if (!isRunning) return {};
    if (getPaused && getPaused()) {
      console.log("[TV-API] Durduruldu - veri çekimi atlandı");
      return lastMarketData?.data || {};
    }
    
    console.log(`[TV-API] Tüm piyasa verileri çekiliyor... (${new Date().toLocaleTimeString('tr-TR')})`);
    
    const allMarketsData = {};
    
    // Her piyasa için ayrı istek yap
    for (const [marketKey, marketConfig] of Object.entries(markets)) {
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;
      
      while (retryCount < maxRetries && !success) {
        try {
          console.log(`[TV-API] ${marketConfig.name} verileri çekiliyor (Deneme ${retryCount + 1}/${maxRetries})...`);
          
          const payload = {
            ...marketConfig.payload,
            "options": { "lang": "tr" },
            "range": [0, 1000],
            "sort": {"sortBy": "name", "sortOrder": "asc"}
          };
          
          const response = await fetchWithRetry("https://scanner.tradingview.com/global/scan", {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            body: JSON.stringify(payload)
          });

          if (response && response.data) {
            allMarketsData[marketKey] = {
              name: marketConfig.name,
              data: processMarketData(response.data, marketConfig.payload.columns),
              lastUpdate: new Date().toISOString(),
              status: 'success'
            };
            console.log(`[TV-API] ${marketConfig.name} başarıyla yüklendi: ${response.data.length} sembol`);
            success = true;
          }
        } catch (error) {
          console.error(`[TV-API] ${marketConfig.name} veri çekme hatası (Deneme ${retryCount + 1}/${maxRetries}):`, error.message);
          retryCount++;
          
          // Son denemede hala başarısız olursa
          if (retryCount === maxRetries) {
            console.log(`[TV-API] ${marketConfig.name} için maksimum deneme sayısına ulaşıldı.`);
            allMarketsData[marketKey] = {
              name: marketConfig.name,
              error: error.message,
              data: lastMarketData?.data?.[marketKey]?.data || [],
              lastUpdate: new Date().toISOString(),
              status: 'error',
              retryCount: retryCount
            };
          } else {
            // Bir sonraki denemeden önce bekle
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
    }
    
    return allMarketsData;
  }
  
  // Ham veriyi işle
  function processMarketData(data, columns) {
    if (!Array.isArray(data)) return [];
    
    return data.map(item => {
      const symbolData = {};
      if (item.s) symbolData.symbol = item.s;
      
      // Sütun verilerini eşle
      if (Array.isArray(item.d)) {
        item.d.forEach((value, index) => {
          if (columns && columns[index]) {
            symbolData[columns[index]] = value;
          } else {
            symbolData[`col_${index}`] = value;
          }
        });
      }
      
      return symbolData;
    });
  }

  // Tüm piyasa verilerini çek ve işle
  async function fetchAllSymbols() {
    if (!isRunning) return 0;
    
    try {
      const allMarketsData = await fetchAllMarkets();
      
      // Veriyi işle ve yayınla
      const marketData = {
        type: "all_market_data",
        timestamp: new Date().toISOString(),
        lastUpdate: new Date().toLocaleTimeString('tr-TR'),
        data: allMarketsData
      };
      
      bus.emit('data', marketData);
      lastMarketData = marketData;
      lastSuccessTime = Date.now();
      errorCount = 0;
      
      const totalSymbols = Object.values(allMarketsData).reduce(
        (acc, market) => acc + (market.data?.length || 0), 0
      );
      
      console.log(`[TV-API] Toplam ${totalSymbols} sembol işlendi`);
      return totalSymbols;
      
    } catch (error) {
      console.error(`[TV-API] Veri çekme hatası:`, error.message);
      
      // Hata sayısını artır
      errorCount++;
      
      // Önceki veriler varsa onları gönder
      if (lastMarketData) {
        console.log(`[TV-API] Son alınan veriler kullanılıyor (${lastMarketData.lastUpdate})`);
        bus.emit("data", {
          ...lastMarketData,
          isMarketClosed: true,
          timestamp: new Date().toISOString(),
          lastUpdate: `${new Date().toLocaleTimeString('tr-TR')} (Önceki Veri)`,
          error: error.message
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
    if (now - lastImmediateReq < 2000) return; // En az 2 saniye beklet
    lastImmediateReq = now;
    fetchAllSymbols().catch(console.error);
  };
  
  bus.on("request_update", onRequestUpdate);

  // Temizlik fonksiyonu
  return () => {
    isRunning = false;
    bus.off("request_update", onRequestUpdate);
    console.log("[TV-API] Veri toplayıcı durduruldu");
  };
}
