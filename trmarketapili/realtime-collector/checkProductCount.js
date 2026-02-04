import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exchangeDataPath = path.join(__dirname, "src/collectors/internationalExchanges.json");
const countryCompaniesPath = path.join(__dirname, "src/collectors/countryCompanies.json");
const exchangeData = JSON.parse(fs.readFileSync(exchangeDataPath, "utf-8"));
const countryCompanies = JSON.parse(fs.readFileSync(countryCompaniesPath, "utf-8"));

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
let exchangeRate = 43.51;

async function fetchExchangeRate() {
  try {
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
    if (res.ok) {
      const data = await res.json();
      exchangeRate = data.rates?.TRY || 43.51;
    }
  } catch (err) {}
}

async function testExchange(exchange) {
  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [exchange.tvExchange] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 500],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name", "description", "close", "change", "change_abs", "market_cap_basic"]
  };

  try {
    const resp = await fetch(TV_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(payload),
      timeout: 15000,
    });

    if (!resp.ok) return 0;
    const json = await resp.json();
    const rows = Array.isArray(json?.data) ? json.data.slice(0, 500) : [];

    // Filter by whitelist
    const countryCode = exchange.countryCode;
    const countryData = countryCompanies[countryCode];
    if (!countryData) return 0;

    const filtered = rows.filter(item => {
      const symbol = item.s || "";
      const symbolClean = symbol.split(":")[symbol.includes(":") ? 1 : 0].toUpperCase();
      return (countryData.companies || []).some((comp) =>
        comp.toUpperCase().includes(symbolClean) || symbolClean.includes(comp.toUpperCase())
      );
    });

    return filtered.length;
  } catch (err) {
    return 0;
  }
}

async function main() {
  console.log("📊 SITEDE NE KADAR ÜRÜN VAR? KONTROL EDILIYOR...\n");
  
  await fetchExchangeRate();
  
  const exchanges = exchangeData.exchanges || [];
  let totalStocks = 0;
  const results = [];

  for (const exchange of exchanges) {
    const count = await testExchange(exchange);
    results.push({ id: exchange.id, name: exchange.name, count });
    totalStocks += count;
    console.log(`${exchange.id.padEnd(8)} (${exchange.name.padEnd(30)}) → ${count} hisse`);
    await wait(700);
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 TOPLAM ÖZET:");
  console.log("=".repeat(80));
  
  const withData = results.filter(r => r.count > 0);
  const withoutData = results.filter(r => r.count === 0);
  
  console.log(`\n✅ Veri olan borsalar (${withData.length}/${exchanges.length}):`);
  withData.forEach(r => {
    console.log(`  - ${r.id}: ${r.count} hisse`);
  });
  
  if (withoutData.length > 0) {
    console.log(`\n❌ Veri olmayan borsalar (${withoutData.length}/${exchanges.length}):`);
    withoutData.forEach(r => {
      console.log(`  - ${r.id}`);
    });
  }
  
  console.log(`\n📈 TOPLAM HISSE SAYISI: ${totalStocks}`);
  console.log(`💰 Exchange Rate: 1 USD = ${exchangeRate.toFixed(2)} TL`);
}

main().catch(console.error);
