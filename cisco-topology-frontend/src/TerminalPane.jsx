import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';
import { useAuth } from './context/AuthContext';
import { t } from './i18n';

// ── Cisco IOS anahtar-kelime renklendirme (SecureCRT "Keyword Highlighting" tarzı) ──
// Cisco çıktıyı renksiz (düz metin) gönderir; renklendirmeyi istemcide yapıyoruz.
// Gelen metni ANSI escape dizileri ↔ düz metin parçalarına ayırıp YALNIZCA düz metin
// parçalarındaki tanınan kelimeleri renk koduyla sarıyoruz → imleç/ekran kontrol
// dizileri (cursor move, clear) bozulmadan geçer. Temel yazı rengi sarı; her kelimeden
// sonra SGR 39 (varsayılan ön-plan) ile sarıya geri döneriz.
const C_GREEN = '\x1b[38;2;80;250;123m';  // komut fiilleri + "iyi" durum (up, permit...)
const C_CYAN  = '\x1b[38;2;120;190;255m'; // nesne/konu (interface, ip, vlan...)
const C_RED   = '\x1b[38;2;255;95;95m';   // olumsuz/tehlike/"kötü" durum (no, shutdown, down...)
const C_RESET = '\x1b[39m';

const KW_GROUPS = [
  { c: C_GREEN, words: ['show','sh','ping','traceroute','trace','write','wr','copy','reload','configure','conf','config','terminal','enable','disable','exit','end','clear','debug','undebug','telnet','ssh','dir','more','commit','up','connected','active','established','permit','forwarding','enabled','reachable','complete','success'] },
  { c: C_CYAN,  words: ['interface','int','ip','ipv6','vlan','router','ospf','eigrp','bgp','rip','route','access-list','acl','spanning-tree','switchport','hostname','description','desc','line','vrf','nat','dhcp','ntp','logging','snmp-server','aaa','crypto','username','banner','standby','channel-group','duplex','speed','bandwidth','mtu','running-config','startup-config','run','version','brief','br','status','summary','neighbors','database','mac','cdp','lldp','inventory','processes','cpu','memory','users','trunk','native','encapsulation','dot1q','protocol','address'] },
  { c: C_RED,   words: ['no','shutdown','shut','down','err-disabled','deny','denied','failed','disabled','administratively','notconnect','error','invalid','incomplete','unreachable','drop','drops'] },
];
const KW_MAP = (() => {
  const m = new Map();
  for (const g of KW_GROUPS) for (const w of g.words) m.set(w, g.c);
  return m;
})();
// Escape dizisi (CSI / OSC / bazı 2-3 baytlıklar) — split için tek yakalama grubu
const ANSI_SPLIT = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[=>78Mc])/;
const WORD = /[A-Za-z][A-Za-z0-9_-]*/g;

function highlightCisco(text) {
  if (!text || !/[A-Za-z]/.test(text)) return text;      // harf yoksa dokunma
  const parts = text.split(ANSI_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;                             // tek indeks = escape dizisi, atla
    const seg = parts[i];
    if (!seg) continue;
    parts[i] = seg.replace(WORD, (w) => {
      const c = KW_MAP.get(w.toLowerCase());
      return c ? c + w + C_RESET : w;
    });
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
  const { userRole, allowedCommands } = useAuth();

  // Administrator = tam kontrol; diğer roller = salt-izle (klavye kapalı, sadece butonlar)
  const restricted = userRole !== 'Administrator';
  // Buton listesi: sunucudan gelen 'mode' mesajı otoritedir; başlangıçta context'ten
  const [commands, setCommands] = useState(restricted ? (allowedCommands || []) : []);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      rows: 24,
      cols: 120,
      scrollback: 2000,
      disableStdin: restricted, // kısıtlı kullanıcı klavyeyle giriş yapamaz
      theme: {
        background: '#000000',
        foreground: '#ffd60a', // SecureCRT tarzı sarı terminal yazısı
        cursor: '#ffd60a',
      },
      cursorBlink: !restricted,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;
    if (!restricted) term.focus();
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
        } else if (msg.type === 'error') {
          term.write(`\r\n*** ERROR: ${msg.message} ***\r\n`);
        }
      } catch (e) {
        term.write(event.data);
      }
    };

    ws.onclose = (event) => {
      onStatusRef.current?.(false);
      term.write(`\r\n*** SSH disconnected (code: ${event.code}${event.reason ? ', ' + event.reason : ''}) — sekmeye sağ tıklayıp Reconnect ile yeniden bağlanın ***\r\n`);
    };

    ws.onerror = (event) => {
      onStatusRef.current?.(false);
      term.write(`\r\n*** WebSocket error ***\r\n`);
    };

    // SecureCRT gibi kopyala/yapıştır: fareyle seçince otomatik kopyala, sağ tık → yapıştır.
    // Kopyalama https'te Clipboard API, http'te textarea+execCommand ile → her iki durumda çalışır.
    const copyText = (text) => {
      if (!text) return;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); } catch (err) { /* ignore */ }
        ta.remove();
        try { term.focus(); } catch (err) { /* ignore */ }
      }
    };
    const onMouseUp = () => { const sel = term.getSelection(); if (sel) copyText(sel); };
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
  useEffect(() => {
    if (!active || restricted || minimized) return;
    const id = requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch (e) { /* ignore */ }
      try { termRef.current?.focus(); } catch (e) { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [active, restricted, minimized]);

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

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />

      {/* Kısıtlı kullanıcı: alt tarafta izinli komut butonları */}
      {restricted && (
        <div style={{
          flexShrink: 0, background: '#0f172a', borderTop: '1px solid var(--border-color)',
          padding: '8px 10px', display: 'flex', flexWrap: 'wrap', gap: 6,
          maxHeight: 120, overflowY: 'auto'
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
                  fontFamily: 'monospace', fontSize: '0.78rem', padding: '5px 12px',
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
  );
}

export default TerminalPane;
