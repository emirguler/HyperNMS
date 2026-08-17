import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useViewport } from '../hooks/useViewport';
import UserFormModal from '../UserFormModal';
import { showToast } from '../Toast';
import { t, roleLabel } from '../i18n';

// Rol rozeti renkleri — Administrator mor, Operator mavi, Viewer nötr
const ROLE_STYLE = {
  Administrator: { bg: 'rgba(168,85,247,0.15)', fg: '#a855f7', bd: 'rgba(168,85,247,0.3)' },
  Operator:      { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa', bd: 'rgba(59,130,246,0.3)' },
  Viewer:        { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-muted)', bd: 'var(--border-color)' },
};
const roleStyle = (role) => ROLE_STYLE[role === 'User' ? 'Operator' : role] || ROLE_STYLE.Viewer;

export default function UsersPage() {
  const { users, fetchUsers } = useApp();
  const { isAdmin, authFetch, username } = useAuth();
  // require2fa toggle'ini yalnizca yerlesik "admin" superkullanicisi yonetir
  const isSuperAdmin = username === 'admin';
  // Erken return'un USTUNDE cagrilmali, yoksa hook sirasi bozulur
  const { isPhone, isTouch } = useViewport();

  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  const [editingUser, setEditingUser] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  // "Active" durumunu canlı tutmak için periyodik tazeleme
  useEffect(() => {
    fetchUsers();
    const id = setInterval(fetchUsers, 15000);
    return () => clearInterval(id);
  }, [fetchUsers]);

  // "admin" bir yonetici hesabi icin 2FA'yi zorunlu kilar/kaldirir
  const toggleRequire2fa = async (u, on) => {
    const res = await authFetch(`/2fa/require/${u.id}`, { method: 'PUT', body: JSON.stringify({ require2fa: on }) });
    if (res && res.ok) {
      showToast(on ? `2FA now required for "${u.username}"` : `2FA no longer required for "${u.username}"`, 'success');
      fetchUsers();
    } else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || t('operationFailed'), 'error'); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await authFetch(`/users/${deleteTarget.id}`, { method: 'DELETE' });
    // authFetch 401'de null doner (iOS'ta arka plana atilan sekmede sik olur)
    if (res && res.ok) showToast(`"${deleteTarget.username}" ${t('deleted')}`, 'success');
    else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || t('deleteFailed'), 'error'); }
    setDeleteTarget(null);
    fetchUsers();
  };

  return (
    <div className="list-container">
      {/* Satir kaydirma + bosluk .rw-actions'tan gelir (<=1024px); inline yazilsa
          masaustunde de gecerli olurdu. */}
      <div className="rw-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>{t('userManagement')}</h2>
        <button className="btn btn-primary" onClick={() => { setEditingUser(null); setIsModalOpen(true); }}>{t('newUser')}</button>
      </div>
      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Yatay kaydirma kabin icinde: overflow:hidden yuzunden Actions kolonu kirpiliyordu */}
        <div className="rw-scroll-x">
        <table className="modern-table rw-cards">
          <thead><tr><th style={{ paddingLeft: isPhone ? undefined : 24 }}>{t('usernameCol')}</th><th>{t('role')}</th><th style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 24 }}>{t('actions')}</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td data-label="User" style={{ paddingLeft: isPhone ? undefined : 24 }}>
                  <span style={{ fontWeight: 600 }}>{u.username}</span>
                  {u.authType === 'ad' && (
                    // title= dokunmatikte hic tetiklenmez -> kisaltmayi acikca yaz.
                    // nowrap da isTouch'a bagli: masaustunde rozet "AD" oldugu icin etkisiz
                    // olurdu ama kural geregi kapsamsiz hicbir stil masaustune sizmamali.
                    <span title="Active Directory" style={{ marginLeft: 8, background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, border: '1px solid rgba(99,102,241,0.3)', verticalAlign: 'middle', whiteSpace: isTouch ? 'nowrap' : undefined }}>{isTouch ? 'AD Directory' : 'AD'}</span>
                  )}
                  {u.active && (
                    <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, border: '1px solid rgba(34,197,94,0.3)', verticalAlign: 'middle' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
                      {t('activeLabel')}
                    </span>
                  )}
                </td>
                <td data-label="Role">
                  <span style={{ background: roleStyle(u.role).bg, color: roleStyle(u.role).fg, padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, border: `1px solid ${roleStyle(u.role).bd}`, whiteSpace: 'nowrap' }}>{roleLabel(u.role)}</span>
                  {/* Ham SSH ciddi bir yetki artisi: listede gorunur olsun ki
                      kimde acik oldugu formu acmadan anlasilsin. */}
                  {/* 2FA rozeti: kimde acik oldugu listede gorunsun */}
                  {u.totpEnabled && (
                    <span title="Two-factor enabled" style={{ marginLeft: 6, background: 'rgba(34,197,94,0.15)', color: 'var(--success)', border: '1px solid rgba(34,197,94,0.35)', padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>2FA</span>
                  )}
                  {/* Zorunlu ama henuz kurmamis: kirmizi "2FA REQUIRED" — herkese gorunur ipucu */}
                  {u.require2fa && !u.totpEnabled && (
                    <span title="Two-factor required but not yet set up" style={{ marginLeft: 6, background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.35)', padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>2FA REQUIRED</span>
                  )}
                  {u.fullSsh && (
                    <span title="Full SSH access" style={{ marginLeft: 6, background: 'rgba(245,158,11,0.15)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.35)', padding: '3px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>FULL SSH</span>
                  )}
                </td>
                {/* Actions gizlenmiyor: satir tiklanabilir degil, tek etkilesim yolu bu */}
                <td data-label="" style={{ textAlign: 'right', paddingRight: isPhone ? undefined : 24 }}>
                  {/* "Require 2FA" toggle'i: yalnizca "admin" yonetir, yalnizca kendisi
                      DISINDAKI Administrator hesaplar icin. */}
                  {isSuperAdmin && u.role === 'Administrator' && u.username !== 'admin' && (
                    <label title="Require two-factor for this administrator"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: isTouch ? 12 : 10, verticalAlign: 'middle', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      <span style={{ whiteSpace: 'nowrap' }}>Require 2FA</span>
                      <span className="toggle-switch" style={{ verticalAlign: 'middle' }}>
                        <input type="checkbox" checked={u.require2fa === true} onChange={e => toggleRequire2fa(u, e.target.checked)} />
                        <span className="toggle-slider" />
                      </span>
                    </label>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ marginRight: isTouch ? 10 : 6 }} onClick={() => { setEditingUser(u); setIsModalOpen(true); }}>{t('edit')}</button>
                  {/* Kilitlenme kurtarmasi: telefonunu kaybeden kullanicinin 2FA'sini
                      ikinci bir admin sifirlayabilir. Islem denetim kaydina yazilir. */}
                  {u.totpEnabled && (
                    <button className="btn btn-ghost btn-sm" style={{ marginRight: isTouch ? 10 : 6 }}
                      title="Clear this user's two-factor setup"
                      onClick={() => setResetTarget(u)}>Reset 2FA</button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(u)}>{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {resetTarget && (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Escape') setResetTarget(null); }}>
          <div className="confirm-modal-content">
            <h3 className="confirm-title">Reset two-factor</h3>
            <p className="confirm-desc">
              Clear the two-factor setup for <strong>{resetTarget.username}</strong>?
              They will sign in with only their password until they enrol again.
            </p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setResetTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={async () => {
                const res = await authFetch(`/2fa/reset/${resetTarget.id}`, { method: 'POST' });
                if (res && res.ok) showToast(`Two-factor cleared for "${resetTarget.username}"`, 'success');
                else { const dd = res ? await res.json().catch(() => ({})) : {}; showToast(dd.error || t('operationFailed'), 'error'); }
                setResetTarget(null);
                fetchUsers();
              }}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onKeyDown={e => { if (e.key === 'Enter') confirmDelete(); if (e.key === 'Escape') setDeleteTarget(null); }}>
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteUser')}</h3>
            <p className="confirm-desc">{t('deleteUserConfirm')} <strong>{deleteTarget.username}</strong> ({roleLabel(deleteTarget.role)})?</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDelete} autoFocus>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && <UserFormModal mode={editingUser ? 'edit' : 'add'} initialValues={editingUser} onCancel={() => setIsModalOpen(false)} onSave={async (f) => {
        const res = await authFetch(`/users${editingUser ? '/' + editingUser.id : ''}`, { method: editingUser ? 'PUT' : 'POST', body: JSON.stringify(f) });
        if (res && res.ok) showToast(editingUser ? t('userUpdated') : t('userCreated'), 'success');
        else { const d = res ? await res.json().catch(() => ({})) : {}; showToast(d.error || t('operationFailed'), 'error'); }
        setIsModalOpen(false);
        fetchUsers();
      }} />}
    </div>
  );
}
