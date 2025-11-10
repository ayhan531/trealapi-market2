import { DateTime } from "luxon";

import "dotenv/config";
import { createSseServer } from "./sseServer.js";
import { startTradingviewApiCollector } from "./collectors/tradingviewApiCollector.js";
import { bus } from "./bus.js";


const PORT = process.env.PORT || 4000;
const app = createSseServer();
const server = app.listen(PORT, () => {
  console.log(`[SSE] listening on http://localhost:${PORT}`);
  console.log(`[SSE] stream endpoint -> http://localhost:${PORT}/stream`);
  console.log(`[SSE] test client -> http://localhost:${PORT}/client.html`);
});

// Türkiye saatine göre zamanlayıcı (UTC+3)
const TR_OPEN_HOUR = 9;
const TR_OPEN_MIN = 0;
const TR_CLOSE_HOUR = 18;
const TR_CLOSE_MIN = 30;
let collectorActive = false;
let collectorStopper = null;

// Piyasa saati kontrolünü devre dışı bırak, her zaman true döndür
function isMarketOpen() {
  return true; // Her zaman piyasa açık gibi davran
}

let collectorInstance = null;
let lastMarketData = null;

// Son piyasa verilerini kaydet
bus.on('data', (data) => {
  if (data.type === 'market_data' && data.data) {
    lastMarketData = data;
  }
});

async function startCollectorIfNeeded() {
  if (!collectorActive) {
    try {
      const market = process.env.TVAPI_MARKET || "turkey";
      const interval = Number(process.env.TVAPI_INTERVAL || 1000);
      
      console.log("[BIST] Veri toplayıcı başlatılıyor (7/24 modu)...");
      collectorInstance = startTradingviewApiCollector({ 
        market, 
        interval,
        force: true // Borsa kapalı olsa bile veri çek
      });
      
      collectorActive = true;
    } catch (e) {
      console.error("[BOOT] error:", e.message);
      // Hata durumunda 10 saniye sonra tekrar dene
      setTimeout(startCollectorIfNeeded, 10000);
    }
  }
}

function stopCollectorIfNeeded() {
  if (collectorActive) {
    // Collector fonksiyonunda bir stop mekanizması yoksa process.exit ile kapatılabilir
    console.log("[BIST] Otomatik durduruluyor (TR saatiyle 18:30)...");
    process.exit(0);
  }
}

// Her dakikada bir kontrol et
setInterval(() => {
  if (isMarketOpen()) {
    startCollectorIfNeeded();
  } else {
    stopCollectorIfNeeded();
  }
}, 60 * 1000);

// Uygulama ilk açıldığında da kontrol et
if (isMarketOpen()) {
  startCollectorIfNeeded();
}

// Graceful shutdown
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(sig) {
  console.log(`[SYS] ${sig} received, closing...`);
  server.close(() => {
    console.log("[SYS] server closed");
    process.exit(0);
  });
}
