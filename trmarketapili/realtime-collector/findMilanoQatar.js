import fetch from "node-fetch";

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// Milano için alternatifler
const milanoAlts = ["BIT", "MIL", "MILAN", "ITALYX", "EURONEXT"];
// Katar için alternatifler  
const qatarAlts = ["DSM", "QE", "QATAR", "DOHA", "TADAWUL", "QE:INDEX"];

async function testId(id, name) {
  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [id] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 10],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name"]
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

    if (!resp.ok) return 0;
    const json = await resp.json();
    return json.data?.length || 0;
  } catch (err) {
    return 0;
  }
}

async function main() {
  console.log("🔍 Testing Milano alternatives:\n");
  for (const id of milanoAlts) {
    const count = await testId(id, "Milano");
    console.log(`  ${id.padEnd(15)} → ${count} stocks ${count > 0 ? "✅" : ""}`);
    await wait(600);
  }

  console.log("\n🔍 Testing Qatar alternatives:\n");
  for (const id of qatarAlts) {
    const count = await testId(id, "Qatar");
    console.log(`  ${id.padEnd(15)} → ${count} stocks ${count > 0 ? "✅" : ""}`);
    await wait(600);
  }
}

main().catch(console.error);
