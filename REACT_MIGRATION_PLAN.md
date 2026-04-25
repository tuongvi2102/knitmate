# KnitMate — React + Vite Migration Plan

## Why
Migrating from standalone HTML files to React + Vite so production builds are minified and obfuscated, making the code harder to clone.

---

## Project Structure

```
knitmate/
├── public/
│   └── images/
│       ├── logo_only3.png
│       └── homepage.jpg
├── src/
│   ├── main.tsx
│   ├── App.tsx                       — Router root
│   ├── data/
│   │   └── dmc.ts                    — DMC_RAW, dedup, Lab precompute, nearestDMCIndex
│   ├── lib/
│   │   ├── colorConversion.ts        — rgbToLab, xyzToLab, labDistance (pure functions)
│   │   ├── supabaseClient.ts         — createClient using .env vars
│   │   └── exportUtils.ts            — buildExportCanvas, downloadPng, exportPdf
│   ├── hooks/
│   │   ├── useUndoRedo.ts            — generic stack-based undo/redo (shared by Convert + Design)
│   │   ├── useToast.ts               — showToast state + timer
│   │   ├── useKeyboardShortcuts.ts   — Ctrl+Z/Y, P/F/E/I dispatch
│   │   └── useCanvasZoom.ts          — zoom state + fitToCanvas via ResizeObserver
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx
│   │   │   └── Footer.tsx
│   │   └── ui/
│   │       ├── Toast.tsx
│   │       ├── Modal.tsx             — generic backdrop + close-on-overlay
│   │       └── DmcColorPicker.tsx    — searchable DMC list + hex input (shared)
│   ├── pages/
│   │   ├── Home/
│   │   │   └── index.tsx
│   │   ├── Convert/
│   │   │   ├── index.tsx             — state orchestration
│   │   │   ├── ConvertSidebar.tsx
│   │   │   ├── PatternCanvas.tsx     — canvas ref + all rendering logic
│   │   │   ├── SelectionCanvas.tsx   — overlay canvas for rubber-band select
│   │   │   ├── LegendTable.tsx
│   │   │   ├── SummaryPanel.tsx
│   │   │   └── ColorReplaceModal.tsx
│   │   ├── Design/
│   │   │   ├── index.tsx
│   │   │   ├── DesignSidebar.tsx
│   │   │   ├── DesignCanvas.tsx
│   │   │   ├── ToolBar.tsx
│   │   │   └── ColorLegend.tsx
│   │   └── Patterns/
│   │       ├── index.tsx
│   │       ├── PatternGallery.tsx
│   │       ├── PatternCard.tsx
│   │       ├── PatternModal.tsx
│   │       └── UploadModal.tsx
│   └── styles/
│       └── index.css                 — @tailwind base/components/utilities
├── .env                              — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── tailwind.config.ts
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Migration Phases

### Phase 0 — Scaffold (do first)
1. `npm create vite@latest knitmate -- --template react-ts`
2. `npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`
3. `npm install react-router-dom @supabase/supabase-js`
4. Create `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
5. Set up `src/lib/supabaseClient.ts`
6. Create `Navbar.tsx`, `Footer.tsx` as static JSX
7. Set up router shell with four empty page components
8. Verify dev server runs and all four routes load

**Router setup:**
```tsx
// App.tsx
const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,  // Navbar + <Outlet /> + Footer
    children: [
      { index: true, element: <Home /> },
      { path: 'convert', element: <Convert /> },
      { path: 'design', element: <Design /> },
      { path: 'patterns', element: <Patterns /> },
    ],
  },
]);
```

**Tailwind config** — move inline tokens from HTML files into `tailwind.config.ts`:
```ts
colors: {
  primary: '#EDBBA4',
  secondary: '#CF9B71',
  accent: '#9B9C8A',
  light: '#EBDBD4',
  warm: '#C49270',
  bluegray: '#C4CDCC',
  brand: {
    dark: '#142F32',
    darker: '#282930',
    light: '#E3FFCC',
    gray: '#777C90',
    bg: '#F8F9FA',
  },
},
fontFamily: {
  sans: ['Inter', 'sans-serif'],
  heading: ['Poppins', 'sans-serif'],
},
```

---

### Phase 1 — Shared data & utilities
1. `src/data/dmc.ts` — copy `DMC_RAW` from `convert.html`, add dedup, precompute Lab values. **Do not put this in React state** — module-scope only.
2. `src/lib/colorConversion.ts` — pure math: `rgbToLab`, `xyzToLab`, `labDistance`
3. `src/hooks/useUndoRedo.ts` — generic hook used by both Convert and Design
4. `src/hooks/useToast.ts`
5. `src/components/ui/DmcColorPicker.tsx` — basic first pass

---

### Phase 2 — Home page (easiest)
- Convert hero, features, sample works, CTA sections to JSX
- Replace `href="convert.html"` with `<Link to="/convert">`
- Mobile menu: replace vanilla JS toggle with `useState(false)`

---

### Phase 3 — Patterns page
- No drawing tools — straightforward React conversion
- Supabase fetch in `useEffect`
- `filteredPatterns` as `useMemo` derived from filter state
- `PatternCard`: render `<img>` if `thumbnail_url` exists; otherwise `<canvas>` drawn in `useEffect`
- Pagination: `displayedCount` state, render `filteredPatterns.slice(0, displayedCount)`

---

### Phase 4 — Design page
- Single canvas, drawing tools: pencil/fill/eraser/eyedropper
- All grid state (`grid`, `gW`, `gH`, `currentTool`, `currentColor`, zoom) in `Design/index.tsx`
- `DesignCanvas.tsx` receives grid via props, sends changes via `onGridChange` callback
- Attach mouse handlers in one `useEffect`; use refs for current tool/color to avoid stale closures
- Verify: all tools, undo/redo (Ctrl+Z/Y), keyboard shortcuts (P/F/E/I), zoom, export PNG

---

### Phase 5 — Convert page (hardest, do last)
Two canvases (`patternCanvas` + `selectionCanvas` overlay), most complex state.

Features to verify after migration:
- [ ] Image upload + drag-and-drop
- [ ] Aspect ratio lock
- [ ] Pattern generation (Lab color matching)
- [ ] Canvas render with grid lines + axis labels
- [ ] Hover tooltip (position: fixed, updated via ref — NOT React state)
- [ ] Undo/redo for color replacements
- [ ] Click-to-pixel color replace
- [ ] Paint mode (click-and-drag)
- [ ] Area select with rubber-band overlay canvas
- [ ] Replace color for selection
- [ ] Save/import `.knitmate` JSON file
- [ ] Export PNG (with appended legend)
- [ ] Export PDF (`window.print()`)
- [ ] Zoom + fitToCanvas

---

## Key Technical Decisions

### Canvas + React: ref-mirror pattern
Canvas event handlers attached in `useEffect` with empty deps will read stale state. Solution:

```tsx
const patternDataRef = useRef(patternData);
useEffect(() => { patternDataRef.current = patternData; }, [patternData]);

useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const handleMouseDown = (e: MouseEvent) => {
    // Read from ref, not from state
    const data = patternDataRef.current;
    // ...
  };
  canvas.addEventListener('mousedown', handleMouseDown);
  return () => canvas.removeEventListener('mousedown', handleMouseDown);
}, []); // empty deps intentional
```

### Two-canvas overlay (Convert only)
`selectionCanvas` is `position: absolute; top: 0; left: 0; pointer-events: none` on top of `patternCanvas`. Both inside a `position: relative` wrapper. All mouse events go to `patternCanvas`; it updates `selectionCanvas` imperatively.

### fitToCanvas
Use `ResizeObserver` on the container ref — not `requestAnimationFrame`. The double-rAF trick from the original code should not be used in React.

### Tooltip on hover
Update `tooltipRef.current.style.left/top` directly in the mousemove handler. Do NOT use `useState` for tooltip position — re-rendering on every mouse move is too slow.

### Supabase .env
```ts
// src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

### Font Awesome
Keep the CDN `<link>` in `index.html` — simplest approach for initial migration.

### Image assets
Put images in `public/images/` → reference as `/images/logo_only3.png` (same as before).

---

## Gotchas

| Gotcha | Solution |
|--------|----------|
| Stale closures in canvas event handlers | Ref-mirror pattern (see above) |
| DMC data (454 colors) in React state | Keep at module scope in `dmc.ts` only |
| `Uint16Array` as React dep | Depend on parent `patternData` object ref, not `.grid` directly |
| `fitToCanvas` timing | Use `ResizeObserver`, not double-rAF |
| `window.print()` for PDF | Works fine in SPA as long as Convert page is active |
| CSS masonry columns (Patterns) | CSS-only, keep same class names — no changes needed |
| `.knitmate` file import/export | `FileReader` + `JSON.stringify` work identically in React |
