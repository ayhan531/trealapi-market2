import fetch from "node-fetch";

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const SESSION_ID = process.env.TRADINGVIEW_SESSION_ID;

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Test edilecek borsalar
const testExchanges = [
  { id: "VSE", code: "VIE", tvExchange: "VIE" },
  { id: "LSE", code: "GB", tvExchange: "TVC:FTSE" },
  { id: "TASI", code: "SA", tvExchange: "TADAWUL" },
  { id: "OMXS", code: "SE", tvExchange: "OMXSTO" },
];

async function testExchange(exchange) {
  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [exchange.tvExchange] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 20],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name", "description", "close", "change", "change_abs", "market_cap_basic"]
  };

  try {
    const resp = await fetch(TV_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `sessionid=${SESSION_ID}`,
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify(payload),
      timeout: 15000,
    });

    console.log(`\n${exchange.id} (${exchange.tvExchange}):`);
    console.log(`  Status: ${resp.status}`);

    if (!resp.ok) {
      console.log(`  ❌ Error: HTTP ${resp.status}`);
      return;
    }

    const json = await resp.json();
    const count = json.data?.length || 0;
    console.log(`  ✅ ${count} stocks received`);
    
    if (count > 0) {
      console.log(`  Top 3:`);
      json.data.slice(0, 3).forEach(stock => {
        const symbol = stock.s || "N/A";
        const name = stock.d?.[1] || "N/A";
        console.log(`    - ${symbol}: ${name}`);
      });
    }
  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
  }
}

async function main() {
  console.log("🧪 Testing TradingView API Connection");
  console.log(`Session: ${SESSION_ID ? "✅ Set" : "❌ Missing"}`);

  for (const exchange of testExchanges) {
    await testExchange(exchange);
    await wait(1000);
  }
}

main().catch(console.error);
