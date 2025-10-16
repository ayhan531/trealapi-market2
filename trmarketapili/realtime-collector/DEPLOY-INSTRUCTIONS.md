# Render.com Deploy Talimatları

## 1. Zip Dosyası Oluştur
- Tüm dosyaları seç (node_modules hariç)
- Sağ tık > "Send to" > "Compressed folder"
- Adını "trmarket-api.zip" yap

## 2. Render.com'a Git
- https://render.com adresine git
- "Get Started for Free" tıkla
- Email ile kayıt ol

## 3. Web Service Oluştur
- Dashboard'da "New +" tıkla
- "Web Service" seç
- "Deploy from Git" yerine "Upload" seç
- Zip dosyasını yükle

## 4. Ayarları Yap
- **Name:** trmarket-api
- **Environment:** Node
- **Build Command:** npm install
- **Start Command:** npm start
- **Plan:** Free

## 5. Environment Variables Ekle
- TVAPI_MARKET=turkey
- TVAPI_INTERVAL=5000
- TRADINGVIEW_SESSION_ID=(uzun cookie değeri)

## 6. Deploy Et
- "Create Web Service" tıkla
- 5-10 dakika bekle
- URL'ni al!

## Sonuç
URL örneği: https://trmarket-api.onrender.com
