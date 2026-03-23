import { useEffect, useState, useCallback, useMemo } from 'react';
import ReactFlow, { Background, Controls, applyNodeChanges, addEdge, applyEdgeChanges, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import './App.css';
import TerminalPane from './TerminalPane';
import SwitchFormModal from './SwitchFormModal';
import UserFormModal from './UserFormModal';
import ToastContainer, { showToast } from './Toast';
import { t, getLang, setLang, onLangChange } from './i18n';
import { API_BASE } from './config';


// --- GAUGE (HIZ GÖSTERGESİ) BİLEŞENİ ---
const Gauge = ({ value, label, color }) => {
  const radius = 35;
  // Sadece yarım dairenin uzunluğunu hesaplayalım (Pi * r)
  const arcLength = Math.PI * radius; 
  
  // %0 dolulukta tüm yayı gizle, %100 de hiç gizleme (offset 0 olsun)
  const strokeDashoffset = arcLength * (1 - value / 100);

  return (
    <div className="chart-container" style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', position:'relative', padding:'10px'}}>
      <h4 style={{margin:'0 0 10px 0', color:'var(--text-muted)', fontSize:'0.9rem', textTransform:'uppercase'}}>{label}</h4>
      <svg width="120" height="80" viewBox="0 0 100 60" style={{overflow:'visible'}}>
        {/* Arka Plan Gri Yarım Daire */}
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="10" strokeLinecap="round" />
        
        {/* Doluluk Oranı (Renkli) */}
        <path 
          d="M 10 50 A 40 40 0 0 1 90 50" 
          fill="none" 
          stroke={color} 
          strokeWidth="10" 
          strokeLinecap="round"
          // DÜZELTME BURADA:
          // İlk değer çizgi uzunluğu (arcLength), ikinci değer boşluk (1000).
          // Boşluğu çok büyük veriyoruz ki çizgi asla tekrar edip sonda gözükmesin.
          strokeDasharray={`${arcLength} 1000`} 
          strokeDashoffset={strokeDashoffset}
          style={{transition: 'stroke-dashoffset 1s ease-out'}}
        />
        
        {/* İbre (Needle) */}
        <g style={{ transformOrigin: '50px 50px', transform: `rotate(${(value * 1.8) - 90}deg)`, transition: 'transform 1s ease-out' }}>
           <path d="M 50 50 L 50 15" stroke="#fff" strokeWidth="2" />
           <circle cx="50" cy="50" r="4" fill="#fff" />
        </g>
      </svg>
      <div style={{fontSize:'1.5rem', fontWeight:'bold', marginTop:'-10px', color:color}}>{value}%</div>
    </div>
  );
};


// --- CUSTOM NODE ---
const SwitchNode = ({ data }) => {
  const renderSwitchIcon = () => (
    <svg width="50" height="14" viewBox="0 0 50 14" style={{marginBottom:5, filter:'drop-shadow(0 0 4px var(--primary))'}}>
      <rect width="50" height="14" rx="2" fill="var(--bg-dark)" stroke="var(--primary)" strokeWidth="1.5" />
      <circle cx="8" cy="7" r="1.5" fill="var(--success)" />
      <circle cx="15" cy="7" r="1.5" fill="var(--success)" />
      <circle cx="22" cy="7" r="1.5" fill="var(--success)" />
      <circle cx="29" cy="7" r="1.5" fill="var(--success)" />
      <circle cx="36" cy="7" r="1.5" fill="var(--success)" />
      <rect x="42" y="4.5" width="5" height="5" rx="0.5" fill="#f59e0b" />
    </svg>
  );

  return (
    <div className={`topology-node ${data.status === 'UP' ? 'up' : 'down'}`}>
        <Handle type="target" position={Position.Top} style={{background:'var(--primary)', width:10, height:10}} />
        <div className="node-icon" style={{lineHeight:0}}>
             {data.type === 'switch' ? renderSwitchIcon() : 
              (data.type === 'router' ? '🌐' : 
               data.type === 'firewall' ? '🛡️' : 
               data.type === 'server' ? '🗄️' : 
               data.type === 'pc' ? '💻' :
               data.type === 'cloud' ? '☁️' : '❓')}
        </div>
        <div className="node-label">{data.label}</div>
        <div className="node-ip">{data.ip}</div>
        <Handle type="source" position={Position.Bottom} style={{background:'var(--primary)', width:10, height:10}} />
    </div>
  );
};
const nodeTypes = { switchNode: SwitchNode };

// --- LOGIN ---
function LoginPage({ onLogin, username, setUsername, password, setPassword, loginError, loginLoading }) {
  return (
    <div className="login-wrapper">
      <div className="login-orb"></div>
      <div className="login-card">
        <div className="login-header">
          <div style={{ fontSize: '4rem', marginBottom:'10px', filter:'drop-shadow(0 0 10px var(--primary))' }}>⚡</div>
          <h1 style={{margin: '10px 0', fontSize:'2rem', letterSpacing:'-1px'}}>NetPulse</h1>
          <p style={{color:'var(--text-muted)', fontSize:'0.9rem', letterSpacing:'1px', textTransform:'uppercase'}}>Keep the Pulse of Your Network</p>
        </div>
        <form onSubmit={onLogin} style={{textAlign:'left', marginTop:'2rem'}}>
          {loginError && (
            <div className="login-error">
              <span style={{marginRight:8}}>✕</span>{loginError}
            </div>
          )}
          <div style={{marginBottom:20}}>
            <label style={{display:'block', marginBottom:8, fontSize:'0.75rem', fontWeight:'600', color:'var(--text-muted)', letterSpacing:'1px'}}>{t('username')}</label>
            <input className="modern-input" placeholder="admin" value={username} onChange={e=>setUsername(e.target.value)} required autoComplete="username" />
          </div>
          <div style={{marginBottom:24}}>
            <label style={{display:'block', marginBottom:8, fontSize:'0.75rem', fontWeight:'600', color:'var(--text-muted)', letterSpacing:'1px'}}>{t('password')}</label>
            <input className="modern-input" type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <button className="btn btn-primary" style={{width:'100%', padding:'16px', fontSize:'1rem'}} disabled={loginLoading}>
            {loginLoading ? t('loggingIn') : t('login')}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- PING CHART ---
function PingHistoryChart({ deviceId, token }) {
    const [data, setData] = useState([]);
    const [range, setRange] = useState('1H');
    const ranges = { '1H': 3600000, '1D': 86400000, '1W': 604800000, '1M': 2592000000 };
    
    const fetchHistory = useCallback(async () => {
      try {
        const res = await fetch(`${API_BASE}/switches/${deviceId}/ping-history?duration=${ranges[range]}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
            const d = await res.json();
            setData(d.map(h => ({ time: new Date(h.timestamp).toLocaleTimeString(getLang() === 'tr' ? 'tr-TR' : 'en-US', {hour:'2-digit',minute:'2-digit'}), value: h.value === -1 ? 0 : h.value })));
        }
      } catch(e) {}
    }, [deviceId, token, range]);
  
    useEffect(() => { fetchHistory(); const i = setInterval(fetchHistory, 10000); return () => clearInterval(i); }, [fetchHistory]);
  

  useEffect(() => {
    const unsubscribe = onLangChange((newLang) => {
      setLangState(newLang);
    });
    return unsubscribe;
  }, []);
    return (
      <div className="chart-container" style={{height: 350}}>
         <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
            <h3 style={{margin:0, fontSize:'1.1rem', color:'var(--primary)'}}>Ping History (ms)</h3>
            <div style={{display:'flex', gap:8}}>
               {['1H', '1D', '1W', '1M'].map(r => (
                 <button key={r} onClick={()=>setRange(r)} className={`nav-btn ${range === r ? 'active' : ''}`} style={{fontSize: '0.75rem', padding: '6px 12px', border:'1px solid var(--border-color)'}}>{r}</button>
               ))}
            </div>
         </div>
         <ResponsiveContainer width="100%" height="80%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorPing" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-muted)" fontSize={11} unit="ms" tickLine={false} axisLine={false} />
              <RechartsTooltip contentStyle={{background:'var(--bg-panel)', border:'1px solid var(--primary)', borderRadius:'8px', color:'var(--text-main)', boxShadow:'0 10px 20px rgba(0,0,0,0.5)'}} />
              <Area type="monotone" dataKey="value" stroke="var(--primary)" fill="url(#colorPing)" strokeWidth={2} />
            </AreaChart>
         </ResponsiveContainer>
      </div>
    );
}


// --- DETAIL ---
function DeviceDetail({ deviceId, onBack, token }) {
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const f = async () => { 
            try { 
                const res = await fetch(`${API_BASE}/switches/${deviceId}/details`, { headers: { Authorization: `Bearer ${token}` } }); 
                if(res.ok) { setDetails(await res.json()); }
            } catch(e){} finally { setLoading(false); }
        };
        f(); const i = setInterval(f, 5000); return () => clearInterval(i);
    }, [deviceId, token]);

    if (loading && !details) return <div style={{padding:40, textAlign:'center', color:'var(--text-muted)'}}>{t('loadingDetails')}</div>;
    if (!details) return <div style={{padding:40, textAlign:'center', color:'var(--danger)'}}>{t('noData')}</div>;

    const displayHostname = details.snmpHostname || details.name || 'Unknown';
    const displayUptime = details.uptime || '-';
    const interfaces = details.interfaces || [];
    const cpuVal = details.cpu || 0;
    const ramVal = details.ram || 0;

    // YENİ: Akıllı Trafik Formatlayıcı (Otomatik Mbps / Gbps seçer)
    const formatTraffic = (bps) => {
        if (!bps || bps === 0) return '0 Mbps';
        
        const mbps = bps / 1000000; // Önce Mbps'e çevir
        
        if (mbps >= 1000) {
            // 1000 Mbps üzeriyse Gbps göster
            return (mbps / 1000).toFixed(2) + ' Gbps';
        } else {
            // Değilse Mbps göster
            return mbps.toFixed(2) + ' Mbps';
        }
    };

    const formatSpeed = (bps) => {
        if (!bps) return '-';
        // 10G kontrolü (Yaklaşık değerler)
        if (bps >= 10000000000) return '10 G'; // Tam 10G
        if (bps >= 1000000000) return (bps / 1000000000).toFixed(0) + ' G';
        return (bps / 1000000).toFixed(0) + ' M';
    };

    return (
        <div className="list-container">
            <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:24}}>
                <button onClick={onBack} className="btn btn-ghost">{t('goBack')}</button>
                <h2 style={{margin:0, fontSize:'1.8rem'}}>{displayHostname}</h2>
                <span className={`status-badge ${details.status==='UP'?'status-up':'status-down'}`} style={{marginLeft:'auto'}}>{details.status}</span>
            </div>

            <div className="chart-container" style={{marginBottom: 24, padding: '24px 32px'}}>
                <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:24, textAlign:'center'}}>
                    <div style={{borderRight:'1px solid var(--border-color)'}}>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:6, textTransform:'uppercase', letterSpacing:1}}>Real Hostname</div>
                        <div style={{fontSize:'1.2rem', fontWeight:600, color:'var(--primary)'}}>{displayHostname}</div>
                    </div>
                    <div style={{borderRight:'1px solid var(--border-color)'}}>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:6, textTransform:'uppercase', letterSpacing:1}}>IP Address</div>
                        <div style={{fontSize:'1.2rem', fontFamily:'monospace'}}>{details.ip}</div>
                    </div>
                    <div style={{borderRight:'1px solid var(--border-color)'}}>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:6, textTransform:'uppercase', letterSpacing:1}}>System Uptime</div>
                        <div style={{fontSize:'1.2rem'}}>{displayUptime}</div>
                    </div>
                    <div>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:6, textTransform:'uppercase', letterSpacing:1}}>Model</div>
                        <div style={{fontSize:'1.2rem', color:'var(--text-main)'}}>{details.model || '-'}</div>
                    </div>
                </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr', gap:24, marginBottom:24}}>
                <PingHistoryChart deviceId={deviceId} token={token} />
                <Gauge value={cpuVal} label="CPU Load" color={cpuVal > 80 ? 'var(--danger)' : 'var(--primary)'} />
                <Gauge value={ramVal} label="RAM Usage" color={ramVal > 80 ? 'var(--danger)' : '#8b5cf6'} />
            </div>
<div className="chart-container" style={{padding:0, overflow:'hidden'}}>
                <div style={{padding:'16px 24px', borderBottom:'1px solid var(--border-color)'}}>
                    <h3 style={{margin:0, fontSize:'1.1rem', color:'var(--primary)'}}>Physical Interfaces</h3>
                </div>
                <table className="modern-table">
                    <thead>
                        <tr>
                            <th style={{paddingLeft:24}}>Port</th>
                            <th>VLAN</th> {/* YENİ SÜTUN */}
                            <th>Status</th>
                            <th>Capacity</th>
                            <th>Traffic In</th>
                            <th>Traffic Out</th>
                        </tr>
                    </thead>
                    <tbody>
                        {interfaces.length > 0 ? interfaces.map(i => (
                            <tr key={i.index}>
                                <td style={{paddingLeft:24}}><span style={{fontWeight:600}}>{i.name}</span></td>
                                
                                {/* VLAN SÜTUNU (GÜNCELLENMİŞ) */}
                                <td>
                                    <span style={{
                                        background: 'rgba(255, 255, 255, 0.05)', 
                                        padding: '4px 8px', // Biraz daha genişlik verelim
                                        borderRadius: 4, 
                                        fontSize: '0.85rem',
                                        fontFamily: 'monospace',
                                        color: i.vlan && i.vlan !== '-' ? 'var(--text-main)' : 'var(--text-muted)', // Veri varsa parlak, yoksa sönük
                                        minWidth: '30px', // Kutu asla yok olmasın
                                        display: 'inline-block',
                                        textAlign: 'center'
                                    }}>
                                        {/* Eğer vlan verisi boşsa veya undefined ise '-' göster */}
                                        {i.vlan ? i.vlan : '-'}
                                    </span>
                                </td>

                                <td>
                                    <span style={{
                                        display:'inline-flex', alignItems:'center', gap:6,
                                        padding:'4px 10px', borderRadius:20, fontSize:'0.75rem', fontWeight:700,
                                        background: i.status==='up' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                                        color: i.status==='up' ? 'var(--success)' : 'var(--text-muted)',
                                        border: `1px solid ${i.status==='up' ? 'rgba(52, 211, 153, 0.2)' : 'rgba(248, 113, 113, 0.2)'}`
                                    }}>
                                        {i.status==='up' ? '● UP' : '○ DOWN'}
                                    </span>
                                </td>
                                
                                <td style={{fontFamily:'monospace', fontSize:'0.9rem', color:'var(--text-muted)'}}>
                                    {formatSpeed(i.speed)}
                                </td>
                                
                                <td style={{fontFamily:'monospace', fontSize:'0.95rem', color:'var(--primary)'}}>
                                    {/* Backend'den gelen 'bps' değerini formatlıyoruz */}
                                    {formatTraffic(i.trafficIn)}
                                </td>

                                <td style={{fontFamily:'monospace', fontSize:'0.95rem', color:'#8b5cf6'}}>
                                    {/* Backend'den gelen 'bps' değerini formatlıyoruz */}
                                    {formatTraffic(i.trafficOut)}
                                </td>
                            </tr>
                        )) : (
                            <tr><td colSpan="6" style={{textAlign:'center', padding:30, color:'var(--text-muted)'}}>
                                {details.status === 'UP' ? t('noPortsFound') : t('deviceDown')}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// --- APP ---
function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [activeView, setActiveView] = useState('dashboard');
  const [detailId, setDetailId] = useState(null);
  const [rawDevices, setRawDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [lang, setLangState] = useState(getLang());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });
  const [statusFilter, setStatusFilter] = useState('all');
  const [deleteUserTarget, setDeleteUserTarget] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('add');
  const [editingNode, setEditingNode] = useState(null);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [menu, setMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null); // Bağlantı sağ tık menüsü

  // --- YENİ EKLENEN STATE: Silme Onayı İçin ---
  const [deleteTarget, setDeleteTarget] = useState(null); // Silinecek cihaz objesi

  // SSH & Terminal
  const [sshSessions, setSshSessions] = useState([]); 
  const [activeSshTabId, setActiveSshTabId] = useState(null);
  const [terminalHeight, setTerminalHeight] = useState(350);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const unsubscribe = onLangChange((newLang) => {
      setLangState(newLang);
    });
    return unsubscribe;
  }, []);

  const toggleTheme = () => { setTheme(prev => prev === 'dark' ? 'light' : 'dark'); };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await fetch(`${API_BASE}/login`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
      const d = await res.json();
      if (res.ok) {
        setToken(d.token);
        localStorage.setItem('token', d.token);
        showToast(t('loginSuccess'), 'success');
      } else {
        setLoginError(d.error || t('loginFailed'));
      }
    } catch {
      setLoginError(t('serverUnavailable'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => { setToken(''); localStorage.removeItem('token'); };

  const fetchData = useCallback(async () => {
    if(!token) return;
    try {
      const res = await fetch(`${API_BASE}/topology`, { headers: { Authorization: `Bearer ${token}` } });
      // Token geçersiz veya süresi dolduysa otomatik logout
      if (res.status === 401 || res.status === 403) {
        setToken(''); localStorage.removeItem('token');
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setRawDevices(data.switches);
      
      setNodes((prevNodes) => {
          const serverIds = new Set(data.switches.map(s => s.id));
          // Önce backend'de olmayan node'ları temizle
          let newNodes = prevNodes.filter(n => serverIds.has(n.id));
          // Sonra güncelle veya ekle
          data.switches.forEach(s => {
              const index = newNodes.findIndex(n => n.id === s.id);
              if (index > -1) {
                  newNodes[index] = { ...newNodes[index], data: { label: s.name, ip: s.ip, status: s.status, type: s.type || 'switch' } };
              } else {
                  newNodes.push({
                      id: s.id, type: 'switchNode',
                      position: s.position || { x: 0, y: 0 },
                      data: { label: s.name, ip: s.ip, status: s.status, type: s.type || 'switch' }
                  });
              }
          });
          return newNodes;
      });
      
      setEdges(data.edges.map(e => {
          const sourceDevice = data.switches.find(s => s.id === e.source);
          const targetDevice = data.switches.find(s => s.id === e.target);
          
          // İki cihaz da UP ise bağlantı aktiftir
          const isLinkActive = sourceDevice?.status === 'UP' && targetDevice?.status === 'UP';

          return { 
              ...e, 
              // React Flow'un standart animasyonunu KAPATIYORUZ (Çünkü CSS ile yapacağız)
              animated: false, 
              // Eğer aktifse CSS sınıfımızı ekle, değilse sınıf yok
              className: isLinkActive ? 'bi-flow-edge' : '',
              style: { 
                  // Aktifse Yeşil, Pasifse Gri
                  stroke: isLinkActive ? 'var(--success)' : 'var(--text-muted)', 
                  strokeWidth: isLinkActive ? 3 : 2, // Aktifse biraz daha kalın olsun
                  opacity: isLinkActive ? 1 : 0.4
              } 
          };
      }));
      
      const resU = await fetch(`${API_BASE}/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (resU.ok) setUsers(await resU.json());
    } catch(e){}
  }, [token]);

  useEffect(() => { fetchData(); const i = setInterval(fetchData, 4000); return () => clearInterval(i); }, [fetchData]);

  const onNodeDragStop = useCallback((event, node) => {
      fetch(`${API_BASE}/switches/${node.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ position: node.position })
      }).catch(err => console.error('Pozisyon kaydedilemedi:', err));
  }, [token]);

  const onConnect = useCallback((params) => {
    setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } }, eds));
    const newEdge = { ...params, id: `e-${params.source}-${params.target}-${Date.now()}`, animated: true, style: { stroke: 'var(--text-muted)', strokeWidth: 2 } };
    fetch(`${API_BASE}/edges`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(newEdge) });
  }, [token]);

  // --- SİLME BUTONUNA BASINCA (Modalı Aç) ---
  const handleDeleteRequest = (device, e) => {
      e.stopPropagation();
      setDeleteTarget(device); // {t('delete')}inecek cihazı seç ve modalı aç
  };

  // --- SİLMEYİ ONAYLA (API Çağrısı) ---
  const confirmDelete = async () => {
      if (!deleteTarget) return;
      const res = await fetch(`${API_BASE}/switches/${deleteTarget.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        showToast(`"${deleteTarget.name}" ${t('deleted')}`, 'success');
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || t('deleteFailed'), 'error');
      }
      setDeleteTarget(null);
      fetchData();
  };

  // --- USER DELETE ---
  const confirmDeleteUser = async () => {
      if (!deleteUserTarget) return;
      const res = await fetch(`${API_BASE}/users/${deleteUserTarget.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        showToast(`"${deleteUserTarget.username}" ${t('deleted')}`, 'success');
      } else {
        const d = await res.json().catch(() => ({}));
        showToast(d.error || t('deleteFailed'), 'error');
      }
      setDeleteUserTarget(null);
      fetchData();
  };

  // --- FİLTRELENMİŞ VE SIRALANMIŞ CİHAZLAR ---
  const filteredDevices = useMemo(() => {
      let list = [...rawDevices];
      if (statusFilter !== 'all') list = list.filter(d => d.status === statusFilter);
      if (searchQuery) {
          const q = searchQuery.toLowerCase();
          list = list.filter(d => d.name?.toLowerCase().includes(q) || d.ip?.toLowerCase().includes(q) || d.type?.toLowerCase().includes(q));
      }
      list.sort((a, b) => {
          let valA = a[sortConfig.key] ?? '';
          let valB = b[sortConfig.key] ?? '';
          if (sortConfig.key === 'latency') { valA = Number(valA); valB = Number(valB); }
          else { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
          if (valA < valB) return sortConfig.dir === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.dir === 'asc' ? 1 : -1;
          return 0;
      });
      return list;
  }, [rawDevices, searchQuery, sortConfig, statusFilter]);

  const handleSort = (key) => {
      setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  };
  const sortIcon = (key) => sortConfig.key === key ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';

// --- BAĞLANTI SİLME (DEL TUŞU İLE) ---
  const onEdgesDelete = useCallback((edgesToDelete) => {
      edgesToDelete.forEach((edge) => {
          fetch(`${API_BASE}/edges/${edge.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` }
          });
      });
      // State'ten de hemen sil (Gecikme olmasın diye)
      setEdges((eds) => eds.filter((e) => !edgesToDelete.some((del) => del.id === e.id)));
  }, [token]);

  // --- BAĞLANTI SAĞ TIK MENÜSÜ ---
  const onEdgeContextMenu = useCallback((event, edge) => {
      event.preventDefault(); // Tarayıcı menüsünü engelle
      setEdgeMenu({
          id: edge.id,
          top: event.clientY,
          left: event.clientX
      });
      setMenu(null); // Node menüsü açıksa kapat
  }, []);

  // --- MENÜDEN SİLME ---
  const handleDeleteEdgeFromMenu = () => {
      if (!edgeMenu) return;
      fetch(`${API_BASE}/edges/${edgeMenu.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
      });
      setEdges((eds) => eds.filter((e) => e.id !== edgeMenu.id));
      setEdgeMenu(null);
  };

  // SSH Logic
  const openSshSession = (id, label) => {
      if (!sshSessions.find(s => s.id === id)) { setSshSessions(prev => [...prev, { id, name: label }]); }
      setActiveSshTabId(id); setMenu(null);
  };
  const closeSshSession = (e, id) => {
      e.stopPropagation();
      const newSessions = sshSessions.filter(s => s.id !== id);
      setSshSessions(newSessions);
      if (activeSshTabId === id) { setActiveSshTabId(newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null); }
  };
  const closeAllSessions = () => { setSshSessions([]); setActiveSshTabId(null); };

  // Terminal Resizing
  const startResizing = useCallback((mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      const onMouseMove = (mouseMoveEvent) => {
          const newHeight = window.innerHeight - mouseMoveEvent.clientY;
          if (newHeight > 100 && newHeight < window.innerHeight * 0.8) { setTerminalHeight(newHeight); }
      };
      const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.style.cursor = 'default';
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = 'row-resize';
  }, []);

  if (!token) return (<><ToastContainer /><LoginPage onLogin={handleLogin} username={username} setUsername={setUsername} password={password} setPassword={setPassword} loginError={loginError} loginLoading={loginLoading} /></>);

  return (
    <div className="app-container" onClick={() => { setMenu(null); setEdgeMenu(null); }}>
      <header className="nav-header" onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize: '1.8rem', filter:'drop-shadow(0 0 5px var(--primary))' }}>⚡</span>
          <div>
              <h3 style={{ margin: 0, lineHeight:1 }}>NetPulse</h3>
              <span style={{ fontSize: '0.7rem', color:'var(--text-muted)', letterSpacing:'1px' }}>Keep the Pulse of Your Network</span>
          </div>
          <nav className="nav-menu" style={{ marginLeft: 40 }}>
            <button className={`nav-btn ${activeView==='dashboard'?'active':''}`} onClick={()=>setActiveView('dashboard')}>Dashboard</button>
            <button className={`nav-btn ${activeView==='list'?'active':''}`} onClick={()=>setActiveView('list')}>{t('devices')}</button>
            <div className="dropdown">
                <button className={`nav-btn ${['topology','geomap'].includes(activeView)?'active':''}`}>{t('maps')} ▼</button>
                <div className="dropdown-content">
                    <a className="dropdown-item" onClick={()=>setActiveView('topology')}>🕸️ {t('topology')}</a>
                    <a className="dropdown-item" onClick={()=>setActiveView('geomap')}>🌍 {t('geographic')}</a>
                </div>
            </div>
            {(activeView === 'list' || activeView === 'topology') && (
              <button className="btn btn-primary btn-sm" style={{marginLeft: 15}} onClick={()=>{setEditingNode(null); setModalMode('add'); setIsModalOpen(true)}}>{t('addDevice')}</button>
            )}
          </nav>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
            <button className="nav-btn" onClick={toggleTheme} title={t('changeTheme')} style={{fontSize:'1.2rem'}}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            <button className="nav-btn" onClick={() => setLang(lang === 'en' ? 'tr' : 'en')} title={lang === 'en' ? 'Türkçe' : 'English'} style={{fontSize:'0.85rem', fontWeight:700, letterSpacing:'1px'}}>
              {lang === 'en' ? '🇹🇷 TR' : '🇬🇧 EN'}
            </button>
            <button className={`nav-btn ${activeView==='users'?'active':''}`} onClick={()=>setActiveView('users')}>👥 {t('users')}</button>
            <button className="btn btn-danger btn-sm" onClick={handleLogout}>{t('logout')}</button>
        </div>
      </header>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeView === 'dashboard' && (() => {
            const upCount = rawDevices.filter(d => d.status === 'UP').length;
            const downCount = rawDevices.filter(d => d.status !== 'UP').length;
            const avgLatency = upCount > 0 ? Math.round(rawDevices.filter(d => d.status === 'UP' && d.latency > 0).reduce((s, d) => s + d.latency, 0) / (upCount || 1)) : 0;
            const healthPct = rawDevices.length > 0 ? Math.round((upCount / rawDevices.length) * 100) : 0;
            const pieData = [{ name: 'UP', value: upCount }, { name: 'DOWN', value: downCount }];
            const COLORS = ['var(--success)', 'var(--danger)'];
            const typeGroups = {};
            rawDevices.forEach(d => { typeGroups[d.type || 'other'] = (typeGroups[d.type || 'other'] || 0) + 1; });

            return (
            <div className="list-container">
                {/* Stat kartları */}
                <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:20, marginBottom:24}}>
                    <div className="chart-container dash-stat-card">                        <h3 className="dash-stat-label">{t('totalDevices')}</h3>
                        <p className="dash-stat-value">{rawDevices.length}</p>
                    </div>
                    <div className="chart-container dash-stat-card">                        <h3 className="dash-stat-label">{t('activeUp')}</h3>
                        <p className="dash-stat-value" style={{color:'var(--success)'}}>{upCount}</p>
                    </div>
                    <div className="chart-container dash-stat-card">                        <h3 className="dash-stat-label">{t('inactiveDown')}</h3>
                        <p className="dash-stat-value" style={{color:'var(--danger)'}}>{downCount}</p>
                    </div>
                    <div className="chart-container dash-stat-card">                        <h3 className="dash-stat-label">{t('avgLatency')}</h3>
                        <p className="dash-stat-value" style={{color:'#a855f7'}}>{avgLatency}<span style={{fontSize:'1rem', fontWeight:400}}> ms</span></p>
                    </div>
                </div>

                {/* Alt grid: Pie chart + Cihaz tipleri + Son durum */}
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 2fr', gap:20}}>
                    {/* {t('networkHealth')} Pie */}
                    <div className="chart-container" style={{textAlign:'center'}}>
                        <h3 className="dash-section-title">{t('networkHealth')}</h3>
                        <div style={{position:'relative', display:'inline-block'}}>
                            <ResponsiveContainer width={160} height={160}>
                                <PieChart>
                                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} dataKey="value" strokeWidth={0}>
                                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center'}}>
                                <div style={{fontSize:'1.8rem', fontWeight:700, color: healthPct >= 80 ? 'var(--success)' : healthPct >= 50 ? 'var(--warning)' : 'var(--danger)'}}>{healthPct}%</div>
                            </div>
                        </div>
                        <div style={{display:'flex', justifyContent:'center', gap:20, marginTop:8}}>
                            <span style={{fontSize:'0.8rem', color:'var(--success)'}}>● UP: {upCount}</span>
                            <span style={{fontSize:'0.8rem', color:'var(--danger)'}}>● DOWN: {downCount}</span>
                        </div>
                    </div>

                    {/* {t('deviceTypes')} */}
                    <div className="chart-container">
                        <h3 className="dash-section-title">{t('deviceTypes')}</h3>
                        <div style={{display:'flex', flexDirection:'column', gap:12, marginTop:16}}>
                            {Object.entries(typeGroups).map(([type, count]) => (
                                <div key={type} style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                                    <span style={{fontSize:'0.85rem', textTransform:'capitalize'}}>{type}</span>
                                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                                        <div style={{width:80, height:6, background:'var(--border-color)', borderRadius:3, overflow:'hidden'}}>
                                            <div style={{width:`${(count/rawDevices.length)*100}%`, height:'100%', background:'var(--primary)', borderRadius:3}} />
                                        </div>
                                        <span style={{fontSize:'0.85rem', fontWeight:600, minWidth:20, textAlign:'right'}}>{count}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Son Durumlar Tablosu */}
                    <div className="chart-container" style={{padding:0, overflow:'hidden'}}>
                        <div style={{padding:'16px 24px', borderBottom:'1px solid var(--border-color)'}}>
                            <h3 className="dash-section-title" style={{margin:0}}>{t('deviceStatus')}</h3>
                        </div>
                        <div style={{maxHeight:260, overflowY:'auto'}}>
                            <table className="modern-table" style={{borderSpacing:0}}>
                                <tbody>
                                    {rawDevices.slice(0, 10).map(d => (
                                        <tr key={d.id} style={{cursor:'pointer'}} onClick={() => {setDetailId(d.id); setActiveView('details')}}>
                                            <td style={{padding:'10px 16px', width:80}}>
                                                <span className={`status-badge ${d.status==='UP'?'status-up':'status-down'}`} style={{fontSize:'0.7rem', padding:'3px 8px'}}>{d.status}</span>
                                            </td>
                                            <td style={{padding:'10px 0', fontWeight:500, fontSize:'0.85rem'}}>{d.name}</td>
                                            <td style={{padding:'10px 16px', fontFamily:'monospace', fontSize:'0.8rem', color:'var(--text-muted)'}}>{d.ip}</td>
                                            <td style={{padding:'10px 16px', fontSize:'0.8rem', color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)'}}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            );
        })()}

        {activeView === 'users' && (
            <div className="list-container">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                    <h2 style={{margin:0}}>{t('userManagement')}</h2>
                    <button className="btn btn-primary" onClick={()=>{setEditingUser(null); setIsUserModalOpen(true)}}>{t('newUser')}</button>
                </div>
                <div className="chart-container no-float" style={{padding:0, overflow:'hidden'}}>
                    <table className="modern-table">
                        <thead><tr><th style={{paddingLeft:24}}>{t('usernameCol')}</th><th>{t('role')}</th><th style={{textAlign:'right', paddingRight:24}}>{t('actions')}</th></tr></thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id}>
                                    <td style={{paddingLeft:24}}><span style={{fontWeight:600}}>{u.username}</span></td>
                                    <td>
                                        <span style={{
                                            background: u.role === 'Administrator' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                                            color: u.role === 'Administrator' ? '#a855f7' : 'var(--text-muted)',
                                            padding:'4px 10px', borderRadius:20, fontSize:'0.75rem', fontWeight:600,
                                            border: `1px solid ${u.role === 'Administrator' ? 'rgba(168,85,247,0.3)' : 'var(--border-color)'}`
                                        }}>{u.role}</span>
                                    </td>
                                    <td style={{textAlign:'right', paddingRight:24}}>
                                        <button className="btn btn-ghost btn-sm" style={{marginRight:6}} onClick={()=>{setEditingUser(u); setIsUserModalOpen(true)}}>{t('edit')}</button>
                                        <button className="btn btn-danger btn-sm" onClick={()=>setDeleteUserTarget(u)}>{t('delete')}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeView === 'list' && (
            <div className="list-container">
                {/* Arama + Filtre Bar */}
                <div style={{display:'flex', gap:12, marginBottom:20, alignItems:'center', flexWrap:'wrap'}}>
                    <div style={{position:'relative', flex:1, minWidth:200}}>
                        <input className="modern-input" placeholder={t('searchPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            style={{paddingLeft:40}} />
                        <span style={{position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontSize:'1rem', pointerEvents:'none'}}>🔍</span>
                    </div>
                    <div style={{display:'flex', gap:6}}>
                        {[{label: t('all'), value:'all'}, {label:'UP', value:'UP'}, {label:'DOWN', value:'DOWN'}].map(f => (
                            <button key={f.value} className={`nav-btn ${statusFilter === f.value ? 'active' : ''}`}
                                style={{fontSize:'0.8rem', padding:'8px 14px', border:'1px solid var(--border-color)'}}
                                onClick={() => setStatusFilter(f.value)}>{f.label}</button>
                        ))}
                    </div>
                    <span style={{color:'var(--text-muted)', fontSize:'0.8rem'}}>{filteredDevices.length} / {rawDevices.length} {t('deviceCount')}</span>
                </div>

                <div className="chart-container no-float" style={{padding:0, overflow:'hidden'}}>
                    <table className="modern-table">
                        <thead>
                            <tr>
                                <th style={{cursor:'pointer', userSelect:'none'}} onClick={() => handleSort('status')}>Status{sortIcon('status')}</th>
                                <th style={{cursor:'pointer', userSelect:'none'}} onClick={() => handleSort('name')}>Name{sortIcon('name')}</th>
                                <th style={{cursor:'pointer', userSelect:'none'}} onClick={() => handleSort('ip')}>IP Address{sortIcon('ip')}</th>
                                <th style={{cursor:'pointer', userSelect:'none'}} onClick={() => handleSort('type')}>Type{sortIcon('type')}</th>
                                <th style={{cursor:'pointer', userSelect:'none'}} onClick={() => handleSort('latency')}>Latency{sortIcon('latency')}</th>
                                <th style={{textAlign:'right', paddingRight:32}}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredDevices.length > 0 ? filteredDevices.map(d => (
                                <tr key={d.id} style={{cursor:'pointer'}} onClick={()=>{setDetailId(d.id); setActiveView('details')}}>
                                    <td><span className={`status-badge ${d.status==='UP'?'status-up':'status-down'}`}>{d.status}</span></td>
                                    <td style={{fontWeight:600}}>{d.name}</td>
                                    <td style={{fontFamily:'monospace', color:'var(--text-muted)'}}>{d.ip}</td>
                                    <td style={{textTransform:'capitalize'}}>{d.type}</td>
                                    <td style={{color: d.latency > 100 ? 'var(--danger)' : 'var(--text-muted)'}}>{d.latency > 0 ? d.latency + ' ms' : '-'}</td>
                                    <td style={{textAlign:'right'}}>
                                        <button className="btn btn-primary btn-sm" style={{marginRight:8}} onClick={(e)=>{
                                            e.stopPropagation();
                                            setEditingNode(d);
                                            setModalMode('edit');
                                            setIsModalOpen(true);
                                        }}>{t('edit')}</button>
                                        <button className="btn btn-danger btn-sm" onClick={(e)=>handleDeleteRequest(d, e)}>{t('delete')}</button>
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan="6" style={{textAlign:'center', padding:40, color:'var(--text-muted)'}}>
                                    {searchQuery || statusFilter !== 'all' ? t('noFilterResult') : t('noDevicesYet')}
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}

        {activeView === 'details' && detailId && <DeviceDetail deviceId={detailId} onBack={()=>setActiveView('list')} token={token} />}

        {activeView === 'geomap' && (
            <div className="list-container" style={{display:'flex', alignItems:'center', justifyContent:'center', height:'100%'}}>
                <div style={{textAlign:'center', color:'var(--text-muted)'}}>
                    <div style={{fontSize:'4rem', marginBottom:16, opacity:0.3}}>🌍</div>
                    <h2 style={{margin:'0 0 8px', color:'var(--text-main)'}}>{t('geoMap')}</h2>
                    <p style={{fontSize:'0.9rem'}}>{t('geoMapWip')}</p>
                </div>
            </div>
        )}

        {activeView === 'topology' && (
            <div style={{width:'100%', height:sshSessions.length > 0 ?'60%':'100%'}}>
                <ReactFlow 
                    nodes={nodes} 
                    edges={edges} 
                    nodeTypes={nodeTypes}
                    onNodesChange={n=>setNodes(applyNodeChanges(n,nodes))} 
                    onEdgesChange={e=>setEdges(applyEdgeChanges(e,edges))} 
                    onConnect={onConnect} 
                    
                    /* --- YENİ EKLENENLER --- */
                    onEdgesDelete={onEdgesDelete}       // Del tuşu ile silme
                    onEdgeContextMenu={onEdgeContextMenu} // Sağ tık menüsü açma
                    /* ----------------------- */

                    onNodeContextMenu={(e,n)=>{e.preventDefault(); setMenu({id:n.id, label:n.data.label, top:e.clientY, left:e.clientX, data:n.data}); setEdgeMenu(null);}} 
                    onNodeDragStop={onNodeDragStop} 
                    fitView 
                >
                    <Background color="var(--primary)" gap={25} size={1} style={{opacity:0.1}} /> 
                    <Controls style={{background:'var(--bg-panel)', border:'1px solid var(--border-color)', borderRadius:8}} />
                </ReactFlow>

                {/* Node Menüsü (Zaten vardı) */}
                {menu && <div className="context-menu" style={{top:menu.top, left:menu.left}}>
                    <div className="context-menu-item" onClick={()=>{setDetailId(menu.id); setActiveView('details')}}>📊 Details</div>
                    <div className="context-menu-item" onClick={()=>{setEditingNode(rawDevices.find(d=>d.id===menu.id)); setModalMode('edit'); setIsModalOpen(true)}}>✏️ Edit</div>
                    <div className="context-menu-item" onClick={()=>{ openSshSession(menu.id, menu.label); }}>💻 Terminal</div>
                </div>}

                {/* --- BAĞLANTI MENÜSÜ (YENİ) --- */}
                {edgeMenu && (
                    <div className="context-menu" style={{top:edgeMenu.top, left:edgeMenu.left}}>
                        <div className="context-menu-item" onClick={handleDeleteEdgeFromMenu} style={{color:'var(--danger)'}}>
                            🗑️ {t('deleteConnection')}
                        </div>
                    </div>
                )}
            </div>
        )}

        {/* --- MULTI-TAB TERMINAL PANELİ --- */}
        {sshSessions.length > 0 && (
            <div style={{height: terminalHeight, background:'#020617', borderTop:'1px solid var(--primary)', position:'absolute', bottom:0, width:'100%', zIndex:2000, boxShadow:'0 -10px 40px rgba(0,0,0,0.8)', display:'flex', flexDirection:'column'}}>
                <div onMouseDown={startResizing} style={{width:'100%', height:'6px', cursor:'row-resize', background:'transparent', position:'absolute', top:-3, zIndex:2001}} />
                <div style={{background:'#1e293b', display:'flex', alignItems:'center', borderBottom:'1px solid var(--border-color)', overflowX:'auto', height:40, flexShrink:0}}>
                    {sshSessions.map(session => (
                        <div key={session.id} onClick={() => setActiveSshTabId(session.id)} style={{padding:'0 16px', height:'100%', borderRight:'1px solid var(--border-color)', cursor:'pointer', background: activeSshTabId === session.id ? 'var(--primary)' : 'transparent', color: activeSshTabId === session.id ? '#0f172a' : 'var(--text-muted)', fontWeight: activeSshTabId === session.id ? '600' : '400', display:'flex', alignItems:'center', gap:8, minWidth:120, justifyContent:'space-between', transition:'all 0.2s'}}>
                            <span style={{fontSize:13}}>{session.name}</span>
                            <span onClick={(e) => closeSshSession(e, session.id)} style={{fontSize:'1.2rem', lineHeight:0.5, opacity:0.6, cursor:'pointer', fontWeight:700}}>&times;</span>
                        </div>
                    ))}
                    <div style={{marginLeft:'auto', padding:'0 15px'}}>
                         <button onClick={closeAllSessions} className="btn btn-ghost btn-sm" style={{color:'var(--danger)', fontSize:'0.75rem', padding:'4px 8px'}}>{t('closeAll')}</button>
                    </div>
                </div>
                <div style={{flex:1, position:'relative', overflow:'hidden', background:'#000'}}>
                    {sshSessions.map(session => (
                        <div key={session.id} style={{display: activeSshTabId === session.id ? 'block' : 'none', height:'100%', width:'100%'}}>
                            <TerminalPane switchId={session.id} />
                        </div>
                    ))}
                </div>
            </div>
        )}
      </main>


      {/* --- ONAY MODALI (YENİ EKLENDİ) --- */}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteDevice')}</h3>
            <p className="confirm-desc">
              {t('deleteDeviceConfirm')} <strong>{deleteTarget.name}</strong> ({deleteTarget.ip})? {t('deleteDeviceWarn')}
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={()=>setDeleteTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDelete}>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* User Delete Confirmation */}
      {deleteUserTarget && (
        <div className="modal-overlay">
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteUser')}</h3>
            <p className="confirm-desc">
              {t('deleteUserConfirm')} <strong>{deleteUserTarget.username}</strong> ({deleteUserTarget.role})?
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={()=>setDeleteUserTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDeleteUser}>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && <SwitchFormModal mode={modalMode} initialValues={editingNode} onCancel={()=>setIsModalOpen(false)} onSave={async (f)=>{
        const res = await fetch(`${API_BASE}/switches${modalMode==='edit'?'/'+editingNode.id:''}`, {method:modalMode==='edit'?'PUT':'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(f)});
        if (res.ok) { showToast(modalMode==='edit' ? t('deviceUpdated') : t('deviceAdded'), 'success'); }
        else { const d = await res.json().catch(()=>({})); showToast(d.error || t('operationFailed'), 'error'); }
        setIsModalOpen(false); fetchData();
      }} />}
      {isUserModalOpen && <UserFormModal mode={editingUser?'edit':'add'} initialValues={editingUser} onCancel={()=>setIsUserModalOpen(false)} onSave={async (f)=>{
        const res = await fetch(`${API_BASE}/users${editingUser?'/'+editingUser.id:''}`, {method:editingUser?'PUT':'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(f)});
        if (res.ok) { showToast(editingUser ? t('userUpdated') : t('userCreated'), 'success'); }
        else { const d = await res.json().catch(()=>({})); showToast(d.error || t('operationFailed'), 'error'); }
        setIsUserModalOpen(false); fetchData();
      }} />}
      <ToastContainer />
    </div>
  );
}

export default App;