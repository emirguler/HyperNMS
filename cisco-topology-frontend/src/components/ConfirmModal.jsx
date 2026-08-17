import { useRef } from 'react';
import { t } from '../i18n';
import { useViewport } from '../hooks/useViewport';

// Tema uyumlu onay penceresi — window.confirm() yerine (tarayıcı pop-up'ı tema dışı kalıyordu).
// Enter = onayla, Escape / dışına tıklama = vazgeç.
export default function ConfirmModal({ title, message, confirmLabel, danger = true, onConfirm, onCancel }) {
  const { isTouch } = useViewport();

  // Arka plana dokunarak kapatma: basma VE birakma ikisi de arka plana denk gelmeli.
  // Telefonda arka plan, sayfanin kaydirilmaya baslandigi her piksel demek; tek bir
  // onClick={onCancel} kaydirma jestini kazara "vazgec" olarak yorumluyordu.
  const downOnBackdrop = useRef(false);

  const handleBackdropDown = (e) => {
    downOnBackdrop.current = e.target === e.currentTarget;
  };
  const handleBackdropClick = (e) => {
    const onBackdrop = downOnBackdrop.current && e.target === e.currentTarget;
    downOnBackdrop.current = false;
    if (onBackdrop) onCancel();
  };

  return (
    <div className="modal-overlay"
      onPointerDown={handleBackdropDown}
      onClick={handleBackdropClick}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); if (e.key === 'Enter') onConfirm(); }}>
      {/* rw-sheet: <=768px veya <=500px yukseklikte alt sayfa olur; mesaj kayar, butonlar yapisik kalir. */}
      <div className="confirm-modal-content rw-sheet">
        <div className="rw-sheet-body">
          <h3 className="confirm-title">{title}</h3>
          <p className="confirm-desc">{message}</p>
        </div>
        <div className="confirm-actions rw-sheet-foot">
          <button className="btn btn-ghost" onClick={onCancel}>{t('cancel')}</button>
          {/* Dokunmatikte autoFocus, iOS'un sayfayi kaydirmasina yol aciyor; klavye
              kisayolu da olmadigi icin yalnizca fare/klavye cihazlarinda veriliyor. */}
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} autoFocus={!isTouch}>
            {confirmLabel || t('yesDelete')}
          </button>
        </div>
      </div>
    </div>
  );
}
