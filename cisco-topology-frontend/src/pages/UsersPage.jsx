import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import UserFormModal from '../UserFormModal';
import { showToast } from '../Toast';
import { t } from '../i18n';
import { API_BASE } from '../config';

export default function UsersPage() {
  const { users, fetchData } = useApp();
  const { token } = useAuth();
  const [editingUser, setEditingUser] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`${API_BASE}/users/${deleteTarget.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) showToast(`"${deleteTarget.username}" ${t('deleted')}`, 'success');
    else { const d = await res.json().catch(() => ({})); showToast(d.error || t('deleteFailed'), 'error'); }
    setDeleteTarget(null);
    fetchData();
  };

  return (
    <div className="list-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>{t('userManagement')}</h2>
        <button className="btn btn-primary" onClick={() => { setEditingUser(null); setIsModalOpen(true); }}>{t('newUser')}</button>
      </div>
      <div className="chart-container no-float" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="modern-table">
          <thead><tr><th style={{ paddingLeft: 24 }}>{t('usernameCol')}</th><th>{t('role')}</th><th style={{ textAlign: 'right', paddingRight: 24 }}>{t('actions')}</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ paddingLeft: 24 }}><span style={{ fontWeight: 600 }}>{u.username}</span></td>
                <td>
                  <span style={{ background: u.role === 'Administrator' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)', color: u.role === 'Administrator' ? '#a855f7' : 'var(--text-muted)', padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, border: `1px solid ${u.role === 'Administrator' ? 'rgba(168,85,247,0.3)' : 'var(--border-color)'}` }}>{u.role}</span>
                </td>
                <td style={{ textAlign: 'right', paddingRight: 24 }}>
                  <button className="btn btn-ghost btn-sm" style={{ marginRight: 6 }} onClick={() => { setEditingUser(u); setIsModalOpen(true); }}>{t('edit')}</button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(u)}>{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <div className="modal-overlay">
          <div className="confirm-modal-content">
            <h3 className="confirm-title">{t('deleteUser')}</h3>
            <p className="confirm-desc">{t('deleteUserConfirm')} <strong>{deleteTarget.username}</strong> ({deleteTarget.role})?</p>
            <div className="confirm-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>{t('cancel')}</button>
              <button className="btn btn-danger" onClick={confirmDelete}>{t('yesDelete')}</button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && <UserFormModal mode={editingUser ? 'edit' : 'add'} initialValues={editingUser} onCancel={() => setIsModalOpen(false)} onSave={async (f) => {
        const res = await fetch(`${API_BASE}/users${editingUser ? '/' + editingUser.id : ''}`, { method: editingUser ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(f) });
        if (res.ok) showToast(editingUser ? t('userUpdated') : t('userCreated'), 'success');
        else { const d = await res.json().catch(() => ({})); showToast(d.error || t('operationFailed'), 'error'); }
        setIsModalOpen(false);
        fetchData();
      }} />}
    </div>
  );
}
