# Release APK imzalama

`npm run android:apk` ile üretilen **debug** APK kurulur ve çalışır; test için
yeterlidir. Ancak debug APK'sı `debuggable` işaretlidir — cihaza bağlanan biri
uygulamanın belleğini ve saklanan oturum anahtarını okuyabilir. **Kullanıcılara
dağıtılacak sürüm imzalı release APK olmalıdır.**

İmzalama anahtarı **size aittir ve repoya girmez.** Bir kez üretilir, sonra hep
aynısı kullanılır: aynı anahtarla imzalanmayan bir güncelleme, telefonlarda
"uygulama zaten yüklü" hatası verir ve önce eskisinin silinmesi gerekir.
Anahtarı kaybederseniz mevcut kurulumların üzerine güncelleme yayınlayamazsınız.

## 1) Anahtar deposunu üret (bir kez)

Masaüstünde, **repo dışında** bir klasörde çalıştırın (örn. `C:\Users\EMIR-PT\Desktop\netpulse-lisans\`):

```bash
"/c/Program Files/Android/Android Studio/jbr/bin/keytool" -genkeypair -v -keystore netpulse-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias netpulse
```

Komut sırayla parola ve kurum bilgisi soracak. Parolayı **siz** belirleyin ve bir
parola yöneticisinde saklayın.

## 2) Gradle'a anahtarı tanıt

`cisco-topology-frontend/android/keystore.properties` dosyasını oluşturun
(bu dosya `.gitignore`'dadır, repoya girmez):

```properties
storeFile=C:/Users/EMIR-PT/Desktop/netpulse-lisans/netpulse-release.jks
storePassword=<belirlediginiz-parola>
keyPassword=<belirlediginiz-parola>
keyAlias=netpulse
```

## 3) Release APK üret

```bash
npm run android:apk -- --release
```

Çıktı: `android/app/build/outputs/apk/release/app-release.apk`

`keystore.properties` yoksa release derlemesi imzasız kalır ve telefona
kurulamaz — bu durumda betik uyarı basar.

## Sürüm numarası

Her yeni dağıtımdan önce `android/app/build.gradle` içinde:

- `versionCode` → bir artırılmalı (tam sayı; Android güncellemeyi buna göre tanır)
- `versionName` → kullanıcıya görünen sürüm (örn. `"1.1"`)
