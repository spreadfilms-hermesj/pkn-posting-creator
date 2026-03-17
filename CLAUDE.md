# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
```bash
npm run dev        # start local dev server (http://localhost:3000)
npm run build      # production build (also type-checks via Next.js)
npm run typecheck  # tsc --noEmit standalone check
npm run lint       # ESLint
npm run test       # Jest (all tests)
npx jest __tests__/stable-stringify.test.ts  # run a single test file
```

After every commit, always push automatically:
```bash
git push
```

## Architecture

### Overview
A password-protected, single-page social media posting creator. The entire app is client-side React state — no database, no server rendering of user data. The only API route handles session auth.

### Auth flow
- `src/middleware.ts` guards all routes except `/` and `/api/auth`
- `src/app/api/auth/route.ts` sets/deletes an `httpOnly` cookie (`pkn_session`)
- Password is read from `process.env.PKN_PASSWORD` (fallback: `'Sprite'`)

### Core data model — `PostingConfig` (`src/types/posting.ts`)
Everything visible on the canvas is derived from a single `PostingConfig` object held in React state on `creator/page.tsx`. `updateConfig(partial)` merges partials in. Key sub-structures:
- `BrandSettings` — logo, colors, font (persists across post types)
- `CarouselSlide[]` — used only when `postType === 'carousel'`
- `AIImportData | null` — present when an Illustrator file has been imported; overrides normal rendering entirely
- `AIImportVariants | null` — holds all imported artboard variants + active index

### Formats
`Format` type: `'1:1' | '4:3' | '3:4' | '4:5' | '16:9' | '9:16'`

`FORMAT_DIMENSIONS` (in `src/types/posting.ts`):
- `1:1` → 1080×1080
- `4:3` → 1200×900
- `3:4` → 900×1200
- `4:5` → 1080×1350 (Instagram portrait)
- `16:9` → 1920×1080
- `9:16` → 1080×1920

### Rendering pipeline
`PostingGraphic` (`src/components/creator/posting-graphic.tsx`) is the single source of truth for the visual. It renders at **native resolution** using inline `style` props — **no Tailwind inside the graphic** — because `html2canvas` cannot reliably handle Tailwind utility classes or CSS `backdrop-filter`.

`PreviewCanvas` wraps `PostingGraphic` in a CSS `transform: scale()` to fit the viewport. It also renders hidden `position: fixed` copies of every format (`id="export-{format}"`) that `ExportBar` captures with `html2canvas`.

**When `config.aiImport` is set**, `PostingGraphic` skips all normal layout logic and renders the stored background image + editable text/graphic overlays at their extracted positions instead.

### Format Switcher (preview-canvas.tsx)
- **Always visible** in the top-right header, both in normal mode and AI import mode
- **Normal mode**: all formats shown; clicking calls `updateConfig({ format })`
- **AI import mode**: only formats matching an imported artboard are shown (ratio-based detection); clicking calls `onSwitchVariant(i)` to switch to the matching artboard
- `detectFormat(width, height)` in `preview-canvas.tsx` picks the closest ratio from `FORMAT_ASPECT_RATIOS`
- `variantFormatMap: Map<Format, number>` built via `useMemo` — maps format → variant index
- `page.tsx` calls `detectFormat` on import and on variant switch to keep `config.format` in sync

### AI Import (`src/components/creator/ai-import-dialog.tsx`)
Uses `pdfjs-dist` (v5, loaded dynamically on the client) to parse `.ai` files as PDFs:
1. Lists PDF pages as artboards with thumbnails
2. Reads Optional Content Groups (OCGs) — each Illustrator layer becomes one
3. Layer prefixes:
   - `*` = editable text or graphic layer (shown in sidebar)
   - `!` = image upload slot (shown in sidebar, transparent background region)
   - `#` = decorative layer (rendered on canvas, **hidden from sidebar**)
4. Text layers: OCG-ID matching (stack-based) with positional block grouping as fallback
5. Graphic/mixed layers: rendered as **isolated full-artboard PNGs** (all other OCGs hidden, `background: 'transparent'`). Stacked at x:0, y:0, width:1, height:1.
6. Text line breaks: `clusterItems()` returns `RichItem[][]`; each cluster = one visual line; clusters joined with `\n` so `whiteSpace: pre-wrap` renders them correctly
7. Layer stacking: `sortedEffectiveOCGs` sorted DESCENDING by `ocgFirstIdx`; CSS `zIndex = editableFields.length - i + 3`

**OCG detection rules (critical):**
- Include ALL `*`, `!`, and `#` prefixed OCGs — NO content-stream range filtering
- Range filters BREAK because `_`-container markers appear AFTER sublayers in draw order
- Supplemented OCGs (no BDC markers in stream) always included via `ocgConfig[Symbol.iterator]()`
- Mixed OCGs (path + text operators) reclassified as GRAPHIC, extracted via isolated render

**`#`-prefix decorative layers:**
- Extracted and rendered exactly like `*` graphic layers (isolated full-artboard PNG)
- `isDecorativeLayer: true` flag set on the `AIEditableField`
- Filtered out in `creator-sidebar.tsx` — never shown as editable fields
- Useful for non-editable shapes that must sit at a specific z-index above other layers

**Graphic layer handling:**
- Skip at import AND hide in sidebar: `type === 'graphic' && !imageUrl`
- Guard: `if (!imageUrl) continue` before `extractedFields.push()`

The pdfjs worker is loaded from unpkg CDN: `https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs`

**Requirement for users:** `.ai` files must be saved with *Create PDF Compatible File* checked (Illustrator default).

### Variant Switcher (preview-canvas.tsx)
- Shown inline **below the main canvas** when AI import has >1 variant
- Style matches mini format previews: artboard name + thumbnail + dimensions label
- Active variant highlighted with `border-cyan-400`
- Thumbnail uses `backgroundImageUrl` of each variant as an `<img>`
- Clicking calls `onSwitchVariant(i)` which updates `aiImport`, `aiImportVariants`, and `format` in `page.tsx`

### Export
`ExportBar` uses `html2canvas` (dynamically imported). It briefly un-hides each fixed export container, pre-measures gradient element widths (because `getBoundingClientRect` returns 0 on hidden elements), then passes those widths into `html2canvas`'s `onclone` callback to fix gradient rendering. All formats can be exported at once as a ZIP via `jszip`.

### Adding a new post type
1. Add the string literal to the `PostType` union in `src/types/posting.ts`
2. Create a layout function in `posting-graphic.tsx` following the existing pattern (inline styles only, no Tailwind)
3. Add a `{config.postType === 'your-type' && <YourLayout config={config} />}` line in `PostingGraphic`
4. Add a selector button in `src/components/creator/post-type-selector.tsx`
