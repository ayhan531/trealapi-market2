import { DateTime } from "luxon";

import "dotenv/config";
import { createSseServer } from "./sseServer.js";
import { startTradingviewApiCollector } from "./collectors/tradingviewApiCollector.js";


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

function isMarketOpen() {
  // Istanbul saatine göre kontrol et
  const now = DateTime.now().setZone("Europe/Istanbul");
  const open = now.set({ hour: TR_OPEN_HOUR, minute: TR_OPEN_MIN, second: 0, millisecond: 0 });
  const close = now.set({ hour: TR_CLOSE_HOUR, minute: TR_CLOSE_MIN, second: 0, millisecond: 0 });
  return now >= open && now <= close;
}

let collectorInstance = null;
async function startCollectorIfNeeded() {
  if (!collectorActive && isMarketOpen()) {
    try {
      const market = process.env.TVAPI_MARKET || "turkey";
      const interval = Number(process.env.TVAPI_INTERVAL || 1000);
      console.log("[BIST] Otomatik başlatılıyor (TR saatiyle 09:00)...");
      collectorInstance = startTradingviewApiCollector({ market, interval });
      collectorActive = true;
    } catch (e) {
      console.error("[BOOT] error:", e.message);
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
