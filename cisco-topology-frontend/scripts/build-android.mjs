#!/usr/bin/env node
/**
 * Android APK derleyici.
 *
 * Tek komutla: web varliklarini derle -> Android projesine kopyala -> APK uret.
 *
 *   npm run android:apk        # debug (yan yukleme / test icin)
 *   npm run android:apk -- --release
 *
 * Neden ayri bir betik: Gradle'in JDK ve Android SDK'yi bulmasi icin JAVA_HOME /
 * ANDROID_HOME ortam degiskenleri gerekiyor. Bunlari gradle.properties'e mutlak
 * yol olarak yazmak projeyi tek makineye baglardi; burada calisma aninda
 * araniyor, boylece repo tasinabilir kaliyor.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const release = process.argv.includes('--release');

const javaBin = (home) => join(home, 'bin', isWin ? 'java.exe' : 'java');

function findJdk() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  if (isWin) {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    candidates.push(join(pf, 'Android', 'Android Studio', 'jbr'));
    for (const dir of [join(pf, 'Java'), join(pf, 'Eclipse Adoptium'), join(pf, 'Microsoft')]) {
      if (existsSync(dir)) for (const e of readdirSync(dir)) candidates.push(join(dir, e));
    }
  } else {
    candidates.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    candidates.push('/usr/lib/jvm/default-java');
  }
  return candidates.find((c) => c && existsSync(javaBin(c))) || null;
}

function findSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    isWin && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Library', 'Android', 'sdk') : null,
  ];
  return candidates.find((c) => c && existsSync(join(c, 'platform-tools'))) || null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`\n✗ Basarisiz: ${cmd} ${args.join(' ')}`);
    process.exit(r.status ?? 1);
  }
}

const jdk = findJdk();
if (!jdk) {
  console.error('✗ JDK bulunamadi. Android Studio kurun ya da JAVA_HOME tanimlayin.');
  process.exit(1);
}
const sdk = findSdk();
if (!sdk) {
  console.error('✗ Android SDK bulunamadi. Android Studio > SDK Manager ile kurun ya da ANDROID_HOME tanimlayin.');
  process.exit(1);
}
console.log(`• JDK: ${jdk}\n• SDK: ${sdk}\n• Derleme: ${release ? 'release' : 'debug'}\n`);

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);

const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const androidDir = join(root, 'android');
// Tam yol: kabuk uzerinden calisirken "gecerli dizinde ara" davranisi platformdan
// platforma degisiyor; goreli 'gradlew.bat' bazi Windows kabuklarinda bulunamiyor.
const gradlew = join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');
run(`"${gradlew}"`, [release ? 'assembleRelease' : 'assembleDebug'], { cwd: androidDir, env });

const out = join(root, 'android', 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug');
console.log(`\n✓ APK hazir: ${out}`);
if (release && !existsSync(join(root, 'android', 'keystore.properties'))) {
  console.log('  ! keystore.properties yok — release APK IMZASIZ uretildi ve kurulamaz.');
  console.log('    Imzalama icin: cisco-topology-frontend/android/README-imza.md');
}
