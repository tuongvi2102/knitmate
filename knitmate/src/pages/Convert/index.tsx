import { useRef, useState, useEffect, useCallback } from 'react';
import { DMC_WITH_LAB, nearestDMCIndex } from '../../data/dmc';
import { labDistance } from '../../lib/colorConversion';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/ui/Toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatternData {
  grid: Uint16Array;
  palette: typeof DMC_WITH_LAB;
  paletteIndices: number[];
  stitchCounts: Map<number, number>;
  W: number;
  H: number;
  cellW: number;
  cellH: number;
}

interface PatternSnapshot {
  grid: Uint16Array;
  palette: typeof DMC_WITH_LAB;
  paletteIndices: number[];
  stitchCounts: Map<number, number>;
  W: number;
  H: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LABEL_PAD_X = 50;
const LABEL_PAD_Y = 50;
const MAX_UNDO = 40;
const CROP_EDGE_THRESHOLD = 10;
const MIN_GRID_DIM = 5;
const MAX_GRID_DIM = 500;
const WHITE_DMC_IDX = 0; // 'blanc' — first entry in DMC list, used to fill expanded cells

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeCellSize(W: number, H: number, stitchRatio: string, availW: number, availH: number) {
  const knit = stitchRatio === 'knit';
  const cellHFromH = Math.floor((availH - LABEL_PAD_X) / H);
  const cellHFromW = knit
    ? Math.floor((availW - LABEL_PAD_Y) / W * 12 / 10)
    : Math.floor((availW - LABEL_PAD_Y) / W);
  const cellH = Math.max(2, Math.min(cellHFromH, cellHFromW));
  const cellW = knit ? Math.max(2, Math.round(cellH * 10 / 12)) : cellH;
  return { cellW, cellH };
}

function drawGridLines(ctx: CanvasRenderingContext2D, W: number, H: number, cellW: number, cellH: number, dpr: number) {
  const thinLine = 1 / dpr;
  const thickLine = 2 / dpr;
  for (let x = 0; x <= W; x++) {
    ctx.beginPath();
    if (x > 0 && x % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = thickLine; }
    else { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = thinLine; }
    ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, H * cellH); ctx.stroke();
  }
  for (let y = 0; y <= H; y++) {
    ctx.beginPath();
    if (y > 0 && y % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = thickLine; }
    else { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = thinLine; }
    ctx.moveTo(0, y * cellH); ctx.lineTo(W * cellW, y * cellH); ctx.stroke();
  }
}

function drawAxisLabels(ctx: CanvasRenderingContext2D, W: number, H: number, cellW: number, cellH: number) {
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, H * cellH); ctx.lineTo(W * cellW, H * cellH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * cellW, 0); ctx.lineTo(W * cellW, H * cellH); ctx.stroke();
  ctx.fillStyle = 'rgba(70,50,30,0.72)';
  const fontSize = Math.max(7, Math.min(10, Math.floor(cellW * 1.5)));
  ctx.font = `bold ${fontSize}px sans-serif`;
  // X-axis: vertical text, right to left (1 at rightmost), every 2 cells
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const maxLabelW = ctx.measureText(String(W)).width;
  for (let c = 1; c <= W; c += 2) {
    const xPos = (W - c) * cellW + cellW / 2;
    ctx.save();
    ctx.translate(xPos, H * cellH + 3);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(String(c), 0, 0);
    ctx.restore();
  }
  // Y-axis: bottom to top, every 2 rows (1, 3, 5…)
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let row = 1; row <= H; row += 2) {
    ctx.fillText(String(row), W * cellW + 3, (H - row) * cellH + cellH / 2);
  }
  // "Start Here" below the vertical numbers, right-aligned to chart edge
  ctx.font = `bold 9px sans-serif`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(70,50,30,0.9)';
  ctx.fillText('Start Here', W * cellW, H * cellH + 3 + maxLabelW + 4);
}

function drawChartKey(
  ctx: CanvasRenderingContext2D,
  _W: number, H: number, _cellW: number, cellH: number,
  palette: Array<{ r: number; g: number; b: number }>,
  paletteIndices: number[]
) {
  const keyTopY = H * cellH + LABEL_PAD_X + 10;
  const SWATCH = 13, GAP = 6, COL_W = 110, ROW_H = 22;
  const COLS = paletteIndices.length < 5 ? paletteIndices.length : 3;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // "Key" heading
  ctx.fillStyle = 'rgba(40,30,20,0.85)';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Key', 0, keyTopY);

  // Color swatches with letter labels
  const startY = keyTopY + 22;
  paletteIndices.forEach((_dmcIdx, pos) => {
    const dmc = palette[pos];
    const col = pos % COLS;
    const row = Math.floor(pos / COLS);
    const x = col * COL_W;
    const y = startY + row * ROW_H;
    ctx.fillStyle = `rgb(${dmc.r},${dmc.g},${dmc.b})`;
    ctx.fillRect(x, y, SWATCH, SWATCH);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, SWATCH, SWATCH);
    ctx.fillStyle = 'rgba(40,30,20,0.85)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`= ${letters[pos] ?? String(pos + 1)}`, x + SWATCH + GAP, y + SWATCH / 2);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Convert() {
  // Canvas refs
  const patternCanvasRef = useRef<HTMLCanvasElement>(null);
  const selectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const patternGridRef = useRef<HTMLDivElement>(null);
  const canvasOuterRef = useRef<HTMLDivElement>(null);

  // Mutable state (imperative, avoids stale closures in event handlers)
  const r = useRef({
    uploadedImage: null as HTMLImageElement | null,
    patternData: null as PatternData | null,
    undoStack: [] as PatternSnapshot[],
    redoStack: [] as PatternSnapshot[],
    currentZoom: 100,
    showGrid: true,
    originalAspect: null as number | null,
    // Selection tool
    selectionActive: false,
    selectedPixels: new Set<string>(),
    selDragging: false,
    selDragStartPx: null as { x: number; y: number } | null,
    selDragEndPx: null as { x: number; y: number } | null,
    // Paint tool
    paintActive: false,
    activePaintDmcIdx: null as number | null,
    isPainting: false,
    // Move tool
    moveActive: false,
    moveDragging: false,
    moveDragStart: null as { x: number; y: number } | null,
    moveDragCurrent: null as { x: number; y: number } | null,
    // Crop
    cropDragging: false,
    cropEdge: null as string | null,
    cropPreviewCell: -1,
    suppressNextClick: false,
    // Color replace
    colorReplaceTarget: null as number | null,
    colorReplacePixel: null as { x: number; y: number } | null,
    colorReplaceScope: 'all' as 'all' | 'selection',
  });

  // React state (for JSX re-renders)
  const [view, setView] = useState<'pattern' | 'original'>('pattern');
  const [showGrid, setShowGridState] = useState(true);
  const [maxColors, setMaxColors] = useState(15);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPattern, setHasPattern] = useState(false);
  const [isUploaded, setIsUploaded] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('Click to upload or drag & drop');
  const [zoom, setZoom] = useState(100);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [paintActive, setPaintActive] = useState(false);
  const [moveActive, setMoveActive] = useState(false);
  const [paintColorDisplay, setPaintColorDisplay] = useState<{ bg: string; label: string } | null>(null);
  const [colorReplaceOpen, setColorReplaceOpen] = useState(false);
  const [paintColorOpen, setPaintColorOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [crCurrentBg, setCrCurrentBg] = useState('');
  const [crCurrentId, setCrCurrentId] = useState('');
  const [crCurrentName, setCrCurrentName] = useState('');
  const [crSearch, setCrSearch] = useState('');
  const [crHex, setCrHex] = useState('');
  const [crPickerBg, setCrPickerBg] = useState('#cccccc');
  const [crNearest, setCrNearest] = useState<{ bg: string; label: string } | null>(null);
  const [pcSearch, setPcSearch] = useState('');
  const [pcHex, setPcHex] = useState('');
  const [pcPickerBg, setPcPickerBg] = useState('#cccccc');
  const [pcNearest, setPcNearest] = useState<{ bg: string; label: string } | null>(null);
  const [summaryData, setSummaryData] = useState<{ size: string; colors: number; est: string; swatches: { bg: string; id: string; name: string; dmcIdx: number }[] } | null>(null);
  const [gaugeStitches, setGaugeStitches] = useState('');
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [gaugeRows, setGaugeRows] = useState('');
  const [gridWidth, setGridWidth] = useState(80);
  const [gridHeight, setGridHeight] = useState(68);
  const [stitchRatio, _setStitchRatio] = useState('square');
  const [gcWidthCm, setGcWidthCm] = useState('');
  const [gcWidthSt, setGcWidthSt] = useState('');
  const [gcResultCm, setGcResultCm] = useState('');
  const [gcResultSt, setGcResultSt] = useState('');
  const [heightDisplay, setHeightDisplay] = useState('— upload image first');

  const { message: toastMsg, visible: toastVisible, showToast } = useToast();

  // ── Canvas rendering ─────────────────────────────────────────────────────────

  const renderCanvas = useCallback(() => {
    const pd = r.current.patternData;
    if (!pd) return;
    const canvas = patternCanvasRef.current;
    if (!canvas) return;
    const { grid, palette, paletteIndices, W, H, cellW, cellH } = pd;
    const keyCols = paletteIndices.length < 5 ? paletteIndices.length : 3;
    const keyRows = Math.ceil(paletteIndices.length / keyCols);
    const KEY_SECTION_H = 10 + 16 + 22 + keyRows * 22 + 16;
    const dpr = window.devicePixelRatio || 1;
    const cssW = W * cellW + LABEL_PAD_Y;
    const cssH = H * cellH + LABEL_PAD_X + KEY_SECTION_H;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const paletteIndexMap = new Map(paletteIndices.map((dmcIdx, pos) => [dmcIdx, pos]));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dmcIdx = grid[y * W + x];
        const dmc = palette[paletteIndexMap.get(dmcIdx)!];
        ctx.fillStyle = `rgb(${dmc.r},${dmc.g},${dmc.b})`;
        ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
      }
    }

    if (r.current.showGrid) drawGridLines(ctx, W, H, cellW, cellH, dpr);
    drawAxisLabels(ctx, W, H, cellW, cellH);
    drawChartKey(ctx, W, H, cellW, cellH, palette, paletteIndices);

    // Draw selection overlay
    const { selectedPixels } = r.current;
    if (selectedPixels.size > 0) {
      ctx.fillStyle = 'rgba(99,102,241,0.3)';
      ctx.strokeStyle = 'rgba(99,102,241,0.9)';
      ctx.lineWidth = 1.5;
      for (const key of selectedPixels) {
        const [sx, sy] = key.split(',').map(Number);
        ctx.fillRect(sx * cellW, sy * cellH, cellW, cellH);
        ctx.strokeRect(sx * cellW + 0.75, sy * cellH + 0.75, cellW - 1.5, cellH - 1.5);
      }
    }
  }, []);

  const renderSummary = useCallback(() => {
    const pd = r.current.patternData;
    if (!pd) return;
    const { palette, paletteIndices, W, H } = pd;
    const gs = parseInt(gaugeStitches) || 20;
    const gr = parseInt(gaugeRows) || 26;
    const estW = Math.round((W / gs) * 10);
    const estH = Math.round((H / gr) * 10);
    setSummaryData({
      size: `${W} × ${H} sts`,
      colors: palette.length,
      est: `${estW}cm × ${estH}cm`,
      swatches: paletteIndices.map((dmcIdx, pos) => ({
        bg: `rgb(${palette[pos].r},${palette[pos].g},${palette[pos].b})`,
        id: palette[pos].id,
        name: palette[pos].name,
        dmcIdx,
      })),
    });
  }, [gaugeStitches, gaugeRows]);

  const fitToCanvas = useCallback(() => {
    const pd = r.current.patternData;
    const outer = canvasOuterRef.current;
    if (!pd || !outer) return;
    const { W, H } = pd;
    const availW = outer.clientWidth - 48;
    const availH = outer.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return;
    const { cellW, cellH } = computeCellSize(W, H, stitchRatio, availW, availH);
    pd.cellW = cellW;
    pd.cellH = cellH;
    r.current.currentZoom = 100;
    setZoom(100);
    if (patternGridRef.current) {
      patternGridRef.current.style.transform = 'scale(1)';
      patternGridRef.current.style.transformOrigin = 'top left';
    }
    renderCanvas();
    renderSummary();
  }, [stitchRatio, renderCanvas, renderSummary]);

  // ── Pattern generation ───────────────────────────────────────────────────────

  function generatePattern() {
    const img = r.current.uploadedImage;
    if (!img) return;
    const outer = canvasOuterRef.current;
    if (!outer) return;

    const W = Math.max(10, Math.min(300, gridWidth));
    const H = Math.max(10, Math.min(300, gridHeight));
    const mc = maxColors;
    const { cellW, cellH } = computeCellSize(W, H, stitchRatio, outer.clientWidth - 48, outer.clientHeight - 48);

    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(img, 0, 0, W, H);
    const imgData = ctx.getImageData(0, 0, W, H).data;

    const dmcIndices = new Uint16Array(W * H);
    const freqMap = new Map<number, number>();
    for (let i = 0; i < W * H; i++) {
      const ri = imgData[i * 4], gi = imgData[i * 4 + 1], bi = imgData[i * 4 + 2];
      const idx = nearestDMCIndex(ri, gi, bi);
      dmcIndices[i] = idx;
      freqMap.set(idx, (freqMap.get(idx) || 0) + 1);
    }

    let sortedEntries = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);
    let paletteIndices: number[];
    if (sortedEntries.length <= mc) {
      paletteIndices = sortedEntries.map(e => e[0]);
    } else {
      paletteIndices = sortedEntries.slice(0, mc).map(e => e[0]);
      const paletteSet = new Set(paletteIndices);
      const paletteLabs = paletteIndices.map(i => DMC_WITH_LAB[i].lab);
      for (let i = 0; i < W * H; i++) {
        if (!paletteSet.has(dmcIndices[i])) {
          const lab = DMC_WITH_LAB[dmcIndices[i]].lab;
          let best = paletteIndices[0], bestDist = Infinity;
          for (let j = 0; j < paletteIndices.length; j++) {
            const d = labDistance(lab, paletteLabs[j]);
            if (d < bestDist) { bestDist = d; best = paletteIndices[j]; }
          }
          dmcIndices[i] = best;
        }
      }
    }

    const palette = paletteIndices.map(i => DMC_WITH_LAB[i]);
    const stitchCounts = new Map<number, number>();
    paletteIndices.forEach(i => stitchCounts.set(i, 0));
    for (let i = 0; i < W * H; i++) {
      stitchCounts.set(dmcIndices[i], (stitchCounts.get(dmcIndices[i]) || 0) + 1);
    }

    r.current.patternData = { grid: dmcIndices, palette, paletteIndices, stitchCounts, W, H, cellW, cellH };
    r.current.undoStack = [];
    r.current.redoStack = [];
    setCanUndo(false);
    setCanRedo(false);

    renderCanvas();
    renderSummary();
    setIsLoading(false);
    setHasPattern(true);
    setView('pattern');
    requestAnimationFrame(() => requestAnimationFrame(fitToCanvas));
  }

  function handleGenerate() {
    if (!r.current.uploadedImage) { showToast('Please upload an image first.'); return; }
    setIsLoading(true);
    setHasPattern(false);
    setTimeout(generatePattern, 50);
  }

  // ── Undo/Redo ────────────────────────────────────────────────────────────────

  function snapshotPatternData(): PatternSnapshot {
    const pd = r.current.patternData!;
    return {
      grid: new Uint16Array(pd.grid),
      palette: pd.palette.slice(),
      paletteIndices: pd.paletteIndices.slice(),
      stitchCounts: new Map(pd.stitchCounts),
      W: pd.W, H: pd.H,
    };
  }

  function restoreSnapshot(snap: PatternSnapshot) {
    const pd = r.current.patternData!;
    pd.grid = snap.grid;
    pd.palette = snap.palette;
    pd.paletteIndices = snap.paletteIndices;
    pd.stitchCounts = snap.stitchCounts;
    pd.W = snap.W; pd.H = snap.H;
    renderCanvas();
    renderSummary();
    requestAnimationFrame(fitToCanvas);
  }

  function saveUndoState() {
    r.current.undoStack.push(snapshotPatternData());
    if (r.current.undoStack.length > MAX_UNDO) r.current.undoStack.shift();
    r.current.redoStack = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function handleUndo() {
    if (!r.current.patternData || !r.current.undoStack.length) return;
    r.current.redoStack.push(snapshotPatternData());
    restoreSnapshot(r.current.undoStack.pop()!);
    setCanUndo(r.current.undoStack.length > 0);
    setCanRedo(true);
    showToast('Undone');
  }

  function handleRedo() {
    if (!r.current.patternData || !r.current.redoStack.length) return;
    r.current.undoStack.push(snapshotPatternData());
    restoreSnapshot(r.current.redoStack.pop()!);
    setCanUndo(true);
    setCanRedo(r.current.redoStack.length > 0);
    showToast('Redone');
  }

  // ── Color replace ────────────────────────────────────────────────────────────

  function replaceSinglePixel(x: number, y: number, newDmcIdx: number, silent = false) {
    const pd = r.current.patternData;
    if (!pd) return;
    const { grid, palette, paletteIndices, stitchCounts, W } = pd;
    const idx = y * W + x;
    const oldDmcIdx = grid[idx];
    if (oldDmcIdx === newDmcIdx) return;
    if (!silent) saveUndoState();
    grid[idx] = newDmcIdx;
    if (!paletteIndices.includes(newDmcIdx)) {
      paletteIndices.push(newDmcIdx);
      palette.push(DMC_WITH_LAB[newDmcIdx]);
      stitchCounts.set(newDmcIdx, 0);
    }
    const oldCount = stitchCounts.get(oldDmcIdx) || 0;
    if (oldCount <= 1) {
      stitchCounts.delete(oldDmcIdx);
      const pos = paletteIndices.indexOf(oldDmcIdx);
      if (pos !== -1) { palette.splice(pos, 1); paletteIndices.splice(pos, 1); }
    } else {
      stitchCounts.set(oldDmcIdx, oldCount - 1);
    }
    stitchCounts.set(newDmcIdx, (stitchCounts.get(newDmcIdx) || 0) + 1);
    renderCanvas();
  }

  function replacePatternColor(oldDmcIdx: number, newDmcIdx: number) {
    const pd = r.current.patternData;
    if (!pd) return;
    saveUndoState();
    const { grid, palette, paletteIndices, stitchCounts, W, H } = pd;
    if (!paletteIndices.includes(newDmcIdx)) {
      paletteIndices.push(newDmcIdx);
      palette.push(DMC_WITH_LAB[newDmcIdx]);
      stitchCounts.set(newDmcIdx, 0);
    }
    for (let i = 0; i < W * H; i++) {
      if (grid[i] === oldDmcIdx) {
        grid[i] = newDmcIdx;
        stitchCounts.set(newDmcIdx, (stitchCounts.get(newDmcIdx) || 0) + 1);
      }
    }
    stitchCounts.delete(oldDmcIdx);
    const pos = paletteIndices.indexOf(oldDmcIdx);
    if (pos !== -1) { palette.splice(pos, 1); paletteIndices.splice(pos, 1); }
    renderCanvas();
    renderSummary();
    showToast('Color replaced!');
  }

  function paintSelectedPixels(newDmcIdx: number) {
    const pd = r.current.patternData;
    if (!pd || r.current.selectedPixels.size === 0) return;
    const { grid, palette, paletteIndices, stitchCounts, W } = pd;
    if (!paletteIndices.includes(newDmcIdx)) {
      paletteIndices.push(newDmcIdx);
      palette.push(DMC_WITH_LAB[newDmcIdx]);
      stitchCounts.set(newDmcIdx, 0);
    }
    for (const key of r.current.selectedPixels) {
      const [x, y] = key.split(',').map(Number);
      const i = y * W + x;
      const oldDmcIdx = grid[i];
      if (oldDmcIdx === newDmcIdx) continue;
      stitchCounts.set(oldDmcIdx, (stitchCounts.get(oldDmcIdx) || 1) - 1);
      stitchCounts.set(newDmcIdx, (stitchCounts.get(newDmcIdx) || 0) + 1);
      grid[i] = newDmcIdx;
    }
    for (let i = paletteIndices.length - 1; i >= 0; i--) {
      if ((stitchCounts.get(paletteIndices[i]) || 0) <= 0) {
        stitchCounts.delete(paletteIndices[i]);
        palette.splice(i, 1);
        paletteIndices.splice(i, 1);
      }
    }
    renderCanvas();
    renderSummary();
    const n = r.current.selectedPixels.size;
    showToast(`${n} pixel${n !== 1 ? 's' : ''} painted!`);
  }

  function commitMove(dx: number, dy: number) {
    const pd = r.current.patternData;
    if (!pd || r.current.selectedPixels.size === 0) return;
    if (dx === 0 && dy === 0) return;
    const { grid, palette, paletteIndices, stitchCounts, W, H } = pd;
    saveUndoState();

    const cells: Array<{ srcX: number; srcY: number; dmcIdx: number }> = [];
    for (const key of r.current.selectedPixels) {
      const [sx, sy] = key.split(',').map(Number);
      cells.push({ srcX: sx, srcY: sy, dmcIdx: grid[sy * W + sx] });
    }

    for (const c of cells) {
      const idx = c.srcY * W + c.srcX;
      const oldDmcIdx = grid[idx];
      if (oldDmcIdx === WHITE_DMC_IDX) continue;
      grid[idx] = WHITE_DMC_IDX;
      stitchCounts.set(oldDmcIdx, (stitchCounts.get(oldDmcIdx) || 1) - 1);
      stitchCounts.set(WHITE_DMC_IDX, (stitchCounts.get(WHITE_DMC_IDX) || 0) + 1);
    }
    if (!paletteIndices.includes(WHITE_DMC_IDX) && (stitchCounts.get(WHITE_DMC_IDX) || 0) > 0) {
      paletteIndices.push(WHITE_DMC_IDX);
      palette.push(DMC_WITH_LAB[WHITE_DMC_IDX]);
    }

    const newSelected = new Set<string>();
    for (const c of cells) {
      const tx = c.srcX + dx;
      const ty = c.srcY + dy;
      if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
      const idx = ty * W + tx;
      const oldDmcIdx = grid[idx];
      newSelected.add(`${tx},${ty}`);
      if (oldDmcIdx === c.dmcIdx) continue;
      grid[idx] = c.dmcIdx;
      if (!paletteIndices.includes(c.dmcIdx)) {
        paletteIndices.push(c.dmcIdx);
        palette.push(DMC_WITH_LAB[c.dmcIdx]);
        stitchCounts.set(c.dmcIdx, 0);
      }
      stitchCounts.set(oldDmcIdx, (stitchCounts.get(oldDmcIdx) || 1) - 1);
      stitchCounts.set(c.dmcIdx, (stitchCounts.get(c.dmcIdx) || 0) + 1);
    }

    for (let i = paletteIndices.length - 1; i >= 0; i--) {
      if ((stitchCounts.get(paletteIndices[i]) || 0) <= 0) {
        stitchCounts.delete(paletteIndices[i]);
        palette.splice(i, 1);
        paletteIndices.splice(i, 1);
      }
    }

    r.current.selectedPixels = newSelected;
    setSelectedCount(newSelected.size);
    if (newSelected.size === 0) {
      r.current.moveActive = false;
      setMoveActive(false);
    }
    renderCanvas();
    renderSummary();
    const n = cells.length;
    showToast(`Moved ${n} pixel${n !== 1 ? 's' : ''}`);
  }

  // ── Color replace modal helpers ───────────────────────────────────────────────

  function openColorReplaceModal(dmcIdx: number, pixel?: { x: number; y: number }) {
    r.current.colorReplaceScope = 'all';
    r.current.colorReplaceTarget = dmcIdx;
    r.current.colorReplacePixel = pixel || null;
    const dmc = DMC_WITH_LAB[dmcIdx];
    setCrCurrentBg(`rgb(${dmc.r},${dmc.g},${dmc.b})`);
    setCrCurrentId(`DMC ${dmc.id}`);
    setCrCurrentName(dmc.name);
    setCrSearch(''); setCrHex(''); setCrPickerBg('#cccccc'); setCrNearest(null);
    setColorReplaceOpen(true);
    document.body.style.overflow = 'hidden';
  }

  function closeColorReplaceModal() {
    setColorReplaceOpen(false);
    document.body.style.overflow = '';
    r.current.colorReplacePixel = null;
  }

  function applyPickedCrColor(hex: string) {
    if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) return;
    const rr = parseInt(hex.slice(1, 3), 16);
    const gg = parseInt(hex.slice(3, 5), 16);
    const bb = parseInt(hex.slice(5, 7), 16);
    const idx = nearestDMCIndex(rr, gg, bb);
    const dmc = DMC_WITH_LAB[idx];
    setCrNearest({ bg: `rgb(${dmc.r},${dmc.g},${dmc.b})`, label: `DMC ${dmc.id} · ${dmc.name}` });
  }

  function applyPickedPcColor(hex: string) {
    if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) return;
    const rr = parseInt(hex.slice(1, 3), 16);
    const gg = parseInt(hex.slice(3, 5), 16);
    const bb = parseInt(hex.slice(5, 7), 16);
    const idx = nearestDMCIndex(rr, gg, bb);
    const dmc = DMC_WITH_LAB[idx];
    setPcNearest({ bg: `rgb(${dmc.r},${dmc.g},${dmc.b})`, label: `DMC ${dmc.id} · ${dmc.name}` });
  }

  function setPaintColor(dmcIdx: number) {
    r.current.activePaintDmcIdx = dmcIdx;
    const dmc = DMC_WITH_LAB[dmcIdx];
    setPaintColorDisplay({ bg: `rgb(${dmc.r},${dmc.g},${dmc.b})`, label: `DMC ${dmc.id} · ${dmc.name}` });
  }

  // ── Crop helpers ─────────────────────────────────────────────────────────────

  function detectCropEdge(canvasX: number, canvasY: number): string | null {
    const pd = r.current.patternData;
    if (!pd) return null;
    const { W, H, cellW, cellH } = pd;
    const gridW = W * cellW, gridH = H * cellH;
    if (canvasX < CROP_EDGE_THRESHOLD) return 'left';
    if (canvasX > gridW - CROP_EDGE_THRESHOLD) return 'right';
    if (canvasY < CROP_EDGE_THRESHOLD) return 'top';
    if (canvasY > gridH - CROP_EDGE_THRESHOLD) return 'bottom';
    return null;
  }

  function applyCrop(edge: string, cell: number) {
    const pd = r.current.patternData;
    if (!pd) return;
    const { grid, W, H, palette, paletteIndices } = pd;
    // cell may be outside [0, W-1] / [0, H-1]: negative on left/top means expand,
    // beyond W-1 / H-1 on right/bottom means expand.
    let newW = W, newH = H;
    let srcOffsetX = 0, srcOffsetY = 0, dstOffsetX = 0, dstOffsetY = 0;
    if (edge === 'left') {
      if (cell >= 0) { srcOffsetX = cell; newW = W - cell; }
      else { dstOffsetX = -cell; newW = W - cell; }
    } else if (edge === 'right') {
      newW = cell + 1;
    } else if (edge === 'top') {
      if (cell >= 0) { srcOffsetY = cell; newH = H - cell; }
      else { dstOffsetY = -cell; newH = H - cell; }
    } else if (edge === 'bottom') {
      newH = cell + 1;
    }
    if (newW < MIN_GRID_DIM || newH < MIN_GRID_DIM) return;
    if (newW > MAX_GRID_DIM || newH > MAX_GRID_DIM) return;
    if (newW === W && newH === H) return;
    saveUndoState();
    const newGrid = new Uint16Array(newW * newH);
    newGrid.fill(WHITE_DMC_IDX);
    const copyW = Math.min(W - srcOffsetX, newW - dstOffsetX);
    const copyH = Math.min(H - srcOffsetY, newH - dstOffsetY);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        const srcIdx = (y + srcOffsetY) * W + (x + srcOffsetX);
        newGrid[(y + dstOffsetY) * newW + (x + dstOffsetX)] = grid[srcIdx];
      }
    }
    const newCounts = new Map<number, number>();
    for (let i = 0; i < newW * newH; i++) {
      const idx = newGrid[i];
      newCounts.set(idx, (newCounts.get(idx) || 0) + 1);
    }
    if ((newCounts.get(WHITE_DMC_IDX) || 0) > 0 && !paletteIndices.includes(WHITE_DMC_IDX)) {
      paletteIndices.push(WHITE_DMC_IDX);
      palette.push(DMC_WITH_LAB[WHITE_DMC_IDX]);
    }
    for (let i = paletteIndices.length - 1; i >= 0; i--) {
      if (!newCounts.has(paletteIndices[i])) {
        palette.splice(i, 1);
        paletteIndices.splice(i, 1);
      }
    }
    pd.grid = newGrid;
    pd.W = newW; pd.H = newH;
    pd.stitchCounts = newCounts;
    const { cellW: cW, cellH: cH } = computeCellSize(newW, newH, stitchRatio,
      (canvasOuterRef.current?.clientWidth || 800) - 48,
      (canvasOuterRef.current?.clientHeight || 600) - 48);
    pd.cellW = cW; pd.cellH = cH;
    setGridWidth(newW); setGridHeight(newH);
    renderCanvas();
    renderSummary();
    requestAnimationFrame(fitToCanvas);
  }

  function drawCropPreview(edge: string, cell: number) {
    const selCanvas = selectionCanvasRef.current;
    const pd = r.current.patternData;
    if (!selCanvas || !pd) return;
    const { W, H, cellW, cellH } = pd;
    const dpr = window.devicePixelRatio || 1;
    const isExpand =
      ((edge === 'left' || edge === 'top') && cell < 0) ||
      (edge === 'right' && cell >= W) ||
      (edge === 'bottom' && cell >= H);

    // Sel canvas spans the union of current grid and any expansion,
    // shifted via negative left/top when expanding from left/top.
    let extraLeft = 0, extraTop = 0;
    let widthPx = W * cellW;
    let heightPx = H * cellH;
    if (edge === 'left' && cell < 0) { extraLeft = -cell * cellW; widthPx += extraLeft; }
    if (edge === 'right' && cell >= W) { widthPx = (cell + 1) * cellW; }
    if (edge === 'top' && cell < 0) { extraTop = -cell * cellH; heightPx += extraTop; }
    if (edge === 'bottom' && cell >= H) { heightPx = (cell + 1) * cellH; }

    selCanvas.width = Math.round(widthPx * dpr);
    selCanvas.height = Math.round(heightPx * dpr);
    selCanvas.style.width = widthPx + 'px';
    selCanvas.style.height = heightPx + 'px';
    selCanvas.style.left = -extraLeft + 'px';
    selCanvas.style.top = -extraTop + 'px';

    const selCtx = selCanvas.getContext('2d')!;
    selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
    selCtx.save();
    selCtx.scale(dpr, dpr);
    selCtx.fillStyle = isExpand ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)';
    selCtx.strokeStyle = isExpand ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)';
    selCtx.lineWidth = 2;

    // All shape coords are in the selCanvas frame, so add extraLeft/extraTop to anchor
    // the original grid. Coordinates outside [extraLeft, extraLeft+W*cellW] etc. are the expansion area.
    const ox = extraLeft, oy = extraTop;
    if (edge === 'left') {
      if (cell >= 0) {
        // Crop: highlight columns 0..cell that will be removed
        selCtx.fillRect(ox, oy, (cell + 1) * cellW, H * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox + (cell + 1) * cellW, oy);
        selCtx.lineTo(ox + (cell + 1) * cellW, oy + H * cellH);
        selCtx.stroke();
      } else {
        // Expand: highlight new area to the left of the current grid
        selCtx.fillRect(0, oy, -cell * cellW, H * cellH);
        selCtx.beginPath();
        selCtx.moveTo(0, oy);
        selCtx.lineTo(0, oy + H * cellH);
        selCtx.stroke();
      }
    } else if (edge === 'right') {
      if (cell < W) {
        selCtx.fillRect(ox + cell * cellW, oy, (W - cell) * cellW, H * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox + cell * cellW, oy);
        selCtx.lineTo(ox + cell * cellW, oy + H * cellH);
        selCtx.stroke();
      } else {
        selCtx.fillRect(ox + W * cellW, oy, (cell + 1 - W) * cellW, H * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox + (cell + 1) * cellW, oy);
        selCtx.lineTo(ox + (cell + 1) * cellW, oy + H * cellH);
        selCtx.stroke();
      }
    } else if (edge === 'top') {
      if (cell >= 0) {
        selCtx.fillRect(ox, oy, W * cellW, (cell + 1) * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox, oy + (cell + 1) * cellH);
        selCtx.lineTo(ox + W * cellW, oy + (cell + 1) * cellH);
        selCtx.stroke();
      } else {
        selCtx.fillRect(ox, 0, W * cellW, -cell * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox, 0);
        selCtx.lineTo(ox + W * cellW, 0);
        selCtx.stroke();
      }
    } else if (edge === 'bottom') {
      if (cell < H) {
        selCtx.fillRect(ox, oy + cell * cellH, W * cellW, (H - cell) * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox, oy + cell * cellH);
        selCtx.lineTo(ox + W * cellW, oy + cell * cellH);
        selCtx.stroke();
      } else {
        selCtx.fillRect(ox, oy + H * cellH, W * cellW, (cell + 1 - H) * cellH);
        selCtx.beginPath();
        selCtx.moveTo(ox, oy + (cell + 1) * cellH);
        selCtx.lineTo(ox + W * cellW, oy + (cell + 1) * cellH);
        selCtx.stroke();
      }
    }
    selCtx.restore();
  }

  // ── Canvas event listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = patternCanvasRef.current!;
    const selCanvas = selectionCanvasRef.current!;
    if (!canvas || !selCanvas) return;

    function clientToCanvas(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const scale = r.current.currentZoom / 100;
      return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    }

    // Tooltip element
    let tooltip = document.getElementById('convert-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'convert-tooltip';
      tooltip.style.cssText = 'position:fixed;pointer-events:none;z-index:100;background:rgba(196,146,112,0.95);color:white;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.5;white-space:nowrap;display:none;font-family:Inter,sans-serif';
      document.body.appendChild(tooltip);
    }

    function handleMouseMove(e: MouseEvent) {
      const pd = r.current.patternData;
      if (!pd) { tooltip!.style.display = 'none'; return; }
      const { x: canvasX, y: canvasY } = clientToCanvas(e);
      const cx = Math.floor(canvasX / pd.cellW);
      const cy = Math.floor(canvasY / pd.cellH);

      // Crop cursor
      if (!r.current.paintActive && !r.current.selectionActive && !r.current.moveActive && !r.current.cropDragging) {
        const edge = detectCropEdge(canvasX, canvasY);
        const wrapper = document.getElementById('convert-canvas-wrapper');
        if (wrapper) {
          if (edge === 'left' || edge === 'right') wrapper.style.cursor = 'col-resize';
          else if (edge === 'top' || edge === 'bottom') wrapper.style.cursor = 'row-resize';
          else wrapper.style.cursor = r.current.paintActive ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23000'/%3E%3C/svg%3E\") 3 21, crosshair" : 'pointer';
        }
      }

      if (cx < 0 || cx >= pd.W || cy < 0 || cy >= pd.H) { tooltip!.style.display = 'none'; return; }
      const { grid, palette, paletteIndices } = pd;
      const dmcIdx = grid[cy * pd.W + cx];
      const paletteIndexMap = new Map(paletteIndices.map((di, pos) => [di, pos]));
      const dmc = palette[paletteIndexMap.get(dmcIdx)!];
      if (!dmc) return;
      tooltip!.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><div style="width:14px;height:14px;border-radius:4px;background:rgb(${dmc.r},${dmc.g},${dmc.b});border:1px solid rgba(255,255,255,0.3)"></div><span>DMC <strong>${dmc.id}</strong> · ${dmc.name}</span></div><div style="margin-top:2px;opacity:0.75">Col ${cx + 1}, Row ${cy + 1}</div>`;
      tooltip!.style.display = 'block';
      tooltip!.style.left = (e.clientX + 14) + 'px';
      tooltip!.style.top = (e.clientY - 10) + 'px';

      // Paint drag
      if (r.current.isPainting && r.current.paintActive && r.current.activePaintDmcIdx !== null) {
        replaceSinglePixel(cx, cy, r.current.activePaintDmcIdx, true);
      }
      // Crop drag is handled on window-level mousemove so the cursor
      // can leave the canvas while expanding.

      // Selection drag
      if (r.current.selDragging && pd) {
        r.current.selDragEndPx = { x: canvasX, y: canvasY };
        drawRubberBand();
      }

      // Move drag
      if (r.current.moveDragging && pd) {
        r.current.moveDragCurrent = { x: canvasX, y: canvasY };
        drawMovePreview();
      }
    }

    function handleMouseLeave() { tooltip!.style.display = 'none'; }

    function drawRubberBand() {
      const pd = r.current.patternData;
      if (!pd || !r.current.selDragStartPx || !r.current.selDragEndPx) return;
      const { cellW, cellH, W, H } = pd;
      const dpr = window.devicePixelRatio || 1;
      const selCtx = selCanvas.getContext('2d')!;
      selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
      selCtx.save();
      selCtx.scale(dpr, dpr);
      const x0 = Math.max(0, Math.min(Math.floor(r.current.selDragStartPx.x / cellW), W - 1));
      const y0 = Math.max(0, Math.min(Math.floor(r.current.selDragStartPx.y / cellH), H - 1));
      const x1 = Math.max(0, Math.min(Math.floor(r.current.selDragEndPx.x / cellW), W - 1));
      const y1 = Math.max(0, Math.min(Math.floor(r.current.selDragEndPx.y / cellH), H - 1));
      const rx = Math.min(x0, x1) * cellW, ry = Math.min(y0, y1) * cellH;
      const rw = (Math.abs(x1 - x0) + 1) * cellW, rh = (Math.abs(y1 - y0) + 1) * cellH;
      selCtx.fillStyle = 'rgba(99,102,241,0.18)';
      selCtx.fillRect(rx, ry, rw, rh);
      selCtx.strokeStyle = 'rgba(99,102,241,0.9)';
      selCtx.lineWidth = 1.5;
      selCtx.setLineDash([4, 3]);
      selCtx.strokeRect(rx + 0.75, ry + 0.75, rw - 1.5, rh - 1.5);
      selCtx.setLineDash([]);
      selCtx.restore();
    }

    function drawMovePreview() {
      const pd = r.current.patternData;
      if (!pd || !r.current.moveDragStart || !r.current.moveDragCurrent) return;
      const { cellW, cellH, W, H, grid, palette, paletteIndices } = pd;
      const dpr = window.devicePixelRatio || 1;
      const dxCell = Math.floor(r.current.moveDragCurrent.x / cellW) - Math.floor(r.current.moveDragStart.x / cellW);
      const dyCell = Math.floor(r.current.moveDragCurrent.y / cellH) - Math.floor(r.current.moveDragStart.y / cellH);
      const selCtx = selCanvas.getContext('2d')!;
      selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
      selCtx.save();
      selCtx.scale(dpr, dpr);
      const paletteIndexMap = new Map(paletteIndices.map((di, pos) => [di, pos]));
      for (const key of r.current.selectedPixels) {
        const [sx, sy] = key.split(',').map(Number);
        const tx = sx + dxCell, ty = sy + dyCell;
        if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
        const dmcIdx = grid[sy * W + sx];
        const dmc = palette[paletteIndexMap.get(dmcIdx)!];
        if (!dmc) continue;
        selCtx.fillStyle = `rgb(${dmc.r},${dmc.g},${dmc.b})`;
        selCtx.fillRect(tx * cellW, ty * cellH, cellW, cellH);
      }
      selCtx.strokeStyle = 'rgba(99,102,241,0.9)';
      selCtx.lineWidth = 1.5;
      selCtx.setLineDash([4, 3]);
      for (const key of r.current.selectedPixels) {
        const [sx, sy] = key.split(',').map(Number);
        const tx = sx + dxCell, ty = sy + dyCell;
        if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
        selCtx.strokeRect(tx * cellW + 0.75, ty * cellH + 0.75, cellW - 1.5, cellH - 1.5);
      }
      selCtx.setLineDash([]);
      selCtx.restore();
    }

    function commitAreaSelection() {
      const pd = r.current.patternData;
      if (!pd || !r.current.selDragStartPx || !r.current.selDragEndPx) return;
      const { cellW, cellH, W, H } = pd;
      const x0 = Math.max(0, Math.min(Math.floor(r.current.selDragStartPx.x / cellW), W - 1));
      const y0 = Math.max(0, Math.min(Math.floor(r.current.selDragStartPx.y / cellH), H - 1));
      const x1 = Math.max(0, Math.min(Math.floor(r.current.selDragEndPx.x / cellW), W - 1));
      const y1 = Math.max(0, Math.min(Math.floor(r.current.selDragEndPx.y / cellH), H - 1));
      r.current.selectedPixels.clear();
      for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1); cy++)
        for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1); cx++)
          r.current.selectedPixels.add(`${cx},${cy}`);
      r.current.selDragStartPx = null; r.current.selDragEndPx = null;
      setSelectedCount(r.current.selectedPixels.size);
      renderCanvas();
    }

    function handleMouseDown(e: MouseEvent) {
      if (!r.current.patternData || e.button !== 0) return;
      const { x: canvasX, y: canvasY } = clientToCanvas(e);

      // Selection tool
      if (r.current.selectionActive) {
        e.preventDefault();
        r.current.selDragging = true;
        r.current.selDragStartPx = { x: canvasX, y: canvasY };
        r.current.selDragEndPx = { x: canvasX, y: canvasY };
        selCanvas.width = canvas.width; selCanvas.height = canvas.height;
        selCanvas.style.width = canvas.style.width; selCanvas.style.height = canvas.style.height;
        selCanvas.style.display = 'block';
        return;
      }

      // Move tool
      if (r.current.moveActive && r.current.selectedPixels.size > 0) {
        e.preventDefault();
        r.current.moveDragging = true;
        r.current.moveDragStart = { x: canvasX, y: canvasY };
        r.current.moveDragCurrent = { x: canvasX, y: canvasY };
        selCanvas.width = canvas.width; selCanvas.height = canvas.height;
        selCanvas.style.width = canvas.style.width; selCanvas.style.height = canvas.style.height;
        selCanvas.style.left = '0px';
        selCanvas.style.top = '0px';
        selCanvas.style.display = 'block';
        const wrapper = document.getElementById('convert-canvas-wrapper');
        if (wrapper) wrapper.style.cursor = 'grabbing';
        return;
      }

      // Paint tool
      if (r.current.paintActive && r.current.activePaintDmcIdx !== null) {
        e.preventDefault();
        saveUndoState();
        r.current.isPainting = true;
        const pd = r.current.patternData!;
        const cx = Math.floor(canvasX / pd.cellW);
        const cy = Math.floor(canvasY / pd.cellH);
        if (cx >= 0 && cx < pd.W && cy >= 0 && cy < pd.H)
          replaceSinglePixel(cx, cy, r.current.activePaintDmcIdx, true);
        return;
      }

      // Crop / resize drag
      const edge = detectCropEdge(canvasX, canvasY);
      if (edge) {
        e.preventDefault();
        r.current.cropDragging = true;
        r.current.cropEdge = edge;
        const pd = r.current.patternData!;
        r.current.cropPreviewCell = edge === 'left' || edge === 'right'
          ? Math.max(0, Math.min(Math.floor(canvasX / pd.cellW), pd.W - 1))
          : Math.max(0, Math.min(Math.floor(canvasY / pd.cellH), pd.H - 1));
        selCanvas.style.left = '0px';
        selCanvas.style.top = '0px';
        selCanvas.style.display = 'block';
        document.body.style.cursor = (edge === 'left' || edge === 'right') ? 'col-resize' : 'row-resize';
        drawCropPreview(edge, r.current.cropPreviewCell);
      }
    }

    function handleMouseUp(_e: MouseEvent) {
      // Paint tool
      if (r.current.isPainting) {
        r.current.isPainting = false;
        if (r.current.patternData) renderSummary();
      }
      // Crop / resize drag
      if (r.current.cropDragging) {
        r.current.cropDragging = false;
        selCanvas.style.display = 'none';
        selCanvas.style.left = '0px';
        selCanvas.style.top = '0px';
        selCanvas.getContext('2d')!.clearRect(0, 0, selCanvas.width, selCanvas.height);
        const wrapper = document.getElementById('convert-canvas-wrapper');
        if (wrapper) wrapper.style.cursor = 'pointer';
        document.body.style.cursor = '';
        if (r.current.cropEdge !== null) {
          r.current.suppressNextClick = true;
          applyCrop(r.current.cropEdge, r.current.cropPreviewCell);
        }
        r.current.cropEdge = null; r.current.cropPreviewCell = -1;
      }
      // Selection drag
      if (r.current.selDragging) {
        r.current.selDragging = false;
        selCanvas.style.display = 'none';
        selCanvas.getContext('2d')!.clearRect(0, 0, selCanvas.width, selCanvas.height);
        if (r.current.selDragEndPx) commitAreaSelection();
      }
      // Move drag
      if (r.current.moveDragging) {
        r.current.moveDragging = false;
        selCanvas.style.display = 'none';
        selCanvas.getContext('2d')!.clearRect(0, 0, selCanvas.width, selCanvas.height);
        const pd = r.current.patternData;
        if (pd && r.current.moveDragStart && r.current.moveDragCurrent) {
          const dx = Math.floor(r.current.moveDragCurrent.x / pd.cellW) - Math.floor(r.current.moveDragStart.x / pd.cellW);
          const dy = Math.floor(r.current.moveDragCurrent.y / pd.cellH) - Math.floor(r.current.moveDragStart.y / pd.cellH);
          if (dx !== 0 || dy !== 0) commitMove(dx, dy);
        }
        r.current.moveDragStart = null;
        r.current.moveDragCurrent = null;
        const wrapper = document.getElementById('convert-canvas-wrapper');
        if (wrapper) wrapper.style.cursor = r.current.moveActive ? 'grab' : 'pointer';
      }
    }

    function handleClick(e: MouseEvent) {
      if (r.current.suppressNextClick) { r.current.suppressNextClick = false; return; }
      if (!r.current.patternData) return;
      if (r.current.paintActive || r.current.selectionActive || r.current.moveActive) return;
      const { x: canvasX, y: canvasY } = clientToCanvas(e);
      const pd = r.current.patternData!;
      const cx = Math.floor(canvasX / pd.cellW);
      const cy = Math.floor(canvasY / pd.cellH);
      if (cx < 0 || cx >= pd.W || cy < 0 || cy >= pd.H) return;
      const dmcIdx = pd.grid[cy * pd.W + cx];
      openColorReplaceModal(dmcIdx, { x: cx, y: cy });
    }

    function handleWindowMouseMove(e: MouseEvent) {
      if (!r.current.cropDragging) return;
      const pd = r.current.patternData;
      if (!pd || !r.current.cropEdge) return;
      const { x: canvasX, y: canvasY } = clientToCanvas(e);
      const { cellW, cellH, W, H } = pd;
      if (r.current.cropEdge === 'left') {
        const cell = Math.floor(canvasX / cellW);
        r.current.cropPreviewCell = Math.max(W - MAX_GRID_DIM, Math.min(cell, W - MIN_GRID_DIM));
      } else if (r.current.cropEdge === 'right') {
        const cell = Math.floor(canvasX / cellW);
        r.current.cropPreviewCell = Math.max(MIN_GRID_DIM - 1, Math.min(cell, MAX_GRID_DIM - 1));
      } else if (r.current.cropEdge === 'top') {
        const cell = Math.floor(canvasY / cellH);
        r.current.cropPreviewCell = Math.max(H - MAX_GRID_DIM, Math.min(cell, H - MIN_GRID_DIM));
      } else if (r.current.cropEdge === 'bottom') {
        const cell = Math.floor(canvasY / cellH);
        r.current.cropPreviewCell = Math.max(MIN_GRID_DIM - 1, Math.min(cell, MAX_GRID_DIM - 1));
      }
      drawCropPreview(r.current.cropEdge, r.current.cropPreviewCell);
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleUp);

    function handleUp(e: MouseEvent) { handleMouseUp(e); }

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('click', handleClick);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleUp);
      tooltip?.remove();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); handleRedo(); }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize
  useEffect(() => {
    const handler = () => { if (r.current.patternData) requestAnimationFrame(fitToCanvas); };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [fitToCanvas]);

  // ── File upload ──────────────────────────────────────────────────────────────

  function loadFile(file: File) {
    if (!file.type.match('image/(png|jpeg|webp)')) { showToast('Please upload a PNG or JPG image.'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('File size must be under 10MB.'); return; }
    const reader = new FileReader();
    reader.onload = e2 => {
      const img = new Image();
      img.onload = () => {
        r.current.uploadedImage = img;
        r.current.originalAspect = img.naturalWidth / img.naturalHeight;
        setIsUploaded(true);
        setUploadFileName(file.name);
        const newH = Math.max(10, Math.round(gridWidth / r.current.originalAspect!));
        setGridHeight(newH);
        updateHeightDisplay(gridWidth, newH);
        setIsLoading(true);
        setHasPattern(false);
        setTimeout(generatePattern, 50);
      };
      img.src = e2.target!.result as string;
      // show original image
      setOriginalSrc(e2.target!.result as string);
      const origEl = document.getElementById('convert-original-img') as HTMLImageElement;
      if (origEl) origEl.src = e2.target!.result as string;
      const thumbEl = document.getElementById('convert-upload-thumb') as HTMLImageElement;
      if (thumbEl) thumbEl.src = e2.target!.result as string;
    };
    reader.readAsDataURL(file);
  }

  function updateHeightDisplay(_w: number, h: number) {
    const ro = parseFloat(gaugeRows) || 0;
    const hCm = ro ? (Math.round(h / ro * 10 * 10) / 10) : null;
    setHeightDisplay(hCm ? `${h} rows · ${hCm} cm` : `${h} rows`);
  }

  // Gauge calculator
  function calcCmToSt() {
    const sts = parseFloat(gaugeStitches) || 0;
    if (!sts || !gcWidthCm) { setGcResultCm(''); return; }
    const w = Math.round(parseFloat(gcWidthCm) / 10 * sts);
    setGcResultCm(`${w} sts wide`);
    setGridWidth(w);
    if (r.current.originalAspect) {
      const h = Math.max(10, Math.round(w / r.current.originalAspect));
      setGridHeight(h);
      updateHeightDisplay(w, h);
    }
  }

  function calcStToCm() {
    const sts = parseFloat(gaugeStitches) || 0;
    if (!sts || !gcWidthSt) { setGcResultSt(''); return; }
    const cm = Math.round(parseFloat(gcWidthSt) / sts * 10 * 10) / 10;
    setGcResultSt(`${cm} cm wide`);
    setGridWidth(parseInt(gcWidthSt) || gridWidth);
    if (r.current.originalAspect) {
      const w = parseInt(gcWidthSt) || gridWidth;
      const h = Math.max(10, Math.round(w / r.current.originalAspect));
      setGridHeight(h);
      updateHeightDisplay(w, h);
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────

  function handleExportPNG() {
    const canvas = patternCanvasRef.current;
    if (!canvas?.width || !r.current.patternData) { showToast('Generate a pattern first.'); return; }
    const MARGIN = 24;
    const exp = document.createElement('canvas');
    exp.width = canvas.width + MARGIN * 2;
    exp.height = canvas.height + MARGIN * 2;
    const ctx = exp.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, exp.width, exp.height);
    ctx.drawImage(canvas, MARGIN, MARGIN);
    const link = document.createElement('a');
    link.download = 'knitmate-pattern.png';
    link.href = exp.toDataURL('image/png');
    link.click();
    showToast('PNG downloaded!');
  }

  function handleExportPDF() {
    const canvas = patternCanvasRef.current;
    if (!canvas?.width || !r.current.patternData) { showToast('Generate a pattern first.'); return; }
    const win = window.open('', '_blank');
    if (!win) { showToast('Please allow popups to export PDF.'); return; }
    const { palette, paletteIndices, stitchCounts } = r.current.patternData;
    const sorted = paletteIndices.map((dmcIdx, pos) => ({ dmc: palette[pos], count: stitchCounts.get(dmcIdx) || 0 }))
      .sort((a, b) => b.count - a.count);
    const legendRows = sorted.map(({ dmc, count }, i) => `<tr><td>${i + 1}</td><td><div style="width:18px;height:18px;background:rgb(${dmc.r},${dmc.g},${dmc.b});border:1px solid #ccc;border-radius:3px"></div></td><td><strong>${dmc.id}</strong></td><td>${dmc.name}</td><td style="text-align:right">${count.toLocaleString()}</td></tr>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>KnitMate Pattern</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#C49270}h1{font-size:20px;margin-bottom:8px}img{max-width:100%;border:1px solid #eee}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}th{border-bottom:2px solid #C49270;padding:6px 8px;text-align:left;font-size:11px;color:#777}td{border-bottom:1px solid #eee;padding:5px 8px;vertical-align:middle}@media print{body{margin:10px}}</style></head><body><h1>KnitMate Cross-Stitch Pattern</h1><img src="${canvas.toDataURL()}"><h2 style="font-size:16px;margin-top:24px">DMC Thread Legend</h2><table><thead><tr><th>#</th><th>Swatch</th><th>DMC No.</th><th>Color Name</th><th style="text-align:right">Stitches</th></tr></thead><tbody>${legendRows}</tbody></table></body></html>`);
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 500);
  }

  function handleSave() {
    if (!r.current.patternData) { showToast('Generate a pattern first.'); return; }
    const { grid, paletteIndices, W, H, cellW, cellH } = r.current.patternData;
    const payload = { version: 1, W, H, cellW, cellH, paletteIndices: Array.from(paletteIndices), grid: Array.from(grid) };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = 'knitmate-pattern.knitmate'; link.href = URL.createObjectURL(blob); link.click();
    URL.revokeObjectURL(link.href);
    showToast('Pattern saved!');
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = e2 => {
      try {
        const payload = JSON.parse(e2.target!.result as string);
        if (!payload.version || !payload.grid || !payload.paletteIndices) throw new Error('Invalid file');
        const { W, H, cellW, cellH, paletteIndices, grid } = payload;
        const dmcIndices = new Uint16Array(grid);
        const palette = paletteIndices.map((i: number) => DMC_WITH_LAB[i]);
        const stitchCounts = new Map<number, number>();
        paletteIndices.forEach((i: number) => stitchCounts.set(i, 0));
        for (let i = 0; i < W * H; i++) stitchCounts.set(dmcIndices[i], (stitchCounts.get(dmcIndices[i]) || 0) + 1);
        r.current.patternData = { grid: dmcIndices, palette, paletteIndices, stitchCounts, W, H, cellW, cellH };
        r.current.undoStack = []; r.current.redoStack = [];
        setCanUndo(false); setCanRedo(false);
        setGridWidth(W); setGridHeight(H);
        renderCanvas(); renderSummary();
        setHasPattern(true); setIsLoading(false);
        setView('pattern');
        requestAnimationFrame(() => requestAnimationFrame(fitToCanvas));
        showToast('Pattern imported!');
      } catch { showToast('Could not load file. Is it a valid .knitmate file?'); }
    };
    reader.readAsText(file);
  }

  // ── Color replace modal list ──────────────────────────────────────────────────

  function crFilteredColors() {
    const pd = r.current.patternData;
    const q = crSearch.toLowerCase().trim();
    const currentPaletteIndices = pd ? pd.paletteIndices : [];
    const currentPaletteSet = new Set(currentPaletteIndices);
    const allFiltered = DMC_WITH_LAB
      .map((dmc, dmcIdx) => ({ dmc, dmcIdx }))
      .filter(({ dmc }) => !q || dmc.id.toLowerCase().includes(q) || dmc.name.toLowerCase().includes(q));
    const palette = allFiltered.filter(x => currentPaletteSet.has(x.dmcIdx));
    const rest = allFiltered.filter(x => !currentPaletteSet.has(x.dmcIdx)).slice(0, 150);
    return { palette, rest };
  }

  function pcFilteredColors() {
    const q = pcSearch.toLowerCase().trim();
    return DMC_WITH_LAB
      .map((dmc, dmcIdx) => ({ dmc, dmcIdx }))
      .filter(({ dmc }) => !q || dmc.id.toLowerCase().includes(q) || dmc.name.toLowerCase().includes(q))
      .slice(0, 150);
  }

  // ── Row-by-row instructions ──────────────────────────────────────────────────

  function generateRowInstructions() {
    const pd = r.current.patternData;
    if (!pd) return [];
    const { grid, palette, paletteIndices, W, H } = pd;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const paletteIndexMap = new Map(paletteIndices.map((di, pos) => [di, pos]));

    type Segment = { count: number; name: string; id: string; letter: string; bg: string };
    type Row = { row: number; isOdd: boolean; segments: Segment[] };
    const rows: Row[] = [];

    // Row R (1-indexed, bottom up) maps to grid y = H - R.
    for (let row = 1; row <= H; row++) {
      const y = H - row;
      const isOdd = row % 2 === 1;
      // Odd: read right→left (grid x: W-1 → 0). Even: read left→right (grid x: 0 → W-1).
      const xStart = isOdd ? W - 1 : 0;
      const xEnd = isOdd ? -1 : W;
      const xStep = isOdd ? -1 : 1;

      const segments: Segment[] = [];
      let curr = -1;
      let count = 0;
      const flush = () => {
        if (count === 0) return;
        const pos = paletteIndexMap.get(curr);
        if (pos === undefined) return;
        const dmc = palette[pos];
        segments.push({
          count,
          name: dmc.name,
          id: dmc.id,
          letter: letters[pos] ?? String(pos + 1),
          bg: `rgb(${dmc.r},${dmc.g},${dmc.b})`,
        });
      };
      for (let x = xStart; x !== xEnd; x += xStep) {
        const dmcIdx = grid[y * W + x];
        if (dmcIdx === curr) {
          count++;
        } else {
          flush();
          curr = dmcIdx;
          count = 1;
        }
      }
      flush();
      rows.push({ row, isOdd, segments });
    }
    return rows;
  }

  function handleCrSelect(dmcIdx: number) {
    if (r.current.colorReplacePixel) replaceSinglePixel(r.current.colorReplacePixel.x, r.current.colorReplacePixel.y, dmcIdx);
    else if (r.current.colorReplaceScope === 'selection') paintSelectedPixels(dmcIdx);
    else replacePatternColor(r.current.colorReplaceTarget!, dmcIdx);
    closeColorReplaceModal();
  }

  // ── JSX ───────────────────────────────────────────────────────────────────────

  const { palette: crPalette, rest: crRest } = colorReplaceOpen ? crFilteredColors() : { palette: [], rest: [] };
  const pcColors = paintColorOpen ? pcFilteredColors() : [];
  const instructionsRows = instructionsOpen ? generateRowInstructions() : [];

  function closeInstructions() {
    setInstructionsOpen(false);
    document.body.style.overflow = '';
  }

  function handleCopyInstructions() {
    const lines = instructionsRows.map(({ row, isOdd, segments }) => {
      const dirLabel = isOdd ? 'knit row, read right → left' : 'purl row, read left → right';
      const verb = isOdd ? 'Knit' : 'Purl';
      const segText = segments.map(s => `${verb} ${s.count} in ${s.name} (${s.letter})`).join(' → ');
      return `Row ${row} (${dirLabel})\n${segText}.`;
    });
    navigator.clipboard.writeText(lines.join('\n\n')).then(
      () => showToast('Instructions copied!'),
      () => showToast('Could not copy to clipboard.')
    );
  }

  return (
    <div className="w-full min-h-screen text-warm antialiased overflow-x-hidden" style={{ background: '#FAF7F4' }}>
      <Toast message={toastMsg} visible={toastVisible} />

      {/* Color Replace Modal */}
      {colorReplaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) closeColorReplaceModal(); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col" style={{ maxHeight: '80vh' }}>
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-brand-dark mb-3">Replace Color</h3>
              <div className="flex items-center gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
                <div style={{ width: 32, height: 32, borderRadius: 8, background: crCurrentBg, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-brand-dark">{crCurrentId}</div>
                  <div className="text-xs text-brand-gray truncate">{crCurrentName}</div>
                </div>
                <span className="text-xs text-brand-gray flex-shrink-0">→ choose below</span>
              </div>
              {/* Custom color picker */}
              <div className="mb-3">
                <p className="text-xs text-brand-gray mb-2">Or pick any color</p>
                <div className="flex items-center gap-2">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: crPickerBg, border: '2px solid #e5e7eb', cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => document.getElementById('cr-color-native')?.click()} />
                  <input type="color" id="cr-color-native" className="sr-only"
                    onChange={e => { setCrPickerBg(e.target.value); setCrHex(e.target.value.toUpperCase()); applyPickedCrColor(e.target.value); }} />
                  <input type="text" placeholder="#RRGGBB" maxLength={7} value={crHex}
                    onChange={e => {
                      let hex = e.target.value.trim();
                      if (!hex.startsWith('#')) hex = '#' + hex;
                      setCrHex(hex.toUpperCase());
                      if (/^#[0-9a-fA-F]{6}$/.test(hex)) { setCrPickerBg(hex); applyPickedCrColor(hex); }
                    }}
                    className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-dark font-mono uppercase" />
                  {crNearest && (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: crNearest.bg, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                      <span className="text-xs font-semibold text-brand-dark truncate">{crNearest.label}</span>
                    </div>
                  )}
                </div>
              </div>
              <input type="text" placeholder="Search DMC number or name…" value={crSearch}
                onChange={e => setCrSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-dark" />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {crPalette.length > 0 && <>
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 pt-3 pb-1">Current Colors</p>
                {crPalette.map(({ dmc, dmcIdx }) => (
                  <button key={dmcIdx} onClick={() => handleCrSelect(dmcIdx)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left ${dmcIdx === r.current.colorReplaceTarget ? 'bg-brand-light' : ''}`}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: `rgb(${dmc.r},${dmc.g},${dmc.b})`, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                    <span className="text-sm font-semibold text-brand-dark w-14 flex-shrink-0">{dmc.id}</span>
                    <span className="text-sm text-brand-darker truncate">{dmc.name}</span>
                  </button>
                ))}
                <div className="mx-3 my-2 border-t border-gray-100" />
                <p className="text-xs font-semibold text-brand-gray uppercase tracking-wide px-3 pb-1">All DMC Colors</p>
              </>}
              {crRest.map(({ dmc, dmcIdx }) => (
                <button key={dmcIdx} onClick={() => handleCrSelect(dmcIdx)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: `rgb(${dmc.r},${dmc.g},${dmc.b})`, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                  <span className="text-sm font-semibold text-brand-dark w-14 flex-shrink-0">{dmc.id}</span>
                  <span className="text-sm text-brand-darker truncate">{dmc.name}</span>
                </button>
              ))}
              {crPalette.length === 0 && crRest.length === 0 && (
                <p className="text-sm text-brand-gray text-center py-8">No colors found</p>
              )}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={closeColorReplaceModal} className="w-full py-2 text-sm font-medium text-brand-gray hover:text-brand-dark transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Paint Color Picker Modal */}
      {paintColorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) setPaintColorOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col" style={{ maxHeight: '80vh' }}>
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-brand-dark mb-3">Pick Paint Color</h3>
              <div className="mb-3">
                <p className="text-xs text-brand-gray mb-2">Pick any color</p>
                <div className="flex items-center gap-2">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: pcPickerBg, border: '2px solid #e5e7eb', cursor: 'pointer', flexShrink: 0 }}
                    onClick={() => document.getElementById('pc-color-native')?.click()} />
                  <input type="color" id="pc-color-native" className="sr-only"
                    onChange={e => { setPcPickerBg(e.target.value); setPcHex(e.target.value.toUpperCase()); applyPickedPcColor(e.target.value); }} />
                  <input type="text" placeholder="#RRGGBB" maxLength={7} value={pcHex}
                    onChange={e => {
                      let hex = e.target.value.trim();
                      if (!hex.startsWith('#')) hex = '#' + hex;
                      setPcHex(hex.toUpperCase());
                      if (/^#[0-9a-fA-F]{6}$/.test(hex)) { setPcPickerBg(hex); applyPickedPcColor(hex); }
                    }}
                    className="w-28 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-dark font-mono uppercase" />
                  {pcNearest && (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <div style={{ width: 20, height: 20, borderRadius: 4, background: pcNearest.bg, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                      <span className="text-xs font-semibold text-brand-dark truncate">{pcNearest.label}</span>
                    </div>
                  )}
                </div>
              </div>
              <input type="text" placeholder="Search DMC number or name…" value={pcSearch}
                onChange={e => setPcSearch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-brand-dark" />
            </div>
            <div className="overflow-y-auto flex-1 p-2">
              {pcColors.map(({ dmc, dmcIdx }) => (
                <button key={dmcIdx}
                  onClick={() => { setPaintColor(dmcIdx); setPaintColorOpen(false); document.body.style.overflow = ''; }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left ${dmcIdx === r.current.activePaintDmcIdx ? 'bg-brand-light' : ''}`}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: `rgb(${dmc.r},${dmc.g},${dmc.b})`, border: '1px solid #e5e7eb', flexShrink: 0 }} />
                  <span className="text-sm font-semibold text-brand-dark w-14 flex-shrink-0">{dmc.id}</span>
                  <span className="text-sm text-brand-darker truncate">{dmc.name}</span>
                </button>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={() => { setPaintColorOpen(false); document.body.style.overflow = ''; }}
                className="w-full py-2 text-sm font-medium text-brand-gray hover:text-brand-dark transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Row Instructions Modal */}
      {instructionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) closeInstructions(); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
            <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-brand-dark">Row-by-Row Instructions</h3>
                <p className="text-xs text-brand-gray mt-0.5">
                  Odd rows: knit, read right → left. Even rows: purl, read left → right.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleCopyInstructions}
                  className="bg-white border border-gray-200 text-brand-darker text-xs font-semibold px-3 py-2 rounded-lg hover:border-brand-dark transition-all flex items-center gap-1.5">
                  <i className="fa-solid fa-copy" /> Copy
                </button>
                <button onClick={closeInstructions}
                  className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-brand-darker hover:bg-brand-light hover:border-brand-light transition-all">
                  <i className="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3">
              {instructionsRows.length === 0 ? (
                <p className="text-sm text-brand-gray text-center py-8">No pattern data.</p>
              ) : (
                instructionsRows.map(({ row, isOdd, segments }) => {
                  const verb = isOdd ? 'Knit' : 'Purl';
                  const dirLabel = isOdd ? 'knit row, read right → left' : 'purl row, read left → right';
                  return (
                    <div key={row} className={`py-3 ${row !== instructionsRows.length ? 'border-b border-gray-100' : ''}`}>
                      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                        <span className="text-sm font-bold text-brand-dark">Row {row}</span>
                        <span className="text-xs text-brand-gray">({dirLabel})</span>
                      </div>
                      <div className="text-sm text-brand-darker leading-relaxed flex flex-wrap items-center gap-x-1 gap-y-1.5">
                        {segments.map((s, i) => (
                          <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
                            {i > 0 && <span className="text-brand-gray mx-1">→</span>}
                            <strong>{verb} {s.count}</strong>
                            <span>in</span>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.bg, border: '1px solid rgba(0,0,0,0.15)', display: 'inline-block', flexShrink: 0 }} />
                            <span>{s.name} ({s.letter})</span>
                          </span>
                        ))}
                        <span>.</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-4 border-t border-gray-100">
              <button onClick={closeInstructions}
                className="w-full py-2 text-sm font-medium text-brand-gray hover:text-brand-dark transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      <main className="pt-24 pb-4 md:pb-0 w-full min-h-screen md:h-screen md:overflow-hidden flex flex-col md:flex-row gap-6 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">

        {/* Sidebar */}
        <aside className="w-full md:w-80 lg:w-96 flex-shrink-0 bg-white rounded-2xl shadow-card p-6 border border-gray-100 h-fit md:h-full md:overflow-y-auto">
          <h2 className="text-xl font-bold text-brand-dark mb-6">Pattern Settings</h2>

          {/* Upload */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-brand-dark">Source Image</label>
            <label
              className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center hover:border-brand-dark transition-colors cursor-pointer bg-gray-50 group block"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-brand-dark', 'bg-brand-light/20'); }}
              onDragLeave={e => e.currentTarget.classList.remove('border-brand-dark', 'bg-brand-light/20')}
              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-brand-dark', 'bg-brand-light/20'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); }}>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { if (e.target.files?.[0]) loadFile(e.target.files[0]); e.target.value = ''; }} />
              <div className="w-12 h-12 rounded-full bg-brand-light flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <i className="fa-solid fa-cloud-arrow-up text-brand-dark" />
              </div>
              <p className="text-sm font-medium text-brand-dark">{uploadFileName}</p>
              <p className="text-xs text-brand-gray mt-1">PNG, JPG up to 10MB</p>
            </label>
            {isUploaded && <img id="convert-upload-thumb" className="w-full h-32 object-contain rounded-lg border border-gray-200 bg-gray-50" alt="" />}
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-px bg-gray-200" /><span className="text-xs text-brand-gray">or</span><div className="flex-1 h-px bg-gray-200" />
            </div>
            <label className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-2.5 text-xs font-semibold text-brand-dark hover:border-brand-dark transition-all bg-gray-50 hover:bg-brand-light/20 cursor-pointer">
              <input type="file" accept=".knitmate" className="hidden" onChange={e => { if (e.target.files?.[0]) { handleImport(e.target.files[0]); e.target.value = ''; } }} />
              <i className="fa-solid fa-folder-open" /> Import saved pattern (.knitmate)
            </label>
          </div>

          {/* Gauge */}
          <div className="space-y-3 pt-4 border-t border-gray-100 mt-6">
            <label className="block text-sm font-semibold text-brand-dark">Gauge (per 10cm / 4")</label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-brand-gray mb-1 block">Stitches</label>
                <input type="number" value={gaugeStitches} min={1} placeholder="e.g. 20"
                  onChange={e => setGaugeStitches(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:border-brand-dark outline-none text-sm font-medium" />
              </div>
              <div>
                <label className="text-xs text-brand-gray mb-1 block">Rows</label>
                <input type="number" value={gaugeRows} min={1} placeholder="e.g. 26"
                  onChange={e => setGaugeRows(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-gray-200 focus:border-brand-dark outline-none text-sm font-medium" />
              </div>
            </div>
          </div>

          {/* Gauge Calculator */}
          <div className="space-y-3 pt-4 border-t border-gray-100 mt-2">
            <label className="block text-sm font-semibold text-brand-dark"><i className="fa-solid fa-ruler-combined mr-1.5 text-brand-gray" />Gauge Calculator</label>
            <p className="text-xs text-brand-gray -mt-1">Enter either one — whichever you know.</p>
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-2 p-3 rounded-xl border border-gray-200 bg-gray-50">
                <div className="text-xs font-semibold text-brand-dark text-center pb-1 border-b border-gray-200">cm → Stitches</div>
                <div>
                  <label className="text-xs text-brand-gray mb-1 block">Width (cm)</label>
                  <input type="number" min={0} placeholder="e.g. 45" value={gcWidthCm}
                    onChange={e => { setGcWidthCm(e.target.value); setGcResultCm(''); }}
                    onBlur={calcCmToSt}
                    className="w-full px-2 py-1.5 rounded-lg border border-gray-200 focus:border-brand-dark outline-none text-xs font-medium" />
                </div>
                {gcResultCm && <div className="bg-brand-light/40 rounded-lg p-2 text-xs text-brand-dark">{gcResultCm}</div>}
              </div>
              <div className="flex flex-col items-center justify-center gap-1 pt-6 flex-shrink-0">
                <div className="w-px flex-1 bg-gray-200" />
                <span className="text-xs font-semibold text-brand-gray bg-white border border-gray-200 rounded-full px-1.5 py-0.5">or</span>
                <div className="w-px flex-1 bg-gray-200" />
              </div>
              <div className="flex-1 space-y-2 p-3 rounded-xl border border-gray-200 bg-gray-50">
                <div className="text-xs font-semibold text-brand-dark text-center pb-1 border-b border-gray-200">Stitches → cm</div>
                <div>
                  <label className="text-xs text-brand-gray mb-1 block">Width (sts)</label>
                  <input type="number" min={0} placeholder="e.g. 100" value={gcWidthSt}
                    onChange={e => { setGcWidthSt(e.target.value); setGcResultSt(''); }}
                    onBlur={calcStToCm}
                    className="w-full px-2 py-1.5 rounded-lg border border-gray-200 focus:border-brand-dark outline-none text-xs font-medium" />
                </div>
                {gcResultSt && <div className="bg-brand-light/40 rounded-lg p-2 text-xs text-brand-dark">{gcResultSt}</div>}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
              <span className="text-brand-gray font-medium">Height (from image)</span>
              <span className="font-bold text-brand-dark">{heightDisplay}</span>
            </div>
          </div>

          {/* Max Colors */}
          <div className="space-y-3 pt-4 border-t border-gray-100 mt-2">
            <label className="block text-sm font-semibold text-brand-dark">
              Max DMC Colors: <span className="text-brand-dark">{maxColors}</span>
            </label>
            <input type="range" value={maxColors} min={2} max={40} step={1}
              onChange={e => setMaxColors(parseInt(e.target.value))}
              className="w-full accent-brand-dark" />
            <p className="text-xs text-brand-gray">Limits the number of DMC thread colors used</p>
          </div>

          <div className="pt-4 border-t border-gray-100 mt-2">
            <button onClick={handleGenerate}
              className="w-full bg-brand-dark text-white font-semibold py-3.5 rounded-xl hover:bg-brand-darker transition-all shadow-md flex items-center justify-center gap-2">
              <i className="fa-solid fa-wand-magic-sparkles" /> Generate Pattern
            </button>
          </div>
        </aside>

        {/* Right Column */}
        <div className="flex-1 flex flex-col gap-6 md:h-full md:overflow-hidden md:min-h-0">

          {/* Top Controls */}
          <div className="bg-white rounded-2xl shadow-card p-4 border border-gray-100 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              {/* View toggle */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button onClick={() => setView('pattern')}
                  className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${view === 'pattern' ? 'bg-white shadow-sm text-brand-dark' : 'text-brand-gray hover:text-brand-dark'}`}>
                  Pattern
                </button>
                <button onClick={() => setView('original')}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'original' ? 'bg-white shadow-sm text-brand-dark font-semibold' : 'text-brand-gray hover:text-brand-dark'}`}>
                  Original
                </button>
              </div>
              {/* Grid toggle */}
              <button
                onClick={() => {
                  r.current.showGrid = !r.current.showGrid;
                  setShowGridState(r.current.showGrid);
                  if (r.current.patternData) renderCanvas();
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${showGrid ? 'bg-brand-light border-brand-dark text-brand-dark' : 'border-gray-200 text-brand-dark'}`}>
                <i className="fa-solid fa-border-all text-xs" /> Grid
              </button>
              <div className="w-px h-6 bg-gray-200" />
              {/* Undo / Redo */}
              <button onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-brand-darker hover:bg-brand-light hover:border-brand-light transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                <i className="fa-solid fa-rotate-left text-xs" />
              </button>
              <button onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-brand-darker hover:bg-brand-light hover:border-brand-light transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                <i className="fa-solid fa-rotate-right text-xs" />
              </button>
              {/* Select tool */}
              <button
                onClick={() => {
                  const next = !r.current.selectionActive;
                  r.current.selectionActive = next;
                  setSelectionActive(next);
                  const wrapper = document.getElementById('convert-canvas-wrapper');
                  if (wrapper) wrapper.style.cursor = next ? 'crosshair' : 'pointer';
                  if (next) {
                    if (r.current.moveActive) { r.current.moveActive = false; setMoveActive(false); }
                  }
                  if (!next) {
                    r.current.selectedPixels.clear();
                    setSelectedCount(0);
                    if (selectionCanvasRef.current) selectionCanvasRef.current.style.display = 'none';
                    if (r.current.patternData) renderCanvas();
                    if (r.current.paintActive) { r.current.paintActive = false; setPaintActive(false); }
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectionActive ? 'bg-brand-light border-brand-dark text-brand-dark' : 'border-gray-200 text-brand-dark hover:border-brand-dark'}`}>
                <i className="fa-solid fa-arrow-pointer text-xs" /> Select
              </button>
              <div className="w-px h-6 bg-gray-200" />
              {/* Paint tool */}
              <button
                onClick={() => {
                  const next = !r.current.paintActive;
                  r.current.paintActive = next;
                  setPaintActive(next);
                  const wrapper = document.getElementById('convert-canvas-wrapper');
                  if (next) {
                    if (wrapper) wrapper.style.cursor = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23000'/%3E%3C/svg%3E\") 3 21, crosshair";
                    if (r.current.activePaintDmcIdx === null && r.current.patternData?.paletteIndices.length) {
                      setPaintColor(r.current.patternData.paletteIndices[0]);
                    }
                    if (r.current.selectionActive) {
                      r.current.selectionActive = false;
                      setSelectionActive(false);
                      r.current.selectedPixels.clear();
                      setSelectedCount(0);
                      if (selectionCanvasRef.current) selectionCanvasRef.current.style.display = 'none';
                      if (r.current.patternData) renderCanvas();
                    }
                    if (r.current.moveActive) { r.current.moveActive = false; setMoveActive(false); }
                  } else {
                    if (wrapper) wrapper.style.cursor = 'pointer';
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${paintActive ? 'bg-brand-light border-brand-dark text-brand-dark' : 'border-gray-200 text-brand-dark hover:border-brand-dark'}`}>
                <i className="fa-solid fa-pencil text-xs" /> Paint
              </button>
              {paintActive && paintColorDisplay && (
                <div onClick={() => { setPcSearch(''); setPcHex(''); setPcPickerBg('#cccccc'); setPcNearest(null); setPaintColorOpen(true); document.body.style.overflow = 'hidden'; }}
                  className="flex items-center gap-1.5 pl-1 pr-3 py-1.5 rounded-lg border border-brand-dark bg-brand-light cursor-pointer hover:opacity-80 transition-opacity">
                  <div style={{ width: 16, height: 16, borderRadius: 3, background: paintColorDisplay.bg, border: '1px solid rgba(255,255,255,0.6)', flexShrink: 0 }} />
                  <span className="text-xs font-semibold text-brand-dark truncate max-w-[72px]">{paintColorDisplay.label}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { r.current.currentZoom = Math.max(25, r.current.currentZoom - 25); const z = r.current.currentZoom; setZoom(z); if (patternGridRef.current) { patternGridRef.current.style.transform = `scale(${z / 100})`; patternGridRef.current.style.transformOrigin = 'top left'; } }}
                className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-brand-darker hover:bg-brand-light hover:border-brand-light transition-all">
                <i className="fa-solid fa-magnifying-glass-minus text-xs" />
              </button>
              <span className="text-sm font-medium w-12 text-center">{zoom}%</span>
              <button onClick={() => { r.current.currentZoom = Math.min(400, r.current.currentZoom + 25); const z = r.current.currentZoom; setZoom(z); if (patternGridRef.current) { patternGridRef.current.style.transform = `scale(${z / 100})`; patternGridRef.current.style.transformOrigin = 'top left'; } }}
                className="w-9 h-9 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-brand-darker hover:bg-brand-light hover:border-brand-light transition-all">
                <i className="fa-solid fa-magnifying-glass-plus text-xs" />
              </button>
              <div className="w-px h-6 bg-gray-200" />
              <button
                onClick={() => {
                  if (!r.current.patternData) { showToast('Generate a pattern first.'); return; }
                  setInstructionsOpen(true);
                  document.body.style.overflow = 'hidden';
                }}
                title="Row-by-row stitch instructions"
                className="bg-white border border-gray-200 text-brand-darker text-xs font-semibold px-3 py-2 rounded-lg hover:border-brand-dark transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-list-ol" /> Instructions
              </button>
              <button onClick={handleExportPNG} className="bg-white border border-gray-200 text-brand-darker text-xs font-semibold px-3 py-2 rounded-lg hover:border-brand-dark transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-image" /> PNG
              </button>
              <button onClick={handleExportPDF} className="bg-white border border-gray-200 text-brand-darker text-xs font-semibold px-3 py-2 rounded-lg hover:border-brand-dark transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-file-pdf" /> PDF
              </button>
              <button onClick={handleSave} className="bg-brand-dark text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-brand-darker transition-all flex items-center gap-1.5">
                <i className="fa-solid fa-floppy-disk" /> Save
              </button>
            </div>
          </div>

          {/* Summary bar */}
          {summaryData && hasPattern && (
            <div className="bg-white rounded-2xl shadow-card border border-gray-100 px-4 py-2.5 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><span className="text-brand-gray">Size</span><span className="font-semibold text-brand-darker">{summaryData.size}</span></div>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center gap-1.5"><span className="text-brand-gray">DMC Colors</span><span className="font-semibold text-brand-darker">{summaryData.colors}</span></div>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center gap-1.5"><span className="text-brand-gray">Est. Size</span><span className="font-semibold text-brand-darker">{summaryData.est}</span></div>
              <div className="w-px h-4 bg-gray-200" />
              <div className="flex items-center gap-1.5">
                <span className="text-brand-gray">Colors</span>
                <div className="flex flex-wrap gap-1">
                  {summaryData.swatches.map(sw => (
                    <div key={sw.dmcIdx}
                      title={`DMC ${sw.id}: ${sw.name}`}
                      onClick={() => {
                        if (paintActive) { setPaintColor(sw.dmcIdx); }
                        else if (selectedCount > 0) { saveUndoState(); paintSelectedPixels(sw.dmcIdx); }
                        else { openColorReplaceModal(sw.dmcIdx); }
                      }}
                      style={{ width: 20, height: 20, borderRadius: '50%', background: sw.bg, border: `2px solid ${paintActive && r.current.activePaintDmcIdx === sw.dmcIdx ? '#7c5c3e' : 'white'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.2)', cursor: 'pointer', transition: 'transform 0.15s' }}
                      className="hover:scale-125"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Canvas area */}
          <div ref={canvasOuterRef} className="bg-white rounded-2xl shadow-card border border-gray-100 overflow-hidden relative flex items-center justify-center flex-1 min-h-[300px] md:min-h-0"
            style={{ backgroundImage: 'radial-gradient(#EBDBD4 1px, transparent 1px)', backgroundSize: '20px 20px' }}>

            {/* Empty state */}
            {!isLoading && !hasPattern && (
              <div className="text-center p-8 w-full flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mx-auto mb-4">
                  <i className="fa-solid fa-image text-brand-dark text-3xl" />
                </div>
                <h3 className="text-lg font-bold text-brand-dark mb-2">No pattern yet</h3>
                <p className="text-brand-gray text-sm">Upload an image to automatically generate your pattern.</p>
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="text-center p-8 w-full flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mx-auto mb-4 animate-pulse">
                  <i className="fa-solid fa-wand-magic-sparkles text-brand-dark text-3xl" />
                </div>
                <h3 className="text-lg font-bold text-brand-dark mb-2">Generating pattern…</h3>
                <p className="text-brand-gray text-sm">Matching colors to DMC palette</p>
              </div>
            )}

            {/* Pattern view */}
            <div className={`w-full h-full p-6 flex items-center justify-center ${hasPattern && view === 'pattern' ? '' : 'hidden'}`}>
              <div id="convert-canvas-wrapper" className="relative max-w-full" style={{ cursor: 'pointer' }}>
                <div ref={patternGridRef} style={{ transformOrigin: 'top left', position: 'relative' }}>
                  <canvas ref={patternCanvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
                  <canvas ref={selectionCanvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', display: 'none' }} />
                </div>
              </div>
            </div>

            {/* Original image view */}
            <div className={`relative w-full h-full p-8 flex items-center justify-center ${hasPattern && view === 'original' ? '' : 'hidden'}`}>
              {originalSrc && <img id="convert-original-img" src={originalSrc} alt="Original" className="max-h-[550px] rounded-xl shadow-md object-contain" />}
            </div>

            {/* Selection action bar */}
            {selectedCount > 0 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg border border-gray-100 px-4 py-2.5 flex items-center gap-3 z-20 whitespace-nowrap">
                <i className="fa-solid fa-arrow-pointer text-brand-dark text-xs" />
                <span className="text-xs font-semibold text-brand-dark">{selectedCount} pixel{selectedCount !== 1 ? 's' : ''} selected</span>
                <div className="w-px h-4 bg-gray-200" />
                <button
                  onClick={() => {
                    r.current.colorReplaceScope = 'selection';
                    r.current.colorReplaceTarget = null;
                    setCrCurrentBg('linear-gradient(135deg,#c49270 25%,transparent 25%) -10px 0,linear-gradient(225deg,#c49270 25%,transparent 25%) -10px 0,linear-gradient(315deg,#c49270 25%,transparent 25%),linear-gradient(45deg,#c49270 25%,transparent 25%)');
                    setCrCurrentId('Selection');
                    setCrCurrentName(`${selectedCount} pixel${selectedCount !== 1 ? 's' : ''}`);
                    setCrSearch(''); setCrHex(''); setCrPickerBg('#cccccc'); setCrNearest(null);
                    setColorReplaceOpen(true);
                    document.body.style.overflow = 'hidden';
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-dark text-white hover:opacity-90 transition-opacity">
                  Replace Color
                </button>
                <button
                  onClick={() => {
                    const next = !r.current.moveActive;
                    r.current.moveActive = next;
                    setMoveActive(next);
                    const wrapper = document.getElementById('convert-canvas-wrapper');
                    if (wrapper) wrapper.style.cursor = next ? 'grab' : 'pointer';
                    if (next) {
                      if (r.current.selectionActive) {
                        r.current.selectionActive = false;
                        setSelectionActive(false);
                      }
                      if (r.current.paintActive) {
                        r.current.paintActive = false;
                        setPaintActive(false);
                      }
                    }
                  }}
                  title="Drag the selected area to move it"
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${moveActive ? 'bg-brand-dark text-white' : 'border border-gray-200 text-brand-dark hover:border-brand-dark'}`}>
                  <i className="fa-solid fa-arrows-up-down-left-right text-xs" /> {moveActive ? 'Drag to move' : 'Move'}
                </button>
                <button
                  onClick={() => {
                    r.current.selectedPixels.clear();
                    setSelectedCount(0);
                    if (r.current.moveActive) {
                      r.current.moveActive = false;
                      setMoveActive(false);
                      const wrapper = document.getElementById('convert-canvas-wrapper');
                      if (wrapper) wrapper.style.cursor = 'pointer';
                    }
                    if (r.current.patternData) renderCanvas();
                  }}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-brand-gray hover:border-brand-dark hover:text-brand-dark transition-all">
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
