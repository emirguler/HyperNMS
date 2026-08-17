import { BaseEdge, getBezierPath } from 'reactflow';
import { useViewport } from '../hooks/useViewport';

// Hareket azaltma tercihi: modul seviyesinde TEK MediaQueryList (edge basina degil).
// Surekli donen comet animasyonu telefon GPU'sunda pil ve akicilik maliyeti.
const reduceMotionMql =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

// Kablolu bağlantı: düz kablo + aktifken üzerinde kablo boyunca kayan kısa
// parlak "ışık" segmenti (comet). stroke-dashoffset animasyonu — filter yok, akıcı.
export default function CableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style = {}, markerEnd, data
}) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition
  });

  const { isTouch } = useViewport();
  const active = data?.active;
  // Dokunmatikte hareketi azalt tercihi varsa comet'i hiç çizme (CSS'e gerek kalmadan)
  const showComet = active && !(isTouch && reduceMotionMql && reduceMotionMql.matches);

  return (
    <>
      {/* interactionWidth: görünmez tıklama şeridi. Varsayılan 20 canvas px, zoom 0.5'te
          ~10 gerçek px — parmakla bir kabloyu seçmek/silmek imkânsızdı. Görsel maliyeti yok. */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        interactionWidth={isTouch ? 44 : 20}
      />
      {showComet && (
        <path
          d={edgePath}
          className="cable-comet"
          fill="none"
          stroke="#fde047"
          strokeWidth={2.2}
        />
      )}
    </>
  );
}
