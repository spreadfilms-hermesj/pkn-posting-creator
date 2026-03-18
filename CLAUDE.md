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

### Multi-Post-Type grouping on import
Artboards are grouped by base name (stripping `_9:16` / `_16:9` etc. suffix) into `TemplateGroup[]`:
- `extractBaseName(name)` — regex `/_\d+:\d+$/` strips format suffix
- `01_Posting_16:9` + `01_Posting_9:16` → one group `"01_Posting"` with two variants
- `02_Text-Post_16:9` + `02_Text-Post_9:16` → separate group `"02_Text-Post"`
- Naming convention `01_`, `02_`, `03_`... is fully adaptive — no hardcoding
- `onImport` in dialog groups `processedVariants` by base name → delivers `TemplateGroup[]`
- `page.tsx` merges incoming groups into `templateGroups` state (upsert by baseName)
- Import dialog Step 2 shows a violet "X Post Types erkannt" summary above the artboard grid

### Template Mode (sidebar + page.tsx)
- `templateGroups: TemplateGroup[]` — state in `page.tsx`, outside `PostingConfig` (not in undo history)
- `templateMode: boolean` — UI state in `page.tsx`; `true` when Template preset is active
- `TemplateGroup { baseName: string, variants: AIImportData[] }` — defined in `src/types/posting.ts`
- `activeTemplateName` — derived from `extractBaseName(config.aiImport.artboardName)`
- Template button in header preset bar only shown when `templateGroups.length > 0`
- Other preset buttons call `setTemplateMode(false)` when clicked

**Sidebar in template mode:**
- "Post auswählen" section: collapsible (ChevronUp/Down), shows 2-column grid of Post Type cards
- Each card: live `PostingGraphic` thumbnail (16:9-preferred variant, scaled to THUMB_W=178px), name, format count
- Active card highlighted with violet border
- AI Import header row ("AI Import / artboard badge / Entfernen button") **hidden** in template mode
- All normal sections (Brand/CI, Media, Post Type, Content, Brand Controls, Format) **hidden** in template mode
- Only the AI Import editable fields section stays visible
- `getBestVariant(variants)` in sidebar — picks variant closest to 16:9 ratio for thumbnail
- `THUMB_W = 178` — computed from sidebar width 400px minus padding/gap

### Variant Switcher (preview-canvas.tsx)
- Shown inline **below the main canvas** when AI import has >1 variant
- Renders live `PostingGraphic` thumbnails (scaled), active variant uses live `config.aiImport`
- Format label shown (e.g. "16:9") instead of artboard name
- Active variant highlighted with `border-cyan-400`
- Clicking calls `onSwitchVariant(i)` which updates `aiImport`, `aiImportVariants`, and `format` in `page.tsx`
- Zoom: **Option (⌥) + scroll** to zoom in/out; Space + drag to pan

### Graphic layer scale controls (sidebar)
- `scale: number` — horizontal/width scale (default 1)
- `scaleY?: number` — vertical/height scale; if undefined, falls back to `scale` (proportional)
- W + lock button + H inputs in sidebar; lock icon = proportions linked
- Clicking unlock **materializes** `scaleY = field.scale` immediately so H becomes independent
- `transformOrigin` uses detected content center (`contentCenterX/Y`) in pixel coords, NOT `'center'`
- Content center detected at import via pixel bounding box scan of layer PNG
- Export (canvas): `ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-cx, -cy)`

### Export
`ExportBar` uses `html2canvas` (dynamically imported). It briefly un-hides each fixed export container, pre-measures gradient element widths (because `getBoundingClientRect` returns 0 on hidden elements), then passes those widths into `html2canvas`'s `onclone` callback to fix gradient rendering. All formats can be exported at once as a ZIP via `jszip`.

In AI import mode, export bypasses html2canvas entirely — uses a direct Canvas 2D composition (`captureAIVariant`) that draws background + graphic layers + text at native resolution.

### Adding a new post type
1. Add the string literal to the `PostType` union in `src/types/posting.ts`
2. Create a layout function in `posting-graphic.tsx` following the existing pattern (inline styles only, no Tailwind)
3. Add a `{config.postType === 'your-type' && <YourLayout config={config} />}` line in `PostingGraphic`
4. Add a selector button in `src/components/creator/post-type-selector.tsx`
