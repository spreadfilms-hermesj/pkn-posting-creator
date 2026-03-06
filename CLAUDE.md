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
3. Layers whose name starts with `*` are "editable"; their OCG visibility is set to `false` before rendering the background
4. Text content is extracted per-OCG via `getTextContent({ includeMarkedContent: true })` — marked content items with `type === 'beginMarkedContentProps'` carry the OCG `id`
5. Text extraction — **positional block grouping is always the primary method** (OCG ID matching is unreliable in pdfjs v5):
   - **OCG-ID matching** (stack-based, handles nested layers): walks `getTextContent({ includeMarkedContent: true })` items using a push/pop stack for `beginMarkedContent`/`endMarkedContent` events, assigns text to the innermost starred OCG on the stack
   - **Positional block grouping** (fallback per layer): clusters all text items by Y-gap relative to font size, assigns the N-th block to the N-th starred layer in top-to-bottom order — reliable even when OCG IDs don't match
6. Field positions are derived from text item `transform` matrices converted via `viewport.convertToViewportPoint()`

The pdfjs worker is loaded from unpkg CDN: `https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs`

**Requirement for users:** `.ai` files must be saved with *Create PDF Compatible File* checked (Illustrator default).

### Export
`ExportBar` uses `html2canvas` (dynamically imported). It briefly un-hides each fixed export container, pre-measures gradient element widths (because `getBoundingClientRect` returns 0 on hidden elements), then passes those widths into `html2canvas`'s `onclone` callback to fix gradient rendering. All formats can be exported at once as a ZIP via `jszip`.

### Adding a new post type
1. Add the string literal to the `PostType` union in `src/types/posting.ts`
2. Create a layout function in `posting-graphic.tsx` following the existing pattern (inline styles only, no Tailwind)
3. Add a `{config.postType === 'your-type' && <YourLayout config={config} />}` line in `PostingGraphic`
4. Add a selector button in `src/components/creator/post-type-selector.tsx`
