import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useApp } from '../context/AppContext';
import { useViewport } from '../hooks/useViewport';
import { severityColor } from '../components/NotificationBell';
import { t } from '../i18n';

// Telefonda bildirimler 190px'lik ic kaydirma kutusuna hapsedilmiyor; once bu
// kadari gosterilir, kalani "Show all" ile acilir (sayfa tek parca kayar).
const NOTIF_PREVIEW = 5;

// Dokunmatikte toLocaleString hem ~90px genislik yiyor hem 10.9px'e sikisiyordu.
// Masaustu yolu eski bicimi aynen kullanmaya devam eder.
function timeAgo(ts) {
  const ms = new Date(ts).getTime();
  if (!Number.isFinite(ms)) return '';
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// Sabit-px ic kaydirma kutulari (190/190/340) parmakla yonetilemiyor: kaydirma
// zincirlenir, sayfanin kendisi kimildamaz.
//   telefon    -> kutu tamamen kalkar, tek surekli sayfa kaydirmasi
//   kisa ekran -> dvh ile sinirlanir + zincirleme kesilir
//   masaustu   -> birebir eski deger
function innerScroll(px, dvh, isPhone, isShort) {
  if (isPhone) return { maxHeight: 'none', overflowY: 'visible' };
  if (isShort) return { maxHeight: `min(${px}px, ${dvh}dvh)`, overflowY: 'auto', overscrollBehavior: 'contain' };
  return { maxHeight: px, overflowY: 'auto' };
}

/* Kart kabugu: dolgu ICERIDE, baslik blogunda verilir. Dort kartin da ayni
   kalibi kullanmasi hizalanmalarinin tek sarti. */
const CARD_SHELL = { padding: 0, overflow: 'hidden' };

/**
 * Kart basligi — DORT kartta da AYNI geometri.
 *
 * Onceden uc ayri kalip vardi: (a) .chart-container'in 24px dolgusu + dogrudan
 * <h3>, (b) padding:0 + kendi dolgusu olan baslik blogu, (c) icinde <select>
 * olan bir flex satiri. (c)'de satir select'in yuksekligine gore buyuyup
 * align-items:center basligi asagi itiyordu; sonucta uc kartin basligi uc farkli
 * yukseklikte duruyor ve kartlar birbirine gore kaymis gorunuyordu.
 * minHeight sabit oldugu icin select'li ve select'siz baslik ayni yer kaplar,
 * boylece govdeler de ayni Y'de baslar.
 *
 * React 19: modul kapsaminda tanimli - bilesen govdesinde tanimlanirsa her
 * render'da remount eder.
 */
function CardHead({ title, right, pad, minH }) {
  return (
    <div style={{
      padding: pad, minHeight: minH, boxSizing: 'border-box',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap',
    }}>
      <h3 className="dash-section-title" style={{ margin: 0, textAlign: 'left' }}>{title}</h3>
      {right || null}
    </div>
  );
}

export default function DashboardPage() {
  const { rawDevices, topoTabs, notifications } = useApp();
  const navigate = useNavigate();
  // compact = responsive.css'teki "dar govde" sorgusu: (max-width:768px) VEYA (max-height:500px)
  const { isPhone, isTablet, isShort, isTouch, width } = useViewport();
  const compact = isPhone || isShort;
  // grid-dash-main'in TEK kolona dustugu hal. Iki yoldan olur:
  //   App.css @media (max-width:900px)                        -> telefon dikey
  //   responsive.css @media (max-height:500px) and (max-width:600px) -> dar VE kisa
  //     (or. yazilim klavyesi acikken 390x400)
  // Kisa ama GENIS ekranda (812x375) responsive.css kolonlari geri veriyor,
  // orada siralama yapilmaz - `order` cok kolonlu gridde sutun sirasini bozardi.
  const stackedGrid = isPhone && (!isShort || width <= 600);

  // DOWN cihazlar tablosu — topoloji sayfası + tip filtresi
  const [downPage, setDownPage] = useState('all');
  const [downType, setDownType] = useState('all');
  const [healthType, setHealthType] = useState('all'); // Network Health kartı cihaz-tipi filtresi
  const [showAllNotifs, setShowAllNotifs] = useState(false); // telefonda bildirim listesini aç

  const downDevices = useMemo(() => rawDevices.filter(d => d.status !== 'UP'), [rawDevices]);
  const downTypes = useMemo(() => [...new Set(downDevices.map(d => d.type || 'switch'))].sort(), [downDevices]);
  const filteredDown = useMemo(() => downDevices.filter(d =>
    (downPage === 'all' || (d.topologyPage || 'main') === downPage) &&
    (downType === 'all' || (d.type || 'switch') === downType)
  ), [downDevices, downPage, downType]);
  const pageName = (id) => topoTabs.find(tab => tab.id === (id || 'main'))?.name || (id || 'main');

  const stats = useMemo(() => {
    const upCount = rawDevices.filter(d => d.status === 'UP').length;
    const downCount = rawDevices.filter(d => d.status !== 'UP').length;
    const avgLatency = upCount > 0 ? Math.round(rawDevices.filter(d => d.status === 'UP' && d.latency > 0).reduce((s, d) => s + d.latency, 0) / (upCount || 1)) : 0;
    const healthPct = rawDevices.length > 0 ? Math.round((upCount / rawDevices.length) * 100) : 0;
    const typeGroups = {};
    rawDevices.forEach(d => { typeGroups[d.type || 'other'] = (typeGroups[d.type || 'other'] || 0) + 1; });
    return { upCount, downCount, avgLatency, healthPct, typeGroups };
  }, [rawDevices]);

  const COLORS = ['#22c55e', '#ef4444'];

  // Network Health — cihaz tipine göre filtrelenebilir (dropdown)
  const healthTypes = useMemo(() => [...new Set(rawDevices.map(d => d.type || 'switch'))].sort(), [rawDevices]);
  const healthStats = useMemo(() => {
    const devs = healthType === 'all' ? rawDevices : rawDevices.filter(d => (d.type || 'switch') === healthType);
    const up = devs.filter(d => d.status === 'UP').length;
    const down = devs.filter(d => d.status !== 'UP').length;
    return { up, down, pct: devs.length ? Math.round((up / devs.length) * 100) : 0, total: devs.length };
  }, [rawDevices, healthType]);
  const healthPie = [{ name: 'UP', value: healthStats.up }, { name: 'DOWN', value: healthStats.down }];

  // Filtre <select>'leri: dokunmatikte inline fontSize/padding KALKAR, boylece
  // responsive.css'in 16px + 44px tabani devreye girer (yoksa iOS odakta zoomlar)
  // ve select.modern-input'un 40px'lik ok payi geri gelir. Telefonda tam genislik.
  // Iki filtre de AYNI stil: farkli minWidth/fontSize/padding degerleri yuzunden
  // ayni "All Types" kutusu iki kartta iki ayri boyda gorunuyordu.
  const filterSelectStyle = isTouch
    ? (isPhone ? { width: '100%', minWidth: 0 } : { width: 'auto', minWidth: 150 })
    : { width: 'auto', minWidth: 130, fontSize: '0.75rem', padding: '6px 10px' };

  // Kart basliklari: 375px ekranda 48px'lik yatay dolgu israf.
  const cardHeadPad = isPhone ? '12px 14px' : '16px 24px';
  // Baslik yuksekligi TEK yerden. Ikinci terim, icindeki en yuksek kontrolden
  // (select) BILEREK buyuk: esit verilirse select'in yuksekligi kirilim noktasina
  // gore 28/29px oynadigi icin select'li kart 1px daha uzun kaliyor ve kartlar
  // yine kayiyordu. minHeight her zaman kazansin.
  const headMinH = (isPhone ? 24 : 32) + (isTouch ? 48 : 32);
  // Govde dolgusu: kabuk artik padding:0, dolgu iceride.
  const cardBodyPad = isPhone ? '12px 14px' : '16px 24px';
  // Tablo hucrelerindeki inline 24px, App.css'in <=768px 10px/8px kuralini eziyordu.
  const tdPadL = isPhone ? undefined : 24;
  const tdPadR = isPhone ? undefined : 24;

  const visibleNotifs = (isPhone && !showAllNotifs) ? notifications.slice(0, NOTIF_PREVIEW) : notifications;

  return (
    // Dar govdede kolon flex: kartlar arasi sira `order` ile degisir. Masaustunde
    // kap duz blok kalir, `order` yok sayilir -> masaustu duzeni birebir ayni.
    <div className="list-container" style={compact ? { display: 'flex', flexDirection: 'column', gap: 14 } : undefined}>
      {/* order 2: DOWN listesinden sonra, dekoratif kartlardan once */}
      <div className="grid-stats" style={compact ? { order: 2, flexShrink: 0 } : { marginBottom: 14 }}>
        {[
          { label: t('totalDevices'), value: rawDevices.length, color: undefined },
          { label: t('activeUp'), value: stats.upCount, color: 'var(--success)' },
          { label: t('inactiveDown'), value: stats.downCount, color: 'var(--danger)' },
          { label: t('avgLatency'), value: stats.avgLatency, color: 'var(--primary)', suffix: ' ms' }
        ].map((card, i) => (
          <div key={i} className="chart-container dash-stat-card">
            <h3 className="dash-stat-label">{card.label}</h3>
            <p className="dash-stat-value" style={card.color ? { color: card.color } : {}}>
              {card.value}{card.suffix && <span style={{ fontSize: '1rem', fontWeight: 400 }}>{card.suffix}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* order 3: dekoratif kartlar en sona */}
      <div className="grid-dash-main" style={compact ? { order: 3, flexShrink: 0 } : undefined}>
        {/* Network Health Pie — cihaz tipine göre filtrelenebilir */}
        {/* Tek kolona dusen gridde donut EN SONA gider (sadece dekoratif). */}
        <div className="chart-container" style={stackedGrid ? { ...CARD_SHELL, order: 3 } : CARD_SHELL}>
          <CardHead
            pad={cardHeadPad} minH={headMinH}
            title={t('networkHealth')}
            right={(
              <select className="modern-input" value={healthType} onChange={e => setHealthType(e.target.value)}
                aria-label={t('networkHealth')} style={filterSelectStyle}>
                <option value="all">{t('allTypes')}</option>
                {healthTypes.map(ty => <option key={ty} value={ty} style={{ textTransform: 'capitalize' }}>{ty}</option>)}
              </select>
            )}
          />
          {/* textAlign artik GOVDEDE: kabukta olunca baslik metnini de etkiliyordu */}
          <div style={{ padding: cardBodyPad, textAlign: 'center' }}>
          {/* Tablet ve altinda akiskan: 130px sabit donut, tek kolona dusen kartta
              kaybolacak kadar kucuk kaliyordu. Yaricaplar yuzde -> orani korur. */}
          <div style={isTablet
            ? { position: 'relative', width: '100%', maxWidth: 220, margin: '0 auto' }
            : { position: 'relative', display: 'inline-block' }}>
            <ResponsiveContainer width={isTablet ? '100%' : 130} height={isTablet ? undefined : 130} aspect={isTablet ? 1 : undefined}>
              <PieChart>
                <Pie data={healthPie} cx="50%" cy="50%"
                  innerRadius={isTablet ? '70%' : 42} outerRadius={isTablet ? '96%' : 58}
                  dataKey="value" strokeWidth={0}>
                  {healthPie.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: healthStats.pct >= 80 ? 'var(--success)' : healthStats.pct >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{healthStats.pct}%</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>● UP: {healthStats.up}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>● DOWN: {healthStats.down}</span>
          </div>
          </div>
        </div>

        {/* Device Types */}
        <div className="chart-container" style={stackedGrid ? { ...CARD_SHELL, order: 2 } : CARD_SHELL}>
          <CardHead pad={cardHeadPad} minH={headMinH} title={t('deviceTypes')} />
          <div style={{ padding: cardBodyPad, display: 'flex', flexDirection: 'column', gap: 10, ...innerScroll(190, 40, isPhone, isShort) }}>
            {Object.entries(stats.typeGroups).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>{type}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: 'var(--border-color)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(count / rawDevices.length) * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 20, textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notifications (zil ile aynı veri) */}
        <div className="chart-container" style={stackedGrid ? { ...CARD_SHELL, order: 1 } : CARD_SHELL}>
          <CardHead pad={cardHeadPad} minH={headMinH} title={<>🔔 {t('notifications')}</>} />
          <div style={innerScroll(190, 45, isPhone, isShort)}>
            {visibleNotifs.length > 0 ? visibleNotifs.map(n => (
              <div key={n.id}
                className={n.deviceId ? 'notif-clickable' : undefined}
                onClick={n.deviceId ? () => navigate(`/devices/${n.deviceId}`) : undefined}
                title={n.deviceId ? n.deviceName : undefined}
                style={{ padding: isTouch ? '12px 16px' : '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1rem', lineHeight: 1.2 }}>{n.severity === 'critical' ? '🔴' : '🟢'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: isTouch ? '0.875rem' : '0.82rem', fontWeight: 600, color: severityColor(n.severity) }}>{n.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                    {/* Cihaz adi masaustunde title= ile hover'da cikiyor; dokunmatikte
                        hover olmadigi icin gorunur metne cevriliyor (sadece orada). */}
                    {isTouch && n.deviceId && n.deviceName && (
                      <span className="rw-truncate" style={{ fontSize: '0.78rem', color: 'var(--text-main)', fontWeight: 500, maxWidth: '100%' }}>{n.deviceName}</span>
                    )}
                    {n.topologyPage && (
                      <span style={{ background: 'rgba(56,189,248,0.15)', color: 'var(--primary)', padding: '1px 6px', borderRadius: 10, fontSize: isTouch ? '0.75rem' : '0.65rem', fontWeight: 600 }}>🗺️ {n.topologyPage}</span>
                    )}
                    <span style={{ fontSize: isTouch ? '0.75rem' : '0.68rem', color: 'var(--text-muted)' }}>{isTouch ? timeAgo(n.timestamp) : new Date(n.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('noNotifications')}</div>
            )}
          </div>
          {isPhone && !showAllNotifs && notifications.length > NOTIF_PREVIEW && (
            <button type="button" className="btn btn-ghost" onClick={() => setShowAllNotifs(true)}
              style={{ width: '100%', borderRadius: 0, borderTop: '1px solid var(--border-color)' }}>
              Show all ({notifications.length})
            </button>
          )}
        </div>

      </div>

      {/* DOWN cihazlar — sayfa sekmeleri + tip filtresi */}
      {/* order 1: sayfanin TEK eyleme donuk karti, dar govdede en uste gelir. */}
      <div className="chart-container no-float"
        style={compact ? { padding: 0, overflow: 'hidden', order: 1, flexShrink: 0 } : { padding: 0, overflow: 'hidden', marginTop: 14 }}>
        <CardHead
          pad={cardHeadPad} minH={headMinH}
          title={<>🔴 {t('downDevices')} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({filteredDown.length})</span></>}
          right={(
            <select className="modern-input" value={downType} onChange={e => setDownType(e.target.value)}
              aria-label={t('downDevices')} style={filterSelectStyle}>
              <option value="all">{t('allTypes')}</option>
              {downTypes.map(ty => <option key={ty} value={ty} style={{ textTransform: 'capitalize' }}>{ty}</option>)}
            </select>
          )}
        />

        {/* Sayfa sekmeleri — dokunmatikte sarmak yerine tek satir yatay kaydirma:
            36px'lik kutuda sarilan satirlar erisilemez oluyordu. */}
        <div className="topology-tabs rw-scroll-x" style={{ padding: '0 12px', flexWrap: isTouch ? 'nowrap' : 'wrap' }}>
          <div className={`topology-tab ${downPage === 'all' ? 'active' : ''}`} role="button" tabIndex={0}
            onClick={() => setDownPage('all')}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDownPage('all'); } }}>{t('allPages')}</div>
          {topoTabs.map(tab => (
            <div key={tab.id} className={`topology-tab ${downPage === tab.id ? 'active' : ''}`} role="button" tabIndex={0}
              onClick={() => setDownPage(tab.id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDownPage(tab.id); } }}>{tab.name}</div>
          ))}
        </div>

        {/* rw-scroll-x: <=1024px'te yatay kaydirma kabi. Telefonda dikey kutu
            kalktigi icin (maxHeight:none) tabloyu karti asan tek eksen yatay kalir;
            responsive.css bu kalibi (.chart-container:has(> .rw-scroll-x > table.rw-cards))
            zaten taniyor ve kart modunda yatay kaydirmayi kapatiyor. */}
        <div className="rw-scroll-x" style={{ ...innerScroll(340, 55, isPhone, isShort), ...(isPhone ? { padding: '10px 12px' } : null) }}>
          {/* .rw-cards: <=600px'te satirlar yigin karta doner (yatay kaydirma biter).
              Kartta yalnizca Name + IP kalir; Status/Type/Page rw-hide-sm ile duser
              (kartin basligi zaten "DOWN devices"). */}
          <table className="modern-table rw-cards">
            <thead>
              <tr>
                <th className="rw-hide-sm" style={{ paddingLeft: tdPadL }}>Status</th>
                <th>Name</th>
                <th>IP</th>
                <th className="rw-hide-sm">Type</th>
                <th className="rw-hide-sm" style={{ paddingRight: tdPadR }}>Page</th>
              </tr>
            </thead>
            <tbody>
              {filteredDown.length > 0 ? filteredDown.map(d => (
                <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/devices/${d.id}`, { state: { from: '/dashboard' } })}>
                  <td className="rw-hide-sm" data-label="Status" style={{ paddingLeft: tdPadL }}><span className="status-badge status-down" style={{ fontSize: isTouch ? '0.75rem' : '0.7rem', padding: '3px 8px' }}>DOWN</span></td>
                  <td data-label="Name" style={{ fontWeight: 500, fontSize: '0.85rem' }}>{d.name}</td>
                  <td data-label="IP" style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.ip}</td>
                  <td className="rw-hide-sm" data-label="Type" style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>{d.type || 'switch'}</td>
                  <td className="rw-hide-sm" data-label="Page" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', paddingRight: tdPadR }}>{pageName(d.topologyPage)}</td>
                </tr>
              )) : (
                <tr><td colSpan={5} data-label="" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>{t('noDownDevices')}</div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
