import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';
import { useAuth } from './context/AuthContext';
import { useViewport } from './hooks/useViewport';
import { t } from './i18n';

// ── Dokunmatik yardimcilari ───────────────────────────────────────────────────
// Yazilim klavyesinde Esc / Tab / Ctrl / ok tuslari YOK. Bu satir onlarin yerine
// gecer; her tus mevcut ws.send({type:'data'}) yolundan ham diziyi gonderir.
const TERM_KEYS = [
  { label: 'Esc', seq: '\x1b' },
  { label: 'Tab', seq: '\t' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '/', seq: '/' },
  { label: '?', seq: '?' },
  { label: 'Space', seq: ' ' },
  { label: '⏎', seq: '\r' },
];

/** Kaba isaretleyici mi (parmak/kalem). Otomatik odagi bastirmak icin. */
function isCoarse() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

/**
 * xterm punto secimi. Cisco ciktisi 80 kolona gore bicimlenmistir; 14px'te 375px
 * genisliginde ~44 kolon kaliyor ve her satir sariliyordu.
 *   <500px genislik -> 10px (~62 kolon)
 *   <=500px yukseklik (telefon yatay) -> 11px, gorunur satir sayisi neredeyse iki katina cikar
 *   digerleri -> 14px (masaustu degeri, DEGISMEZ)
 */
function pickFontSize() {
  if (typeof window === 'undefined') return 14;
  if (window.innerWidth < 500) return 10;
  if (window.innerHeight <= 500) return 11;
  return 14;
}

/**
 * Panoya yaz. https'te Clipboard API, http'te textarea+execCommand — her iki durumda calisir.
 * @param {string} text
 * @param {import('xterm').Terminal} [term] islem sonrasi odagi geri verilecek terminal
 */
function copyToClipboard(text, term) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); } catch (err) { /* ignore */ }
  ta.remove();
  try { term?.focus(); } catch (err) { /* ignore */ }
}

// ── Cisco IOS anahtar-kelime renklendirme (SecureCRT "Keyword Highlighting" tarzı) ──
// Cisco çıktıyı renksiz gönderir; renklendirmeyi istemcide yapıyoruz. Gelen metni ANSI
// escape dizileri ↔ düz metin parçalarına ayırıp YALNIZCA düz metne dokunuyoruz → imleç/
// ekran kontrol dizileri bozulmadan geçer. Temel yazı beyaz; her eşleşmeden sonra SGR 39
// ile beyaza döneriz. Renkler kullanıcının SecureCRT şemasına göre ayarlandı.
const C_GREEN  = '\x1b[38;2;64;200;64m';   // arayüz adları, IP, "iyi" durum (up, on, connected)
const C_RED    = '\x1b[38;2;255;85;85m';   // olumsuz/"kötü" (no, not, down, disabled, failure, reload)
const C_CYAN   = '\x1b[38;2;90;190;255m';  // uptime, local, active
const C_ORANGE = '\x1b[38;2;255;170;60m';  // Version, trunk, %SYSLOG-etiketleri
const C_RESET  = '\x1b[39m';

// Sabit kelime → renk. (Arayüz adı / IP / syslog etiketi sabit değil; aşağıda regex ile.)
const KW_MAP = (() => {
  const m = new Map();
  const put = (c, ws) => ws.forEach(w => m.set(w, c));
  put(C_GREEN,  ['up','on','connected','permit','forwarding','enabled','reachable','established','success','complete']);
  put(C_RED,    ['no','not','down','disabled','failure','reload','shutdown','shut','err-disabled','deny','denied','failed','unreachable','notconnect','error','invalid','incomplete','drop','drops','administratively']);
  put(C_CYAN,   ['uptime','local','active','inactive']);
  put(C_ORANGE, ['version','trunk']);
  return m;
})();

// Arayüz adı önekleri (uzun → kısa). 2-harfli kısa önekler yalnızca hemen ardından rakam
// gelirse eşleşir → "Power/Send/Local" gibi kelimeleri yanlışlıkla boyamaz.
const IFACE = 'GigabitEthernet|TenGigabitEthernet|TwentyFiveGigE|HundredGigE|FortyGigE|FastEthernet|TenGigE|Port-channel|Ethernet|Loopback|Tunnel|Serial|Vlan|Eth|Gi|Fa|Te|Tw|Fo|Hu|Po|Vl|Lo|Tu|Se';
// Tek geçişte sıra: %SYSLOG etiketi | arayüz adı | IPv4 | genel kelime
const RULE_RE = new RegExp(
  '%[A-Z][A-Z0-9_]*-\\d+-[A-Z0-9_]+' +          // 1: %CDP-4-DUPLEX_MISMATCH → turuncu
  '|\\b(?:' + IFACE + ')\\d[\\d/.:]*' +          // 2: Gi1/0/1, Vlan1, Te1/1/3 → yeşil
  '|\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b' +          // 3: 172.16.128.246 → yeşil
  '|[A-Za-z][A-Za-z0-9_-]*',                     // 4: kelime → KW_MAP
  'g'
);
const IFACE_HEAD = new RegExp('^(?:' + IFACE + ')\\d');
// Escape dizisi (CSI / OSC / bazı 2-3 baytlıklar) — split için tek yakalama grubu
const ANSI_SPLIT = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[=>78Mc])/;

function colorToken(tok) {
  if (tok[0] === '%') return C_ORANGE + tok + C_RESET;                 // syslog etiketi
  if (tok[0] >= '0' && tok[0] <= '9') return C_GREEN + tok + C_RESET;  // IPv4 (rakamla başlar)
  if (IFACE_HEAD.test(tok)) return C_GREEN + tok + C_RESET;            // arayüz adı
  const c = KW_MAP.get(tok.toLowerCase());                             // sabit kelime
  return c ? c + tok + C_RESET : tok;
}

function highlightCisco(text) {
  if (!text || !/[A-Za-z0-9]/.test(text)) return text;   // harf/rakam yoksa dokunma
  const parts = text.split(ANSI_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;                             // tek indeks = escape dizisi, atla
    const seg = parts[i];
    if (!seg) continue;
    parts[i] = seg.replace(RULE_RE, colorToken);
  }
  return parts.join('');
}

function TerminalPane({ switchId, switchName, active = true, minimized = false, onStatus }) {
  const containerRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  const termRef = useRef(null);
  // En güncel onStatus'a eriş (mount effect'i eski closure'a takılmasın)
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const { userRole, allowedCommands, fullSsh } = useAuth();
  const { isTouch, isShort } = useViewport();

  // Tam kontrol = Administrator, VEYA hesabinda fullSsh acik olan Operator.
  // Bu yalnizca baslangic degeri: otorite sunucudan gelen 'mode' mesajidir
  // (asagida readOnly'ye gore yeniden ayarlanir), cunku bayrak sunucuda tutulur.
  const restricted = userRole !== 'Administrator' && !fullSsh;
  // Buton listesi: sunucudan gelen 'mode' mesajı otoritedir; başlangıçta context'ten
  const [commands, setCommands] = useState(restricted ? (allowedCommands || []) : []);
  // Sunucunun bildirdigi gercek mod (null = henuz bilinmiyor). Terminali YENIDEN
  // OLUSTURMAZ - yalnizca alt paneli (komut pedi / ipucu satiri) dogru gosterir.
  const [srvReadOnly, setSrvReadOnly] = useState(null);
  const uiRestricted = srvReadOnly === null ? restricted : srvReadOnly;
  // Kısıtlı kullanıcının komut pedi kısa ekranda alanın %40'ını yiyordu; katlanabilir.
  const [padOpen, setPadOpen] = useState(true);
  // Dokunmatik tuş satırına basılmadan ÖNCE terminalin odakta olup olmadığı.
  // Odaktaysa tuştan sonra odağı geri veririz (klavye açık kalır); değilse dokunmayız.
  const hadFocusRef = useRef(false);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace',
      fontSize: pickFontSize(),
      rows: 24,
      cols: 120,
      scrollback: 2000,
      disableStdin: restricted, // kısıtlı kullanıcı klavyeyle giriş yapamaz
      theme: {
        background: '#000000',
        foreground: '#e5e7eb', // varsayılan yazı: beyaz (renklendirme yalnızca anahtar kelimelerde)
      },
      cursorBlink: !restricted,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    // xterm'in gizli yardimci textarea'si terminal puntosunu miras alir; 16px altinda
    // iOS odakta sayfayi zoomlar ve geri donmez. Opaklik 0 oldugu icin gorunmez kalir.
    try {
      const helper = containerRef.current.querySelector('.xterm-helper-textarea');
      if (helper) helper.style.fontSize = '16px';
    } catch (e) { /* ignore */ }
    // Dokunmatikte mount aninda odaklamak yazilim klavyesini acar ve az once acilan
    // paneli ortbas eder; kullanici terminale dokununca ya da Keyboard tusuyla odaklar.
    if (!restricted && !isCoarse()) term.focus();
    term.write(`Connecting to switch ${switchId} (${switchName})...\r\n`);

    const ws = new WebSocket(
      `${WS_BASE}/ws/terminal?switchId=${encodeURIComponent(switchId)}`
    );
    socketRef.current = ws;

    ws.onopen = () => {
      onStatusRef.current?.(true);
      term.write(`*** SSH connection opening ***\r\n`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          term.write(highlightCisco(msg.data));
        } else if (msg.type === 'info') {
          term.write(msg.message);
        } else if (msg.type === 'mode') {
          // Sunucu, oturumun izinli komutlarını bildirir (otorite)
          setCommands(msg.commands || []);
          // readOnly de OTORITEDIR. fullSsh bayragi sunucuda tutuluyor; admin onu
          // acinca istemcideki deger /me tazelenene kadar eski kalir ve klavye
          // bosuna kapali kalirdi. xterm secenekleri calisma aninda degistirilebilir.
          if (typeof msg.readOnly === 'boolean') {
            term.options.disableStdin = msg.readOnly;
            term.options.cursorBlink = !msg.readOnly;
            setSrvReadOnly(msg.readOnly);
            if (!msg.readOnly && !isCoarse()) term.focus();
          }
        } else if (msg.type === 'error') {
          term.write(`\r\n*** ERROR: ${msg.message} ***\r\n`);
        }
      } catch (e) {
        term.write(event.data);
      }
    };

    ws.onclose = (event) => {
      onStatusRef.current?.(false);
      // Jest-notr metin: dokunmatikte sag tik yok, kullanici sekme menusunden Reconnect'e ulasir.
      term.write(`\r\n*** SSH disconnected (code: ${event.code}${event.reason ? ', ' + event.reason : ''}) — use Reconnect on the tab menu ***\r\n`);
    };

    ws.onerror = (event) => {
      onStatusRef.current?.(false);
      term.write(`\r\n*** WebSocket error ***\r\n`);
    };

    // SecureCRT gibi kopyala/yapıştır: fareyle seçince otomatik kopyala, sağ tık → yapıştır.
    // Kopyalama https'te Clipboard API, http'te textarea+execCommand ile → her iki durumda çalışır.
    // Seçince otomatik kopyalama YALNIZCA fareli cihazlarda; dokunmatikte sentetik
    // mouseup olayları panoyu istem dışı eziyor, orada Copy düğmesi var.
    const onMouseUp = () => {
      if (isCoarse()) return;
      const sel = term.getSelection();
      if (sel) copyToClipboard(sel, term);
    };
    const el = containerRef.current;
    el.addEventListener('mouseup', onMouseUp);

    let onContextMenu = null;
    // Klavye girişi + yapıştırma yalnızca tam kontrol (admin) oturumlarında
    if (!restricted) {
      // Ctrl+C: çalışan komutu kes (interrupt, \x03) — SecureCRT gibi. Kopyalama artık seçimle
      // otomatik yapıldığından Ctrl+C her zaman interrupt gönderir (kopya için Ctrl+Shift+C).
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyC') {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data: '\x03' }));
          return false;
        }
        return true;
      });

      // Sağ tık → yapıştır. https'te doğrudan (Clipboard API); http'te pano okunamadığından
      // tarayıcının kendi sağ-tık menüsüne (Paste) bırakılır (ya da Ctrl+V ile yapıştırılır).
      onContextMenu = (e) => {
        if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
          e.preventDefault();
          navigator.clipboard.readText().then(text => { if (text) term.paste(text); }).catch(() => {});
        }
      };
      el.addEventListener('contextmenu', onContextMenu);

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });
    }

    return () => {
      try { ws.close(); } catch (e) {}
      try { el.removeEventListener('mouseup', onMouseUp); } catch (e) {}
      try { if (onContextMenu) el.removeEventListener('contextmenu', onContextMenu); } catch (e) {}
      termRef.current = null;
      term.dispose();
    };
  }, [switchId, switchName, restricted]);

  // Sekme aktif olunca (veya panel küçük bardan yeniden büyütülünce) terminali odakla + boyutu tazele.
  // display:none / küçültülmüş (transform ile ekran altına) iken odak/fit güvenilmez; görünür olunca (rAF) yap.
  // 'minimized' bağımlılığı: küçük bardayken zaten aktif olan sekmeye basıp büyütünce active değişmese de
  // efekt yeniden koşar → içine ayrıca tıklamadan yazılır.
  // DOKUNMATIK NOTU: fit() her zaman koşar, focus() koşmaz. Dokunmatikte her sekme
  // değişimi / küçük bardan geri dönüş yazılım klavyesini yeniden açıp az önce
  // görünür kılınan paneli örtüyordu.
  useEffect(() => {
    if (!active || restricted || minimized) return;
    const id = requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch (e) { /* ignore */ }
      if (!isCoarse()) { try { termRef.current?.focus(); } catch (e) { /* ignore */ } }
    });
    return () => cancelAnimationFrame(id);
  }, [active, restricted, minimized]);

  // Punto viewport'a göre seçiliyor; döndürme/yeniden boyutlandırmada yeniden seç ve fit et.
  // fit() yalnızca punto GERÇEKTEN değiştiyse çağrılır (ResizeObserver zaten normal
  // boyut değişimlerini karşılıyor), böylece resize sırasında gereksiz iş yok.
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
    // iOS'ta orientationchange, viewport ölçüleri güncellenmeden önce tetiklenir.
    const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 120); };
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!window.ResizeObserver) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const runCommand = (cmd) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', cmd }));
    }
  };

  // Tuş satırındaki her düğme buradan geçer: ham diziyi mevcut 'data' yolundan gönderir.
  const sendRaw = useCallback((seq) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: seq }));
    }
    // Tuşa basmadan önce terminal odaktaysa odağı geri ver → yazılım klavyesi kapanmasın.
    if (hadFocusRef.current) { try { termRef.current?.focus(); } catch (e) { /* ignore */ } }
  }, []);

  // Düğmeye basılmadan hemen önce odağın terminalde olup olmadığını not et.
  const noteFocus = useCallback(() => {
    const el = containerRef.current;
    hadFocusRef.current = !!(el && document.activeElement && el.contains(document.activeElement));
  }, []);

  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const sel = term.getSelection();
    if (sel) copyToClipboard(sel, term);
  }, []);

  // iOS hiçbir zaman contextmenu tetiklemez → sağ tık yapıştırma yolu orada yok.
  const pasteClipboard = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
      navigator.clipboard.readText()
        .then(text => { if (text) term.paste(text); })
        .catch(() => { term.write('\r\n*** Clipboard not available — allow paste permission ***\r\n'); });
    } else {
      term.write('\r\n*** Clipboard read needs HTTPS ***\r\n');
    }
  }, []);

  const focusTerm = useCallback(() => {
    try { termRef.current?.focus(); } catch (e) { /* ignore */ }
  }, []);

  const keyBtnStyle = {
    // Kisa ekranda (telefon yatay, ~330px kullanilabilir yukseklik) 44 yerine 38:
    // responsive.css'in kisa ekranda chrome'u daraltma cizgisiyle ayni takas.
    minHeight: isShort ? 38 : 44, minWidth: 44, padding: '0 12px', flexShrink: 0,
    background: '#1e293b', color: 'var(--text-main)', border: '1px solid var(--border-color)',
    borderRadius: 8, fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600,
    cursor: 'pointer', touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none'
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* ── Dokunmatik tuş satırı (terminalin ÜSTÜNDE) ──────────────────────────
          Yazılım klavyesinde Esc/Tab/Ctrl/ok tuşu yok: onlarsız --More-- sayfalama,
          tab tamamlama ve interrupt telefonda imkânsız. Kopyala/Yapıştır da burada,
          çünkü iOS contextmenu tetiklemez. Fareli cihazlarda hiç render edilmez. */}
      {isTouch && (
        <div
          className="rw-scroll-x"
          style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: isShort ? '5px 8px' : '7px 10px',
            background: '#0f172a', borderBottom: '1px solid var(--border-color)',
            overflowX: 'auto', whiteSpace: 'nowrap'
          }}
        >
          <button type="button" onPointerDown={noteFocus} onClick={copySelection} style={keyBtnStyle}>Copy</button>
          {!uiRestricted && (
            <>
              <button type="button" onPointerDown={noteFocus} onClick={pasteClipboard} style={keyBtnStyle}>Paste</button>
              <button type="button" onClick={focusTerm} style={{ ...keyBtnStyle, borderColor: 'var(--primary)', color: 'var(--primary)' }}>⌨</button>
              <span style={{ flexShrink: 0, width: 1, alignSelf: 'stretch', background: 'var(--border-color)', margin: '0 2px' }} />
              {TERM_KEYS.map(k => (
                <button
                  key={k.label}
                  type="button"
                  onPointerDown={noteFocus}
                  onClick={() => sendRaw(k.seq)}
                  style={k.label === 'Ctrl+C' ? { ...keyBtnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' } : keyBtnStyle}
                >
                  {k.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />

      {/* Kısıtlı kullanıcı: alt tarafta izinli komut butonları */}
      {uiRestricted && (
        <div style={{
          flexShrink: 0, background: '#0f172a', borderTop: '1px solid var(--border-color)',
          display: 'flex', flexDirection: 'column', minHeight: 0
        }}>
          {/* Dokunmatikte ped, kısa ekranda alanın %40'ını yiyordu → katlanabilir başlık. */}
          {isTouch && (
            <button
              type="button"
              onClick={() => setPadOpen(o => !o)}
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, width: '100%', minHeight: 36, padding: '0 12px', background: 'transparent',
                border: 'none', borderBottom: padOpen ? '1px solid var(--border-color)' : 'none',
                color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: 0.4
              }}
            >
              <span>Commands ({commands.length})</span>
              <span style={{ fontSize: '0.9rem' }}>{padOpen ? '▾' : '▸'}</span>
            </button>
          )}
          {(!isTouch || padOpen) && (
            <div style={{
              padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: isTouch ? 8 : 6,
              maxHeight: isTouch ? (isShort ? 'min(120px, 25dvh)' : '35dvh') : 120,
              overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              // Tekerlek zincirlemesini yalnizca dokunmatikte kes; masaustu davranisi aynen kalsin.
              overscrollBehavior: isTouch ? 'contain' : undefined
            }}>
              {commands.length === 0 ? (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('noCommandsAssigned')}</span>
              ) : (
                commands.map((cmd, i) => (
                  <button
                    key={i}
                    onClick={() => runCommand(cmd)}
                    className="btn btn-sm"
                    title={cmd}
                    style={{
                      background: 'var(--primary)', color: '#0f172a', fontWeight: 600,
                      fontFamily: 'monospace',
                      fontSize: isTouch ? '0.85rem' : '0.78rem',
                      padding: isTouch ? '0 14px' : '5px 12px',
                      borderRadius: 6, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap'
                    }}
                  >
                    {cmd}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TerminalPane;
