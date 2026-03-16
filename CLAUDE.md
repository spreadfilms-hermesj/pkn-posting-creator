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

### Rendering pipeline
`PostingGraphic` (`src/components/creator/posting-graphic.tsx`) is the single source of truth for the visual. It renders at **native resolution** (e.g. 1080×1080 px) using inline `style` props — **no Tailwind inside the graphic** — because `html2canvas` cannot reliably handle Tailwind utility classes or CSS `backdrop-filter`.

`PreviewCanvas` wraps `PostingGraphic` in a CSS `transform: scale()` to fit the viewport. It also renders hidden `position: fixed` copies of every format (`id="export-{format}"`) that `ExportBar` captures with `html2canvas`.

**When `config.aiImport` is set**, `PostingGraphic` skips all normal layout logic and renders the stored background image + editable text overlays at their extracted positions instead.

### AI Import (`src/components/creator/ai-import-dialog.tsx`)
Uses `pdfjs-dist` (v5, loaded dynamically on the client) to parse `.ai` files as PDFs:
1. Lists PDF pages as artboards with thumbnails
2. Reads Optional Content Groups (OCGs) — each Illustrator layer becomes one
3. Layers prefixed with `*` are editable text/graphic fields; `!`-prefixed layers are editable image slots (upload placeholders)
4. OCG visibility is set to `false` for all editable layers before rendering the background image
5. Text extraction uses OCG-ID matching (stack-based) with positional block grouping as fallback
6. Graphic layers are extracted via pixel-diff rendering (full vs. without that OCG)
7. Field positions are derived from text item `transform` matrices via `viewport.convertToViewportPoint()`

**Critical OCG detection rules:**
- ALL `*`-prefixed and `!`-prefixed OCGs are included as `effectiveOCGs` — **no content-stream range filtering**. Range filters break because Illustrator writes `_`-container markers AFTER their sublayers in draw order (bottom-to-top), so all editable layers would be excluded.
- Supplemented OCGs (found via `ocgConfig[Symbol.iterator]()`, not in content stream BDC markers) are always included — pdfjs rendering naturally isolates per-page content.
- Graphic/image fields with no extracted `imageUrl` are **skipped at import** and **hidden in the sidebar** — never shown as error placeholders.
- `!`-prefixed image slots are also skipped if extraction fails (no imageUrl).

**Layer naming conventions (Illustrator):**
- `*LayerName` — editable text or graphic field
- `!LayerName` — editable image upload slot
- `_ArtboardName` — artboard container marker (e.g. `_01_Posting_16:9`)

The pdfjs worker is loaded from unpkg CDN: `https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs`

**Requirement for users:** `.ai` files must be saved with *Create PDF Compatible File* checked (Illustrator default).

### Multi-artboard import
When multiple artboards are selected, each becomes an `AIImportData` variant stored in `config.aiImportVariants`. The `ArtboardVariantSwitcher` component in `creator/page.tsx` renders as an **absolute overlay at the bottom of the canvas area** (not a separate bar), allowing the user to switch between artboard formats. The left sidebar is unaffected.

### Layout (`src/app/creator/page.tsx`)
```
[Header]
[Left: CreatorSidebar (full height)] | [Right: relative container]
                                          [PreviewCanvas (flex-1, scrollable)]
                                          [ArtboardVariantSwitcher (absolute bottom overlay, z-20)]
[ExportBar (fixed bottom)]
```

### Export
`ExportBar` uses `html2canvas` (dynamically imported). It briefly un-hides each fixed export container, pre-measures gradient element widths (because `getBoundingClientRect` returns 0 on hidden elements), then passes those widths into `html2canvas`'s `onclone` callback to fix gradient rendering. All formats can be exported at once as a ZIP via `jszip`.

### Adding a new post type
1. Add the string literal to the `PostType` union in `src/types/posting.ts`
2. Create a layout function in `posting-graphic.tsx` following the existing pattern (inline styles only, no Tailwind)
3. Add a `{config.postType === 'your-type' && <YourLayout config={config} />}` line in `PostingGraphic`
4. Add a selector button in `src/components/creator/post-type-selector.tsx`
