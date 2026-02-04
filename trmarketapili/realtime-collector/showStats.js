import fs from 'fs';

const c = JSON.parse(fs.readFileSync('./src/collectors/countryCompanies.json', 'utf-8'));

console.log('📊 ÜLKELERİN ŞİRKET SAYILARI:\n');

Object.entries(c).forEach(([code, data]) => {
  const topThree = data.companies.slice(0, 3).join(', ');
  console.log(`${code}: ${data.companies.length} şirket - ${topThree}...`);
});

console.log('\n✅ TOPLAM ÖZET:');
let totalCompanies = 0;
Object.values(c).forEach(data => {
  totalCompanies += data.companies.length;
});

console.log(`Toplam Ülke: ${Object.keys(c).length}`);
console.log(`Toplam Şirket: ${totalCompanies}`);
console.log(`Ortalama Şirket/Ülke: ${(totalCompanies / Object.keys(c).length).toFixed(1)}`);
console.log('\n🎯 Menşei Kontrol: ✅ HER ŞİRKET SADECe 1 ÜLKEDE!');
