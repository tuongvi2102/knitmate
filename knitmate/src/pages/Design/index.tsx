import { useRef, useState, useEffect } from 'react';
import { DMC } from '../../data/dmc';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/ui/Toast';

type Tool = 'pencil' | 'fill' | 'eraser' | 'eyedropper';
type StitchRatio = 'square' | 'knit';

interface LegendItem {
  color: string;
  label: string;
  count: number;
  skeins: number;
}

const colorToLabelCache = new Map<string, string>();

function colorToLabel(colorStr: string): string {
  if (colorToLabelCache.has(colorStr)) return colorToLabelCache.get(colorStr)!;
  const m = colorStr.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!m) return colorStr;
  const [, r, g, b] = m.map(Number);
  let best = DMC[0], bestDist = Infinity;
  for (const d of DMC) {
    const dist = Math.sqrt((r - d[2]) ** 2 + (g - d[3]) ** 2 + (b - d[4]) ** 2);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  const label = `DMC ${best[0]} · ${best[1]}`;
  colorToLabelCache.set(colorStr, label);
  return label;
}

function getToolCursor(tool: Tool): string {
  if (tool === 'pencil') return "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23000'/%3E%3C/svg%3E\") 0 24, crosshair";
  if (tool === 'eraser') return 'cell';
  return 'crosshair';
}

export default function Design() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // All mutable canvas state in a single ref (avoids stale closures in event handlers)
  const s = useRef({
    gW: 40, gH: 40,
    cellW: 14, cellH: 14,
    grid: new Array(40 * 40).fill(null) as (string | null)[],
    showGrid: true,
    currentTool: 'pencil' as Tool,
    currentDMC: DMC.find(d => d[0] === '310') || DMC[0],
    isCustomColor: false,
    customColorRGB: null as [number, number, number] | null,
    isDrawing: false,
    lastCell: null as { x: number; y: number } | null,
    undoStack: [] as (string | null)[][],
    redoStack: [] as (string | null)[][],
    pendingSnapshot: null as (string | null)[] | null,
    zoom: 100,
  });

  // React state — only for JSX rendering
  const [tool, setToolState] = useState<Tool>('pencil');
  const [showGridState, setShowGridState] = useState(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [colorLabel, setColorLabel] = useState('DMC 310 · Black');
  const [colorBg, setColorBg] = useState('rgb(0,0,0)');
  const [legendItems, setLegendItems] = useState<LegendItem[]>([]);
  const [statusCursor, setStatusCursor] = useState('—');
  const [statusColors, setStatusColors] = useState(0);
  const [dmcSearch, setDmcSearch] = useState('');
  const [canvasW, setCanvasW] = useState(40);
  const [canvasH, setCanvasH] = useState(40);
  const [stitchRatio, setStitchRatio] = useState<StitchRatio>('square');
  const [showClearModal, setShowClearModal] = useState(false);
  const [customColorHex, setCustomColorHex] = useState('#C49270');

  const { message: toastMsg, visible: toastVisible, showToast } = useToast();

  // ── Drawing helpers ──────────────────────────────────────────────────────────

  function getCtx() { return canvasRef.current?.getContext('2d') ?? null; }

  function drawGridLines(ctx: CanvasRenderingContext2D) {
    const { gW, gH, cellW, cellH } = s.current;
    for (let x = 0; x <= gW; x++) {
      ctx.beginPath();
      if (x % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; }
      else { ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5; }
      ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, gH * cellH); ctx.stroke();
    }
    for (let y = 0; y <= gH; y++) {
      ctx.beginPath();
      if (y % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1; }
      else { ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5; }
      ctx.moveTo(0, y * cellH); ctx.lineTo(gW * cellW, y * cellH); ctx.stroke();
    }
  }

  function redrawAll() {
    const ctx = getCtx();
    if (!ctx) return;
    const { gW, gH, cellW, cellH, grid, showGrid: sg } = s.current;
    ctx.clearRect(0, 0, gW * cellW, gH * cellH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, gW * cellW, gH * cellH);
    for (let y = 0; y < gH; y++) {
      for (let x = 0; x < gW; x++) {
        const color = grid[y * gW + x];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        }
      }
    }
    if (sg) drawGridLines(ctx);
  }

  function getCellAt(e: MouseEvent | Touch) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { gW, gH, cellW, cellH, zoom: z } = s.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e as MouseEvent).clientX - rect.left) / (z / 100) / cellW);
    const y = Math.floor(((e as MouseEvent).clientY - rect.top) / (z / 100) / cellH);
    if (x < 0 || x >= gW || y < 0 || y >= gH) return null;
    return { x, y };
  }

  function getDrawColor(): string | null {
    const { currentTool, isCustomColor, customColorRGB, currentDMC } = s.current;
    if (currentTool === 'eraser') return null;
    if (isCustomColor && customColorRGB) return `rgb(${customColorRGB[0]},${customColorRGB[1]},${customColorRGB[2]})`;
    if (currentDMC) return `rgb(${currentDMC[2]},${currentDMC[3]},${currentDMC[4]})`;
    return null;
  }

  function paintCell(x: number, y: number) {
    const ctx = getCtx();
    if (!ctx) return;
    const { gW, cellW, cellH, grid, showGrid: sg } = s.current;
    const newColor = getDrawColor();
    const idx = y * gW + x;
    if (grid[idx] === newColor) return;
    grid[idx] = newColor;
    ctx.clearRect(x * cellW, y * cellH, cellW, cellH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    if (newColor) {
      ctx.fillStyle = newColor;
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
    if (sg) {
      ctx.strokeStyle = (x % 10 === 0 || y % 10 === 0) ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.08)';
      ctx.lineWidth = (x % 10 === 0 || y % 10 === 0) ? 1 : 0.5;
      ctx.strokeRect(x * cellW + 0.5, y * cellH + 0.5, cellW - 1, cellH - 1);
    }
  }

  function floodFill(sx: number, sy: number) {
    const { gW, gH, grid } = s.current;
    const targetColor = grid[sy * gW + sx];
    const fillColor = getDrawColor();
    if (targetColor === fillColor) return;
    const stack: [number, number][] = [[sx, sy]];
    const visited = new Uint8Array(gW * gH);
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x < 0 || x >= gW || y < 0 || y >= gH) continue;
      const idx = y * gW + x;
      if (visited[idx] || grid[idx] !== targetColor) continue;
      visited[idx] = 1;
      grid[idx] = fillColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    redrawAll();
  }

  function eyedropper(x: number, y: number) {
    const { grid, gW } = s.current;
    const color = grid[y * gW + x];
    if (!color) return;
    const m = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    if (!m) return;
    const [, r, g, b] = m.map(Number);
    let best = DMC[0], bestDist = Infinity;
    for (const d of DMC) {
      const dist = Math.sqrt((r - d[2]) ** 2 + (g - d[3]) ** 2 + (b - d[4]) ** 2);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    s.current.currentDMC = best;
    s.current.isCustomColor = false;
    syncColorPreview();
    setToolInternal('pencil');
  }

  // ── State sync helpers ───────────────────────────────────────────────────────

  function syncColorPreview() {
    const { isCustomColor, customColorRGB, currentDMC } = s.current;
    if (isCustomColor && customColorRGB) {
      setColorBg(`rgb(${customColorRGB[0]},${customColorRGB[1]},${customColorRGB[2]})`);
      setColorLabel('Custom color');
    } else if (currentDMC) {
      setColorBg(`rgb(${currentDMC[2]},${currentDMC[3]},${currentDMC[4]})`);
      setColorLabel(`DMC ${currentDMC[0]} · ${currentDMC[1]}`);
    }
  }

  function syncStatusBar() {
    setStatusColors(new Set(s.current.grid.filter(Boolean)).size);
  }

  function syncLegend() {
    const { grid } = s.current;
    const counts = new Map<string, number>();
    for (const c of grid) if (c) counts.set(c, (counts.get(c) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    setLegendItems(sorted.map(([color, count]) => ({
      color,
      label: colorToLabel(color),
      count,
      skeins: Math.ceil(count / 150),
    })));
  }

  function pushUndo(snapshot: (string | null)[]) {
    s.current.undoStack.push(snapshot);
    if (s.current.undoStack.length > 40) s.current.undoStack.shift();
    s.current.redoStack = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function handleUndo() {
    if (!s.current.undoStack.length) return;
    s.current.redoStack.push([...s.current.grid]);
    s.current.grid = s.current.undoStack.pop()!;
    redrawAll();
    setCanUndo(s.current.undoStack.length > 0);
    setCanRedo(true);
    syncStatusBar();
    syncLegend();
  }

  function handleRedo() {
    if (!s.current.redoStack.length) return;
    s.current.undoStack.push([...s.current.grid]);
    s.current.grid = s.current.redoStack.pop()!;
    redrawAll();
    setCanUndo(true);
    setCanRedo(s.current.redoStack.length > 0);
    syncStatusBar();
    syncLegend();
  }

  function setToolInternal(t: Tool) {
    s.current.currentTool = t;
    setToolState(t);
    if (canvasRef.current) canvasRef.current.style.cursor = getToolCursor(t);
  }

  function initGrid(w: number, h: number, ratio: StitchRatio) {
    s.current.gW = w;
    s.current.gH = h;
    s.current.cellW = 14;
    s.current.cellH = ratio === 'knit' ? 17 : 14;
    s.current.grid = new Array(w * h).fill(null);
    s.current.undoStack = [];
    s.current.redoStack = [];
    setCanUndo(false);
    setCanRedo(false);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = w * s.current.cellW;
      canvas.height = h * s.current.cellH;
    }
    redrawAll();
    setStatusColors(0);
    setStatusCursor('—');
    setLegendItems([]);
  }

  // ── Canvas event listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    function handleMouseDown(e: MouseEvent) {
      const cell = getCellAt(e);
      if (!cell) return;
      const { currentTool } = s.current;
      if (currentTool === 'eyedropper') { eyedropper(cell.x, cell.y); return; }
      if (currentTool === 'fill') {
        const snapshot = [...s.current.grid];
        floodFill(cell.x, cell.y);
        pushUndo(snapshot);
        syncStatusBar();
        syncLegend();
        return;
      }
      s.current.isDrawing = true;
      s.current.pendingSnapshot = [...s.current.grid];
      s.current.lastCell = null;
      paintCell(cell.x, cell.y);
      s.current.lastCell = cell;
    }

    function handleMouseMove(e: MouseEvent) {
      const cell = getCellAt(e);
      if (cell) {
        setStatusCursor(`${cell.x + 1}, ${cell.y + 1}`);
        canvas.style.cursor = getToolCursor(s.current.currentTool);
      } else {
        setStatusCursor('—');
      }
      if (!s.current.isDrawing || !cell) return;
      const { lastCell } = s.current;
      if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;
      paintCell(cell.x, cell.y);
      s.current.lastCell = cell;
    }

    function handleMouseUp() {
      if (s.current.isDrawing && s.current.pendingSnapshot) {
        pushUndo(s.current.pendingSnapshot);
        syncStatusBar();
        syncLegend();
        s.current.pendingSnapshot = null;
      }
      s.current.isDrawing = false;
      s.current.lastCell = null;
    }

    function handleTouchStart(e: TouchEvent) {
      e.preventDefault();
      const touch = e.touches[0];
      const cell = getCellAt(touch as any);
      if (!cell) return;
      if (s.current.currentTool === 'fill') {
        const snapshot = [...s.current.grid];
        floodFill(cell.x, cell.y);
        pushUndo(snapshot);
        syncLegend();
        return;
      }
      s.current.isDrawing = true;
      s.current.pendingSnapshot = [...s.current.grid];
      paintCell(cell.x, cell.y);
      s.current.lastCell = cell;
    }

    function handleTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (!s.current.isDrawing) return;
      const cell = getCellAt(e.touches[0] as any);
      if (!cell) return;
      const { lastCell } = s.current;
      if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;
      paintCell(cell.x, cell.y);
      s.current.lastCell = cell;
    }

    function handleTouchEnd() {
      if (s.current.isDrawing && s.current.pendingSnapshot) {
        pushUndo(s.current.pendingSnapshot);
        syncLegend();
        s.current.pendingSnapshot = null;
      }
      s.current.isDrawing = false;
      s.current.lastCell = null;
    }

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); }
      if (e.key === 'p' || e.key === 'P') setToolInternal('pencil');
      if (e.key === 'f' || e.key === 'F') setToolInternal('fill');
      if (e.key === 'e' || e.key === 'E') setToolInternal('eraser');
      if (e.key === 'i' || e.key === 'I') setToolInternal('eyedropper');
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Init on mount
  useEffect(() => {
    initGrid(40, 40, 'square');
    syncColorPreview();
    if (canvasRef.current) canvasRef.current.style.cursor = getToolCursor('pencil');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──────────────────────────────────────────────────────────────────

  function applyZoom(z: number) {
    s.current.zoom = z;
    setZoom(z);
    if (canvasRef.current) {
      canvasRef.current.style.transform = `scale(${z / 100})`;
      canvasRef.current.style.transformOrigin = 'top left';
    }
  }

  function handleExportPNG() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { grid, showGrid: sg } = s.current;

    const wasGrid = sg;
    s.current.showGrid = true;
    redrawAll();

    const counts = new Map<string, number>();
    for (const c of grid) if (c) counts.set(c, (counts.get(c) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    const LEGEND_H = 36 + sorted.length * 28 + 20;
    const TITLE_H = 50;
    const exp = document.createElement('canvas');
    exp.width = Math.max(canvas.width + 40, 500);
    exp.height = TITLE_H + canvas.height + LEGEND_H;
    const ectx = exp.getContext('2d')!;

    ectx.fillStyle = '#FFFFFF';
    ectx.fillRect(0, 0, exp.width, exp.height);
    ectx.fillStyle = '#C49270';
    ectx.font = 'bold 20px sans-serif';
    ectx.fillText('KnitMate Design', 20, 34);
    ectx.drawImage(canvas, 20, TITLE_H);

    let ly = TITLE_H + canvas.height + 20;
    ectx.font = 'bold 14px sans-serif';
    ectx.fillStyle = '#C49270';
    ectx.fillText('Color Legend', 20, ly); ly += 20;
    sorted.forEach(([colorStr, count]) => {
      const skeins = Math.ceil(count / 150);
      const label = colorToLabel(colorStr);
      ectx.fillStyle = colorStr;
      ectx.fillRect(20, ly - 12, 16, 16);
      ectx.strokeStyle = '#e5e7eb'; ectx.lineWidth = 1;
      ectx.strokeRect(20, ly - 12, 16, 16);
      ectx.fillStyle = '#C49270';
      ectx.font = '12px sans-serif';
      ectx.fillText(`${label}  —  ${count} sts / ${skeins} skein${skeins !== 1 ? 's' : ''}`, 42, ly);
      ly += 22;
    });

    const link = document.createElement('a');
    link.download = 'knitmate-design.png';
    link.href = exp.toDataURL('image/png');
    link.click();
    showToast('PNG downloaded!');

    s.current.showGrid = wasGrid;
    redrawAll();
  }

  const dmcFiltered = dmcSearch
    ? DMC.filter(d => d[0].toLowerCase().includes(dmcSearch.toLowerCase()) || d[1].toLowerCase().includes(dmcSearch.toLowerCase()))
    : DMC;

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen text-warm antialiased overflow-x-hidden" style={{ background: '#FAF7F4' }}>
      <Toast message={toastMsg} visible={toastVisible} />

      <main className="pt-24 pb-12 flex flex-col lg:flex-row gap-5 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">

        {/* LEFT SIDEBAR */}
        <aside className="w-full lg:w-80 xl:w-96 flex-shrink-0 space-y-4">

          {/* Grid Setup */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5">
            <h3 className="font-bold text-brand-dark mb-4">Grid Setup</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-brand-gray mb-1 block">Width (stitches)</label>
                <input type="number" value={canvasW} min={5} max={200}
                  onChange={e => setCanvasW(Math.max(5, Math.min(200, parseInt(e.target.value) || 40)))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium focus:border-brand-dark focus:ring-1 focus:ring-brand-dark outline-none" />
              </div>
              <div>
                <label className="text-xs text-brand-gray mb-1 block">Height (stitches)</label>
                <input type="number" value={canvasH} min={5} max={200}
                  onChange={e => setCanvasH(Math.max(5, Math.min(200, parseInt(e.target.value) || 40)))}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium focus:border-brand-dark focus:ring-1 focus:ring-brand-dark outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(['square', 'knit'] as StitchRatio[]).map(r => (
                <label key={r} className="relative cursor-pointer">
                  <input type="radio" name="stitch_ratio" value={r} checked={stitchRatio === r}
                    onChange={() => setStitchRatio(r)} className="peer sr-only" />
                  <div className="p-2.5 rounded-lg border border-gray-200 peer-checked:border-brand-dark peer-checked:bg-brand-light/30 text-center transition-all">
                    <div className="text-xs font-medium text-brand-dark">{r === 'square' ? 'Square (1:1)' : 'Knit (4:5)'}</div>
                  </div>
                </label>
              ))}
            </div>
            <button
              onClick={() => {
                if (s.current.grid.some(c => c !== null)) setShowClearModal(true);
                else { initGrid(canvasW, canvasH, stitchRatio); }
              }}
              className="mt-3 w-full bg-brand-dark text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-brand-darker transition-all flex items-center justify-center gap-2">
              <i className="fa-solid fa-table-cells" /> New Canvas
            </button>
          </div>

          {/* Tools */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5">
            <h3 className="font-bold text-brand-dark mb-4">Tools</h3>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {([
                { t: 'pencil', icon: 'fa-pencil', label: 'Pencil', key: 'P' },
                { t: 'fill', icon: 'fa-fill-drip', label: 'Fill', key: 'F' },
                { t: 'eraser', icon: 'fa-eraser', label: 'Eraser', key: 'E' },
                { t: 'eyedropper', icon: 'fa-eye-dropper', label: 'Pick', key: 'I' },
              ] as { t: Tool; icon: string; label: string; key: string }[]).map(({ t, icon, label, key }) => (
                <button key={t}
                  onClick={() => setToolInternal(t)}
                  title={`${label} (${key})`}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all ${tool === t ? 'bg-brand-dark text-brand-light border-brand-dark' : 'border-gray-200 text-brand-dark hover:border-brand-dark'}`}>
                  <i className={`fa-solid ${icon} text-base`} /><span>{label}</span>
                </button>
              ))}
            </div>

            {/* Color preview + undo/redo */}
            <div className="flex items-center gap-3 mb-3">
              <div style={{ width: 40, height: 40, borderRadius: 10, border: '2px solid #e5e7eb', background: colorBg, flexShrink: 0 }} />
              <div className="flex-1">
                <p className="text-xs text-brand-gray">Current color</p>
                <p className="text-sm font-bold text-brand-dark">{colorLabel}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-brand-dark hover:bg-brand-light hover:border-brand-dark transition-all disabled:opacity-30">
                  <i className="fa-solid fa-rotate-left text-xs" />
                </button>
                <button onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                  className="w-9 h-9 rounded-lg border border-gray-200 flex items-center justify-center text-brand-dark hover:bg-brand-light hover:border-brand-dark transition-all disabled:opacity-30">
                  <i className="fa-solid fa-rotate-right text-xs" />
                </button>
              </div>
            </div>

            {/* Custom color */}
            <div className="flex gap-2 mb-1">
              <input type="color" value={customColorHex}
                onChange={e => setCustomColorHex(e.target.value)}
                className="w-10 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
              <button
                onClick={() => {
                  const hex = customColorHex;
                  const r = parseInt(hex.slice(1, 3), 16);
                  const g = parseInt(hex.slice(3, 5), 16);
                  const b = parseInt(hex.slice(5, 7), 16);
                  s.current.customColorRGB = [r, g, b];
                  s.current.isCustomColor = true;
                  syncColorPreview();
                }}
                className="flex-1 text-xs font-semibold border border-gray-200 rounded-lg px-2 hover:border-brand-dark hover:bg-brand-light/30 transition-all">
                Use custom color
              </button>
            </div>
            <p className="text-xs text-brand-gray">Or pick from DMC palette below</p>
          </div>

          {/* DMC Palette */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-brand-dark">DMC Palette</h3>
              <input type="text" placeholder="Search…" value={dmcSearch}
                onChange={e => setDmcSearch(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-28 focus:border-brand-dark outline-none" />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
              {dmcFiltered.map(d => (
                <div key={d[0]}
                  title={`DMC ${d[0]}: ${d[1]}`}
                  onClick={() => {
                    s.current.currentDMC = d;
                    s.current.isCustomColor = false;
                    syncColorPreview();
                  }}
                  style={{
                    width: 20, height: 20, borderRadius: 4,
                    background: `rgb(${d[2]},${d[3]},${d[4]})`,
                    cursor: 'pointer', flexShrink: 0,
                    border: s.current.currentDMC && s.current.currentDMC[0] === d[0]
                      ? '2px solid #C49270' : '2px solid transparent',
                  }}
                  className="hover:scale-125 transition-transform"
                />
              ))}
            </div>
          </div>
        </aside>

        {/* CENTER */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">

          {/* Toolbar */}
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  s.current.showGrid = !s.current.showGrid;
                  setShowGridState(s.current.showGrid);
                  redrawAll();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${showGridState ? 'bg-brand-light border-brand-dark text-brand-dark' : 'border-gray-200 text-brand-dark'}`}>
                <i className="fa-solid fa-border-all text-xs" /> Grid
              </button>
              <button
                onClick={() => {
                  if (s.current.grid.some(c => c !== null)) setShowClearModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-brand-dark hover:border-red-300 hover:text-red-600 transition-all">
                <i className="fa-solid fa-trash text-xs" /> Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => applyZoom(Math.max(25, zoom - 25))}
                className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center hover:bg-brand-light transition-all">
                <i className="fa-solid fa-magnifying-glass-minus text-xs" />
              </button>
              <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
              <button onClick={() => applyZoom(Math.min(400, zoom + 25))}
                className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center hover:bg-brand-light transition-all">
                <i className="fa-solid fa-magnifying-glass-plus text-xs" />
              </button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
              <button onClick={handleExportPNG}
                className="bg-brand-dark text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-brand-darker transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-download" /> Export PNG
              </button>
            </div>
          </div>

          {/* Canvas viewport */}
          <div id="canvasViewport"
            style={{ overflow: 'hidden', position: 'relative', background: '#e5e7eb' }}
            className="bg-white rounded-2xl shadow-card border border-gray-100 flex-1 min-h-[500px] overflow-auto flex items-start justify-start">
            <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
          </div>

          {/* Status bar */}
          <div className="bg-white rounded-xl shadow-card border border-gray-100 px-4 py-2 text-xs text-brand-gray flex gap-6">
            <span>Grid: <strong className="text-brand-dark">{s.current.gW} × {s.current.gH}</strong></span>
            <span>Cursor: <strong className="text-brand-dark">{statusCursor}</strong></span>
            <span>Colors used: <strong className="text-brand-dark">{statusColors}</strong></span>
          </div>
        </div>

        {/* RIGHT SIDEBAR: Legend */}
        <div className="w-full lg:w-64 xl:w-72 flex-shrink-0">
          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-5 lg:sticky top-28">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-brand-dark">Color Legend</h3>
              <span className="text-xs text-brand-gray bg-gray-100 px-2 py-0.5 rounded-full">
                {legendItems.length} color{legendItems.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {legendItems.length === 0 ? (
                <p className="text-xs text-brand-gray">Start drawing to see colors here.</p>
              ) : legendItems.map(item => (
                <div key={item.color}
                  onClick={() => {
                    const m = item.color.match(/rgb\((\d+),(\d+),(\d+)\)/);
                    if (!m) return;
                    const [, r, g, b] = m.map(Number);
                    let best = DMC[0], bestDist = Infinity;
                    for (const d of DMC) {
                      const dist = Math.sqrt((r - d[2]) ** 2 + (g - d[3]) ** 2 + (b - d[4]) ** 2);
                      if (dist < bestDist) { bestDist = dist; best = d; }
                    }
                    s.current.currentDMC = best;
                    s.current.isCustomColor = false;
                    syncColorPreview();
                  }}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors hover:bg-orange-50">
                  <div style={{ width: 18, height: 18, background: item.color, border: '1px solid #e5e7eb', borderRadius: 4, flexShrink: 0 }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-brand-dark truncate">{item.label}</div>
                    <div className="text-xs text-brand-gray">{item.count} sts · {item.skeins} skein{item.skeins !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Clear Canvas Modal */}
      {showClearModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full">
            <h3 className="text-lg font-bold text-brand-dark mb-2">Start new canvas?</h3>
            <p className="text-sm text-brand-gray mb-6">This will clear your current design. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearModal(false)}
                className="flex-1 border border-gray-200 text-brand-dark font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition-all text-sm">
                Cancel
              </button>
              <button onClick={() => { setShowClearModal(false); initGrid(canvasW, canvasH, stitchRatio); }}
                className="flex-1 bg-red-500 text-white font-semibold py-2.5 rounded-xl hover:bg-red-600 transition-all text-sm">
                Clear Canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
