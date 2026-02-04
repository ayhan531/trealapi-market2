import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const countryCompaniesPath = path.join(__dirname, "src/collectors/countryCompanies.json");
const countryCompanies = JSON.parse(fs.readFileSync(countryCompaniesPath, "utf-8"));

console.log("📊 ÜLKELERE GÖRE ŞİRKET SAYILARI:\n");

let total = 0;
const results = [];

Object.entries(countryCompanies).forEach(([code, data]) => {
  const count = data.companies.length;
  total += count;
  results.push({ code, count, country: data.country });
});

// Sırala - az olanlar önce
results.sort((a, b) => a.count - b.count);

results.forEach(r => {
  const status = r.count < 20 ? "❌" : r.count < 30 ? "⚠️" : "✅";
  console.log(`${status} ${r.code} (${r.country.padEnd(20)}) → ${r.count} şirket`);
});

console.log(`\n` + "=".repeat(60));
console.log(`📈 TOPLAM: ${total} şirket`);
console.log(`🎯 Hedef: Tüm ülkeler minimum 30 şirket`);

const under30 = results.filter(r => r.count < 30);
console.log(`\n⚠️ 30'un altındaki (${under30.length} ülke):`);
under30.forEach(r => {
  console.log(`  - ${r.code}: ${r.count} → +${30 - r.count} şirket ekle`);
});
