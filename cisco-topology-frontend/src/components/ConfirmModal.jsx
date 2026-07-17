import { t } from '../i18n';

// Tema uyumlu onay penceresi — window.confirm() yerine (tarayıcı pop-up'ı tema dışı kalıyordu).
// Enter = onayla, Escape / dışına tıklama = vazgeç.
export default function ConfirmModal({ title, message, confirmLabel, danger = true, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onConfirm(); }}>
      <div className="confirm-modal-content" onClick={e => e.stopPropagation()}>
        <h3 className="confirm-title">{title}</h3>
        <p className="confirm-desc">{message}</p>
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus>
            {confirmLabel || t('yesDelete')}
          </button>
        </div>
      </div>
    </div>
  );
}
