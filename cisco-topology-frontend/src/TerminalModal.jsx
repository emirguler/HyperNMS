import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';
import { useViewport } from './hooks/useViewport';

/** Kaba isaretleyici mi (parmak/kalem). Mount aninda otomatik odagi bastirmak icin. */
function isCoarse() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

/** xterm puntosu: dar/kisa viewport'ta kucultulur, masaustunde 13 (eski deger). */
function pickFontSize() {
  if (typeof window === 'undefined') return 13;
  if (window.innerWidth < 500) return 10;
  if (window.innerHeight <= 500) return 11;
  return 13;
}

function TerminalModal({ switchId, onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);
  const fitAddonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const { isPhone, isShort, isTouch } = useViewport();
  // Telefon VEYA kisa ekran: 800x500 kutu 375px'lik bir viewport'a sigmaz -> tam ekran sayfa.
  const fullScreen = isPhone || isShort;
  // 44px'lik dokunma hedefi SADECE dokunmatikte. Masaustunde baslik cubugu dolgusu ve
  // "Kapat" dugmesi eski olculerinde kalmali (masaustu gorunumu degismemeli kurali).
  const tap = isTouch || fullScreen;

  useEffect(() => {
    const term = new Terminal({
      fontSize: pickFontSize(),
      scrollback: 2000,
      theme: {
        background: '#000000',
        foreground: '#e5e7eb',
      },
      cursorBlink: true,
    });

    // Sabit cols/rows kaba sigmayan bir tuval uretiyordu; FitAddon kaba gore olculendirir.
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);
    fitAddon.fit();
    // Gizli yardimci textarea 16px altinda kalirsa iOS odakta sayfayi zoomlar.
    try {
      const helper = containerRef.current.querySelector('.xterm-helper-textarea');
      if (helper) helper.style.fontSize = '16px';
    } catch (e) { /* ignore */ }
    // Dokunmatikte mount aninda odaklamak yazilim klavyesini acar ve modali orter.
    if (!isCoarse()) term.focus();
    term.write(`Connecting to switch ${switchId}...\r\n`);

    const ws = new WebSocket(`${WS_BASE}/ws/terminal?switchId=${switchId}`);

    socketRef.current = ws;
    termRef.current = term;

    ws.onopen = () => {
      term.write('*** SSH connection opening ***\r\n');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'info') {
          term.write(msg.message);
        } else if (msg.type === 'error') {
          term.write(`\r\n*** ERROR: ${msg.message} ***\r\n`);
        }
      } catch (e) {
        // raw data gelirse
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      term.write('\r\n*** WebSocket closed ***\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    return () => {
      try {
        ws.close();
      } catch (e) {}
      termRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
    };
  }, [switchId]);

  // Kap boyu degisince (dondurme, klavye) tuvali yeniden olcule.
  useEffect(() => {
    if (!containerRef.current || !window.ResizeObserver) return;
    const observer = new ResizeObserver(() => {
      try { fitAddonRef.current?.fit(); } catch (e) { /* ignore */ }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Punto viewport'a gore secildi; dondurmede yeniden sec.
  useEffect(() => {
    let timer = 0;
    const apply = () => {
      const term = termRef.current;
      if (!term) return;
      const size = pickFontSize();
      if (term.options.fontSize === size) return;
      term.options.fontSize = size;
      try { fitAddonRef.current?.fit(); } catch (e) { /* ignore */ }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 120); };
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  // Kapat dugmesi tek cikis yoluydu: Escape ve arka plana dokunma da kapatsin.
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, []);

  return (
    <div
      onClick={() => onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15,23,42,0.75)',
        display: 'flex',
        alignItems: fullScreen ? 'stretch' : 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: fullScreen ? '100%' : 'min(800px, calc(100vw - 24px))',
          height: fullScreen ? '100%' : 'min(500px, calc(100dvh - 24px))',
          maxWidth: '100%',
          maxHeight: '100%',
          backgroundColor: '#020617',
          borderRadius: fullScreen ? 0 : 12,
          boxShadow: '0 20px 40px rgba(15,23,42,0.9)',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          paddingTop: fullScreen ? 'env(safe-area-inset-top)' : 0,
          paddingBottom: fullScreen ? 'env(safe-area-inset-bottom)' : 0,
        }}
      >
        <div
          style={{
            padding: tap ? '4px 8px 4px 12px' : '8px 12px',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            color: '#e5e7eb',
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            SSH Terminal – Switch ID: {switchId}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              minWidth: tap ? 44 : undefined,
              minHeight: tap ? 44 : undefined,
              padding: tap ? '0 16px' : '4px 8px',
              flexShrink: 0,
              fontSize: tap ? 13 : 12,
              borderRadius: 6,
              border: '1px solid #6b7280',
              backgroundColor: '#111827',
              color: '#f9fafb',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            Kapat
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

export default TerminalModal;
