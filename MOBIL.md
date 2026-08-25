# NetPulse Android uygulaması

Web arayüzünün kendisi, Android paketine (APK) gömülü olarak çalışır. Ayrı bir
kod tabanı **yoktur**: `cisco-topology-frontend` hem tarayıcıya hem telefona
derlenir, dolayısıyla web'e eklenen her özellik bir sonraki APK'da mobilde de
vardır.

## Derleme

```bash
cd cisco-topology-frontend && npm run android:apk
```

Çıktı: `cisco-topology-frontend/android/app/build/outputs/apk/debug/app-debug.apk`

Betik JDK ve Android SDK'yı kendisi bulur (Android Studio kurulu olması yeterli),
web varlıklarını derler, Android projesine kopyalar ve Gradle'ı çalıştırır.
Dağıtılacak imzalı sürüm için: [android/README-imza.md](cisco-topology-frontend/android/README-imza.md)

## Telefonda ilk açılış

1. APK'yı telefona kopyalayıp kurun (Ayarlar → "Bilinmeyen kaynaklara izin ver").
2. Uygulama **sunucu adresi** sorar: `10.0.0.10:4000` ya da `netpulse.isu.gov.tr`.
   `http://` / `https://` yazmak gerekmez — ikisi de denenir, çalışan saklanır.
3. Adres bir kez girilir, cihazda kalır. Değiştirmek için giriş ekranındaki
   **"Sunucuyu değiştir"** düğmesi.

## Web'den farkı ne?

Kullanıcı açısından hiçbir sayfa eksik değil. Teknik olarak farklı olan tek şey
**oturumun nasıl taşındığı**:

| | Web | Android |
|---|---|---|
| Sunucu adresi | derleme anında (`/api`, aynı origin) | çalışma anında, kullanıcıdan |
| Oturum | httpOnly çerez + CSRF | `Authorization: Bearer` (aynı JWT) |
| WebSocket | çerez | `?token=` (backend zaten destekliyordu) |
| İndirmeler | tarayıcı indirir | cihaza yazılır + paylaş menüsü |

Bu ayrım `src/native/` altında toplanmıştır; sayfa/bileşen kodu bunu bilmez.
`window.fetch` ve `window.WebSocket` yalnızca native'de yamalanır, böylece 50+
çağrı yeri tek tek değiştirilmek zorunda kalmamıştır.

## Bilinen sınırlar

- **Cihaz web arayüzü (🌐 Web)** mobilde gizli. `<iframe>` isteğine başlık
  eklenemediği için token'lı oturumda proxy 401 döner.
- **Coğrafi harita** Google Maps'i internetten yükler; kapalı ağda boş kalır
  (web sürümünde de böyle).
- **Bildirimler** yalnızca uygulama açıkken gelir (uygulama içi zil ikonu).
  Telefon bildirimi istenirse ayrıca eklenmesi gerekir.

## Sunucu tarafındaki karşılığı

Mobil için backend'de üç küçük değişiklik var:

- `POST /login` ve `/login/2fa`, yalnızca `X-Auth-Mode: token` başlığı gönderen
  istemciye JWT'yi yanıt gövdesinde de döner (web'de token httpOnly çerezde kalır).
- CSRF denetimi, kimliği `Authorization` başlığıyla taşıyan isteklerde atlanır —
  tarayıcı bu başlığı üçüncü bir siteden kendiliğinden eklemediği için CSRF
  yüzeyi yoktur.
- CORS, Capacitor WebView'inin origin'lerini (`https://localhost` vb.) kabul eder.
