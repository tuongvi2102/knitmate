import { DMC_WITH_LAB } from '../../data/dmc';

// Build id → [r, g, b] lookup for fast grid rendering
export const DMC_MAP: Record<string, [number, number, number]> = {};
for (const c of DMC_WITH_LAB) {
  DMC_MAP[c.id] = [c.r, c.g, c.b];
}

export function getDMCName(id: string): string {
  return DMC_WITH_LAB.find(c => c.id === id)?.name ?? `DMC ${id}`;
}

export function renderGridToCanvas(
  gridData: string[][],
  canvas: HTMLCanvasElement,
  size = 160,
): string {
  const h = gridData.length;
  const w = gridData[0]?.length ?? 0;
  if (!w || !h) return '';
  const cell = Math.max(1, Math.floor(size / Math.max(w, h)));
  canvas.width = w * cell;
  canvas.height = h * cell;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = gridData[y][x];
      const rgb = DMC_MAP[id] ?? [200, 200, 200];
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return canvas.toDataURL();
}
