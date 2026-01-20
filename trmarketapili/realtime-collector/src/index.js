import 'dotenv/config';
import { createSseServer } from './sseServer.js';
import { startInternationalExchangesCollector } from './collectors/internationalExchangesCollector.js';

const PORT = process.env.PORT || 4005;

// Uluslararası Borsalar - TradingView Scanner
startInternationalExchangesCollector({
  interval: Number(process.env.INTL_INTERVAL_MS) || 30000,
});

const app = createSseServer();

const server = app.listen(PORT, () => {
  console.log(`[SSE] Sunucu http://localhost:${PORT} adresinde baslatildi`);
  console.log(`[SSE] Veri akis -> http://localhost:${PORT}/stream`);
  console.log(`[SSE] Test istemcisi -> http://localhost:${PORT}/client.html`);
});

process.on('SIGINT', () => {
  console.log('\n[SYS] SIGINT sinyali alindi, kapatiliyor...');
  server.close(() => {
    console.log('[SYS] Sunucu kapatildi');
    process.exit(0);
  });
});
