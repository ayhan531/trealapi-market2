import fetch from "node-fetch";

const TV_ENDPOINT = "https://scanner.tradingview.com/global/scan";

// Eksik olan 14 exchange'i test et
const exchangesToTest = [
  { id: "VSE", names: ["WIENERBOERSE", "VIE", "VSE", "WIEN"] },
  { id: "ENXBE", names: ["BRUXE", "EURONEXT", "BRUSSELS", "BRU"] },
  { id: "HEX", names: ["HELSINKI", "HEX", "FIHEX", "HELS"] },
  { id: "ENXPA", names: ["PARIS", "EURONEXT", "PAR", "PARIS_MAIN"] },
  { id: "ENXAM", names: ["AMSTD", "EURONEXT", "AMSTERDAM", "AMS"] },
  { id: "ENXDU", names: ["DUBLI", "DUBLIN", "DUB", "ISEQ"] },
  { id: "OMXS", names: ["STOCKHOLM", "OMXS", "STO", "OMXSSTO"] },
  { id: "QE", names: ["QATAR", "QE", "QAT", "DOHA"] },
  { id: "BES", names: ["BUDAPEST", "BES", "BET", "BUD"] },
  { id: "OBX", names: ["OSLO", "OBX", "NOR", "OSLO_MAIN"] },
  { id: "MSM", names: ["MUSCAT", "MSM", "OMR", "MUS"] },
  { id: "ENXLI", names: ["LISBON", "ENXLI", "EUROLIS", "LIS"] },
  { id: "XETRA", names: ["XETRA", "FRANKFURT", "DE", "FRA"] },
  { id: "STO", names: ["STOCKHOLM", "STO", "OMXS", "NORDIC"] },
];

async function testExchange(exchangeId, tvExchangeName) {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8",
  };

  if (process.env.TRADINGVIEW_SESSION_ID) {
    headers["Cookie"] = process.env.TRADINGVIEW_SESSION_ID;
  }

  const payload = {
    filter: [
      { left: "exchange", operation: "in_range", right: [tvExchangeName] },
      { left: "type", operation: "in_range", right: ["stock"] }
    ],
    options: { lang: "tr" },
    range: [0, 1],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    columns: ["name", "description", "close"]
  };

  try {
    const resp = await fetch(TV_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeout: 15000,
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const count = Array.isArray(json?.data) ? json.data.length : 0;
    
    return { tvExchangeName, count, status: "OK" };
  } catch (error) {
    return { tvExchangeName, count: 0, status: error.message };
  }
}

async function runTests() {
  console.log("Testing alternative exchange IDs...\n");

  for (const exchange of exchangesToTest) {
    console.log(`Testing ${exchange.id}:`);
    
    for (const name of exchange.names) {
      const result = await testExchange(exchange.id, name);
      console.log(
        `  ${name.padEnd(20)} -> ${result.count} stocks [${result.status}]`
      );
      
      if (result.count > 0) {
        console.log(`    ✓ FOUND! Use "${name}" for ${exchange.id}`);
        break;
      }
    }
    console.log();
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
}

runTests().catch(console.error);
