import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const exchangeDataPath = path.join(__dirname, "src/collectors/internationalExchanges.json");
const exchangeData = JSON.parse(fs.readFileSync(exchangeDataPath, "utf-8"));

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function testExchange(exchange) {
  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [exchange.tvExchange] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 50],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name", "description"]
  };

  try {
    const resp = await fetch(TV_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(payload),
      timeout: 10000,
    });

    if (!resp.ok) {
      return { id: exchange.id, name: exchange.name, count: 0, status: `HTTP ${resp.status}` };
    }

    const json = await resp.json();
    const count = json.data?.length || 0;
    
    return { 
      id: exchange.id, 
      name: exchange.name, 
      tvExchange: exchange.tvExchange,
      count, 
      status: count > 0 ? "✅" : "❌ 0 stocks" 
    };
  } catch (err) {
    return { id: exchange.id, name: exchange.name, count: 0, status: `Error: ${err.message}` };
  }
}

async function main() {
  console.log("🔍 Testing all exchanges:\n");
  const exchanges = exchangeData.exchanges || [];
  const results = [];

  for (const exchange of exchanges) {
    const result = await testExchange(exchange);
    results.push(result);
    console.log(`${result.status} ${result.id.padEnd(8)} (${result.tvExchange.padEnd(15)}) → ${result.count} stocks - ${result.name}`);
    await wait(600);
  }

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY:");
  console.log("=".repeat(80));
  
  const zeros = results.filter(r => r.count === 0);
  const working = results.filter(r => r.count > 0);
  
  console.log(`\n✅ Working (${working.length}): ${working.map(r => r.id).join(", ")}`);
  console.log(`\n❌ Not Working (${zeros.length}):`);
  zeros.forEach(r => {
    console.log(`  - ${r.id} (tvExchange: "${r.tvExchange}") → ${r.status}`);
  });

  console.log(`\n📊 Total: ${working.length}/${exchanges.length} working`);
}

main().catch(console.error);
