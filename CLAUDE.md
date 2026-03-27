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
`Format` type: `'1:1' | '4:3' | '3:4' | '4:5' | '16:9' | '9:16' | '4:1'`

`FORMAT_DIMENSIONS` (in `src/types/posting.ts`):
- `1:1` → 1080×1080
- `4:3` → 1200×900
- `3:4` → 900×1200
- `4:5` → 1080×1350 (Instagram portrait)
- `16:9` → 1920×1080
- `9:16` → 1080×1920
- `4:1` → 2804×701 (LinkedIn Banner)

**Adding a new predefined format (normal mode):** update `Format` union + `FORMAT_DIMENSIONS` in `posting.ts`, `FORMAT_RATIOS` in `page.tsx`, `FORMATS` array in `preview-canvas.tsx`, `normalFormats` array in `export-bar.tsx`, and the inline ratio array in `ai-import-dialog.tsx`. Niche formats (4:5, 4:1) are excluded from `normalFormats` in export-bar.tsx.

**AI import mode supports any artboard size automatically** — no format registration needed. Labels are computed via `computeRatioLabel` (GCD).

### Rendering pipeline
`PostingGraphic` (`src/components/creator/posting-graphic.tsx`) is the single source of truth for the visual. It renders at **native resolution** using inline `style` props — **no Tailwind inside the graphic** — because `html2canvas` cannot reliably handle Tailwind utility classes or CSS `backdrop-filter`.

`PreviewCanvas` wraps `PostingGraphic` in a CSS `transform: scale()` to fit the viewport. It also renders hidden `position: fixed` copies of every format (`id="export-{format}"`) that `ExportBar` captures with `html2canvas`.

**When `config.aiImport` is set**, `PostingGraphic` skips all normal layout logic and renders the stored background image + editable text/graphic overlays at their extracted positions instead.

### Format Switcher (preview-canvas.tsx)
- **Always visible** in the top-right header, both in normal mode and AI import mode
- **Normal mode**: all predefined formats shown; clicking calls `updateConfig({ format })`
- **AI import mode**: shows one button per imported artboard, label computed dynamically via `computeRatioLabel`; clicking calls `onSwitchVariant(i)` directly — supports **any artboard size**, not just predefined formats
- Active button in AI import mode determined by `activeVariantIndex`, not `config.format`
- `aiFormatButtons: { label: string; variantIdx: number }[]` built via `useMemo` — computed from actual artboard dimensions
- `computeRatioLabel(w, h)` exported from `posting.ts` — uses GCD to simplify ratio (e.g. 1920×1080 → "16:9", 600×600 → "1:1", 800×500 → "8:5")
- `page.tsx` still calls its own `detectFormat` (Format union) on import/variant switch to keep `config.format` in sync — this is a best-effort mapping for internal state, not used for display

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
- Template button in header preset bar always visible when `templateGroups.length > 0`
- Other preset buttons call `setTemplateMode(false)` when clicked
- First time entering template mode: canvas is completely hidden (right panel not rendered) until a Post Type is selected

**Sidebar in template mode:**
- "Post auswählen" section: collapsible (ChevronUp/Down), shows 2-column grid of Post Type cards
- Sort dropdown: `ArrowUpDown` icon button in header opens dropdown with Standard / A→Z / Z→A / Meiste Formate / Wenigste Formate
  - `templateSort` state + `sortDropdownOpen` state + `sortDropdownRef` ref (for outside-click close)
  - Dropdown closes on `mousedown` outside the ref — uses ref.contains() check to avoid closing on item click
- Each card: live `PostingGraphic` thumbnail (16:9-preferred variant, scaled to THUMB_W=178px), name, format count
- Active card highlighted with violet border
- AI Import header row ("AI Import / artboard badge / Entfernen button") **hidden** in template mode
- All normal sections (Brand/CI, Media, Post Type, Content, Brand Controls, Format) **hidden** in template mode
- Only the AI Import editable fields section stays visible
- `getBestVariant(variants)` in sidebar — picks variant closest to 16:9 ratio for thumbnail
- `THUMB_W = 178` — computed from sidebar width 400px minus padding/gap
- Warning dialog when switching to a new Post Type **only if edits have been made**
  - `hasUnsavedEdits()` in sidebar compares current `editableFields` against saved template standard in `templateGroups` (not hardcoded defaults) — checks text value, scale, scaleY, opacity, imageUrl
  - No dialog shown if switching from a freshly loaded (unedited) template

**Super Admin Settings (collapsible, in sidebar):**
- `adminOpen` state controls collapse
- Contains: AI Import button, Anpassen (customize) button, "Als Template-Standard speichern" button
- "Als Template-Standard speichern": saves current `editableFields` into `templateGroups` + `aiImportVariants`; shows `toast.success('Template-Standard gespeichert')`
  - Also updates `originalText = value` for all text fields so saved state becomes the new baseline (no false "unsaved edits" after save)
  - Also updates live `config.aiImport` with normalized fields
- Anpassen mode: overlay on cards with Ersetzen / Entfernen (+ delete confirmation)

### User Projects (page.tsx)
- `ProjectDraft { id, name, createdAt, aiImport, aiImportVariants, format, templateBaseName? }` — in `src/types/posting.ts`
- `projectDrafts: ProjectDraft[]` — state in `page.tsx`, persisted in IndexedDB (`projectDrafts` store)
- "Projekt speichern" button in export bar → save dialog with pre-filled name → `toast.success('„name" gespeichert')`
- "User Projects" button in export bar opens fixed bottom panel above export bar
- Panel: compact grid (3→4→5→6→7 columns), THUMB=90px cards
- Each card: thumbnail, name, templateBaseName, date, Laden / delete (with confirmation)
- **Rename on double-click**: double-click name → inline input; Enter/blur confirms, Escape cancels
  - `renamingDraftId` + `renameInput` state, `renameDraft(id, name)` callback
- `loadDraft(draft)` restores `aiImport`, `aiImportVariants`, `format` into config

### Toast notifications (sonner)
- `sonner` already set up via `src/components/ui/sonner.tsx` + `<Toaster>` in `src/app/layout.tsx`
- `import { toast } from 'sonner'` in `page.tsx`
- Used for: save project draft, save as template default

### Variant Switcher (preview-canvas.tsx)
- Shown inline **below the main canvas** for any AI import (even single-variant)
- `page.tsx` always passes `variants` array: `config.aiImportVariants?.variants ?? [config.aiImport]`
- Renders live `PostingGraphic` thumbnails (scaled), active variant uses live `config.aiImport`
- Label shown per variant = `computeRatioLabel(artboardWidth, artboardHeight)` — computed dynamically, supports any size
- Active variant highlighted with `border-cyan-400`
- Clicking calls `onSwitchVariant(i)` which updates `aiImport`, `aiImportVariants`, and `format` in `page.tsx`
- Zoom: **Option (⌥) + scroll** to zoom in/out; Space + drag to pan

### Sidebar field accordion (creator-sidebar.tsx)
Each AI editable field renders as a collapsible accordion (`AIFieldItem`):
- **Chevron arrow** (left of name) — `onClick={() => setOpen(v => !v)}` — only this toggles fold/unfold
- **Layer name** — `onClick={() => onSelect?.()}` — selects the field in the canvas **without** toggling the accordion
- `onSelect` prop flows: `AIFieldItem` ← `AIFieldList` ← `CreatorSidebar` ← `page.tsx` (`setSelectedFieldIndex`)
- Do NOT put fold/unfold on the name click — they must remain separate

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

**Export format visibility rules:**
- Normal mode: predefined formats in `normalFormats` array (excludes `4:5` and `4:1`)
- AI import mode: `aiExportItems: { label: string; variant: AIImportData }[]` — one entry per unique artboard, label via `computeRatioLabel`, supports any imported size
- Each AI export item exports its specific artboard at native resolution via `captureAIVariant`
- Export containers (`id="export-{format}"`) rendered only in normal mode — AI mode bypasses html2canvas entirely

### Adding a new post type
1. Add the string literal to the `PostType` union in `src/types/posting.ts`
2. Create a layout function in `posting-graphic.tsx` following the existing pattern (inline styles only, no Tailwind)
3. Add a `{config.postType === 'your-type' && <YourLayout config={config} />}` line in `PostingGraphic`
4. Add a selector button in `src/components/creator/post-type-selector.tsx`
