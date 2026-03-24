import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';

function TerminalPane({ switchId, switchName }) {
  const containerRef = useRef(null);
  const fitAddonRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      rows: 24,
      cols: 120,
      scrollback: 2000,
      theme: {
        background: '#000000',
        foreground: '#e5e7eb',
      },
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;

    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();
    term.write(`Connecting to switch ${switchId} (${switchName})...\r\n`);

    const ws = new WebSocket(
      `${WS_BASE}/ws/terminal?switchId=${encodeURIComponent(switchId)}`
    );

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

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    return () => {
      try { ws.close(); } catch (e) {}
      term.dispose();
    };
  }, [switchId, switchName]);

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

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}

export default TerminalPane;
