import { useState, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { showToast } from '../Toast';
import { t } from '../i18n';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const BATCH_SIZE = 8; // backend eşzamanlılığıyla aynı — her parti bitince tablo güncellenir

// Satır/virgül/boşluk ayrılmış IP metnini ayrıştır. CIDR ve aralık KAPSAM DIŞI —
// belirsiz "geçersiz IP" yerine net bir sebep göster.
function parseIps(text) {
  const tokens = String(text || '').split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean);
  const ips = [], invalid = [], seen = new Set();
  for (const tok of tokens) {
    if (tok.includes('/') || tok.includes('-')) { invalid.push({ value: tok, reason: t('findRangeUnsupported') }); continue; }
    if (!IPV4_RE.test(tok)) { invalid.push({ value: tok, reason: t('findInvalidIp') }); continue; }
    if (seen.has(tok)) continue;
    seen.add(tok);
    ips.push(tok);
  }
  return { ips, invalid };
}

// Import parser'ı tırnaklı virgülü çözemediği için hücrelerden virgül/tırnak/satırsonu
// temizlenir — böylece üretilen CSV Import List'e sorunsuz geri beslenir.
const csvCell = (v) => String(v ?? '').replace(/[",\r\n]/g, ' ').trim();

export default function FindDeviceModal({ onClose }) {
  const { authFetch } = useAuth();
  const { topoTabs } = useApp();
  const [ipText, setIpText] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [snmpCommunity, setSnmpCommunity] = useState('');
  const [typeOverride, setTypeOverride] = useState('auto'); // 'auto' = keşifte tespit edilen
  const [topologyPage, setTopologyPage] = useState('main');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  const parsed = useMemo(() => parseIps(ipText), [ipText]);
  const foundCount = results.filter(r => r.status === 'ok').length;

  // Tabloda ve CSV'de aynı değer görünsün: 'auto' ise keşfin bulduğu tip, değilse seçilen
  const effectiveType = (r) => (typeOverride === 'auto' ? (r.type || 'switch') : typeOverride);

  // reset=true → yeni tarama (tüm sonuçlar sıfırlanır)
  // reset=false → sadece verilen IP'ler yeniden denenir, diğer sonuçlar korunur
  const runDiscovery = async (ips, reset) => {
    if (ips.length === 0) { showToast(t('findNoValidIp'), 'error'); return; }
    if (!username || !password) { showToast(t('findCredsRequired'), 'error'); return; }

    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: ips.length });
    setResults(prev => {
      if (reset) return ips.map(ip => ({ ip, status: 'pending' }));
      const map = new Map(prev.map(r => [r.ip, r]));
      for (const ip of ips) map.set(ip, { ip, status: 'pending' });
      return [...map.values()];
    });

    for (let i = 0; i < ips.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = ips.slice(i, i + BATCH_SIZE);
      try {
        const res = await authFetch('/switches/discover', {
          method: 'POST',
          body: JSON.stringify({ ips: batch, username, password })
        });
        if (!res || !res.ok) { // authFetch 401'de null döner
          const d = res ? await res.json().catch(() => ({})) : {};
          setResults(prev => prev.map(r => batch.includes(r.ip) ? { ...r, status: 'fail', error: d.error || t('findProbeFailed') } : r));
        } else {
          const data = await res.json();
          const byIp = Object.fromEntries((data.results || []).map(r => [r.ip, r]));
          setResults(prev => prev.map(r => {
            const hit = byIp[r.ip];
            if (!hit) return r;
            return hit.status === 'ok'
              ? { ...r, ...hit, status: 'ok' }
              : { ...r, status: 'fail', error: hit.status };
          }));
        }
      } catch {
        setResults(prev => prev.map(r => batch.includes(r.ip) ? { ...r, status: 'fail', error: t('findProbeFailed') } : r));
      }
      setProgress(p => ({ ...p, done: Math.min(p.total, i + batch.length) }));
    }
    setRunning(false);
  };

  const failedIps = results.filter(r => r.status === 'fail').map(r => r.ip);

  const downloadFoundCsv = () => {
    const found = results.filter(r => r.status === 'ok');
    if (found.length === 0) return;
    const pageName = (topoTabs || []).find(tab => tab.id === topologyPage)?.name || 'main';
    const rows = found.map(r => [
      csvCell(r.name || r.ip),   // Name (import zorunlu) — boşsa IP'ye düş
      csvCell(r.ip),
      csvCell(effectiveType(r)),
      csvCell(r.model || ''),
      csvCell(username),         // keşifte çalışan SSH kullanıcısı
      csvCell(password),         // SSH Password
      csvCell(snmpCommunity),    // SNMP Community (SSH ile keşfedilemez → kullanıcı girer)
      '',                        // Tags
      csvCell(pageName)          // Topology Page — id yerine ad: okunur ve import adı çözüyor
    ].join(','));
    const csv = ['Name,IP,Type,Model,SSH Username,SSH Password,SNMP Community,Tags,Topology Page', ...rows].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'netpulse-found-devices.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="modal-content" style={{ width: 640, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>🔍 {t('findDevice')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {t('findDeviceHint')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('findIpsLabel')}</label>
            <textarea className="modern-input" value={ipText} onChange={e => setIpText(e.target.value)} rows={5}
              placeholder={'10.11.3.126\n10.11.8.126\n10.11.13.126'}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.78rem', resize: 'vertical' }} />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
              {t('findIpsHint')} — {parsed.ips.length} IP
              {parsed.invalid.length > 0 && <span style={{ color: 'var(--danger)' }}> · {parsed.invalid.length} {t('findInvalidIp')}</span>}
            </div>
          </div>
          <div className="grid-2col">
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('sshUser')}</label>
              <input className="modern-input" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('sshPassword')}</label>
              <input className="modern-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <div className="grid-2col">
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('snmpCommunity')}</label>
              <input className="modern-input" value={snmpCommunity} onChange={e => setSnmpCommunity(e.target.value)} autoComplete="off" placeholder="public" />
            </div>
            <div>
              <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('deviceType')}</label>
              <select className="modern-input" value={typeOverride} onChange={e => setTypeOverride(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="auto">{t('findTypeAuto')}</option>
                <option value="switch">Network Switch</option>
                <option value="router">Router</option>
                <option value="firewall">Firewall</option>
                <option value="server">Server</option>
                <option value="pc">PC</option>
                <option value="antenna">Antenna</option>
                <option value="cloud">Cloud / Internet</option>
              </select>
            </div>
          </div>
          <div>
            <label className="input-label" style={{ display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>{t('topologyPage')}</label>
            <select className="modern-input" value={topologyPage} onChange={e => setTopologyPage(e.target.value)} style={{ cursor: 'pointer' }}>
              {(topoTabs || [{ id: 'main', name: 'Main Topology' }]).map(tab => (
                <option key={tab.id} value={tab.id}>{tab.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <button className="btn btn-primary" onClick={() => runDiscovery(parsed.ips, true)} disabled={running || parsed.ips.length === 0}>
            {running ? t('findRunning') : t('findRun')}
          </button>
          {!running && failedIps.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => runDiscovery(failedIps, false)} title={t('findRetryFailedTitle')}>
              ↻ {t('findRetryFailed')} ({failedIps.length})
            </button>
          )}
          {running && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { cancelRef.current = true; }}>{t('cancel')}</button>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('findProgress')}: {progress.done}/{progress.total}</span>
            </>
          )}
          {!running && results.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <strong style={{ color: 'var(--success)' }}>{foundCount}</strong> {t('findFound')} · {results.length - foundCount} {t('findFailed')}
            </span>
          )}
        </div>

        {results.length > 0 && (
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, marginBottom: 16 }}>
            <table className="modern-table" style={{ fontSize: '0.75rem' }}>
              <thead>
                <tr>{['', 'IP', 'Name', 'Type', 'Model', 'Detail'].map(h => <th key={h} style={{ padding: '6px 10px' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.ip}>
                    <td style={{ padding: '4px 10px' }}>
                      {r.status === 'pending'
                        ? <span style={{ color: 'var(--text-muted)' }}>⏳</span>
                        : <span className={`status-badge ${r.status === 'ok' ? 'status-up' : 'status-down'}`}>{r.status === 'ok' ? 'OK' : 'FAIL'}</span>}
                    </td>
                    <td style={{ padding: '4px 10px', fontFamily: 'monospace' }}>{r.ip}</td>
                    <td style={{ padding: '4px 10px' }}>{r.name || '-'}</td>
                    <td style={{ padding: '4px 10px' }}>{r.status === 'ok' ? effectiveType(r) : '-'}</td>
                    <td style={{ padding: '4px 10px' }}>{r.model || '-'}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--text-muted)' }}>{r.error || r.vendor || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-ghost" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-primary" onClick={downloadFoundCsv} disabled={foundCount === 0}>
            ⬇ {t('findDownload')} ({foundCount})
          </button>
        </div>
      </div>
    </div>
  );
}
