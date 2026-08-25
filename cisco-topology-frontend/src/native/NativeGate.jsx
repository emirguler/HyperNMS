import { useEffect, useState } from 'react';
import { SplashScreen } from '@capacitor/splash-screen';
import { isNative, loadNativeState, getServerUrl } from './state';
import { applyServerBase } from '../config';
import { installNativeApiClient } from './apiClient';
import ServerSetup from './ServerSetup';

// Native acilis kapisi.
//
// Uygulama agacinin geri kalani (router / AuthProvider / sayfalar) SUNUCU ADRESI
// BELLI OLANA KADAR monte EDILMEZ. Boylece API_BASE'in bos oldugu bir anda
// hicbir istek atilmaz — adres cozulur, ag yamalari kurulur, sonra render edilir.
//
// Web surumunde bu bilesen tamamen seffaftir (isNative=false → dogrudan cocuklar).

// Giris ekranindaki "Sunucuyu degistir" baglantisi buraya ulasabilsin diye
// modul seviyesinde bir kanca: bilesen monte oldugunda kendini kaydeder.
let openSetup = null;
export const canChangeServer = () => isNative && !!openSetup;
export function requestServerSetup() { if (openSetup) openSetup(); }

export default function NativeGate({ children }) {
  const [ready, setReady] = useState(!isNative);
  const [setupMode, setSetupMode] = useState(null); // null | 'first' | 'change'

  useEffect(() => {
    if (!isNative) return undefined;
    let cancelled = false;
    (async () => {
      await loadNativeState();
      applyServerBase();
      installNativeApiClient();
      if (cancelled) return;
      setSetupMode(getServerUrl() ? null : 'first');
      setReady(true);
      SplashScreen.hide().catch(() => {});
    })();
    openSetup = () => setSetupMode('change');
    return () => { cancelled = true; openSetup = null; };
  }, []);

  if (!ready) return null; // splash ekrani hala gorunuyor
  if (setupMode) {
    return (
      <ServerSetup
        onDone={() => setSetupMode(null)}
        // Ilk kurulumda vazgecilecek bir yer yok; adres degistirmede geri donulur.
        onCancel={setupMode === 'change' ? () => setSetupMode(null) : undefined}
      />
    );
  }
  return children;
}
