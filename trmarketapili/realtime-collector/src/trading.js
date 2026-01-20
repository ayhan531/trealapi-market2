import { lastPayload, getLastPayloadByType } from "./bus.js";

let seq = 0;
const orders = [];

function nextId() {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

function findInstrument(symbolOrId, market) {
  const key = symbolOrId?.toLowerCase();
  const sources = [];
  if (market) {
    if (market === "bist") sources.push(getLastPayloadByType("bist_top100"));
    else if (market === "crypto") sources.push(getLastPayloadByType("coingecko_top100"));
    else if (market === "forex" || market === "fx") sources.push(getLastPayloadByType("forex_top100"));
    else if (market === "commodity" || market === "cmdty" || market === "emtia") sources.push(getLastPayloadByType("commodity_top100"));
    else sources.push(getLastPayloadByType(market));
  } else {
    // try latest, then all known sources
    sources.push(
      lastPayload,
      getLastPayloadByType("coingecko_top100"),
      getLastPayloadByType("bist_top100"),
      getLastPayloadByType("forex_top100"),
      getLastPayloadByType("commodity_top100")
    );
  }

  for (const src of sources) {
    if (!src || !Array.isArray(src.data)) continue;
    const found = src.data.find((c) => {
      const sym = (c.symbol || "").toLowerCase();
      const id = (c.id || "").toLowerCase();
      return sym === key || id === key;
    });
    if (found) return found;
  }
  return null;
}

export function listOrders() {
  return orders.slice();
}

export function getOrder(id) {
  return orders.find((o) => o.id === id) || null;
}

export function cancelOrder(id) {
  const o = orders.find((x) => x.id === id);
  if (!o) return null;
  if (o.status === "filled") return o; // already done, cannot cancel
  o.status = "cancelled";
  o.cancelledAt = Date.now();
  return o;
}

export function createOrder({ symbol, side, amount, market }) {
  const instrument = findInstrument(symbol, market);
  if (!instrument) {
    return { error: "symbol_not_found" };
  }
  const price = Number(instrument.current_price ?? instrument.price ?? instrument.last_price ?? instrument.close);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "price_unavailable" };
  }
  const qty = Number(amount);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: "invalid_amount" };
  }
  const total = price * qty;
  const order = {
    id: nextId(),
    symbol: instrument.symbol,
    instrumentId: instrument.id,
    side,
    amount: qty,
    price,
    total,
    status: "filled", // market order, instant fill
    createdAt: Date.now(),
    filledAt: Date.now(),
    market: market || instrument.type || "unknown",
  };
  orders.unshift(order);
  return order;
}
