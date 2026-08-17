import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import PingModal from '../components/PingModal';
import PingIcon from '../components/PingIcon';
import TraceModal from '../components/TraceModal';
import TraceIcon from '../components/TraceIcon';
import InterfaceConfigModal from '../components/InterfaceConfigModal';
import ConfirmModal from '../components/ConfirmModal';
import { showToast } from '../Toast';
import Gauge from '../components/Gauge';
import PingHistoryChart from '../components/PingHistoryChart';
import ConfigBackupCard from '../components/ConfigBackupCard';
import { useViewport } from '../hooks/useViewport';
import { t } from '../i18n';

export default function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { authFetch, isAdmin, isOperator, allowedCommands } = useAuth();
  const { openSshSession, topoTabs, rawDevices } = useApp();
  const { isPhone, isTablet, isShort, isTouch, width } = useViewport();
  // compact         -> dar govde: aksiyon satiri "..." sayfasina toplanir, kartlar kisilir
  // phonePortrait   -> telefon dikey: bilgi izgarasi tek kolon (CSS tarafinda <=600px)
  // stackedGrid     -> .grid-detail-main tek kolona dustu mu
  //                    (App.css <=900px; responsive.css kisa ekranda 3 kolona geri aliyor)
  // gaugesSideBySide-> CPU+RAM ayni satirda mi cizilsin
  const compact = isPhone || isShort;
  const phonePortrait = width <= 600;
  const stackedGrid = width <= 900 && (!isShort || width <= 600);
  const gaugesSideBySide = stackedGrid && (isPhone || isTouch);
  const [showPing, setShowPing] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showActions, setShowActions] = useState(false); // dar govdedeki "..." aksiyon sayfasi
  const [configIface, setConfigIface] = useState(null); // "Config" butonuyla açılan arayüz
  const [confirmReload, setConfirmReload] = useState(false); // reload onay diyaloğu
  const [reloading, setReloading] = useState(false);
  // Geri dön: gelinen sayfaya (topoloji sekmesi / Devices / Dashboard ...).
  // Doğrudan link ile açıldıysa (state yok) Devices'a düş.
  const backTo = location.state?.from || '/devices';
  const [detailsData, setDetailsData] = useState(null); // /details yanıtı (SNMP zengin verisi)
  const [snmpLoaded, setSnmpLoaded] = useState(false);  // /details en az bir kez döndü mü
  const [reveal, setReveal] = useState(false);          // 4sn güvenlik: veri gelmese de sayfayı aç
  const [slas, setSlas] = useState(null); // IP SLA durumu (MD/GSM rozeti + IP SLA kartı)

  // Bağlamdan (Devices/topoloji zaten yüklü) anında tohumla: SNMP verisi gelene kadar
  // KAYIT-tabanlı tüm alanlar (ad/ip/durum/sürüm/etiket + snmpCommunity/sshUsername/
  // sshPasswordSet/model) hemen görünür. Bunlar SNMP'den değil cihaz kaydından gelir; admin
  // için /topology yanıtında zaten mevcut → /details'in yavaş SNMP turunu beklemesine gerek yok.
  useEffect(() => {
    if (snmpLoaded) return;
    const s = rawDevices.find(dev => dev.id === id);
    if (s) setDetailsData(prev => ({
      ...prev, // /details'ten gelen SNMP alanları (cpu/ram/interfaces/vendor/uptime...) korunur
      name: s.name, ip: s.ip, status: s.status, type: s.type,
      topologyPage: s.topologyPage, tags: s.tags, version: s.version, latency: s.latency,
      snmpCommunity: s.snmpCommunity, sshUsername: s.sshUsername,
      sshPasswordSet: s.sshPasswordSet, model: s.model,
    }));
  }, [rawDevices, id, snmpLoaded]);

  // /details — arka planda; gelince SNMP verisini birleştir. In-flight guard yavaş SNMP'de
  // isteklerin yığılmasını önler (ölü SNMP'de tek istek ~30sn sürebilir).
  useEffect(() => {
    let active = true, inFlight = false;
    const f = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const res = await authFetch(`/switches/${id}/details`);
        if (active && res && res.ok) {
          const fresh = await res.json();
          setDetailsData(prev => ({ ...prev, ...fresh }));
          setSnmpLoaded(true);
        }
      } catch (e) { /* ignore */ } finally { inFlight = false; }
    };
    f();
    const i = setInterval(f, 5000);
    return () => { active = false; clearInterval(i); };
  }, [id, authFetch]);

  // 4 saniye sonra ne olursa olsun sayfa iskeletini göster (tohum yoksa bile).
  useEffect(() => { setReveal(false); const tm = setTimeout(() => setReveal(true), 4000); return () => clearTimeout(tm); }, [id]);

  // IP SLA — 30 sn'de bir (MD/GSM rozeti ve IP SLA kartı bunu kullanır). SSH fallback yavaş
  // olabildiği için burada da in-flight guard var.
  useEffect(() => {
    let active = true, inFlight = false;
    const f = async () => {
      if (inFlight) return; inFlight = true;
      try {
        const res = await authFetch(`/switches/${id}/ip-sla`);
        if (active && res && res.ok) { const d = await res.json(); setSlas(Array.isArray(d) ? d : []); }
      } catch (e) { /* ignore */ } finally { inFlight = false; }
    };
    f();
    const i = setInterval(f, 30000);
    return () => { active = false; clearInterval(i); };
  }, [id, authFetch]);

  // İlk açılış kapısı: elde tohum/veri VARSA hemen render; hiç yoksa en geç 4sn sonra iskeletle.
  if (!detailsData && !reveal) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>{t('loadingDetails')}</div>;
  // detailsData null olsa bile (tohumsuz + 4sn geçti) sayfa çökmeden gelsin diye stub.
  const details = detailsData || { id, name: id, ip: '-', status: 'UNKNOWN', tags: [] };

  const displayHostname = details.snmpHostname || details.name || 'Unknown';
  // IP SLA OK (tüm operasyonlar ok) → birincil etiket (varsayılan MD), aksi halde yedek etiket (varsayılan GSM).
  // Etiketler cihaz bazında elle girilebilir. IP SLA yoksa rozet gizli.
  const slaBadge = (!slas || slas.length === 0) ? null
    : slas.every(s => s.status === 'ok')
      ? { label: details.ipSlaOkLabel || 'MD', color: 'var(--success)', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)' }
      : { label: details.ipSlaFailLabel || 'GSM', color: 'var(--warning)', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' };
  const formatTraffic = (bps) => {
    if (!bps || bps === 0) return '0 Mbps';
    const mbps = bps / 1000000;
    return mbps >= 1000 ? (mbps / 1000).toFixed(2) + ' Gbps' : mbps.toFixed(2) + ' Mbps';
  };
  const formatSpeed = (bps) => {
    if (!bps) return '-';
    if (bps >= 10000000000) return '10 G';
    if (bps >= 1000000000) return (bps / 1000000000).toFixed(0) + ' G';
    return (bps / 1000000).toFixed(0) + ' M';
  };

  // Cihazı yeniden başlat: SSH ile "reload" + onay Enter'ı gönder (yıkıcı → önce onay diyaloğu)
  const doReload = async () => {
    setConfirmReload(false);
    setReloading(true);
    try {
      const res = await authFetch(`/switches/${id}/reload`, { method: 'POST' });
      const data = res ? await res.json().catch(() => null) : null;
      if (res && res.ok) showToast(t('reloadSent'), 'success');
      else showToast((data && data.error) || t('reloadFail'), 'error');
    } catch {
      showToast(t('reloadFail'), 'error');
    } finally {
      setReloading(false);
    }
  };

  // Arayuz tablosu kolon genislikleri. <=768'de App.css tabloyu 560px'e zorluyor;
  // orada Port %20 = 112px ve "GigabitEthernet1/0/24" komsu kolona tasiyor -> Port'u genislet.
  // (<=600px'te tablo zaten .rw-cards ile karta donuyor, genislikler devre disi kaliyor.)
  const ifaceW = isPhone
    ? { port: '30%', vlan: '14%', vlanName: '18%', status: '16%', cap: '10%', cfg: '12%' }
    : { port: '20%', vlan: '12%', vlanName: '22%', status: '15%', cap: '10%', cfg: '15%' };
  const ifacePadL = isPhone ? 12 : 24;

  // Deger kopyalama (dokunmatikte title tooltip'i yok). Basari DOGRULANIR, yoksa hata toast'i.
  const copyValue = async (label, val) => {
    const ok = await copyToClipboard(val);
    showToast(ok ? `${label} copied` : 'Copy not supported here — use Download', ok ? 'success' : 'error');
  };

  // Dar govdedeki "..." sayfasinin icerigi. Masaustunde HIC uretilmez;
  // asagidaki masaustu aksiyon satiri bugunku haliyle BIREBIR korunur.
  const sheetActions = [];
  if (compact) {
    if (isOperator && (isAdmin || allowedCommands.length > 0)) {
      sheetActions.push({ key: 'ssh', icon: <span aria-hidden="true">💻</span>, label: 'SSH Terminal', onClick: () => openSshSession(id, displayHostname || details.name || id) });
    }
    if (details.ip) {
      sheetActions.push({ key: 'ping', icon: <PingIcon size={16} />, label: t('pingTool'), onClick: () => setShowPing(true) });
      sheetActions.push({ key: 'trace', icon: <TraceIcon size={16} />, label: t('traceTool'), onClick: () => setShowTrace(true) });
    }
    sheetActions.push({ key: 'focus', icon: <span aria-hidden="true">🔍</span>, label: t('focusTool'), onClick: () => navigate(`/topology/${details.topologyPage || 'main'}?zoom=${id}`) });
    if (isOperator) {
      // Yikici aksiyon: sayfada da KIRMIZI kalir ve ayni ConfirmModal akisindan gecer.
      sheetActions.push({ key: 'reload', icon: <ReloadIcon size={16} />, label: reloading ? t('reloadSending') : t('reloadDevice'), danger: true, disabled: reloading, onClick: () => setConfirmReload(true) });
    }
  }

  return (
    <div className="list-container">
      {compact ? (
        /* 7 ogeli masaustu satiri ~840px min-content ister; burada geri + ad + tek "..." */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, minWidth: 0 }}>
          <button onClick={() => navigate(backTo)} className="btn btn-ghost" aria-label={t('goBack')} title={t('goBack')}
            style={{ flexShrink: 0, minWidth: 44, minHeight: 44, padding: '0 10px', fontSize: '1.2rem', lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
          <h2 className="rw-truncate" style={{ margin: 0, fontSize: '1.15rem', flex: '1 1 auto', minWidth: 0 }}>{displayHostname}</h2>
          <button className="btn btn-primary" onClick={() => setShowActions(true)} aria-label="Device actions" title="Device actions"
            style={{ flexShrink: 0, minWidth: 44, minHeight: 44, padding: '0 10px', fontSize: '1.35rem', fontWeight: 700, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>⋯</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <button onClick={() => navigate(backTo)} className="btn btn-ghost">{t('goBack')}</button>
          <h2 style={{ margin: 0, fontSize: '1.8rem' }}>{displayHostname}</h2>
          {isOperator && (isAdmin || allowedCommands.length > 0) && (
            <button className="btn btn-primary btn-sm" onClick={() => openSshSession(id, displayHostname || details.name || id)}>
              💻 SSH Terminal
            </button>
          )}
          {details.ip && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowPing(true)}>
              <PingIcon size={16} /> {t('pingTool')}
            </button>
          )}
          {details.ip && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowTrace(true)}>
              <TraceIcon size={16} /> {t('traceTool')}
            </button>
          )}
          <button className="btn btn-primary btn-sm"
            onClick={() => navigate(`/topology/${details.topologyPage || 'main'}?zoom=${id}`)}
            title={t('focusTool')}>
            🔍 {t('focusTool')}
          </button>
          {isOperator && (
            <button className="btn btn-sm" onClick={() => setConfirmReload(true)} disabled={reloading}
              title={t('reloadDevice')}
              style={{ marginLeft: 'auto', background: 'var(--danger)', color: '#fff', border: 'none', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ReloadIcon size={15} /> {reloading ? t('reloadSending') : t('reloadDevice')}
            </button>
          )}
        </div>
      )}

      {/* SATIR 1: Bilgi kartı (daraltıldı, 2 sütun) + CPU + RAM (küçültülmüş) */}
      <div className="grid-detail-main" style={{ marginBottom: compact ? 16 : 24 }}>
        {/* minWidth:0 BURADA VERILMEZ: responsive.css <=1024px'te .chart-container'a zaten
            veriyor. Inline verilirse masaustunde de (>1024) etkili olur ve uzun bir uptime
            degeri kolonu genisletmek yerine kirpilmaya baslar -> masaustu degisir. */}
        <div className="chart-container" style={{ padding: compact ? '14px' : '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            {slaBadge && (
              <span className="status-badge" title="IP SLA" style={{ background: slaBadge.bg, color: slaBadge.color, border: `1px solid ${slaBadge.border}` }}>{slaBadge.label}</span>
            )}
            <span className={`status-badge ${details.status === 'UP' ? 'status-up' : 'status-down'}`}>{details.status}</span>
          </div>
          {/* 375px'te 2 kolon = 140px'lik hucre; IP ve uptime oraya sigmiyor -> telefon dikeyde tek kolon. */}
          <div className="grid-stats" style={{ gridTemplateColumns: phonePortrait ? '1fr' : 'repeat(2, 1fr)', gap: '14px 20px', marginBottom: details.sshPasswordSet !== undefined ? 16 : 0 }}>
            {[
              { label: 'Real Hostname', value: displayHostname, color: 'var(--primary)', copy: true },
              { label: 'IP Address', value: details.ip, mono: true, copy: true },
              { label: 'Vendor', value: details.detectedVendor || '-' },
              { label: 'Version', value: details.version || '-' },
              { label: 'System Uptime', value: details.uptime || '-' }
            ].map((item, i) => {
              const raw = String(item.value ?? '');
              // Dokunmatikte title tooltip'i YOK: kirpilan deger geri getirilemiyordu.
              // Cozum: dar govdede kirpma yerine sarma + kopyalanabilir alanlarda dokun-kopyala.
              const tappable = isTouch && item.copy && raw && raw !== '-';
              // Kirpma yerine SARMA: dar govdede VE her dokunmatik cihazda (tablet yatay
              // dahil - orada da title tooltip'i yok, kirpilan Vendor/Version/Uptime
              // geri getirilemiyor). Fare + genis ekranda eski nowrap/ellipsis aynen kalir.
              const wrapValue = compact || isTouch;
              return (
                // minWidth:0 SADECE <=1024px'te: masaustunde izgara hucresi eskisi gibi
                // icerigi kadar genisler (kirpma yerine kolon buyumesi) - davranis degismesin.
                <div key={i} style={isTablet ? { minWidth: 0 } : undefined}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</div>
                  <div
                    title={raw}
                    onClick={tappable ? () => copyValue(item.label, raw) : undefined}
                    style={{
                      fontSize: '1.05rem', fontWeight: 600, color: item.color,
                      fontFamily: item.mono ? 'monospace' : undefined,
                      ...(wrapValue
                        ? { whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }
                        : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                      ...(tappable ? { cursor: 'pointer', WebkitTapHighlightColor: 'rgba(59,130,246,0.18)' } : null),
                    }}>
                    {item.value}
                    {tappable && <span aria-hidden="true" style={{ marginLeft: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>⧉</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {details.sshPasswordSet !== undefined && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', borderTop: '1px solid var(--border-color)', paddingTop: 14 }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Topology Page</span>
                <div style={{ fontSize: '0.85rem', marginTop: 4, color: 'var(--text-main)' }}>
                  🗺️ {topoTabs.find(t => t.id === details.topologyPage)?.name || details.topologyPage || 'Main Topology'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SNMP Community</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', marginTop: 4, color: details.snmpCommunity ? 'var(--text-main)' : 'var(--danger)' }}>
                  {details.snmpCommunity || 'Not set  ✕'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SSH Username</span>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', marginTop: 4, color: details.sshUsername ? 'var(--text-main)' : 'var(--danger)' }}>
                  {details.sshUsername || 'Not set  ✕'}
                </div>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>SSH Password</span>
                <div style={{ fontSize: '0.85rem', marginTop: 4, color: details.sshPasswordSet ? 'var(--success)' : 'var(--danger)' }}>
                  {details.sshPasswordSet ? '••••••••  ✓' : 'Not set  ✕'}
                </div>
              </div>
              {details.model && (
                <div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Model</span>
                  <div style={{ fontSize: '0.85rem', marginTop: 4 }}>{details.model}</div>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Izgara tek kolona dustugunde iki gosterge alt alta ~280px yiyor; yan yana koy. */}
        {gaugesSideBySide ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minWidth: 0 }}>
            <Gauge value={details.cpu || 0} label="CPU Load" color={(details.cpu || 0) > 80 ? 'var(--danger)' : 'var(--primary)'} loading={!snmpLoaded} compact />
            <Gauge value={details.ram || 0} label="RAM Usage" color={(details.ram || 0) > 80 ? 'var(--danger)' : '#8b5cf6'} loading={!snmpLoaded} compact />
          </div>
        ) : (
          <>
            <Gauge value={details.cpu || 0} label="CPU Load" color={(details.cpu || 0) > 80 ? 'var(--danger)' : 'var(--primary)'} loading={!snmpLoaded} />
            <Gauge value={details.ram || 0} label="RAM Usage" color={(details.ram || 0) > 80 ? 'var(--danger)' : '#8b5cf6'} loading={!snmpLoaded} />
          </>
        )}
      </div>

      {/* SATIR 2: Ping + Config Backup + Running Config (eşit genişlik, ping ile aynı yükseklik) */}
      {isAdmin ? (
        compact ? (
          /* Dar govdede uc kart alt alta ~1200px'lik bir serit olusturuyordu.
             Ping grafigi acik kalir, iki yedek karti katlanir. */
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 12 }}><PingHistoryChart deviceId={id} /></div>
            <CollapsibleCard title={t('configBackup')}>
              <ConfigBackupCard deviceId={id} deviceName={displayHostname} />
            </CollapsibleCard>
            <CollapsibleCard title={t('importableBackup')}>
              <ImportableBackupCard deviceId={id} hostname={displayHostname} />
            </CollapsibleCard>
          </div>
        ) : (
          <div className="grid-detail-main" style={{ marginBottom: 24 }}>
            <PingHistoryChart deviceId={id} />
            <ConfigBackupCard deviceId={id} deviceName={displayHostname} />
            <ImportableBackupCard deviceId={id} hostname={displayHostname} />
          </div>
        )
      ) : (
        <div style={{ marginBottom: compact ? 16 : 24 }}>
          <PingHistoryChart deviceId={id} />
        </div>
      )}

      <div className="chart-container" style={{ padding: 0, overflow: 'hidden', marginTop: compact ? 12 : 24 }}>
        <div style={{ padding: compact ? '12px 14px' : '16px 24px', borderBottom: '1px solid var(--border-color)' }}>
          <h3 style={{ margin: 0, fontSize: compact ? '1rem' : '1.1rem', color: 'var(--primary)' }}>Physical Interfaces</h3>
        </div>
        {/* .rw-cards: <=600px'te thead gizlenir, her satir yigilmis bir karta doner.
            Kart modunun sarti her <td>'nin data-label tasimasidir.
            VLAN Name + Capacity telefonda .rw-hide-sm ile dusuyor (bkz. audit tableColumns). */}
        <table className="modern-table rw-cards" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: ifacePadL, width: ifaceW.port }}>Port</th>
              <th style={{ width: ifaceW.vlan }}>VLAN</th>
              <th className="rw-hide-sm" style={{ width: ifaceW.vlanName }}>VLAN Name</th>
              <th style={{ width: ifaceW.status }}>Status</th>
              <th className="rw-hide-sm" style={{ width: ifaceW.cap }}>Capacity</th>
              {isOperator && <th style={{ width: ifaceW.cfg, textAlign: 'center' }}>Config</th>}
            </tr>
          </thead>
          <tbody>
            {(details.interfaces || []).length > 0 ? details.interfaces.map(i => (
              <tr key={i.index}>
                <td data-label="Port" style={{ paddingLeft: ifacePadL }}><span style={{ fontWeight: 600 }}>{i.name}</span></td>
                <td data-label="VLAN">
                  {/* Tek sarmalayici: kart modunda <td> flex satiri oluyor, sarmalayici olmadan
                      rozet ile trunk listesi YAN YANA diziliyordu. Blok akisi masaustunde ayni. */}
                  <div>
                    <span style={{ background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4, fontSize: '0.85rem', fontFamily: 'monospace', color: i.vlan && i.vlan !== '-' ? 'var(--text-main)' : 'var(--text-muted)', minWidth: '30px', display: 'inline-block', textAlign: 'center' }}>
                      {i.vlan || '-'}
                    </span>
                    {/* clamp esigi <=1024px: 820x1180 tablette de VLAN kolonu ~95px ve
                        sabit maxWidth:200 komsu hucrenin uzerine tasiyor (audit: tablet). */}
                    {i.trunkVlans && i.trunkVlans.length > 0 && (
                      <TrunkVlanList vlans={i.trunkVlans} clamp={isTablet} />
                    )}
                  </div>
                </td>
                <td className="rw-hide-sm" data-label="VLAN Name" style={{ fontSize: '0.8rem', color: i.vlanName && i.vlanName !== '-' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                  {i.vlanName || '-'}
                </td>
                <td data-label="Status">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: i.status === 'up' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: i.status === 'up' ? 'var(--success)' : 'var(--text-muted)', border: `1px solid ${i.status === 'up' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
                    {i.status === 'up' ? '● UP' : '○ DOWN'}
                  </span>
                </td>
                <td className="rw-hide-sm" data-label="Capacity" style={{ fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--text-muted)' }}>{formatSpeed(i.speed)}</td>
                {/* Arayüz konfigi Operator+ yetkisi ister — Viewer (View Only) rolünde kolon hiç yok */}
                {isOperator && (
                  /* data-label="" -> kartta etiket basilmaz, buton saga yaslanir */
                  <td data-label="" style={{ textAlign: 'center' }}>
                    {/* VLAN (SVI) arayüzlerinde switchport ayarı yok → Config butonu gösterme.
                        SNMP adı "Vlan10" ya da kısaltmalı "Vl10" olabilir; fiziksel portlar Gi/Fa/Te ile başlar. */}
                    {!/^vl(?:an)?\s*\d+$/i.test((i.name || '').trim()) && (
                      <button className="btn btn-primary btn-sm" onClick={() => setConfigIface(i)}
                        style={{ fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...(compact ? { minHeight: 44 } : { fontSize: '0.78rem', padding: '5px 16px' }) }}>
                        <GearIcon size={14} /> Config
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )) : (
              <tr><td colSpan={isOperator ? 6 : 5} style={{ textAlign: 'center', justifyContent: 'center', padding: 30, color: 'var(--text-muted)' }}>
                {!snmpLoaded ? t('loadingSnmpData') : (details.status === 'UP' ? t('noPortsFound') : t('deviceDown'))}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showActions && compact && (
        <DeviceActionSheet actions={sheetActions} onClose={() => setShowActions(false)} />
      )}
      {showPing && details.ip && (
        <PingModal ip={details.ip} lockIp onClose={() => setShowPing(false)} />
      )}
      {showTrace && details.ip && (
        <TraceModal ip={details.ip} lockIp onClose={() => setShowTrace(false)} />
      )}
      {configIface && (
        <InterfaceConfigModal deviceId={id} iface={configIface} onClose={() => setConfigIface(null)} />
      )}
      {confirmReload && (
        <ConfirmModal
          title={t('reloadConfirmTitle')}
          message={t('reloadConfirmMsg').replace('{name}', displayHostname || details.name || id)}
          confirmLabel={t('reloadDevice')}
          onConfirm={doReload}
          onCancel={() => setConfirmReload(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODUL SEVIYESI yardimcilar ve bilesenler.
// DIKKAT: hicbiri DeviceDetailPage govdesinin ICINDE tanimlanmamali - orada
// tanimlanan bir bilesen her ust render'da yeniden mount olur (state kaybi).
// ---------------------------------------------------------------------------

// Panoya kopyala. LAN uzerinde uygulamaya cogunlukla duz http:// ile eriliyor,
// yani isSecureContext=false ve navigator.clipboard yok. Yedek yol icin metin
// GORUNUR (opacity:1) ve readOnly bir textarea'ya konur; iOS sifir-opakligi secmez.
// Donus degeri gercekten kopyalandi mi bilgisidir - cagiran buna gore toast basar.
async function copyToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* yedek yola dus */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.fontSize = '16px'; // iOS odakta sayfayi zoomlamasin
    document.body.appendChild(ta);
    const range = document.createRange();
    range.selectNodeContents(ta);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

// Dar govdede tum cihaz aksiyonlarini tasiyan alt sayfa (.rw-sheet iskeleti).
// Sadece compact iken render edilir, yani .rw-sheet kurallari her zaman aktiftir.
function DeviceActionSheet({ actions, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content rw-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="rw-sheet-head">
          <h3>Device Actions</h3>
          <button className="rw-sheet-close" onClick={onClose} aria-label="Close" title="Close">&times;</button>
        </div>
        <div className="rw-sheet-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions.map((a) => (
              <button
                key={a.key}
                className={a.danger ? 'btn' : 'btn btn-primary'}
                disabled={a.disabled}
                onClick={() => { onClose(); a.onClick(); }}
                style={{
                  width: '100%', minHeight: 48, fontSize: '0.95rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
                  // Reload Device sayfada da yikici gorunur ve digerlerinden ayrilir.
                  ...(a.danger
                    ? { background: 'var(--danger)', color: '#fff', border: 'none', fontWeight: 700, marginTop: 8 }
                    : null),
                }}>
                {a.icon}{a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Dar govdede yedek kartlarini katlar; <details> icerigi MOUNT halinde tuttugu
// icin kart kapaliyken de kendi verisini cekmis olur (acilista bekleme yok).
function CollapsibleCard({ title, children }) {
  return (
    <details style={{ marginBottom: 12 }}>
      <summary style={{
        // display:flex ayni zamanda webkit acilir ucgenini de kaldirir
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        listStyle: 'none', cursor: 'pointer', minHeight: 44, padding: '0 14px',
        background: 'var(--bg-card)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', color: 'var(--text-main)',
        fontSize: '0.95rem', fontWeight: 600, WebkitTapHighlightColor: 'rgba(59,130,246,0.18)',
      }}>
        <span className="rw-truncate">{title}</span>
        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0 }}>▾</span>
      </summary>
      <div style={{ marginTop: 10 }}>{children}</div>
    </details>
  );
}

// Trunk VLAN listesi tablonun en genis icerigi. Sabit maxWidth:200 dar kolonda
// komsu hucrenin uzerine tasiyordu; dar govdede 2 satira kirpip dokunmayla aciyoruz.
function TrunkVlanList({ vlans, clamp }) {
  const [open, setOpen] = useState(false);
  const text = vlans.join(', ');

  if (!clamp) {
    return (
      <div style={{ marginTop: 4, fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 200 }}>
        {text}
      </div>
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      title={text}
      style={{
        marginTop: 4, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: 1.5,
        maxWidth: '100%', overflowWrap: 'anywhere', cursor: 'pointer',
        WebkitTapHighlightColor: 'rgba(59,130,246,0.18)',
        ...(open ? null : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' }),
      }}>
      {text}
    </div>
  );
}

const DlIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const GearIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ReloadIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

// Importable Backup karti: cihazin GERCEK running-config'inden uretilen, yeni switch'e
// kopyala-yapistir provizyon konfigi. Backend LAN/IP/route'lari cihaza gore doldurur; kart duzenlenebilir.
function ImportableBackupCard({ deviceId, hostname }) {
  const { isAdmin, authFetch } = useAuth();
  const { isPhone, isTablet, isShort, isTouch } = useViewport();
  const compact = isPhone || isShort;
  const [text, setText] = useState('');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [copied, setCopied] = useState(false);
  // Dokunmatikte varsayilan salt-okunur: kaza ile duzenleme olmasin ve
  // her dokunusta yazilim klavyesi acilip viewport'u yariya dusurmesin.
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const res = await authFetch(`/switches/${deviceId}/importable-config`);
      if (res && res.ok) {
        const d = await res.json();
        setText(d.text || '');   // yedegi/erisimi olmayan cihazda '' -> kart bos gorunur
        setStatus('ready');
      } else { setStatus('error'); }
    } catch (e) { setStatus('error'); }
  }, [deviceId, authFetch]);

  useEffect(() => { load(); }, [load]);

  // "✓ Copied" yalnizca GERCEKTEN kopyalandiysa gosterilir; aksi halde
  // kullaniciya Download yolunu oneren bir hata toast'i cikar.
  const copy = async () => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      showToast('Copy not supported here — use Download', 'error');
    }
  };

  const download = () => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(hostname || 'switch').replace(/[^a-zA-Z0-9_.-]/g, '_')}-importable.cfg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Yalnizca admin (parent zaten admin blogunda render ediyor; savunma amacli tekrar).
  if (!isAdmin) return null;

  const busy = status === 'loading';
  // Sabit 400px telefon yatayda (375px) ekranin tamamindan buyuk.
  const cardHeight = isShort ? 'clamp(220px, 78vh, 340px)' : isPhone ? 'clamp(260px, 40vh, 400px)' : 400;
  const readOnly = isTouch && !editing;

  return (
    <div className="chart-container" style={{ height: cardHeight, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
      {/* flexWrap SADECE <=1024px'te: 1280px'lik bir masaustu penceresinde bu kart ~295px olur
          ve sarma acikken buton grubu ikinci satira duserdi -> masaustu yerlesimi degisirdi. */}
      <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, ...(isTablet ? { flexWrap: 'wrap' } : null) }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '1 1 auto' }}>{t('importableBackup')}</h3>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {/* Dokunmatikte inline 4px dolgu ve 0.7rem'i birak: responsive.css .btn-sm'i
              (pointer:coarse) altinda 44px'e cikariyor, minWidth:84 ise basligi eziyordu. */}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={busy} title={t('resetTemplate')} aria-label={t('resetTemplate')}
            style={{ fontSize: '0.85rem', lineHeight: 1, ...(isTouch ? null : { padding: '4px 8px' }) }}>↺</button>
          <button className="btn btn-ghost btn-sm" onClick={download} disabled={busy || !text} title={t('download')} aria-label={t('download')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...(isTouch ? null : { padding: '4px 8px' }) }}><DlIcon /></button>
          {isTouch && status === 'ready' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing((v) => !v)} aria-pressed={editing}
              style={{ whiteSpace: 'nowrap' }}>{editing ? 'Done' : 'Edit'}</button>
          )}
          <button className="btn btn-primary btn-sm" onClick={copy} disabled={busy || !text}
            style={{ whiteSpace: 'nowrap', ...(isTouch ? null : { fontSize: '0.7rem', padding: '4px 10px', minWidth: 84 }) }}>
            {copied ? `✓ ${t('copied')}` : t('copyConfig')}
          </button>
        </div>
      </div>
      {status === 'loading' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>…</div>
      ) : status === 'error' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t('loadFailed')}
          <button className="btn btn-ghost btn-sm" onClick={load}>{t('resetTemplate')}</button>
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          placeholder={t('noImportableConfig')}
          style={{
            flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', resize: 'none',
            border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-main)',
            fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.5, padding: '12px 16px',
            whiteSpace: 'pre', overflow: 'auto',
            ...(compact ? { overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } : null),
          }}
        />
      )}
    </div>
  );
}
