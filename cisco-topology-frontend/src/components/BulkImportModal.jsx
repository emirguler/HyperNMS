import { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { showToast } from '../Toast';

// Basit CSV/TSV parser
function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Header satırı
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

  // Header mapping
  const map = {};
  headers.forEach((h, i) => {
    if (h === 'name' || h === 'hostname' || h === 'ad' || h === 'cihaz' || h === 'device name' || h === 'device_name' || h === 'cihaz adı' || (h.includes('name') && !h.includes('user') && !h.includes('host') && !h.includes('account'))) map.name = i;
    else if (h.includes('ip') || h.includes('address') || h.includes('adres')) map.ip = i;
    else if (h.includes('type') || h.includes('tip')) map.type = i;
    else if (h.includes('model')) map.model = i;
    else if (h.includes('ssh') && h.includes('user')) map.sshUsername = i;
    else if (h.includes('ssh') && h.includes('pass')) map.sshPassword = i;
    else if (h.includes('snmp') || h.includes('community')) map.snmpCommunity = i;
    else if (h.includes('tag')) map.tags = i;
    else if (h.includes('topology') || h.includes('page') || h.includes('sayfa')) map.topologyPage = i;
  });

  if (map.name === undefined && map.ip === undefined) {
    // Fallback: ilk sütun name, ikinci sütun ip
    map.name = 0;
    map.ip = 1;
  }

  return lines.slice(1).map(line => {
    const cols = line.split(sep).map(c => c.trim().replace(/^['"]|['"]$/g, ''));
    const device = {};
    if (map.name !== undefined) device.name = cols[map.name] || '';
    if (map.ip !== undefined) device.ip = cols[map.ip] || '';
    if (map.type !== undefined) device.type = cols[map.type] || 'switch';
    if (map.model !== undefined) device.model = cols[map.model] || '';
    if (map.sshUsername !== undefined) device.sshUsername = cols[map.sshUsername] || '';
    if (map.sshPassword !== undefined) device.sshPassword = cols[map.sshPassword] || '';
    if (map.snmpCommunity !== undefined) device.snmpCommunity = cols[map.snmpCommunity] || '';
    if (map.tags !== undefined) device.tags = cols[map.tags] || '';
    if (map.topologyPage !== undefined) device.topologyPage = cols[map.topologyPage] || 'main';
    return device;
  }).filter(d => d.name && d.ip);
}

export default function BulkImportModal({ onClose }) {
  const { authFetch } = useAuth();
  const { fetchData } = useApp();
  const [devices, setDevices] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState('');
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const buf = ev.target.result; // ArrayBuffer
      // Önce UTF-8 dene; Türkçe karakterler bozulup replacement (�) çıkarsa
      // dosya büyük olasılıkla Windows Türkçe (windows-1254) kodlamasındadır.
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.includes('�')) {
        try { text = new TextDecoder('windows-1254').decode(buf); } catch { /* ignore */ }
      }
      setRawText(text);
      const parsed = parseCSV(text);
      setDevices(parsed);
      setResult(null);
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePaste = (text) => {
    setRawText(text);
    const parsed = parseCSV(text);
    setDevices(parsed);
    setResult(null);
  };

  // İçe aktarılabilir tüm sütun başlıkları + 1 örnek satır içeren CSV indir
  const downloadExampleCsv = () => {
    // Geçerli type değerleri: switch, router, firewall, server, pc, antenna, cloud
    const csv = [
      'Name,IP,Type,Model,SSH Username,SSH Password,SNMP Community,Tags,Topology Page',
      'Switch-01,192.168.1.10,switch,Cisco C9200,admin,MyP@ssw0rd,public,core,main',
      'Router-01,192.168.1.1,router,Cisco ISR4331,admin,MyP@ssw0rd,public,edge,main',
      'Firewall-01,192.168.1.2,firewall,Fortinet FG-60F,admin,MyP@ssw0rd,public,security,main',
      'Server-01,192.168.1.20,server,Dell R740,root,MyP@ssw0rd,public,datacenter,main',
      'PC-01,192.168.1.50,pc,Dell OptiPlex,,,public,office,main',
      'Antenna-01,192.168.1.30,antenna,Ubiquiti LiteBeam,admin,MyP@ssw0rd,public,wireless,main',
      'Internet,8.8.8.8,cloud,,,,,,main'
    ].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'netpulse-example.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (devices.length === 0) return;
    setLoading(true);
    try {
      const res = await authFetch('/switches/bulk', {
        method: 'POST',
        body: JSON.stringify({ devices })
      });
      const data = await res.json();
      setResult(data);
      if (data.added > 0) {
        showToast(`${data.added} device(s) imported`, 'success');
        fetchData();
      }
    } catch {
      showToast('Import failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 600, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>Bulk Import Devices</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Instructions */}
        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              Upload a CSV/Excel file or paste data. Required columns: <strong>Name</strong> and <strong>IP</strong>.
              Optional: Type, Model, SSH Username, SSH Password, SNMP Community, Tags, Topology Page
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={downloadExampleCsv}
              title="Download a sample CSV with all columns"
              style={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'var(--primary)', fontWeight: 600 }}>
              ⬇ Example CSV
            </button>
          </div>
        </div>

        {/* File upload */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <input type="file" ref={fileRef} accept=".csv,.tsv,.txt,.xlsx" onChange={handleFile} style={{ display: 'none' }} />
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose File (CSV)</button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', alignSelf: 'center' }}>or paste below</span>
        </div>

        {/* Paste area */}
        <textarea
          className="modern-input"
          value={rawText}
          onChange={e => handlePaste(e.target.value)}
          placeholder={'Name,IP,Type,SNMP Community,Topology Page\nSwitch-01,192.168.1.1,switch,public,main\nRouter-01,10.0.0.1,router,public,tab-123'}
          style={{ width: '100%', height: 120, fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', marginBottom: 16 }}
        />

        {/* Preview */}
        {devices.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Preview ({devices.length} devices)
            </h4>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
              <table className="modern-table" style={{ fontSize: '0.75rem' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 10px' }}>Name</th>
                    <th style={{ padding: '6px 10px' }}>IP</th>
                    <th style={{ padding: '6px 10px' }}>Type</th>
                    <th style={{ padding: '6px 10px' }}>SNMP</th>
                    <th style={{ padding: '6px 10px' }}>Topology</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.slice(0, 50).map((d, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 10px' }}>{d.name}</td>
                      <td style={{ padding: '4px 10px', fontFamily: 'monospace' }}>{d.ip}</td>
                      <td style={{ padding: '4px 10px' }}>{d.type || 'switch'}</td>
                      <td style={{ padding: '4px 10px' }}>{d.snmpCommunity || '-'}</td>
                      <td style={{ padding: '4px 10px' }}>{d.topologyPage || 'main'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ padding: 12, borderRadius: 8, marginBottom: 16, background: result.added > 0 ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${result.added > 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: result.added > 0 ? 'var(--success)' : 'var(--danger)' }}>
              Added: {result.added} | Skipped: {result.skipped}
              {result.pagesCreated > 0 && ` | New pages: ${result.pagesCreated}`}
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {result.errors.slice(0, 10).map((e, i) => <div key={i}>• {e}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={devices.length === 0 || loading}>
            {loading ? 'Importing...' : `Import ${devices.length} Device(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
