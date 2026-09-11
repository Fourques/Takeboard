type Rect = { x: number; y: number; width: number; height: number };

/** Prefer free space inside the current view; never move existing user content. */
export function canvasPlacement(view: Rect, occupied: Rect[], width: number, height: number) {
  const maxX = view.x + Math.max(0, view.width - width);
  const maxY = view.y + Math.max(0, view.height - height);
  const center = { x: (view.x + maxX) / 2, y: (view.y + maxY) / 2 };
  const candidates = [center];
  const step = Math.max(48, Math.max(view.width, view.height) / 24);
  for (let y = view.y; y <= maxY; y += step)
    for (let x = view.x; x <= maxX; x += step) candidates.push({ x, y });
  const overlap = (p: { x: number; y: number }) =>
    occupied.reduce(
      (total, r) =>
        total +
        Math.max(0, Math.min(p.x + width + 16, r.x + r.width) - Math.max(p.x - 16, r.x)) *
          Math.max(0, Math.min(p.y + height + 16, r.y + r.height) - Math.max(p.y - 16, r.y)),
      0,
    );
  return (
    candidates
      .map((p) => ({
        p,
        overlap: overlap(p),
        distance: Math.hypot(p.x - center.x, p.y - center.y),
      }))
      .sort((a, b) => a.overlap - b.overlap || a.distance - b.distance)[0]?.p ?? center
  );
}
