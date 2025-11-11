import express from "express";
import { bus, lastPayload } from "./bus.js";
import path from "path";
import { fileURLToPath } from "url";
import { getIntervalMs, setIntervalMs, getOverrides, setOverride, removeOverride, getPaused, setPaused } from "./config.js";

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, "../public/client.html"));
  });

  // Basit sağlık kontrolü
  app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

  // Favicon isteğini 404 yerine 204 ile cevapla
  app.get('/favicon.ico', (_, res) => res.status(204).end());

  // Son payload'ı JSON olarak ver (debug)
  app.get("/latest", (_, res) => res.json({ ts: Date.now(), last: lastPayload }));

  app.get("/admin", (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, "../public/admin.html"));
  });

  app.get("/admin/api/config", async (_, res) => {
    res.json({ intervalMs: getIntervalMs(), overrides: getOverrides(), paused: getPaused() });
  });

  app.post("/admin/api/interval", async (req, res) => {
    const n = await setIntervalMs(req.body?.intervalMs);
    res.json({ ok: true, intervalMs: n });
  });

  app.post("/admin/api/override", async (req, res) => {
    const { symbol, type, value, durationSec, expiresAt } = req.body || {};
    if (!symbol || !type) return res.status(400).json({ ok: false, error: 'bad_request' });
    let exp = 0;
    const now = Date.now();
    if (Number(expiresAt)) {
      exp = Number(expiresAt);
    } else if (Number(durationSec)) {
      exp = now + Number(durationSec) * 1000;
    }
    const payload = { type, value: Number(value) };
    if (exp > now) payload.expiresAt = exp;
    await setOverride(symbol, payload);
    res.json({ ok: true });
  });

  app.delete("/admin/api/override/:symbol", async (req, res) => {
    const symbol = req.params.symbol;
    await removeOverride(symbol);
    res.json({ ok: true });
  });

  app.post("/admin/api/pause", async (req, res) => {
    const paused = !!(req.body && (req.body.paused === true || req.body.paused === 'true'));
    const v = await setPaused(paused);
    res.json({ ok: true, paused: v });
  });


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

  let clients = [];

  // EventSource bağlantısı
  app.get("/stream", (req, res) => {
    // SSE başlıklarını ayarla
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Keep-Alive': 'timeout=60',
      'Alt-Svc': 'clear'
    });

    try { res.flushHeaders(); } catch (_) {}

    // Yeni bağlantıyı kaydet
    const clientId = Date.now();
    const newClient = {
      id: clientId,
      res
    };

    clients.push(newClient);
    console.log(`[SSE] New client connected: ${clientId}`);

    // İlk bağlantıda mevcut veriyi 'update' event'i ile gönder
    if (lastPayload) {
      try {
        const initial = { ts: Date.now(), ...lastPayload };
        res.write(`event: update\n`);
        res.write(`data: ${JSON.stringify(initial)}\n\n`);
      } catch (e) {
        console.error(`[SSE] Initial send error for client ${clientId}:`, e.message);
      }
    } else {
      // Eğer hiç veri yoksa, borsanın kapalı olduğunu belirten bir mesaj gönder
      const marketClosedMessage = {
        type: 'market_closed',
        message: 'Borsa kapalı. Türkiye saatiyle 09:00-18:30 arası canlı veri yayını yapılır.'
      };
      res.write(`event: market_closed\ndata: ${JSON.stringify(marketClosedMessage)}\n\n`);
    }

    // Bağlantının açık kalmasını sağla
    const keepAlive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);

    // Veri geldiğinde sadece bu bağlantıya gönder
    const onData = (evt) => {
      if (res.writableEnded) return;
      
      try {
        const payload = { ts: Date.now(), ...evt };
        res.write(`event: update\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {
        console.error(`[SSE] Error sending to client ${clientId}:`, e.message);
      }
    };

    bus.on("data", onData);

    // Bağlantı kapatıldığında temizlik yap
    req.on('close', () => {
      console.log(`[SSE] Client ${clientId} disconnected`);
      clients = clients.filter(client => client.id !== clientId);
      clearInterval(keepAlive);
      bus.off("data", onData);
    });

    req.on('aborted', () => {
      console.log(`[SSE] Client ${clientId} aborted`);
      clients = clients.filter(client => client.id !== clientId);
      clearInterval(keepAlive);
      bus.off("data", onData);
    });
  });

  return app;
}
