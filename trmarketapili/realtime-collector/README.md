# BIST Real-time Data Collector

Türk hisse senedi piyasası (BIST) verilerini gerçek zamanlı çeker ve SSE üzerinden yayınlar.

## Kurulum ve Çalıştırma

```bash
npm install
npm start
```

## Yapılandırma

`.env` dosyasını düzenleyin:

```env
PORT=4005
TVAPI_MARKET=turkey
TVAPI_INTERVAL=1000
```

## Kullanım

Uygulama `http://localhost:4005` adresinde çalışır.

- **SSE Stream**: `http://localhost:4005/stream`
- **Test Client**: `http://localhost:4005/client.html`

## 🚀 **Premium TradingView Hesabı ile Anlık Veri Çekimi**

Eğer premium TradingView hesabınız varsa, rate limit'i aşmak ve daha fazla veri almak için şu adımları takip edin:

### **1. Premium Cookie'yi Alın**
- Tarayıcıda TradingView'e premium hesapla giriş yapın.
- Developer Tools'u açın (F12) > Network sekmesine gidin.
- Sayfayı yenileyin veya bir istek yapın – `scanner.tradingview.com` isteklerini görün.
- Bir isteği seçin > Headers > Cookie'yi kopyalayın (örneğin, `sessionid=abc123...` gibi).

### **2. .env Dosyasını Güncelleyin**
`.env` dosyasında şu satırı düzenleyin:
```env
TV_SESSION_COOKIE=buraya_kopyaladığınız_cookie
```
(Örnek: `TV_SESSION_COOKIE=sessionid=abc123; other=value`)

### **3. Projeyi Çalıştırın**
Artık premium API ile veri çekeceksiniz – rate limit artmalı ve daha fazla veri almalısınız.

**Not:** Eğer cookie geçersiz olursa veya çalışmazsa, tekrar kopyalayın veya alternatif yöntem deneyin.

## 🚀 **Başka Bir Bilgisayarda Çalıştırma (Adım Adım)**

Bu projeyi başka bir bilgisayara taşımak ve çalıştırmak çok kolay. 

### **1. Önce Ne Lazım?**x"
- Bilgisayarda **Node.js** yüklü olmalı. Eğer yoksa buradan indir: https://nodejs.org/
- İnternet bağlantın olmalı (verileri çekmek için)

### **2. Dosyaları Taşı**
- Tüm proje klasörünü (`realtime-collector`) zip'le veya kopyala
- Yeni bilgisayara yapıştır
- Klasörün içine gir (örneğin: `cd realtime-collector`)

### **3. Gerekli Paketleri Yükle**
Terminal veya komut istemcisine şunu yaz:
```bash
npm install
```
Bu komut, projenin çalışması için gereken paketleri otomatik yükler. Birkaç dakika sürer, sabırla bekle.

### **4. Ayarları Kontrol Et**
`.env` dosyası zaten hazır. İçinde şunlar var:
```env
PORT=4005
TVAPI_MARKET=turkey
TVAPI_INTERVAL=1000
```
- Eğer port 4005 kullanılıyorsa (başka program kullanıyor olabilir), PORT'u değiştir (örneğin: PORT=4006)

### **5. Uygulamayı Başlat**
Şimdi çalıştırma zamanı:
```bash
npm start
```
Veya eğer npm çalışmazsa:
```bash
node src/index.js
```

### **6. Kontrol Et**
- Tarayıcıda aç: `http://localhost:4005`
- Eğer açılırsa, çalışıyor demektir!
- Veri akışı için: `http://localhost:4005/stream`
- Test sayfası için: `http://localhost:4005/client.html`

### **⚠️ Eğer Sorun Yaşarsan:**
- **"Port kullanılıyor"** hatası: `.env`'de PORT'u değiştir (örneğin: PORT=4006)
- **"npm install" çalışmıyor**: Node.js'i yeniden yükle
- **Başka hata**: Hata mesajını kopyala ve bana söyle, çözeriz

## 🌐 **Cloudflare Tunnel ile İnternetten Erişim**

Projenizi internetten erişilebilir hale getirmek için Cloudflare Tunnel kullanabilirsiniz.

### **Hızlı Başlatma**

1. **Server'ı başlatın:**
   ```bash
   # Windows için
   start-server.bat
   
   # Veya manuel olarak
   node src/index.js
   ```

2. **Cloudflare Tunnel kurulumu:**
   - https://dash.cloudflare.com adresine gidin
   - Zero Trust > Networks > Tunnels seçin
   - "Create a tunnel" tıklayın
   - Tunnel adını `trmarket-api-tunnel` yapın
   - Verilen token'ı kopyalayın

3. **Tunnel'ı başlatın:**
   ```bash
   # start-tunnel.bat dosyasını düzenleyin ve token'ı ekleyin
   start-tunnel.bat
   ```

### **Manuel Kurulum**

Eğer otomatik script çalışmazsa:

1. **Cloudflared indirin:**
   - https://github.com/cloudflare/cloudflared/releases/latest
   - Windows için `cloudflared-windows-amd64.exe` indirin
   - Dosya adını `cloudflared.exe` yapın

2. **Tunnel oluşturun:**
   ```bash
   cloudflared.exe tunnel login
   cloudflared.exe tunnel create trmarket-api-tunnel
   ```

3. **Tunnel'ı çalıştırın:**
   ```bash
   cloudflared.exe tunnel --url http://localhost:4000 run trmarket-api-tunnel
   ```

### **Dosyalar**
- `start-server.bat` - Node.js server'ını başlatır
- `start-tunnel.bat` - Cloudflare tunnel kurulum rehberi
- `cloudflare-tunnel.yml` - Tunnel konfigürasyonu

**Not:** Tunnel aktif olduğunda projenize `https://your-tunnel-url.trycloudflare.com` gibi bir URL ile erişebilirsiniz.


