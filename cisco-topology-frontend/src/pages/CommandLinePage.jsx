import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';
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
  const cmdRef = useRef(null);

  // Viewport bayraklari. Masaustunde hepsi false -> asagidaki kosullu stillerin
  // TAMAMI eski degerlerine duser, gorunum birebir korunur.
  const { isPhone, isShort, isTouch, height: vpH } = useViewport();
  // Telefon katmani (<=768px): yan yana iki panel yerine tek kolon akis
  // (hedefler -> komut -> sonuclar) + sabit Send cubugu.
  const stacked = isPhone;
  // Telefon yatay: ekran GENIS ama ~330px yuksek -> iki kolon kalir, yukseklikler kisilir.
  const compact = isPhone || isShort;
  // Uzun cihaz listesi telefonda komut kutusunu ekranin cok altina itiyordu; katlanabilir.
  const [targetsOpen, setTargetsOpen] = useState(true);
  // Cikti satirlarini sar: 80 kolonluk `show run` satiri telefonda kaydirmadan okunsun.
  const [wrapOut, setWrapOut] = useState(false);

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

  // textarea'nin resize tutamagi fareyle surukleme kontrolu; iOS onu hic cizmez, yani
  // dokunmatikte kutu 150px'e kilitli kaliyordu. Dokunmatikte icerige gore kendi buyusun.
  // Masaustunde hicbir sey yapmaz (orada resize:'vertical' duruyor).
  // DIKKAT: masaustunde tarayici, kullanicinin tutamakla surukledigi yuksekligi AYNI
  // inline style.height'e yazar. Kosulsuz temizlemek, her tus vurusunda elle buyutmeyi
  // geri aliyordu -> yalnizca bu efekt daha once yazdiysa temizliyoruz.
  const autoGrownRef = useRef(false);
  useEffect(() => {
    const el = cmdRef.current;
    if (!el) return;
    if (!isTouch) {
      if (autoGrownRef.current) { el.style.height = ''; autoGrownRef.current = false; }
      return;
    }
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.5)) + 'px';
    autoGrownRef.current = true;
    // 'stacked': kirilma noktasi asilinca textarea key ile yeniden monte olur, yeni dugumu de olcule.
  }, [commands, isTouch, stacked]);

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
  // Onay onizlemesi: kisa ekranda 4 satir (yer yok), diger her yerde eski 12.
  const previewCount = isShort ? 4 : 12;

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
    // Yigin modunda alttaki sabit Send cubugu son satiri ortmesin.
    <div
      className="list-container"
      style={stacked ? { paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' } : undefined}
    >
      <div style={{ marginBottom: compact ? 12 : 20 }}>
        <h1 style={{ fontSize: compact ? '1.3rem' : '1.6rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>{t('commandLine')}</h1>
        {/* Kisa ekranda aciklama satiri, 330px'lik yukseklikte lukstur. */}
        <p className="rw-hide-short" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0' }}>{t('clDesc')}</p>
      </div>

      <div style={{ display: 'flex', gap: compact ? 12 : 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* SOL: Hedef paneli */}
        <div className="chart-container" style={{
          // 812px ve 844px yatay telefonlar taban genisligi yuzunden FARKLI duzen aliyordu
          // (biri sariyor, digeri sarmiyor). Kisa ekranda tabani 300'e cekip iki kolonu garantiledik.
          flex: stacked ? '1 1 100%' : (isShort ? '1 1 300px' : '1 1 320px'),
          minWidth: 0,
          maxWidth: stacked ? '100%' : 400,
          padding: 0, display: 'flex', flexDirection: 'column',
          // Telefonda 640px'lik kap + ic kaydirici, .list-container'in kendi kaydiricisiyla
          // birlikte ust uste ucuncu bir kaydirma ekseni yapiyordu. Yigin modunda kap serbest.
          maxHeight: stacked ? 'none' : (isShort ? Math.max(180, vpH - 92) : 640)
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('clTargets')}</h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selCount} {t('clSelected')}</span>
            </div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('clPage')}</label>
            <select className="modern-input" value={selectedTab} onChange={e => setSelectedTab(e.target.value)} style={{ width: '100%', marginBottom: 10 }}>
              {(topoTabs || []).map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
            </select>
            {/* type="search" YALNIZCA dokunmatikte: masaustu Chrome'da temizleme (x) dugmesi cizer. */}
            <input
              className="modern-input"
              type={isTouch ? 'search' : 'text'}
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('clSearch')}
              style={{ width: '100%', marginBottom: 10 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer', minHeight: isTouch ? 44 : undefined }}>
                <input type="checkbox" checked={onlyUp} onChange={e => setOnlyUp(e.target.checked)} /> {t('clOnlyUp')}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAll} style={{ fontSize: isTouch ? '0.85rem' : '0.72rem', padding: '3px 10px' }}>{t('clAll')}</button>
                <button className="btn btn-ghost btn-sm" onClick={clearSel} style={{ fontSize: isTouch ? '0.85rem' : '0.72rem', padding: '3px 10px' }}>{t('clNone')}</button>
              </div>
            </div>

            {/* Yigin modunda liste sayfayla akiyor; 40 cihazlik bir liste komut kutusunu
                ekranin cok altina itiyordu. Tek dokunusla katlanabilsin. */}
            {stacked && (
              <button
                type="button"
                onClick={() => setTargetsOpen(o => !o)}
                style={{
                  marginTop: 10, width: '100%', minHeight: 44, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 8, padding: '0 12px', cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8,
                  color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit'
                }}
              >
                <span>{filtered.length} {t('clDevicesWord')}</span>
                <span style={{ fontSize: '0.9rem' }}>{targetsOpen ? '▾' : '▸'}</span>
              </button>
            )}
          </div>

          {(!stacked || targetsOpen) && (
          <div style={{
            flex: 1, minHeight: 120,
            // Yigin modunda ic kaydirici KAPALI: sayfanin tek kaydirma ekseni kalsin,
            // yoksa parmak listenin uzerine geldiginde sayfa kaydirmasi kilitleniyor.
            overflowY: stacked ? 'visible' : 'auto',
            WebkitOverflowScrolling: 'touch',
            // Yalnizca dokunmatikte: masaustunde tekerlek zincirlemesini kesmek
            // eski davranisi degistirirdi (liste sonuna gelince sayfa kaymaya devam ederdi).
            overscrollBehavior: (isTouch && !stacked) ? 'contain' : undefined
          }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('clNoDevices')}</div>
            ) : filtered.map(d => {
              const ok = hasSsh(d);
              const checked = selectedIds.has(d.id);
              return (
                <label key={d.id} title={ok ? '' : t('clNoSsh')} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
                  minHeight: isTouch ? 48 : undefined, boxSizing: 'border-box',
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
          )}
        </div>

        {/* SAG: Komut + Sonuclar */}
        <div style={{
          flex: stacked ? '1 1 100%' : (isShort ? '3 1 400px' : '3 1 460px'),
          minWidth: 0, display: 'flex', flexDirection: 'column', gap: compact ? 12 : 20
        }}>
          <div className="chart-container" style={{ padding: compact ? 12 : 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{t('clCommands')}</h3>
              {/* Salt-okunur ile config modu arasindaki bu anahtar, yikici config gonderimini
                  silahlandiran kontrol. Dokunmatikte tam genislikte, aradaki belirsiz bosluk
                  olmadan iki esit parcaya bolunur. */}
              <div style={{
                display: 'flex', gap: 4, background: 'var(--bg-panel)', borderRadius: 8, padding: 3,
                border: '1px solid var(--border-color)',
                ...(isTouch ? { flex: '1 1 100%' } : null)
              }}>
                <button onClick={() => setMode('show')} className={mode === 'show' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} style={{ fontSize: isTouch ? '0.85rem' : '0.75rem', padding: '4px 12px', ...(isTouch ? { flex: 1 } : null) }}>{t('clShow')}</button>
                <button onClick={() => setMode('config')} className={mode === 'config' ? 'btn btn-sm' : 'btn btn-ghost btn-sm'} style={{ fontSize: isTouch ? '0.85rem' : '0.75rem', padding: '4px 12px', ...(isTouch ? { flex: 1 } : null), ...(mode === 'config' ? { background: 'var(--danger)', color: '#fff' } : {}) }}>{t('clConfig')}</button>
              </div>
            </div>

            {mode === 'config' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: 'var(--danger)', fontSize: '0.78rem' }}>
                ⚠️ {t('clConfigWarn')}
              </div>
            )}

            {mode === 'config' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.83rem', color: 'var(--text-main)', cursor: 'pointer', minHeight: isTouch ? 44 : undefined }}>
                <input type="checkbox" checked={saveAfter} onChange={e => setSaveAfter(e.target.checked)} />
                {t('clSaveAfter')} <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>(write memory)</span>
              </label>
            )}

            {/* Telefonda wrap="off" + whiteSpace:'pre' yazarken yatay kaydiriyordu; satirlar katlansin.
                key: `wrap` niteligi canli olarak degistirilemez, kirilma noktasi asilinca
                yeniden monte edilmeli. Deger kontrollu state'te oldugu icin metin kaybolmaz. */}
            <textarea
              key={stacked ? 'soft' : 'off'}
              ref={cmdRef}
              value={commands}
              onChange={e => setCommands(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              wrap={stacked ? 'soft' : 'off'}
              placeholder={mode === 'config' ? t('clPhConfig') : t('clPhShow')}
              style={{
                width: '100%', boxSizing: 'border-box',
                // Kisa ekranda 150px sabit taban, viewport'un ~%45'ini yiyip Send'i katlanin altina itiyordu.
                minHeight: compact ? Math.max(90, Math.min(150, Math.round(vpH * 0.22))) : 150,
                maxHeight: isTouch ? Math.round(vpH * 0.5) : undefined,
                // resize tutamagi iOS'ta cizilmez -> dokunmatikte icerige gore otomatik buyume (bkz. effect).
                resize: isTouch ? 'none' : 'vertical',
                background: 'var(--bg-panel)', color: 'var(--text-main)',
                border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px',
                fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5,
                whiteSpace: stacked ? 'pre-wrap' : 'pre',
                overflowWrap: stacked ? 'anywhere' : undefined,
                overflow: 'auto'
              }}
            />

            {/* Yigin modunda sayac + Send, sayfanin altina sabitlenmis cubukta (asagida). */}
            {!stacked && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 12, gap: 10, flexWrap: 'wrap',
                // Kisa ekranda kart icinde yapisik kalsin: birincil eylem hep gorunur olsun.
                ...(isShort ? { position: 'sticky', bottom: 0, background: 'var(--bg-card)', paddingTop: 8, zIndex: 1 } : null)
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {cmdLines.length} {t('clLines')} · {selCount} {t('clDevicesWord')}
                </span>
                <button className="btn btn-primary" disabled={!canSend} onClick={() => setConfirm(true)} style={{ padding: '9px 22px' }}>
                  {running ? t('clRunning') : t('clSend')}
                </button>
              </div>
            )}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{results.completed}/{results.total}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>✓ {results.ok}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>✕ {results.failed}</span>
                  {/* 80 kolonluk cikti telefonda satir basina birkac kaydirma istiyordu. */}
                  {isTouch && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setWrapOut(w => !w)}
                      style={{ fontSize: '0.85rem', color: wrapOut ? 'var(--primary)' : 'var(--text-muted)' }}
                    >
                      {wrapOut ? 'Wrap ✓' : 'Wrap'}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={exportResults} style={{ fontSize: isTouch ? '0.85rem' : '0.72rem' }}>{t('clExport')}</button>
                </div>
              </div>
              {!results.done && (
                <div style={{ height: 3, background: 'var(--border-color)' }}>
                  <div style={{ height: '100%', width: `${results.total ? Math.round(results.completed / results.total * 100) : 0}%`, background: 'var(--primary)', transition: 'width 0.3s ease' }} />
                </div>
              )}
              {/* 460px, 330px'lik yatay viewport'tan uzun: sayfa icinde ikinci bir kaydirici
                  oluyordu. Yigin modunda sonuclar sayfayla birlikte akar. */}
              <div style={{
                maxHeight: stacked ? 'none' : (isShort ? Math.max(160, Math.round(vpH * 0.55)) : 460),
                overflowY: stacked ? 'visible' : 'auto',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: (isTouch && !stacked) ? 'contain' : undefined
              }}>
                {results.results.map(r => {
                  const pending = r.status === 'pending';
                  const open = expanded.has(r.id) && !pending;
                  return (
                    <div key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <div onClick={() => !pending && toggleRow(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', minHeight: isTouch ? 44 : undefined, boxSizing: 'border-box', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: pending ? 'var(--text-muted)' : (r.ok ? 'var(--success)' : 'var(--danger)') }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-main)', fontWeight: 500 }}>{r.name}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 8 }}>{r.ip || ''}</span>
                        </span>
                        {r.durationMs != null && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{(r.durationMs / 1000).toFixed(1)}s</span>}
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: pending ? 'var(--text-muted)' : (r.ok ? 'var(--success)' : 'var(--danger)') }}>{pending ? '…' : (r.ok ? 'OK' : t('clFail'))}</span>
                        {!pending && <span style={{ color: 'var(--text-muted)', fontSize: isTouch ? '0.9rem' : '0.7rem' }}>{open ? '▾' : '▸'}</span>}
                      </div>
                      {open && (
                        <pre className={wrapOut ? undefined : 'rw-scroll-x'} style={{
                          margin: 0, padding: '10px 16px', background: 'rgba(0,0,0,0.25)',
                          fontSize: isTouch ? '0.85rem' : '0.72rem', lineHeight: 1.5, fontFamily: 'monospace',
                          color: r.ok ? 'var(--text-main)' : 'var(--danger)',
                          whiteSpace: wrapOut ? 'pre-wrap' : 'pre',
                          overflowWrap: wrapOut ? 'anywhere' : undefined,
                          overflowX: wrapOut ? 'hidden' : 'auto'
                        }}>
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

      {/* Yigin modunda birincil eylem: sayfanin altina sabitlenmis Send cubugu.
          Hedefler -> komut -> sonuclar akisinda Send aksi halde katlanin cok altinda kaliyordu.
          zIndex 900: navbar (10000), terminal paneli (10000) ve modal (10001) bunun USTUNDE kalir. */}
      {stacked && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 900,
          display: 'flex', alignItems: 'center', gap: 12, boxSizing: 'border-box',
          background: 'var(--bg-panel)', borderTop: '1px solid var(--border-color)',
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
          paddingLeft: 'max(12px, env(safe-area-inset-left))',
          paddingRight: 'max(12px, env(safe-area-inset-right))'
        }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {cmdLines.length} {t('clLines')} · {selCount} {t('clDevicesWord')}
          </span>
          <button
            className="btn btn-primary"
            disabled={!canSend}
            onClick={() => setConfirm(true)}
            style={{ flexShrink: 0, minHeight: 44, padding: '0 24px' }}
          >
            {running ? t('clRunning') : t('clSend')}
          </button>
        </div>
      )}

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
            {/* Sabit 160px onizleme, 330px'lik yatay viewport'un ~%48'ini yiyip Send/Cancel
                satirini katlanin altina itiyordu. Kisa ekranda hem yukseklik hem satir sayisi kisilir. */}
            <pre style={{
              margin: '0 0 16px', maxHeight: compact ? Math.max(60, Math.min(160, Math.round(vpH * 0.3))) : 160,
              overflow: 'auto', padding: '10px 12px', background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.74rem',
              fontFamily: 'monospace', color: 'var(--text-main)', whiteSpace: 'pre',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: isTouch ? 'contain' : undefined
            }}>
              {cmdLines.slice(0, previewCount).join('\n')}{cmdLines.length > previewCount ? `\n… +${cmdLines.length - previewCount}` : ''}
            </pre>
            <div className="rw-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>{t('cancel')}</button>
              <button className="btn btn-primary" onClick={run} style={mode === 'config' ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : {}}>{t('clSend')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
