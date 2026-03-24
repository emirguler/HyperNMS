import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';
import { WS_BASE } from './config';

function TerminalModal({ switchId, onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      rows: 24,
      cols: 80,
      theme: {
        background: '#000000',
        foreground: '#e5e7eb',
      },
      cursorBlink: true,
    });

    term.open(containerRef.current);
    term.focus();
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
      term.dispose();
    };
  }, [switchId]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15,23,42,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: '800px',
          height: '500px',
          backgroundColor: '#020617',
          borderRadius: 12,
          boxShadow: '0 20px 40px rgba(15,23,42,0.9)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #1f2937',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#e5e7eb',
            fontSize: 13,
          }}
        >
          <span>SSH Terminal – Switch ID: {switchId}</span>
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              fontSize: 12,
              borderRadius: 6,
              border: '1px solid #6b7280',
              backgroundColor: '#111827',
              color: '#f9fafb',
              cursor: 'pointer',
            }}
          >
            Kapat
          </button>
        </div>
        <div style={{ flex: 1 }}>
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
