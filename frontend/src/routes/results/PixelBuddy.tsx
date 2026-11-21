/**
 * "Bitsy", our own pixel character: a tiny building with window eyes, a small smile and two walking legs.
 * Drawn on a 16 x 14 grid with plain SVG rectangles; the motion is CSS (see .buddy-* in styles.css).
 */
export default function PixelBuddy({ className }: { className?: string }) {
  const px = (x: number, y: number, w = 1, h = 1) => <rect x={x} y={y} width={w} height={h} />;
  return (
    <svg viewBox="0 0 16 14" shapeRendering="crispEdges" className={className} role="img" aria-label="Bitsy, a small walking building, smiling">
      <g className="buddy-body" fill="var(--primary)">
        {/* antenna on the roof */}
        {px(7, 0, 2, 1)}
        {/* the building: walls, with little arms at the sides */}
        {px(3, 1, 10, 9)}
        {px(1, 5, 2, 2)}
        {px(13, 5, 2, 2)}
        {/* window eyes and a smile, cut out in ink */}
        <g fill="var(--foreground)">
          <g className="buddy-eyes">
            {px(5, 4, 2, 2)}
            {px(9, 4, 2, 2)}
          </g>
          {px(6, 7)}
          {px(7, 8, 2, 1)}
          {px(9, 7)}
        </g>
      </g>
      {/* legs take turns, so it walks in place */}
      <g fill="var(--primary)">
        <g className="buddy-leg-a">{px(4, 10, 1, 3)}{px(6, 10, 1, 3)}</g>
        <g className="buddy-leg-b">{px(9, 10, 1, 3)}{px(11, 10, 1, 3)}</g>
      </g>
    </svg>
  );
}
