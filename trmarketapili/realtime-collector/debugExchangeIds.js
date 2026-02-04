import fetch from "node-fetch";

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const SESSION_ID = process.env.TRADINGVIEW_SESSION_ID;

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Test edilecek borsaların alternatif ID'leri
const testExchanges = {
  "MSM": ["MSM", "MUSCAT", "OMAN", "OMX", "MUS", "MUSCAT_MAIN", "OMAN_MAIN", "OMA"],
  "SASE": ["SASE", "TADAWUL", "SAUDI", "SAU", "TAD", "TASI"],
  "STO": ["STO", "STOCKHOLM", "OMXS", "OMXSTO", "STOCK", "STOCKHOLM_MAIN"],
};

async function testExchange(exchangeId) {
  console.log(`\n🧪 Testing: ${exchangeId}`);
  const payload = {
    filter: [
      { left: "exchange", operation: "equal", right: exchangeId },
      { left: "type", operation: "in_range", right: ["stock"] },
      { left: "market_cap_basic", operation: "nempty" }
    ],
    options: { lang: "en" },
    symbols: { query: { types: ["stock"] }, frame: "d" },
    range: [0, 50],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
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
    });

    console.log(`   Status: ${resp.status}`);

    if (!resp.ok) {
      console.log(`   ❌ HTTP ${resp.status}`);
      return 0;
    }

    const result = await resp.json();
    const count = result.data?.length || 0;
    
    if (count > 0) {
      console.log(`   ✅ ${count} stocks found!`);
      result.data.slice(0, 3).forEach(stock => {
        console.log(`      - ${stock.s} (${stock.d[2]})`);
      });
    } else {
      console.log(`   ⚠️  0 stocks`);
    }
    
    return count;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log("🔍 TradingView Exchange ID Tester");
  console.log(`📌 Session: ${SESSION_ID ? "✅ Found" : "❌ Not found"}`);

  for (const [mainId, alternatives] of Object.entries(testExchanges)) {
    console.log(`\n═══════════════════════════════════`);
    console.log(`🏢 Testing for: ${mainId}`);
    console.log(`═══════════════════════════════════`);

    let found = false;
    for (const altId of alternatives) {
      const result = await testExchange(altId);
      if (result > 0) {
        console.log(`\n✅✅✅ FOUND! Use tvExchange: "${altId}"`);
        found = true;
        break;
      }
      await wait(500);
    }

    if (!found) {
      console.log(`\n❌ No ID worked for ${mainId}`);
    }
  }

  console.log(`\n✅ Test tamamlandı!`);
}

main().catch(console.error);
