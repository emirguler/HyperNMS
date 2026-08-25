// Hamburger / kapat ikonu. Daha once '☰' ve '✕' karakterleri kullaniliyordu;
// bunlarin cizgi kalinligi ve hizasi yazi tipine gore degisiyor ve kucuk
// ekranlarda soluk kaliyordu. SVG hem her yogunlukta net hem de cizgi
// kalinligi kontrol edilebilir.
export default function MenuIcon({ open = false, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      {open ? (
        <>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </>
      ) : (
        <>
          <line x1="3.5" y1="6.5" x2="20.5" y2="6.5" />
          <line x1="3.5" y1="12" x2="20.5" y2="12" />
          <line x1="3.5" y1="17.5" x2="20.5" y2="17.5" />
        </>
      )}
    </svg>
  );
}
