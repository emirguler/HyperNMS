// Ayarlar ikonu: yatay sürgüler (adjustments). Buton metin rengini (currentColor) devralır.
export default function SettingsIcon({ size = 18, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} aria-hidden="true">
      <line x1="4" y1="7" x2="14" y2="7" />
      <line x1="18" y1="7" x2="20" y2="7" />
      <circle cx="16" cy="7" r="2" />
      <line x1="4" y1="12" x2="6" y2="12" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <circle cx="8" cy="12" r="2" />
      <line x1="4" y1="17" x2="13" y2="17" />
      <line x1="17" y1="17" x2="20" y2="17" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}
