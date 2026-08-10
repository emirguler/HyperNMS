// Trace (traceroute) ikonu: iki uç düğüm + aralarında kesikli "izlenen yol".
// Buton metin rengini (currentColor) devralır.
export default function TraceIcon({ size = 18, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8 16 C 12 13, 12 11, 16 8" strokeDasharray="0.5 3" />
    </svg>
  );
}
