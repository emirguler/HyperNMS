import { BaseEdge, getBezierPath } from 'reactflow';

// Kablolu bağlantı: düz kablo + aktifken üzerinde kablo boyunca kayan kısa
// parlak "ışık" segmenti (comet). stroke-dashoffset animasyonu — filter yok, akıcı.
export default function CableEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style = {}, markerEnd, data
}) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition
  });

  const active = data?.active;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {active && (
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
