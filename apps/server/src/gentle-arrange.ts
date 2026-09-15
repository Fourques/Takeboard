type Rectangle = { id: string; x: number; y: number; width: number; height: number };
const gap = 48;
function overlaps(a: Rectangle, b: Rectangle) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Snap nearby axes only; never compress free space or re-layer the user's graph. */
function arrangePass(rectangles: Rectangle[]) {
  const placed: Rectangle[] = [];
  for (const item of [...rectangles].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  )) {
    const next = { ...item };
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "width" : "height";
      // A fixed 24 canvas units was imperceptible on media-sized cards.
      const tolerance = Math.min(96, Math.max(24, item[size] * 0.2));
      let nearest = tolerance + 1;
      for (const other of placed) {
        const cross = axis === "x" ? "y" : "x";
        const crossSize = axis === "x" ? "height" : "width";
        if (Math.abs(other[cross] - item[cross]) > 3 * Math.max(item[crossSize], other[crossSize]))
          continue;
        for (const factor of [0, 0.5, 1]) {
          const delta = other[axis] + other[size] * factor - (item[axis] + item[size] * factor);
          if (Math.abs(delta) < Math.abs(nearest)) nearest = delta;
        }
      }
      if (Math.abs(nearest) <= tolerance) next[axis] += nearest;
    }
    if (placed.some((other) => overlaps(next, other))) {
      const candidates = placed.flatMap((other) => [
        { ...next, x: other.x + other.width + gap },
        { ...next, x: other.x - next.width - gap },
        { ...next, y: other.y + other.height + gap },
        { ...next, y: other.y - next.height - gap },
      ]);
      const available = candidates.filter((candidate) =>
        placed.every((other) => !overlaps(candidate, other)),
      );
      available.sort(
        (a, b) => Math.hypot(a.x - item.x, a.y - item.y) - Math.hypot(b.x - item.x, b.y - item.y),
      );
      const closest = available[0];
      if (closest) {
        next.x = closest.x;
        next.y = closest.y;
      }
    }
    placed.push(next);
  }
  return placed;
}

export function gentlyArrange(rectangles: Rectangle[]) {
  let arranged = rectangles;
  // Resolve alignments exposed by collision moves within one undoable operation.
  for (let pass = 0; pass < 32; pass++) {
    const next = arrangePass(arranged);
    const previous = new Map(arranged.map((item) => [item.id, item]));
    if (
      next.every(
        (item) => item.x === previous.get(item.id)?.x && item.y === previous.get(item.id)?.y,
      )
    ) {
      arranged = next;
      break;
    }
    arranged = next;
  }
  return new Map(arranged.map((item) => [item.id, { x: item.x, y: item.y }]));
}
