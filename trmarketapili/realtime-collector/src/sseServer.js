import express from "express";
import { bus, lastPayload } from "./bus.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createSseServer() {
  const app = express();

  // JSON body parser (header'ları okumak için)
  app.use(express.json());

  // API Key kontrolü devre dışı bırakıldı - herkes erişebilir
  // app.use((req, res, next) => {
  //   const apiKey = req.headers['x-api-key'];
  //   const expectedApiKey = process.env.API_KEY;
  //   if (!apiKey || apiKey !== expectedApiKey) {
  //     return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
  //   }
  //   next();
  // });

  // CORS ayarları - sadece belirli origin'lere izin ver veya API key ile koru
  app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    const origin = req.headers.origin;
    if (allowedOrigins.length > 0 && origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length === 0) {
      // Eğer hiç origin belirtilmemişse, sadece API key ile koru
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      return res.status(403).json({ error: 'Forbidden: Origin not allowed' });
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // Statik test istemcisi
  app.use(express.static(path.join(__dirname, "../public")));

  // Ana sayfa - client.html'i göster
  app.get("/", (_, res) => {
    res.sendFile(path.join(__dirname, "../public/client.html"));
  });

  // Basit sağlık kontrolü
  app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

  // Son payload'ı JSON olarak ver (debug)
  app.get("/latest", (_, res) => res.json({ ts: Date.now(), last: lastPayload }));


  // Türkiye saatine göre market açık mı kontrolü için fonksiyon ekle
  function isMarketOpen() {
    const now = new Date();
    const trNow = new Date(now.getTime() + (3 * 60 - now.getTimezoneOffset()) * 60000);
    const open = new Date(trNow);
    open.setHours(9, 0, 0, 0);
    const close = new Date(trNow);
    close.setHours(18, 30, 0, 0);
    return trNow >= open && trNow <= close;
  }

  // SSE endpointi
  app.get("/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();

    // Market kapalıysa hemen mesaj gönder ve terminale log bas
    if (!isMarketOpen()) {
      const msg = "[BIST] Borsa kapalı. Türkiye saatiyle 09:00-18:30 arası canlı veri yayını yapılır.";
      res.write(`event: market_closed\n`);
      res.write(`data: {"message": "Borsa kapalı. Türkiye saatiyle 09:00-18:30 arası canlı veri yayını yapılır."}\n\n`);
      console.log(msg);
    }

    const keepAlive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);

    const onData = (evt) => {
      res.write(`event: update\n`);
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };

    bus.on("data", onData);

    req.on("close", () => {
      clearInterval(keepAlive);
      bus.off("data", onData);
    });
  });

  return app;
}
