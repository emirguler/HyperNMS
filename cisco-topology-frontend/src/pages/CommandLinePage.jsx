import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { showToast } from '../Toast';
import { t } from '../i18n';

// Toplu komut gonderme: bir topoloji sayfasindaki cihazlarin tamamina ya da secilen alt kumeye
// SSH ile show (read-only) veya config komutlari gonderir. Yalnizca admin.
export default function CommandLinePage() {
  const { authFetch, isAdmin } = useAuth();
  const { topoTabs, rawDevices } = useApp();

  const [selectedTab, setSelectedTab] = useState(() => (topoTabs && topoTabs[0] ? topoTabs[0].id : 'main'));
  const [search, setSearch] = useState('');
  const [onlyUp, setOnlyUp] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [commands, setCommands] = useState('');
  const [mode, setMode] = useState('show'); // 'show' | 'config'
  const [saveAfter, setSaveAfter] = useState(false); // config sonrasi write memory
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [confirm, setConfirm] = useState(false);
  const pollRef = useRef(null);

  const hasSsh = (d) => !!(d && d.sshUsername && d.sshPasswordSet);
  const onPage = (d) => (d.topologyPage || 'main') === selectedTab;

  // Sayfa degisince (ya da cihazlar ilk yuklenince) o sayfadaki uygun cihazlari otomatik sec
  const initedTab = useRef(null);
  useEffect(() => {
    if (initedTab.current === selectedTab) return;
    if (!rawDevices || rawDevices.length === 0) return; // henuz yuklenmedi
    const ids = rawDevices.filter(d => onPage(d) && hasSsh(d)).map(d => d.id);
    setSelectedIds(new Set(ids));
    initedTab.current = selectedTab;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, rawDevices]);

  // Gercek topoloji sekmeleri yuklenince gecersiz secimi ilk sekmeye duzelt
  useEffect(() => {
    if (topoTabs && topoTabs.length && !topoTabs.some(tb => tb.id === selectedTab)) {
      setSelectedTab(topoTabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topoTabs]);

  // Sayfadan cikinca canli akis polling'ini durdur
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t('clAdminOnly')}</div>;
  }

  const devices = (rawDevices || []).filter(onPage);
  const q = search.trim().toLowerCase();
  const filtered = devices.filter(d =>
    (!onlyUp || d.status === 'UP') &&
    (!q || (d.name || '').toLowerCase().includes(q) || (d.ip || '').toLowerCase().includes(q))
  );
  const selectableFiltered = filtered.filter(hasSsh);
  const selCount = selectedIds.size;

  const toggle = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSelectedIds(prev => { const n = new Set(prev); selectableFiltered.forEach(d => n.add(d.id)); return n; });
  const clearSel = () => setSelectedIds(new Set());

  const cmdLines = commands.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const canSend = selCount > 0 && cmdLines.length > 0 && !running;

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const run = async () => {
    setConfirm(false);
    setRunning(true);
    setResults(null);
    setExpanded(new Set());
    stopPoll();
    try {
      const res = await authFetch('/switches/bulk-exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], commands, mode, saveAfter: mode === 'config' && saveAfter })
      });
      const d = await res.json().catch(() => ({}));
      if (!res || !res.ok) { showToast(d.error || t('operationFailed'), 'error'); setRunning(false); return; }
      setResults(d); // ilk yanit: hedefler 'pending', atlananlar dolu
      if (d.done || !d.jobId) { setRunning(false); return; }
      // Canli akis: is bitene kadar polling — sonuclar cihaz tamamlandikca dolar
      pollRef.current = setInterval(async () => {
        try {
          const r = await authFetch(`/switches/bulk-exec/${d.jobId}`);
          if (!r) return;
          if (r.status === 404) { stopPoll(); setRunning(false); showToast(t('clJobExpired'), 'error'); return; }
          if (!r.ok) return;
          const jd = await r.json();
          setResults(jd);
          if (jd.done) { stopPoll(); setRunning(false); }
        } catch (e) { /* gecici hata — polling devam eder */ }
      }, 1200);
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
      setRunning(false);
    }
  };

  const exportResults = () => {
    if (!results) return;
    const body = results.results.map(r => {
      const head = `===== ${r.name} (${r.ip || '-'}) - ${r.ok ? 'OK' : 'FAIL'}${r.durationMs != null ? ` (${(r.durationMs / 1000).toFixed(1)}s)` : ''} =====`;
      return head + '\n' + (r.ok ? (r.output || '') : (r.error || '')) + '\n';
    }).join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-${mode}-${selectedTab}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const toggleRow = (id) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="list-container">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>{t('commandLine')}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>{t('clDesc')}</p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* SOL: Hedef paneli */}
        <div className="chart-container" style={{ flex: '1 1 320px', maxWidth: 400, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: 640 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('clTargets')}</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selCount} {t('clSelected')}</span>
            </div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('clPage')}</label>
            <select className="modern-input" value={selectedTab} onChange={e => setSelectedTab(e.target.value)} style={{ width: '100%', marginBottom: 10 }}>
              {(topoTabs || []).map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
            </select>
            <input className="modern-input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('clSearch')} style={{ width: '100%', marginBottom: 10 }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyUp} onChange={e => setOnlyUp(e.target.checked)} /> {t('clOnlyUp')}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAll} style={{ fontSize: '0.72rem', padding: '3px 10px' }}>{t('clAll')}</button>
                <button className="btn btn-ghost btn-sm" onClick={clearSel} style={{ fontSize: '0.72rem', padding: '3px 10px' }}>{t('clNone')}</button>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('clNoDevices')}</div>
            ) : filtered.map(d => {
              const ok = hasSsh(d);
              const checked = selectedIds.has(d.id);
              return (
                <label key={d.id} title={ok ? '' : t('clNoSsh')} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
                  borderBottom: '1px solid var(--border-color)', cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.5
                }}>
                  <input type="checkbox" disabled={!ok} checked={checked} onChange={() => ok && toggle(d.id)} />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: d.status === 'UP' ? 'var(--success)' : 'var(--danger)' }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: '0.83rem', color: 'var(--text-main)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{d.ip}</span>
                  </span>
                  {!ok && <span style={{ fontSize: '0.62rem', color: 'var(--warning)', border: '1px solid var(--warning)', borderRadius: 4, padding: '1px 5px' }}>{t('clNoSsh')}</span>}
                </label>
              );
            })}
          </div>
        </div>

        {/* SAG: Komut + Sonuclar */}
        <div style={{ flex: '3 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="chart-container" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('clCommands')}</h3>
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg-panel)', borderRadius: 8, padding: 3, border: '1px solid var(--border-color)' }}>
                <button onClick={() => setMode('show')} className={mode === 'show' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} style={{ fontSize: '0.75rem', padding: '4px 12px' }}>{t('clShow')}</button>
                <button onClick={() => setMode('config')} className={mode === 'config' ? 'btn btn-sm' : 'btn btn-ghost btn-sm'} style={{ fontSize: '0.75rem', padding: '4px 12px', ...(mode === 'config' ? { background: 'var(--danger)', color: '#fff' } : {}) }}>{t('clConfig')}</button>
              </div>
            </div>

            {mode === 'config' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.78rem' }}>
                ⚠️ {t('clConfigWarn')}
              </div>
            )}

            {mode === 'config' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.83rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                <input type="checkbox" checked={saveAfter} onChange={e => setSaveAfter(e.target.checked)} />
                {t('clSaveAfter')} <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>(write memory)</span>
              </label>
            )}

            <textarea
              value={commands}
              onChange={e => setCommands(e.target.value)}
              spellCheck={false}
              wrap="off"
              placeholder={mode === 'config' ? t('clPhConfig') : t('clPhShow')}
              style={{ width: '100%', boxSizing: 'border-box', minHeight: 150, resize: 'vertical', background: 'var(--bg-panel)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, whiteSpace: 'pre', overflow: 'auto' }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {cmdLines.length} {t('clLines')} · {selCount} {t('clDevicesWord')}
              </span>
              <button className="btn btn-primary" disabled={!canSend} onClick={() => setConfirm(true)} style={{ padding: '9px 22px' }}>
                {running ? t('clRunning') : t('clSend')}
              </button>
            </div>
          </div>

          {running && !results && (
            <div className="chart-container" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>⏳</div>
              {t('clRunningOn')} {selCount} {t('clDevicesWord')}…
            </div>
          )}

          {results && (
            <div className="chart-container" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 16px', borderBottom: results.done ? '1px solid var(--border-color)' : 'none', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('clResults')}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{results.completed}/{results.total}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ {results.ok}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>✕ {results.failed}</span>
                  <button className="btn btn-ghost btn-sm" onClick={exportResults} style={{ fontSize: '0.72rem' }}>{t('clExport')}</button>
                </div>
              </div>
              {!results.done && (
                <div style={{ height: 3, background: 'var(--border-color)' }}>
                  <div style={{ height: '100%', width: `${results.total ? Math.round(results.completed / results.total * 100) : 0}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }} />
                </div>
              )}
              <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                {results.results.map(r => {
                  const pending = r.status === 'pending';
                  const open = expanded.has(r.id) && !pending;
                  return (
                    <div key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <div onClick={() => !pending && toggleRow(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: pending ? 'var(--text-muted)' : (r.ok ? 'var(--success)' : 'var(--danger)') }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-main)', fontWeight: 500 }}>{r.name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 8 }}>{r.ip || ''}</span>
                        </span>
                        {r.durationMs != null && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{(r.durationMs / 1000).toFixed(1)}s</span>}
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: pending ? 'var(--text-muted)' : (r.ok ? 'var(--success)' : 'var(--danger)') }}>{pending ? '…' : (r.ok ? 'OK' : t('clFail'))}</span>
                        {!pending && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{open ? '▾' : '▸'}</span>}
                      </div>
                      {open && (
                        <pre style={{ margin: 0, padding: '10px 16px', background: 'rgba(0,0,0,0.25)', fontSize: '0.72rem', lineHeight: 1.5, fontFamily: 'monospace', color: r.ok ? 'var(--text-main)' : 'var(--danger)', whiteSpace: 'pre', overflowX: 'auto' }}>
                          {r.ok ? (r.output || t('clNoOutput')) : (r.error || 'error')}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Onay penceresi */}
      {confirm && (
        <div className="modal-overlay" onClick={() => setConfirm(false)} onKeyDown={e => { if (e.key === 'Escape') setConfirm(false); }}>
          <div className="modal-content" style={{ width: 'min(520px, 92vw)' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 12px', fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-main)' }}>{t('clConfirmTitle')}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 12 }}>
              <strong style={{ color: 'var(--text-main)' }}>{cmdLines.length}</strong> {t('clLines')} → <strong style={{ color: 'var(--text-main)' }}>{selCount}</strong> {t('clDevicesWord')} · {mode === 'config' ? t('clConfig') : t('clShow')}
            </p>
            {mode === 'config' && (
              <div style={{ padding: '8px 12px', marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.8rem' }}>
                ⚠️ {t('clConfirmConfigWarn')}{saveAfter ? ' ' + t('clSaveNote') : ''}
              </div>
            )}
            <pre style={{ margin: '0 0 16px', maxHeight: 160, overflow: 'auto', padding: '10px 12px', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.74rem', fontFamily: 'monospace', color: 'var(--text-main)', whiteSpace: 'pre' }}>
              {cmdLines.slice(0, 12).join('\n')}{cmdLines.length > 12 ? `\n… +${cmdLines.length - 12}` : ''}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={run} style={mode === 'config' ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : {}}>{t('clSend')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
