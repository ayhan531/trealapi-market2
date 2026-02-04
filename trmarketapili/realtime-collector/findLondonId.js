import fetch from "node-fetch";

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// London için alternatif ID'ler
const londonAlts = [
  "LSE",
  "FTSE",
  "TVC:FTSE",
  "FTSE:INDEX",
  "FTSE100",
  "LSE:INDEX",
  "LONDON",
  "UK",
  "GB",
  "GBPUSD",
  "XLON",
];

async function testId(id) {
  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [id] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 10],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name", "description", "close"]
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
      console.log(`${id.padEnd(15)} → HTTP ${resp.status}`);
      return 0;
    }

    const json = await resp.json();
    const count = json.data?.length || 0;
    
    if (count > 0) {
      console.log(`✅ ${id.padEnd(15)} → ${count} stocks`);
      if (count > 0) {
        console.log(`   Sample: ${json.data[0].s}`);
      }
    } else {
      console.log(`${id.padEnd(15)} → 0 stocks`);
    }
    
    return count;
  } catch (err) {
    console.log(`${id.padEnd(15)} → Error: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log("🔍 Testing London Stock Exchange ID alternatives:\n");

  for (const id of londonAlts) {
    await testId(id);
    await wait(800);
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
