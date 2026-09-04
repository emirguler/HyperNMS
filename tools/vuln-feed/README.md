# NetPulse zafiyet feed aracı (offline)

NetPulse sunucusu internete çıkamadığı için Cisco güvenlik duyuruları **internetli
bir PC'de** çekilir ve dosya olarak NetPulse'a yüklenir. Eşleştirme (hangi cihaz
hangi duyurudan etkileniyor) sunucuda, cihaz kayıtlarıyla yapılır.

Kaynaklar: **Cisco PSIRT openVuln API** (resmi duyurular, sürüme göre; "düzeltildiği
sürüm" bilgisiyle) + **CISA KEV** (aktif olarak sömürülen CVE'ler — önceliklendirme).

## Bir kez: Cisco API kimliği

1. https://apiconsole.cisco.com → Cisco.com hesabınla gir → **Register a New App**
2. Application type: *Service*, grant type: *Client Credentials*; API'lerden **"Cisco PSIRT openVuln API"** seç.
3. Verilen **Key** (client id) ve **Client Secret** değerlerini bu klasörde `cisco-api.json` dosyasına yaz:

```json
{ "clientId": "xxxxxxxx", "clientSecret": "yyyyyyyy" }
```

Bu dosya `.gitignore`'dadır; repoya girmez. (Alternatif: `CISCO_CLIENT_ID` / `CISCO_CLIENT_SECRET` ortam değişkenleri.)

Gereksinim: Node 18+ (bağımlılık yok).

## Her seferinde (aylık ya da sürüm değişince)

1. NetPulse → **Vulnerabilities** → **Export inventory** → `netpulse-vuln-inventory-….json` indir.
   (Ağdaki farklı IOS / IOS-XE sürümlerinin listesi — cihaz adı/IP içermez.)
2. Dosyayı internetli PC'ye taşı ve bu klasörde:

```bash
node vuln-feed.mjs --inventory netpulse-vuln-inventory-2026-09-04.json --out netpulse-vuln-feed.json
```

   Araç her sürüm için openVuln'u sorgular (≈4 istek/sn), CISA KEV'i indirir, tek bir feed dosyası üretir ve özet basar.
3. `netpulse-vuln-feed.json` dosyasını NetPulse'a taşı → **Vulnerabilities** → **Import feed**.

Import sonrası ağdaki cihazları etkileyen **yeni** Critical/High/KEV duyurular için bildirim üretilir.

## Notlar

- Feed dosyası 1 MB'ı geçmemeli (araç uyarır). Özetler 600 karaktere kırpılır, HTML temizlenir.
- Sürüm yazımı Cisco'nun beklediği biçime çevrilir: `17.06.04(CAT9K_IOSXE)` → `17.6.4`; eşleşmezse dolgulu hali de denenir.
- Cisco'nun tanımadığı sürümler feed'de `invalid_version` olarak işaretlenir; NetPulse'ta "Feed'de yok" görünür (temiz sayılmaz).
- `--no-kev` ile CISA erişimi olmadan da feed üretilebilir.
