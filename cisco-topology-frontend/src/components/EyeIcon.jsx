// Goz ikonu (goster/gizle). Once LoginPage icinde yerel bir fonksiyondu; cihaz
// detayindaki SNMP community maskesi de ayni ikonu istedigi icin buraya tasindi.
// Buton metin rengini (currentColor) devralir.
export default function EyeIcon({ off, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M1.8 12S5.5 5 12 5s10.2 7 10.2 7-3.7 7-10.2 7S1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />}
    </svg>
  );
}
