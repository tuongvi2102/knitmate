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

const LABEL_PAD_X = 24;
const LABEL_PAD_Y = 32;
const MAX_UNDO = 40;
const CROP_EDGE_THRESHOLD = 10;

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

function drawGridLines(ctx: CanvasRenderingContext2D, W: number, H: number, cellW: number, cellH: number) {
  for (let x = 0; x <= W; x++) {
    ctx.beginPath();
    if (x % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; }
    ctx.moveTo(x * cellW, 0); ctx.lineTo(x * cellW, H * cellH); ctx.stroke();
  }
  for (let y = 0; y <= H; y++) {
    ctx.beginPath();
    if (y % 10 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; }
    else { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; }
    ctx.moveTo(0, y * cellH); ctx.lineTo(W * cellW, y * cellH); ctx.stroke();
  }
}

function drawAxisLabels(ctx: CanvasRenderingContext2D, W: number, H: number, cellW: number, cellH: number) {
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(0, H * cellH); ctx.lineTo(W * cellW, H * cellH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * cellW, 0); ctx.lineTo(W * cellW, H * cellH); ctx.stroke();
  ctx.fillStyle = 'rgba(70,50,30,0.72)';
  const fontSize = Math.max(5, Math.min(cellH - 1, cellW - 1, 9, LABEL_PAD_X - 4));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 10; c <= W; c += 10) {
    ctx.fillText(String(c), (c - 1) * cellW + cellW / 2, H * cellH + LABEL_PAD_X / 2);
  }
  ctx.textAlign = 'left';
  for (let r = 10; r <= H; r += 10) {
    ctx.fillText(String(r), W * cellW + 3, (H - r) * cellH + cellH / 2);
  }
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
  const [paintColorDisplay, setPaintColorDisplay] = useState<{ bg: string; label: string } | null>(null);
  const [colorReplaceOpen, setColorReplaceOpen] = useState(false);
  const [paintColorOpen, setPaintColorOpen] = useState(false);
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
  const [stitchRatio, setStitchRatio] = useState('square');
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
    canvas.width = W * cellW + LABEL_PAD_Y;
    canvas.height = H * cellH + LABEL_PAD_X;
    const ctx = canvas.getContext('2d')!;

    const paletteIndexMap = new Map(paletteIndices.map((dmcIdx, pos) => [dmcIdx, pos]));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dmcIdx = grid[y * W + x];
        const dmc = palette[paletteIndexMap.get(dmcIdx)!];
        ctx.fillStyle = `rgb(${dmc.r},${dmc.g},${dmc.b})`;
        ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
      }
    }

    if (r.current.showGrid) drawGridLines(ctx, W, H, cellW, cellH);
    drawAxisLabels(ctx, W, H, cellW, cellH);

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
    const { palette, paletteIndices, stitchCounts, W, H } = pd;
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
    saveUndoState();
    const { grid, W, H, cellW, cellH, palette, paletteIndices, stitchCounts } = pd;
    let newW = W, newH = H, offsetX = 0, offsetY = 0;
    if (edge === 'left') { offsetX = cell; newW = W - cell; }
    else if (edge === 'right') { newW = cell + 1; }
    else if (edge === 'top') { offsetY = cell; newH = H - cell; }
    else if (edge === 'bottom') { newH = cell + 1; }
    if (newW < 5 || newH < 5) return;
    const newGrid = new Uint16Array(newW * newH);
    const newCounts = new Map<number, number>(paletteIndices.map(i => [i, 0]));
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const srcIdx = (y + offsetY) * W + (x + offsetX);
        const dmcIdx = grid[srcIdx];
        newGrid[y * newW + x] = dmcIdx;
        newCounts.set(dmcIdx, (newCounts.get(dmcIdx) || 0) + 1);
      }
    }
    // Remove unused palette entries
    for (let i = paletteIndices.length - 1; i >= 0; i--) {
      if ((newCounts.get(paletteIndices[i]) || 0) === 0) {
        newCounts.delete(paletteIndices[i]);
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
    const selCtx = selCanvas.getContext('2d')!;
    selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
    selCtx.fillStyle = 'rgba(239,68,68,0.18)';
    selCtx.strokeStyle = 'rgba(239,68,68,0.9)';
    selCtx.lineWidth = 2;
    if (edge === 'left') {
      selCtx.fillRect(0, 0, (cell + 1) * cellW, H * cellH);
      selCtx.beginPath(); selCtx.moveTo((cell + 1) * cellW, 0); selCtx.lineTo((cell + 1) * cellW, H * cellH); selCtx.stroke();
    } else if (edge === 'right') {
      selCtx.fillRect((cell) * cellW, 0, W * cellW - cell * cellW, H * cellH);
      selCtx.beginPath(); selCtx.moveTo(cell * cellW, 0); selCtx.lineTo(cell * cellW, H * cellH); selCtx.stroke();
    } else if (edge === 'top') {
      selCtx.fillRect(0, 0, W * cellW, (cell + 1) * cellH);
      selCtx.beginPath(); selCtx.moveTo(0, (cell + 1) * cellH); selCtx.lineTo(W * cellW, (cell + 1) * cellH); selCtx.stroke();
    } else if (edge === 'bottom') {
      selCtx.fillRect(0, cell * cellH, W * cellW, H * cellH - cell * cellH);
      selCtx.beginPath(); selCtx.moveTo(0, cell * cellH); selCtx.lineTo(W * cellW, cell * cellH); selCtx.stroke();
    }
  }

  // ── Canvas event listeners ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = patternCanvasRef.current;
    const selCanvas = selectionCanvasRef.current;
    if (!canvas || !selCanvas) return;

    function clientToCanvas(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const scale = r.current.currentZoom / 100;
      return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
    }

    function getCellFromClient(e: MouseEvent) {
      const pd = r.current.patternData;
      if (!pd) return null;
      const { x, y } = clientToCanvas(e);
      const cx = Math.floor(x / pd.cellW);
      const cy = Math.floor(y / pd.cellH);
      if (cx < 0 || cx >= pd.W || cy < 0 || cy >= pd.H) return null;
      return { x: cx, y: cy };
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
      if (!r.current.paintActive && !r.current.selectionActive && !r.current.cropDragging) {
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
      // Crop drag update
      if (r.current.cropDragging && pd) {
        const { cellW, cellH, W, H } = pd;
        if (r.current.cropEdge === 'left' || r.current.cropEdge === 'right') {
          r.current.cropPreviewCell = Math.max(0, Math.min(Math.floor(canvasX / cellW), W - 1));
        } else {
          r.current.cropPreviewCell = Math.max(0, Math.min(Math.floor(canvasY / cellH), H - 1));
        }
        drawCropPreview(r.current.cropEdge!, r.current.cropPreviewCell);
      }
      // Selection drag
      if (r.current.selDragging && pd) {
        r.current.selDragEndPx = { x: canvasX, y: canvasY };
        drawRubberBand();
      }
    }

    function handleMouseLeave() { tooltip!.style.display = 'none'; }

    function drawRubberBand() {
      const pd = r.current.patternData;
      if (!pd || !r.current.selDragStartPx || !r.current.selDragEndPx) return;
      const { cellW, cellH, W, H } = pd;
      const selCtx = selCanvas.getContext('2d')!;
      selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
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
        selCanvas.style.display = 'block';
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

      // Crop drag
      const edge = detectCropEdge(canvasX, canvasY);
      if (edge) {
        e.preventDefault();
        r.current.cropDragging = true;
        r.current.cropEdge = edge;
        const pd = r.current.patternData!;
        r.current.cropPreviewCell = edge === 'left' || edge === 'right'
          ? Math.max(0, Math.min(Math.floor(canvasX / pd.cellW), pd.W - 1))
          : Math.max(0, Math.min(Math.floor(canvasY / pd.cellH), pd.H - 1));
        selCanvas.width = canvas.width; selCanvas.height = canvas.height;
        selCanvas.style.display = 'block';
        drawCropPreview(edge, r.current.cropPreviewCell);
      }
    }

    function handleMouseUp(e: MouseEvent) {
      // Paint tool
      if (r.current.isPainting) {
        r.current.isPainting = false;
        if (r.current.patternData) renderSummary();
      }
      // Crop drag
      if (r.current.cropDragging) {
        r.current.cropDragging = false;
        selCanvas.style.display = 'none';
        selCanvas.getContext('2d')!.clearRect(0, 0, selCanvas.width, selCanvas.height);
        const wrapper = document.getElementById('convert-canvas-wrapper');
        if (wrapper) wrapper.style.cursor = 'pointer';
        if (r.current.cropPreviewCell >= 0 && r.current.cropEdge) {
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
    }

    function handleClick(e: MouseEvent) {
      if (r.current.suppressNextClick) { r.current.suppressNextClick = false; return; }
      if (!r.current.patternData) return;
      if (r.current.paintActive || r.current.selectionActive) return;
      const { x: canvasX, y: canvasY } = clientToCanvas(e);
      const pd = r.current.patternData!;
      const cx = Math.floor(canvasX / pd.cellW);
      const cy = Math.floor(canvasY / pd.cellH);
      if (cx < 0 || cx >= pd.W || cy < 0 || cy >= pd.H) return;
      const dmcIdx = pd.grid[cy * pd.W + cx];
      openColorReplaceModal(dmcIdx, { x: cx, y: cy });
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('click', handleClick);
    window.addEventListener('mouseup', handleUp);

    function handleUp(e: MouseEvent) { handleMouseUp(e); }

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('click', handleClick);
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

  function updateHeightDisplay(w: number, h: number) {
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
    const { palette, paletteIndices, stitchCounts, W, H, cellW, cellH } = r.current.patternData;
    const LEGEND_ROW_H = 28, LEGEND_PADDING = 40, TITLE_H = 60;
    const totalLegendH = LEGEND_PADDING + palette.length * LEGEND_ROW_H + 30;
    const exportH = TITLE_H + canvas.height + totalLegendH;
    const exportW = Math.max(canvas.width + 80, 600);
    const exp = document.createElement('canvas');
    exp.width = exportW; exp.height = exportH;
    const ctx = exp.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, exportW, exportH);
    ctx.fillStyle = '#C49270'; ctx.font = 'bold 22px Inter,sans-serif';
    ctx.fillText('KnitMate Pattern', 40, 40);
    ctx.drawImage(canvas, 40, TITLE_H);
    let ly = TITLE_H + canvas.height + 30;
    ctx.fillStyle = '#C49270'; ctx.font = 'bold 16px Inter,sans-serif';
    ctx.fillText('DMC Thread Legend', 40, ly); ly += 24;
    ctx.font = '12px Inter,sans-serif'; ctx.fillStyle = '#9B9C8A';
    ctx.fillText('No.', 40, ly); ctx.fillText('DMC', 90, ly);
    ctx.fillText('Color Name', 160, ly);
    ctx.fillText('Stitches', exportW - 160, ly); ctx.fillText('Skeins', exportW - 70, ly); ly += 6;
    ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, ly); ctx.lineTo(exportW - 40, ly); ctx.stroke(); ly += 10;
    const sorted = paletteIndices.map((dmcIdx, pos) => ({ dmc: palette[pos], count: stitchCounts.get(dmcIdx) || 0 }))
      .sort((a, b) => b.count - a.count);
    sorted.forEach(({ dmc, count }, i) => {
      const skeins = Math.ceil(count / 150);
      const rowY = ly + i * LEGEND_ROW_H;
      ctx.fillStyle = `rgb(${dmc.r},${dmc.g},${dmc.b})`;
      ctx.fillRect(40, rowY - 14, 18, 18);
      ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 1; ctx.strokeRect(40, rowY - 14, 18, 18);
      ctx.fillStyle = '#C49270'; ctx.font = 'bold 12px Inter,sans-serif'; ctx.fillText(dmc.id, 70, rowY);
      ctx.font = '12px Inter,sans-serif'; ctx.fillText(dmc.name, 140, rowY);
      ctx.textAlign = 'right';
      ctx.fillText(count.toLocaleString(), exportW - 90, rowY);
      ctx.fillText(String(skeins), exportW - 40, rowY);
      ctx.textAlign = 'left';
    });
    const link = document.createElement('a');
    link.download = 'knitmate-pattern.png'; link.href = exp.toDataURL('image/png'); link.click();
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
    const legendRows = sorted.map(({ dmc, count }, i) => `<tr><td>${i + 1}</td><td><div style="width:18px;height:18px;background:rgb(${dmc.r},${dmc.g},${dmc.b});border:1px solid #ccc;border-radius:3px"></div></td><td><strong>${dmc.id}</strong></td><td>${dmc.name}</td><td style="text-align:right">${count.toLocaleString()}</td><td style="text-align:right">${Math.ceil(count / 150)}</td></tr>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><title>KnitMate Pattern</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#C49270}h1{font-size:20px;margin-bottom:8px}img{max-width:100%;border:1px solid #eee}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}th{border-bottom:2px solid #C49270;padding:6px 8px;text-align:left;font-size:11px;color:#777}td{border-bottom:1px solid #eee;padding:5px 8px;vertical-align:middle}@media print{body{margin:10px}}</style></head><body><h1>KnitMate Cross-Stitch Pattern</h1><img src="${canvas.toDataURL()}"><h2 style="font-size:16px;margin-top:24px">DMC Thread Legend</h2><table><thead><tr><th>#</th><th>Swatch</th><th>DMC No.</th><th>Color Name</th><th style="text-align:right">Stitches</th><th style="text-align:right">Skeins</th></tr></thead><tbody>${legendRows}</tbody></table><p style="font-size:11px;color:#777;margin-top:12px">* Skein estimate: ~150 stitches per skein at 14-count Aida, 2 strands.</p></body></html>`);
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

  function handleCrSelect(dmcIdx: number) {
    if (r.current.colorReplacePixel) replaceSinglePixel(r.current.colorReplacePixel.x, r.current.colorReplacePixel.y, dmcIdx);
    else if (r.current.colorReplaceScope === 'selection') paintSelectedPixels(dmcIdx);
    else replacePatternColor(r.current.colorReplaceTarget!, dmcIdx);
    closeColorReplaceModal();
  }

  // ── JSX ───────────────────────────────────────────────────────────────────────

  const { palette: crPalette, rest: crRest } = colorReplaceOpen ? crFilteredColors() : { palette: [], rest: [] };
  const pcColors = paintColorOpen ? pcFilteredColors() : [];

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
                    r.current.selectedPixels.clear();
                    setSelectedCount(0);
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
