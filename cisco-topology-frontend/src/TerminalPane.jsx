import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';
import { useAuth } from './context/AuthContext';
import { t } from './i18n';

function TerminalPane({ switchId, switchName, active = true }) {
  const containerRef = useRef(null);
  const fitAddonRef = useRef(null);
  const socketRef = useRef(null);
  const termRef = useRef(null);
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
        foreground: '#e5e7eb',
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
      term.write(`*** SSH connection opening ***\r\n`);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          term.write(msg.data);
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
      term.write(`\r\n*** WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'}) ***\r\n`);
    };

    ws.onerror = (event) => {
      term.write(`\r\n*** WebSocket error ***\r\n`);
    };

    // Klavye girişini yalnızca tam kontrol (admin) oturumlarında ilet
    if (!restricted) {
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });
    }

    return () => {
      try { ws.close(); } catch (e) {}
      termRef.current = null;
      term.dispose();
    };
  }, [switchId, switchName, restricted]);

  // Sekme aktif olunca terminali odakla + boyutu tazele. display:none iken odak/fit çalışmaz,
  // bu yüzden görünür olduktan sonra (rAF) yap → sekmeye tıklayınca içine tıklamadan yazılır.
  useEffect(() => {
    if (!active || restricted) return;
    const id = requestAnimationFrame(() => {
      try { fitAddonRef.current?.fit(); } catch (e) { /* ignore */ }
      try { termRef.current?.focus(); } catch (e) { /* ignore */ }
    });
    return () => cancelAnimationFrame(id);
  }, [active, restricted]);

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
