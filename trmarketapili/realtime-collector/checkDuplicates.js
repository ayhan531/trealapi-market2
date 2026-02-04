import fs from 'fs';
const c = JSON.parse(fs.readFileSync('./src/collectors/countryCompanies.json', 'utf-8'));
const allCompanies = {};
let duplicates = 0;

Object.entries(c).forEach(([code, data]) => {
  data.companies.forEach(comp => {
    if (allCompanies[comp]) {
      console.log(`❌ "${comp}" - ${allCompanies[comp]} VE ${code}'de (ÇAKIŞMA!)`);
      duplicates++;
    } else {
      allCompanies[comp] = code;
    }
  });
});

console.log(`\n✅ Toplam Ülke: ${Object.keys(c).length}`);
console.log(`✅ Toplam Şirket: ${Object.keys(allCompanies).length}`);
console.log(`❌ Çakışma Sayısı: ${duplicates}`);

if (duplicates === 0) {
  console.log('\n🎉 MÜKEMMELİ Her şirket sadece BİR ülkede!');
}
