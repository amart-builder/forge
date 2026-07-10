type CurrentPoint = {
  x: number;
  y: number;
};

type Tributary = {
  id: string;
  side: 'left' | 'right';
  y: number;
};

type CurrentCanvasProps = {
  height: number;
  points: CurrentPoint[];
  tributaries: Tributary[];
  focusPoint: CurrentPoint;
  completing: boolean;
  ambientPaused: boolean;
};

function smoothPath(points: CurrentPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const middleY = (previous.y + point.y) / 2;
    return `${path} C ${previous.x} ${middleY}, ${point.x} ${middleY}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function tributaryPath(tributary: Tributary): string {
  const riverX = 500;
  if (tributary.side === 'left') {
    return `M 44 ${tributary.y - 54} C 176 ${tributary.y - 50}, 288 ${tributary.y + 10}, ${riverX - 26} ${tributary.y}`;
  }
  return `M 956 ${tributary.y - 54} C 824 ${tributary.y - 50}, 712 ${tributary.y + 10}, ${riverX + 26} ${tributary.y}`;
}

export default function CurrentCanvas({
  height,
  points,
  tributaries,
  focusPoint,
  completing,
  ambientPaused,
}: CurrentCanvasProps) {
  const path = smoothPath(points);

  return (
    <svg
      className="current-canvas"
      viewBox={`0 0 1000 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="current-line" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--current-line-warm)" />
          <stop offset="0.42" stopColor="var(--current-line-core)" />
          <stop offset="1" stopColor="var(--current-line-cool)" />
        </linearGradient>
        <filter id="current-glow" x="-40%" y="-10%" width="180%" height="120%">
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>

      <path className="current-path-glow" d={path} filter="url(#current-glow)" />
      <path className="current-path-water" d={path} />
      <path className="current-path-core" d={path} />
      {!ambientPaused && (
        <>
          <circle className="current-glint current-glint-one" r="3.2">
            <animateMotion path={path} dur="21s" repeatCount="indefinite" />
          </circle>
          <circle className="current-glint current-glint-two" r="2.2">
            <animateMotion path={path} dur="33s" begin="-11s" repeatCount="indefinite" />
          </circle>
        </>
      )}

      <path
        className="current-jarvis-path"
        d={`M 790 18 C 900 92, 864 248, 754 332 C 692 380, 676 456, 704 520 C 748 ${Math.round(height * 0.62)}, 672 ${Math.round(height * 0.8)}, 720 ${height}`}
      />

      {tributaries.map((tributary) => (
        <path
          key={tributary.id}
          className="current-tributary-path"
          d={tributaryPath(tributary)}
        />
      ))}

      {completing && (
        <circle
          className="current-completion-ripple"
          cx={focusPoint.x}
          cy={focusPoint.y}
          r="18"
        />
      )}
    </svg>
  );
}

export type { CurrentPoint, Tributary };
