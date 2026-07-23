// Ping ikonu: büyüteç + nabız (aktivite) çizgisi. Buton metin rengini (currentColor) devralır.
export default function PingIcon({ size = 18, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M6 11 h2 l1.3 -3 l1.5 6 l1.4 -4 l1.3 1 h2" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}
