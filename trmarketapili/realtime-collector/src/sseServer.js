import express from "express";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import { bus, lastPayload } from "./bus.js";
import { getIntervalMs, setIntervalMs, getOverrides, setOverride, removeOverride, getPaused, setPaused } from "./config.js";
import { createOrder, listOrders, getOrder, cancelOrder } from "./trading.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createSseServer() {
  const app = express();

  app.use(express.json());

  app.use(compression({
    filter: (req, res) => {
      const type = res.getHeader('Content-Type');
      if (type && typeof type === 'string' && type.includes('text/event-stream')) return false;
      return compression.filter(req, res);
    }
  }));

  const API_KEY = process.env.API_KEY;
  const requireApiKey = (req, res, next) => {
    if (!API_KEY) return next();
    const headerKey = req.headers['x-api-key'];
    const queryKey = req.query && req.query.key;
    if (headerKey === API_KEY || queryKey === API_KEY) return next();
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
  };

  app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
    const origin = req.headers.origin;
    if (allowedOrigins.length > 0 && origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length === 0) {
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

  app.use(express.static(path.join(__dirname, "../public"), {
    maxAge: '365d',
    immutable: true,
    index: false,
    etag: true
  }));

  app.get("/", (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, "../public/client.html"));
  });

  app.get("/client.html", (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, "../public/client.html"));
  });

  app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now(), collector: 'disabled' }));

  app.get('/favicon.ico', (_, res) => res.status(204).end());

  // Collector disabled: always return null payload
  app.get("/latest", requireApiKey, (_, res) => res.json({ ts: Date.now(), last: lastPayload || null }));

  app.get("/admin", requireApiKey, (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, "../public/admin.html"));
  });

  app.get("/admin/api/config", requireApiKey, async (_, res) => {
    res.json({
      intervals: {
        GLOBAL: getIntervalMs("GLOBAL"),
        CRYPTO: getIntervalMs("CRYPTO"),
        FOREX: getIntervalMs("FOREX"),
        COMMODITY: getIntervalMs("COMMODITY"),
        STOCK: getIntervalMs("STOCK")
      },
      overrides: getOverrides(),
      paused: {
        GLOBAL: getPaused("GLOBAL"),
        CRYPTO: getPaused("CRYPTO"),
        FOREX: getPaused("FOREX"),
        COMMODITY: getPaused("COMMODITY"),
        STOCK: getPaused("STOCK")
      }
    });
  });

  app.post("/admin/api/interval", requireApiKey, async (req, res) => {
    const market = req.body?.market || "GLOBAL";
    const n = await setIntervalMs(req.body?.intervalMs, market);
    res.json({ ok: true, intervalMs: n, market });
  });

  app.post("/admin/api/override", requireApiKey, async (req, res) => {
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

  app.delete("/admin/api/override/:symbol", requireApiKey, async (req, res) => {
    const symbol = req.params.symbol;
    await removeOverride(symbol);
    res.json({ ok: true });
  });

  app.post("/admin/api/pause", requireApiKey, async (req, res) => {
    const paused = !!(req.body && (req.body.paused === true || req.body.paused === 'true'));
    const market = req.body?.market || "GLOBAL";
    const v = await setPaused(paused, market);
    res.json({ ok: true, paused: v, market });
  });

  app.post("/admin/api/request-update", requireApiKey, async (_req, res) => {
    try {
      bus.emit("request_update");
    } catch (_) {}
    res.json({ ok: true });
  });

  // Basit trade API (in-memory, market order simülasyonu)
  app.get("/trade/orders", requireApiKey, (_, res) => {
    res.json({ ok: true, orders: listOrders() });
  });

  app.get("/trade/orders/:id", requireApiKey, (req, res) => {
    const o = getOrder(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, order: o });
  });

  app.post("/trade/orders", requireApiKey, (req, res) => {
    const { symbol, side, amount, market } = req.body || {};
    if (!symbol || !side || !amount) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }
    if (!["buy", "sell"].includes(String(side).toLowerCase())) {
      return res.status(400).json({ ok: false, error: "invalid_side" });
    }
    const result = createOrder({ symbol: String(symbol).toLowerCase(), side: String(side).toLowerCase(), amount, market });
    if (result.error) {
      const status = result.error === "symbol_not_found" ? 404 : 400;
      return res.status(status).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, order: result });
  });

  app.delete("/trade/orders/:id", requireApiKey, (req, res) => {
    const o = cancelOrder(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, order: o });
  });

  app.get("/stream", (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Keep-Alive': 'timeout=60',
      'Alt-Svc': 'clear'
    });

    try { res.flushHeaders(); } catch (_) {}

    if (lastPayload) {
      const initial = { ts: Date.now(), ...lastPayload };
      res.write(`data: ${JSON.stringify(initial)}\n\n`);
    }

    const keepAlive = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 15000);

    const onData = (evt) => {
      if (res.writableEnded) return;
      try {
        const payload = { ts: Date.now(), ...evt };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {
        console.error(`[SSE] Error sending to client:`, e.message);
      }
    };

    bus.on("data", onData);

    req.on('close', () => {
      clearInterval(keepAlive);
      bus.off("data", onData);
    });
    req.on('aborted', () => {
      clearInterval(keepAlive);
      bus.off("data", onData);
    });
  });

  return app;
}
