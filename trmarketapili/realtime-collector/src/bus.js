import { EventEmitter } from "events";
export const bus = new EventEmitter();

// Son olayın snapshot'unu tutalım (isteğe bağlı)
export let lastPayload = null;
bus.on("data", (payload) => { lastPayload = payload; });
