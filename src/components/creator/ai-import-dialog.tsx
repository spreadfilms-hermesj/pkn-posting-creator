'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Upload, X, ChevronRight, Loader2, FileCheck, AlertCircle, RotateCcw } from 'lucide-react'
import type { AIImportData, AIEditableField } from '@/types/posting'
import { Label } from '@/components/ui/label'

interface AIImportDialogProps {
  onImport: (variants: AIImportData[]) => void
  onClose: () => void
}

type Step = 'upload' | 'artboards' | 'fields'

interface ArtboardInfo {
  pageNum: number
  name: string
  width: number
  height: number
  thumbUrl: string
}

export function AIImportDialog({ onImport, onClose }: AIImportDialogProps) {
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [artboards, setArtboards] = useState<ArtboardInfo[]>([])
  const [selectedArtboards, setSelectedArtboards] = useState<Set<number>>(new Set())
  const [processedVariants, setProcessedVariants] = useState<AIImportData[]>([])
  const [processingProgress, setProcessingProgress] = useState<{ current: number; total: number } | null>(null)
  const [activePreviewIndex, setActivePreviewIndex] = useState(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Step 1: parse the file and list artboards ─────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setIsLoading(true)
    setError(null)

    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      pdfDocRef.current = pdf

      const pageLabels = await pdf.getPageLabels().catch(() => null)
      // Fetch OCG config once — used to resolve OCG names for artboard detection
      const ocgCfgForNames = await pdf.getOptionalContentConfig().catch(() => null)
      const boards: ArtboardInfo[] = []

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const vp = page.getViewport({ scale: 1 })

        // Small thumbnail
        const thumbScale = Math.min(140 / vp.width, 90 / vp.height)
        const thumbVp = page.getViewport({ scale: thumbScale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(thumbVp.width)
        canvas.height = Math.round(thumbVp.height)
        const ctx = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport: thumbVp }).promise

        const pageLabel = pageLabels?.[i - 1]
        // Prefer page label if it looks like a real name (not just a page number)
        let name = pageLabel && !/^\d+$/.test(pageLabel.trim()) ? pageLabel : null

        // Try Illustrator's /VP ViewportDictionary (pdfjs internal)
        if (!name) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawPage = page as any
            const pd = rawPage._pageDict ?? rawPage.pageDict
            const vpEntry = typeof pd?.get === 'function' ? pd.get('VP') : null
            if (vpEntry) {
              const vpArr = Array.isArray(vpEntry) ? vpEntry : [vpEntry]
              for (const entry of vpArr) {
                const n = typeof entry?.get === 'function' ? entry.get('Name') : entry?.Name
                if (n && typeof n === 'string' && n.trim()) { name = n.trim(); break }
              }
            }
          } catch { /* VP not accessible */ }
        }

        // Scan operator list for _-prefixed marker OCGs (Illustrator artboard container layers
        // like _01_Posting_16:9). Sort by content-stream position DESCENDING — in PDF, lower
        // Illustrator layers render first so the last marker found = topmost artboard.
        // Pick index [pageNum-1] to map each PDF page to its artboard marker in panel order.
        if (!name && ocgCfgForNames) {
          try {
            const ops = await page.getOperatorList()
            const markers: Array<{name: string; idx: number}> = []
            const seenMarkers = new Set<string>()
            for (let j = 0; j < ops.fnArray.length; j++) {
              if (ops.fnArray[j] === pdfjs.OPS.beginMarkedContentProps) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const args = ops.argsArray[j] as any[]
                if (String(args[0] ?? '') === 'OC' && args[1]?.id) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const grp = ocgCfgForNames.getGroup(String(args[1].id)) as { name?: string } | null
                  const n = grp?.name?.trim()
                  if (n && n.startsWith('_') && !seenMarkers.has(n)) {
                    markers.push({ name: n, idx: j })
                    seenMarkers.add(n)
                  }
                }
              }
            }
            // Descending: last in stream = topmost in Illustrator panel = artboard 1 (page 1)
            markers.sort((a, b) => b.idx - a.idx)
            const marker = markers[i - 1] ?? markers[0]
            if (marker) name = marker.name.replace(/^_+/, '').trim()
          } catch { /* operator list scan failed */ }
        }

        if (!name) {
          name = pdf.numPages === 1
            ? file.name.replace(/\.ai$/i, '')
            : `Artboard ${i}`
        }

        boards.push({
          pageNum: i,
          name,
          width: Math.round(vp.width),
          height: Math.round(vp.height),
          thumbUrl: canvas.toDataURL('image/jpeg', 0.8),
        })
      }

      setArtboards(boards)
      setSelectedArtboards(new Set(boards.map(b => b.pageNum)))
      setStep('artboards')
    } catch {
      setError(
        'Datei konnte nicht gelesen werden. Stelle sicher, dass die .ai Datei mit aktivierter PDF-Kompatibilität gespeichert wurde (Illustrator Standard).'
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Step 2: render background + extract editable fields ───────────────────

  const processArtboardData = useCallback(async (artboard: ArtboardInfo): Promise<AIImportData> => {
    try {
      const pdfjs = await import('pdfjs-dist')
      const pdf = pdfDocRef.current
      const page = await pdf.getPage(artboard.pageNum)
      const vp1 = page.getViewport({ scale: 1 })

      // ── Collect all OCGs via operator list (pdfjs v5 #groups is private) ─────
      // ocgConfig is NOT iterable in pdfjs v5. Scan operator list for OC markers
      // instead, then use getGroup(id) to resolve names.
      const ocgConfig = await pdf.getOptionalContentConfig()
      const firstOpList = await page.getOperatorList()

      // Build OCG parent-child map from the PDF's /OCProperties/D/Order array.
      // pdfjs v5 parseNestedOrder converts the raw /Order array into either:
      //   - plain strings (top-level OCG IDs)
      //   - {name: ocgId, order: [...childIds]} objects (grouped/nested OCGs)
      // We handle both formats to correctly capture Illustrator's artboard container hierarchy.
      const ocgParentMap = new Map<string, string | null>()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orderArr = (ocgConfig as any).getOrder?.()
        if (Array.isArray(orderArr)) {
          const parseOrderItem = (item: unknown, parentId: string | null) => {
            if (typeof item === 'string') {
              if (!ocgParentMap.has(item)) ocgParentMap.set(item, parentId)
            } else if (item && typeof item === 'object' && !Array.isArray(item)) {
              // pdfjs {name: ocgId, order: [...children]} format
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const group = item as { name?: string; order?: unknown[] }
              const groupId = group.name ?? null
              if (groupId) {
                if (!ocgParentMap.has(groupId)) ocgParentMap.set(groupId, parentId)
                if (Array.isArray(group.order)) {
                  for (const child of group.order) parseOrderItem(child, groupId)
                }
              }
            } else if (Array.isArray(item)) {
              for (const child of item) parseOrderItem(child, parentId)
            }
          }
          for (const item of orderArr) parseOrderItem(item, null)
          console.log('[AI Import] OCG order map:', Array.from(ocgParentMap.entries()).map(([k, v]) => `${k} → ${v ?? 'top'}`))
        }
      } catch { /* getOrder not available; content-stream stack used as fallback */ }

      // Tracks the first operator-list index at which each OCG's BDC marker appears.
      // Used to sort marker OCGs in content-stream order (descending = Illustrator top-to-bottom).
      const ocgFirstOccurrence = new Map<string, number>()

      // id: OCG ref like "25R", or synthetic "layer:*Grafik" for non-OCG BDC sublayers
      // isOCG: true = registered OCG (setVisibility works), false = BDC marker only
      // parentId: from /Order hierarchy (ocgParentMap) for OCGs, or content-stream stack for BDC sublayers
      const allOCGs: { id: string; name: string; isOCG: boolean; parentId: string | null }[] = []

      // Walk the operator list to collect all layer ids and names.
      // For registered OCGs: parentId comes from ocgParentMap (reliable /Order hierarchy).
      // For non-OCG BDC sublayers: parentId comes from the content-stream nesting stack (fallback).
      {
        const ocgStack: string[] = [] // stack of active layer ids ('' = unnamed/non-layer)
        const seenOCGIds = new Set<string>()
        for (let j = 0; j < firstOpList.fnArray.length; j++) {
          const fn = firstOpList.fnArray[j]
          if (fn === pdfjs.OPS.beginMarkedContentProps) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const args = firstOpList.argsArray[j] as any[]
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const props = args[1] as Record<string, any> | null
            const tag = String(args[0] ?? '')
            const stackParentId = ocgStack.findLast(s => s !== '') ?? null

            if (tag === 'OC' && props?.id) {
              const ocgId = String(props.id)
              ocgStack.push(ocgId)
              if (!seenOCGIds.has(ocgId)) {
                seenOCGIds.add(ocgId)
                ocgFirstOccurrence.set(ocgId, j)
                // Use /Order hierarchy (ocgParentMap) first, then content-stream stack as fallback.
                // For nested layers (sublayers of a container), the stack correctly captures the parent.
                const parentId = ocgParentMap.has(ocgId) ? ocgParentMap.get(ocgId)! : stackParentId
                try {
                  const group = ocgConfig.getGroup(ocgId) as { name?: string } | null
                  allOCGs.push({ id: ocgId, name: group?.name ?? ocgId, isOCG: true, parentId })
                } catch {
                  allOCGs.push({ id: ocgId, name: ocgId, isOCG: true, parentId })
                }
              }
            } else if (props) {
              const layerName = String(props.Name ?? props.name ?? props.N ?? '')
              if (layerName) {
                const syntheticId = `layer:${layerName}`
                ocgStack.push(syntheticId)
                if (!allOCGs.find(g => g.id === syntheticId)) {
                  allOCGs.push({ id: syntheticId, name: layerName, isOCG: false, parentId: stackParentId })
                }
              } else {
                ocgStack.push('')
              }
            } else {
              ocgStack.push('')
            }
            console.log(`[AI Import] BDC marker: tag="${tag}" id=${props?.id ?? '-'} name=${props?.Name ?? props?.name ?? '-'} parent=${stackParentId ?? 'top'}`)
          } else if (fn === pdfjs.OPS.beginMarkedContent) {
            ocgStack.push('')
          } else if (fn === pdfjs.OPS.endMarkedContent) {
            ocgStack.pop()
          }
        }
      }

      // Supplement allOCGs with any registered OCGs that weren't found by the content-stream scan.
      // Illustrator sometimes writes sublayer OCGs (especially graphic/image layers) without
      // active BDC markers in the visible content stream, so they would be missed above.
      // ocgConfig[Symbol.iterator] yields [id, OptionalContentGroup] pairs from #groups (all registered OCGs).
      //
      // IMPORTANT: OCGs are document-level (shared across all pages/artboards). We track
      // supplemented IDs here so we can later remove any that have no operator-list presence
      // on this specific page — those belong to other artboards and would cause cross-artboard bleed.
      const supplementedOCGIds = new Set<string>()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfgIter: Iterator<[string, any]> = (ocgConfig as any)[Symbol.iterator]()
        const scannedOCGIds = new Set(allOCGs.filter(g => g.isOCG).map(g => g.id))
        let cfgStep = cfgIter.next()
        while (!cfgStep.done) {
          const [ocgId, ocgGroup] = cfgStep.value as [string, any]
          cfgStep = cfgIter.next()
          if (!scannedOCGIds.has(ocgId)) {
            const name = (ocgGroup as any)?.name ?? ocgId
            // Carry parentId from /Order map so container-based filtering works for graphic layers
            const parentId = ocgParentMap.get(ocgId) ?? null
            allOCGs.push({ id: ocgId, name, isOCG: true, parentId })
            supplementedOCGIds.add(ocgId)
            console.log(`[AI Import] Supplemented OCG from config: "${name}" (${ocgId})`)
          }
        }
      } catch { /* iterator not available in this pdfjs build */ }

      // Find _-prefixed marker OCGs (Illustrator artboard container layers like _01_Posting_16:9).
      // Sort DESCENDING by content-stream occurrence: last-in-stream = topmost-in-panel = artboard 1.
      // artboard.pageNum is 1-indexed, so markerOCGs[pageNum-1] is the container for this artboard.
      const markerOCGs = allOCGs
        .filter(g => g.isOCG && g.name.trimStart().startsWith('_'))
        .sort((a, b) => (ocgFirstOccurrence.get(b.id) ?? 0) - (ocgFirstOccurrence.get(a.id) ?? 0))
      const containerOCG = markerOCGs.length > 0
        ? (markerOCGs[artboard.pageNum - 1] ?? markerOCGs[markerOCGs.length - 1])
        : null
      const containerOCGId = containerOCG?.id ?? null

      // If a container marker was found, keep it visible so its non-starred sublayers
      // (Background, Element, etc.) remain rendered in the background image.
      const containerIds = new Set<string>()
      if (containerOCGId) containerIds.add(containerOCGId)

      // Effective OCGs: *-prefixed and !-prefixed layers belonging to this artboard.
      // When a container marker exists, restrict to its direct children only —
      // this prevents OCGs from other artboards bleeding into this artboard's field list.
      const effectiveOCGs = allOCGs.filter(g => {
        const name = g.name.trimStart()
        if (!name.startsWith('*') && !name.startsWith('!')) return false
        if (containerOCGId !== null) return g.parentId === containerOCGId
        return true // no container markers → include all */* layers (flat structure)
      })

      console.log('[AI Import] Container marker:', containerOCG ? `"${containerOCG.name}" (${containerOCGId})` : 'none (flat structure)')
      console.log('[AI Import] All OCGs:', allOCGs.map(g => `${g.id} (${g.isOCG ? 'OCG' : 'layer'}): "${g.name}" parent=${g.parentId ?? 'top'}`))
      console.log('[AI Import] Effective OCGs:', effectiveOCGs.map(g => `${g.id}: "${g.name}"`))

      // ── Extract text content, grouped by OCG via marked content markers ────
      // getTextContent with includeMarkedContent returns both text items and
      // beginMarkedContentProps/endMarkedContent markers. OC-tagged markers
      // tell us exactly which OCG each text item belongs to.
      const textContent = await page.getTextContent({ includeMarkedContent: true })

      // Parse CSS numeric font weight from a PostScript / font-family name string.
      // Uses simple substring matching (no word boundaries) to handle names like
      // "HelveticaNeue-BoldMT", "Arial,Bold", "MyriadPro-Semibold" etc.
      const parseFontWeight = (name: string): number => {
        const f = name.toLowerCase()
        if (/thin|hairline/.test(f))                           return 100
        if (/extralight|extra.?light|ultralight/.test(f))      return 200
        if (/light/.test(f))                                   return 300
        if (/demibold|demi.?bold|semibold|semi.?bold/.test(f)) return 600
        if (/extrabold|extra.?bold|ultrabold/.test(f))         return 800
        if (/black|heavy/.test(f))                             return 900
        if (/bold/.test(f))                                    return 700
        if (/medium/.test(f))                                  return 500
        return 400 // regular / normal
      }

      // fontWeightMap is populated after the first page.render() call below,
      // because pdfjs only finishes binding fonts into commonObjs during rendering.
      // PDFObjects exposes a public Symbol.iterator → [objId, FontFaceObject] pairs.
      const fontWeightMap = new Map<string, number>()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textStyles = (textContent as any).styles as Record<string, { fontFamily: string }> ?? {}

      // Resolve font weight: commonObjs PostScript name (populated after first render)
      // → textStyles.fontFamily fallback (works for non-embedded system fonts).
      const getFontWeight = (fontName: string): number =>
        fontWeightMap.get(fontName) ?? parseFontWeight(textStyles[fontName]?.fontFamily ?? fontName)

      type RichItem = { str: string; vx: number; vy: number; fontSize: number; width: number; fontName: string }
      // Map from OCG ID → text items found in that OCG's marked content section
      const ocgTextMap = new Map<string, RichItem[]>()
      // Text items outside any OC group (for fallback)
      const ungroupedItems: RichItem[] = []

      {
        // All effective layer ids (OCG ids + synthetic 'layer:X') for quick lookup
        const effectiveIdSet = new Set(effectiveOCGs.map(g => g.id))
        let currentLayerId: string | null = null // active layer: OCG id or 'layer:X' synthetic id
        let mcDepth = 0
        let layerStartDepth = -1
        for (const item of textContent.items) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = item as any
          if (it.type === 'beginMarkedContentProps' && it.tag === 'OC') {
            mcDepth++
            if (currentLayerId === null) {
              const ocId = it.id ?? it.properties?.id ?? it.properties?.OCMD?.id ?? null
              if (ocId) { currentLayerId = String(ocId); layerStartDepth = mcDepth }
            }
          } else if (it.type === 'beginMarkedContentProps') {
            mcDepth++
            if (currentLayerId === null) {
              // Also match non-OCG sublayer BDC markers by name (for layers inside _-containers)
              const name = String(it.properties?.Name ?? it.properties?.name ?? it.properties?.N ?? '')
              if (name) {
                const syntheticId = `layer:${name}`
                if (effectiveIdSet.has(syntheticId)) { currentLayerId = syntheticId; layerStartDepth = mcDepth }
              }
            }
          } else if (it.type === 'beginMarkedContent') {
            mcDepth++
          } else if (it.type === 'endMarkedContent') {
            if (mcDepth === layerStartDepth) { currentLayerId = null; layerStartDepth = -1 }
            mcDepth = Math.max(0, mcDepth - 1)
          } else if (typeof it.str === 'string' && it.str.trim()) {
            const [vx, vy] = vp1.convertToViewportPoint(it.transform[4], it.transform[5])
            const fontSize = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 12
            const rich: RichItem = { str: it.str, vx, vy, fontSize, width: it.width ?? 0, fontName: it.fontName ?? '' }
            if (currentLayerId !== null) {
              if (!ocgTextMap.has(currentLayerId)) ocgTextMap.set(currentLayerId, [])
              ocgTextMap.get(currentLayerId)!.push(rich)
            } else {
              ungroupedItems.push(rich)
            }
          }
        }
      }

      console.log('[AI Import] OCG text map keys:', Array.from(ocgTextMap.keys()))
      console.log('[AI Import] Effective OCGs:', effectiveOCGs.map(g => `${g.id}: "${g.name}"`))

      // Fallback: if OCG text mapping failed (no OC markers found), cluster all text
      // into positional blocks and match to text-type starred OCGs in order.
      const clusterItems = (items: RichItem[]): RichItem[][] => {
        const sorted = [...items].sort((a, b) => a.vy - b.vy)
        const blocks: RichItem[][] = []
        for (const item of sorted) {
          const last = blocks[blocks.length - 1]
          const lastItem = last?.[last.length - 1]
          const gap = lastItem ? item.vy - lastItem.vy : Infinity
          const yThreshold = Math.max((lastItem?.fontSize ?? 12) * 1.8, 8)
          const fsRatio = lastItem ? item.fontSize / lastItem.fontSize : 1
          const fontSizeChanged = fsRatio < 0.72 || fsRatio > 1.4
          if (!last || gap > yThreshold || fontSizeChanged) blocks.push([item])
          else last.push(item)
        }
        return blocks
      }

      // Fallback positional blocks (all text, no OCG grouping)
      const allTextItems: RichItem[] = [...ungroupedItems, ...Array.from(ocgTextMap.values()).flat()]
      const fallbackBlocks = clusterItems(allTextItems)
      console.log('[AI Import] Fallback blocks:', fallbackBlocks.map(b => b.map(i => i.str).join(' ')))

      // ── Render full page (all layers visible) ────────────────────────────
      const renderScale = Math.max(2, 1080 / artboard.width)
      const renderVp = page.getViewport({ scale: renderScale })
      const artW_px = Math.round(renderVp.width)
      const artH_px = Math.round(renderVp.height)

      // Force all effective OCGs visible for full render (some may default to hidden).
      // Also ensure any _-container OCGs are visible so their children can be rendered.
      const fullRenderCfg = await pdf.getOptionalContentConfig()
      for (const { id, isOCG } of effectiveOCGs) {
        if (isOCG) try { fullRenderCfg.setVisibility(id, true) } catch { /* unsupported */ }
      }
      for (const { id, isOCG } of allOCGs) {
        if (isOCG && containerIds.has(id)) try { fullRenderCfg.setVisibility(id, true) } catch { /* unsupported */ }
      }

      // fullCanvas = artboard-sized render with all layers visible (used for artboard diff fallback)
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = artW_px; fullCanvas.height = artH_px
      const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true })!
      await page.render({ canvas: fullCanvas, canvasContext: fullCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(fullRenderCfg) }).promise

      // ── Build font-weight map from pdfjs commonObjs ───────────────────────
      // After the first render, pdfjs has fully loaded all fonts into commonObjs.
      // PDFObjects exposes Symbol.iterator yielding [objId, FontFaceObject] pairs.
      // FontFaceObject.name is the PostScript name (e.g. "VazirmatnBlack").
      // FontFaceObject.bold and .black are boolean flags set by pdfjs font analysis.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iter: Iterator<[string, any]> = (page as any).commonObjs[Symbol.iterator]()
        let step = iter.next()
        while (!step.done) {
          const [objId, fontObj] = step.value as [string, any]
          step = iter.next();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fo = fontObj as any
          if (!fo || typeof fo !== 'object') continue
          // Prefer boolean flags (most reliable), fall back to PostScript name parsing
          let w: number
          if (fo.black === true)       w = 900
          else if (fo.bold === true)   w = 700
          else {
            const psName: string = fo.name ?? ''
            w = psName ? parseFontWeight(psName) : 400
          }
          fontWeightMap.set(objId, w)
          console.log(`[AI Import] Font "${objId}" name="${fo.name ?? ''}" bold=${fo.bold} black=${fo.black} → weight ${w}`)
        }
      } catch { /* iterator not available in this pdfjs build */ }

      // ── Render background (all effective OCG layers hidden) ───────────────
      // bgCanvas is artboard-sized only — used as the displayed background image
      const bgCfg = await pdf.getOptionalContentConfig()
      for (const { id, isOCG } of effectiveOCGs) {
        if (isOCG) try { bgCfg.setVisibility(id, false) } catch { /* unsupported */ }
      }
      // Keep _-containers visible so non-starred sublayers (Background etc.) stay rendered
      for (const { id, isOCG } of allOCGs) {
        if (isOCG && containerIds.has(id)) try { bgCfg.setVisibility(id, true) } catch { /* unsupported */ }
      }
      const bgCanvas = document.createElement('canvas')
      bgCanvas.width = artW_px
      bgCanvas.height = artH_px
      const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true })!
      // 'transparent' background tells pdfjs not to pre-fill the canvas with white,
      // so semi-transparent objects retain their correct alpha channel in the output.
      await page.render({
        canvas: bgCanvas, canvasContext: bgCtx, viewport: renderVp,
        optionalContentConfigPromise: Promise.resolve(bgCfg),
        background: 'transparent',
      }).promise

      // "Page background only" canvas: ALL registered OCGs hidden (starred + non-starred).
      // Used later to distinguish bare page-background pixels (→ transparent, let !-image slots
      // show through) from design-element pixels (Element, Background overlays → keep opaque).
      const pageBgCfg = await pdf.getOptionalContentConfig()
      for (const { id, isOCG } of allOCGs) {
        if (isOCG) try { pageBgCfg.setVisibility(id, false) } catch { /* unsupported */ }
      }
      const pageBgCanvas = document.createElement('canvas')
      pageBgCanvas.width = artW_px; pageBgCanvas.height = artH_px
      const pageBgCtx = pageBgCanvas.getContext('2d', { willReadFrequently: true })!
      await page.render({ canvas: pageBgCanvas, canvasContext: pageBgCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(pageBgCfg), background: 'transparent' }).promise
      const pageBgData = pageBgCtx.getImageData(0, 0, artW_px, artH_px).data

      // Helper: erase a region from bgCanvas by sampling surrounding color
      const paintOver = (cx: number, cy: number, cw: number, ch: number) => {
        if (cw <= 0 || ch <= 0) return
        const sY = cy > 10 ? cy - 8 : Math.min(cy + ch + 4, bgCanvas.height - 2)
        const sW = Math.min(cw, bgCanvas.width - cx)
        if (sW <= 0 || sY < 0 || sY >= bgCanvas.height) return
        const px = bgCtx.getImageData(cx, sY, sW, 1).data
        let r = 0, g = 0, b = 0
        for (let p = 0; p < px.length; p += 4) { r += px[p]; g += px[p + 1]; b += px[p + 2] }
        const n = px.length / 4
        bgCtx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`
        bgCtx.fillRect(cx, cy, cw, ch)
      }

      // Helper: pixel-diff two canvases and return bounding box of differing pixels
      const pixelDiff = (aData: Uint8ClampedArray, bData: Uint8ClampedArray, w: number, h: number, threshold = 25) => {
        let minX = w, maxX = -1, minY = h, maxY = -1
        for (let py = 0; py < h; py++) {
          for (let px2 = 0; px2 < w; px2++) {
            const idx = (py * w + px2) * 4
            const diff = Math.abs(aData[idx] - bData[idx]) + Math.abs(aData[idx + 1] - bData[idx + 1]) + Math.abs(aData[idx + 2] - bData[idx + 2])
            if (diff > threshold) {
              minX = Math.min(minX, px2); maxX = Math.max(maxX, px2)
              minY = Math.min(minY, py);  maxY = Math.max(maxY, py)
            }
          }
        }
        return maxX >= minX && maxY >= minY ? { minX, maxX, minY, maxY } : null
      }

      // ── Operator list: definitively classify each starred OCG ─────────────
      // This is the most reliable method: scan actual drawing operators to check
      // whether each OCG section contains text ops vs path/fill ops.
      // This avoids all ordering/ID-format ambiguity issues.
      const ocgIsText = new Map<string, boolean>()
      const ocgPathBBox = new Map<string, {minX: number, minY: number, maxX: number, maxY: number}>()
      const ocgFirstIdx = new Map<string, number>()
      // ocgHasImage: true if the OCG contains raster image XObject operators
      const ocgHasImage = new Map<string, boolean>()
      // ocgParentId: for isOCG:false sublayers, the nearest parent registered OCG id
      const ocgParentId = new Map<string, string>()
      for (const { id } of effectiveOCGs) ocgIsText.set(id, false)

      try {
        const opList = firstOpList
        const { OPS } = pdfjs
        let mcDepth = 0
        // isRegistered: true = real OCG (setVisibility works), false = sublayer marker
        const ocgStack: {id: string, depth: number, isRegistered: boolean}[] = []
        // stack of currently open registered OCG ids (to find parent for sublayers)
        const registeredOCGStack: string[] = []
        const ctmStack: number[][] = [[1, 0, 0, 1, 0, 0]]
        const applyCtm = (m: number[], x: number, y: number): [number, number] =>
          [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]]

        for (let j = 0; j < opList.fnArray.length; j++) {
          const fn = opList.fnArray[j]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = opList.argsArray[j] as any[]

          if (fn === OPS.save) {
            ctmStack.push([...ctmStack[ctmStack.length - 1]])
          } else if (fn === OPS.restore) {
            if (ctmStack.length > 1) ctmStack.pop()
          } else if (fn === OPS.transform) {
            const [a, b, c, d, e, f] = args as number[], cur = ctmStack[ctmStack.length - 1]
            ctmStack[ctmStack.length - 1] = [cur[0]*a+cur[2]*b, cur[1]*a+cur[3]*b, cur[0]*c+cur[2]*d, cur[1]*c+cur[3]*d, cur[0]*e+cur[2]*f+cur[4], cur[1]*e+cur[3]*f+cur[5]]
          } else if (fn === OPS.beginMarkedContentProps) {
            mcDepth++
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const props = args[1] as Record<string, any> | null
            const bTag = String(args[0] ?? '')
            let matchedId: string | null = null
            let isRegisteredOCG = false
            if (bTag === 'OC' && props?.id) {
              const ocgId = String(props.id)
              if (ocgIsText.has(ocgId)) { matchedId = ocgId; isRegisteredOCG = true }
            } else if (props) {
              // Illustrator sublayer: check Name key
              const layerName = String(props.Name ?? props.name ?? props.N ?? '')
              if (layerName) {
                const syntheticId = `layer:${layerName}`
                if (ocgIsText.has(syntheticId)) {
                  matchedId = syntheticId
                  // Record the nearest parent registered OCG
                  if (registeredOCGStack.length > 0 && !ocgParentId.has(syntheticId)) {
                    ocgParentId.set(syntheticId, registeredOCGStack[registeredOCGStack.length - 1])
                  }
                }
              }
            }
            if (matchedId) {
              ocgStack.push({id: matchedId, depth: mcDepth, isRegistered: isRegisteredOCG})
              if (isRegisteredOCG) registeredOCGStack.push(matchedId)
              if (!ocgFirstIdx.has(matchedId)) ocgFirstIdx.set(matchedId, j)
            }
          } else if (fn === OPS.beginMarkedContent) {
            mcDepth++
          } else if (fn === OPS.endMarkedContent) {
            if (ocgStack.length > 0 && ocgStack[ocgStack.length - 1].depth === mcDepth) {
              const popped = ocgStack.pop()!
              if (popped.isRegistered) {
                const ri = registeredOCGStack.lastIndexOf(popped.id)
                if (ri >= 0) registeredOCGStack.splice(ri, 1)
              }
            }
            mcDepth = Math.max(0, mcDepth - 1)
          }

          const inOCG = ocgStack.length > 0 ? ocgStack[ocgStack.length - 1].id : null
          if (!inOCG) continue

          if (fn === OPS.showText || fn === OPS.showSpacedText ||
              fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
            ocgIsText.set(inOCG, true)
          }

          // Detect raster image XObject operators
          if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject ||
              fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
            ocgHasImage.set(inOCG, true)
          }

          // Track path coordinates for graphic OCGs (bounding box)
          if (!ocgIsText.get(inOCG)) {
            const addPoint = (ux: number, uy: number) => {
              const [vpx, vpy] = vp1.convertToViewportPoint(ux, uy)
              const cx2 = vpx * renderScale, cy2 = vpy * renderScale
              if (!ocgPathBBox.has(inOCG)) ocgPathBBox.set(inOCG, {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity})
              const bb = ocgPathBBox.get(inOCG)!
              bb.minX = Math.min(bb.minX, cx2); bb.maxX = Math.max(bb.maxX, cx2)
              bb.minY = Math.min(bb.minY, cy2); bb.maxY = Math.max(bb.maxY, cy2)
            }
            if (fn === OPS.constructPath) {
              // pdfjs v5: args[2] is Float32Array([minX,minY,maxX,maxY]) in path-local space
              // args[1] is Array([Float32Array of interleaved cmd+coords]) — NOT a flat coord list
              const minMax = args[2] as ArrayLike<number> | null
              if (minMax && minMax.length >= 4) {
                const ctm = ctmStack[ctmStack.length - 1]
                addPoint(...applyCtm(ctm, minMax[0], minMax[1]))
                addPoint(...applyCtm(ctm, minMax[2], minMax[3]))
                addPoint(...applyCtm(ctm, minMax[0], minMax[3]))
                addPoint(...applyCtm(ctm, minMax[2], minMax[1]))
              }
            } else if (fn === OPS.rectangle) {
              const [x, y, w, h] = args as number[], ctm = ctmStack[ctmStack.length - 1]
              for (const [rx, ry] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]] as [number,number][])
                addPoint(...applyCtm(ctm, rx, ry))
            }
          }
        }
      } catch (e) {
        console.warn('[AI Import] Operator list analysis failed:', e)
      }

      console.log('[AI Import] OCG text classification:', Array.from(ocgIsText.entries()).map(([id, t]) => {
        const name = effectiveOCGs.find(g => g.id === id)?.name ?? id
        return `${name}: ${t ? 'TEXT' : 'GRAPHIC'}`
      }))
      console.log('[AI Import] OCG has-image:', Array.from(ocgHasImage.entries()).map(([id, v]) => `${effectiveOCGs.find(g=>g.id===id)?.name ?? id}: ${v}`))
      console.log('[AI Import] OCG parent ids:', Array.from(ocgParentId.entries()))
      console.log('[AI Import] OCG path bboxes:', Array.from(ocgPathBBox.entries()))

      // Separate and order OCGs
      // Sort in DESCENDING ocgFirstIdx order: PDF draws bottom-to-top, so descending = Illustrator top-to-bottom layer order
      const sortedEffectiveOCGs = [...effectiveOCGs].sort(
        (a, b) => (ocgFirstIdx.get(b.id) ?? 0) - (ocgFirstIdx.get(a.id) ?? 0)
      )
      const textStarredOCGs = sortedEffectiveOCGs.filter(ocg => ocgIsText.get(ocg.id) === true)
      const graphicStarredOCGs = sortedEffectiveOCGs.filter(ocg => ocgIsText.get(ocg.id) !== true)

      console.log('[AI Import] Text OCGs (ordered):', textStarredOCGs.map(g => g.name))
      console.log('[AI Import] Graphic OCGs:', graphicStarredOCGs.map(g => g.name))

      // ── Build extracted fields ─────────────────────────────────────────────
      const extractedFields: AIEditableField[] = []

      if (effectiveOCGs.length === 0) {
        // No OCGs found — fall back to positional text blocks
        fallbackBlocks.forEach((block, i) => {
          const sorted = [...block].sort((a, b) => a.vx - b.vx)
          const text = sorted.map(it => it.str).join(' ').trim()
          const topVy = Math.min(...block.map(it => it.vy - it.fontSize))
          const bottomVy = Math.max(...block.map(it => it.vy))
          const minVx = Math.min(...block.map(it => it.vx))
          const maxVx = Math.min(Math.max(...block.map(it => {
            const w = it.width > 2 ? it.width * 1.15 : it.str.length * it.fontSize * 0.65
            return it.vx + w
          })), vp1.width * 0.95)
          const fs = block[0].fontSize
          const pad = Math.ceil(fs * renderScale * 0.25)
          paintOver(
            Math.max(0, Math.floor(minVx * renderScale) - pad),
            Math.max(0, Math.floor(topVy * renderScale) - pad),
            Math.ceil((maxVx - minVx) * renderScale) + pad * 2,
            Math.ceil((bottomVy - topVy) * renderScale) + pad * 2,
          )
          const label = i === 0 ? 'Headline' : i === 1 ? 'Subline' : `Text ${i + 1}`
          extractedFields.push({
            type: 'text', layerName: label, value: text, originalText: text,
            x: minVx / vp1.width, y: topVy / vp1.height,
            width: Math.min(0.98, Math.max(0.5, (maxVx - minVx) / vp1.width)),
            height: Math.max(0.05, (bottomVy - topVy) / vp1.height),
            scale: 1, opacity: 1, fontSize: fs, color: '#ffffff',
            fontWeight: getFontWeight(block[0].fontName), fontStyle: 'normal', textAlign: 'left',
          })
        })
      } else {
        // ── Process text OCGs (correctly ordered by operator list position) ──
        for (let ti = 0; ti < textStarredOCGs.length; ti++) {
          const { name: ocgRawName, id: ocgId, isOCG: textIsOCG } = textStarredOCGs[ti]
          const layerName = ocgRawName.replace(/^\s*[*!]/, '').trim()

          // Try OCG-specific text items first, then fall back to positional block
          let block: RichItem[] | null = null
          const ocgItems = ocgTextMap.get(ocgId) ?? null
          if (ocgItems && ocgItems.length > 0) {
            block = clusterItems(ocgItems).flat()
          } else if (fallbackBlocks[ti]) {
            block = fallbackBlocks[ti]
          }

          if (!block || block.length === 0) continue

          const sorted = [...block].sort((a, b) => a.vx - b.vx)
          const text = sorted.map(it => it.str).join(' ').trim()
          const topVy = Math.min(...block.map(it => it.vy - it.fontSize))
          const bottomVy = Math.max(...block.map(it => it.vy))
          const minVx = Math.min(...block.map(it => it.vx))
          const maxVx = Math.min(Math.max(...block.map(it => {
            const w = it.width > 2 ? it.width * 1.15 : it.str.length * it.fontSize * 0.65
            return it.vx + w
          })), vp1.width * 0.95)
          const fs = block[0].fontSize
          const pad = Math.ceil(fs * renderScale * 0.25)
          // Only paintOver for sublayers that can't be hidden (isOCG: false)
          if (!textIsOCG) {
            paintOver(
              Math.max(0, Math.floor(minVx * renderScale) - pad),
              Math.max(0, Math.floor(topVy * renderScale) - pad),
              Math.ceil((maxVx - minVx) * renderScale) + pad * 2,
              Math.ceil((bottomVy - topVy) * renderScale) + pad * 2,
            )
          }
          extractedFields.push({
            type: 'text', layerName, value: text, originalText: text,
            x: minVx / vp1.width, y: topVy / vp1.height,
            width: Math.min(0.98, Math.max(0.5, (maxVx - minVx) / vp1.width)),
            height: Math.max(0.05, (bottomVy - topVy) / vp1.height),
            scale: 1, opacity: 1, fontSize: fs, color: '#ffffff',
            fontWeight: getFontWeight(block[0].fontName), fontStyle: 'normal', textAlign: 'left',
          })
        }

        // ── Pre-render "full overflow" canvas for graphic extraction ─────
        // Gradient fills in Illustrator use PDF sh (paintShading) operators that
        // paint over the CURRENT CLIPPING REGION. In isolation (only this OCG
        // visible), the clipping region is the whole canvas — so the gradient floods
        // the entire bbox. In the full render, the clipping region is correctly set
        // by the surrounding path/clip context. Therefore we use a "full vs without
        // this OCG" diff so clip paths are always active during rendering.

        // Overflow canvas dimensions (used for elements that touch artboard boundaries)
        const ofPad = Math.round(200 * renderScale)
        const ofW = artW_px + 2 * ofPad
        const ofH = artH_px + 2 * ofPad

        // Helper: pixel-diff two renders → isolated element canvas.
        // Use `srcData` pixel colors for pixels that differ from `baseData`.
        // Pixels matching baseline become transparent. Handles gradients correctly
        // because both renders include the full PDF clipping context.
        const diffToIsolated = (
          srcData: Uint8ClampedArray, baseData: Uint8ClampedArray, w: number, h: number
        ): { canvas: HTMLCanvasElement; bbox: { minX: number; minY: number; maxX: number; maxY: number } | null } => {
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const ctx = c.getContext('2d')!
          const img = ctx.createImageData(w, h)
          const d = img.data
          let minX = w, minY = h, maxX = -1, maxY = -1
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4
              const diff = Math.abs(srcData[idx] - baseData[idx])
                + Math.abs(srcData[idx + 1] - baseData[idx + 1])
                + Math.abs(srcData[idx + 2] - baseData[idx + 2])
              if (diff > 8) {
                d[idx] = srcData[idx]; d[idx + 1] = srcData[idx + 1]
                d[idx + 2] = srcData[idx + 2]; d[idx + 3] = 255
                if (x < minX) minX = x; if (x > maxX) maxX = x
                if (y < minY) minY = y; if (y > maxY) maxY = y
              }
            }
          }
          ctx.putImageData(img, 0, 0)
          return { canvas: c, bbox: maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null }
        }


        // ── Process graphic OCGs ──────────────────────────────────────────
        for (const { id: ocgId, name: ocgRawName, isOCG: ocgIsRegistered } of graphicStarredOCGs) {
          const layerName = ocgRawName.replace(/^\s*[*!]/, '').trim()
          const isImageSlot = ocgRawName.trimStart().startsWith('!')
          console.log(`[AI Import] Extracting graphic: "${layerName}" (${ocgId})`)

          let imageUrl: string | undefined
          let gx = 0.05, gy = 0.3, gw = 0.4, gh = 0.4
          const pad2 = 16

          // Helper: crop a rect from a canvas, set normalized position.
          const applyGraphicCropFrom = (
            srcCanvas: HTMLCanvasElement, cropX: number, cropY: number, cropW: number, cropH: number,
            offsetX: number, offsetY: number
          ) => {
            if (cropW <= 4 || cropH <= 4) return false
            const cc = document.createElement('canvas')
            cc.width = cropW; cc.height = cropH
            cc.getContext('2d')!.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
            imageUrl = cc.toDataURL('image/png')
            gx = (cropX - offsetX) / artW_px
            gy = (cropY - offsetY) / artH_px
            gw = cropW / artW_px
            gh = cropH / artH_px
            const bgX = Math.max(0, cropX - offsetX)
            const bgY = Math.max(0, cropY - offsetY)
            const bgW = Math.min(artW_px - bgX, cropW - Math.max(0, offsetX - cropX))
            const bgH = Math.min(artH_px - bgY, cropH - Math.max(0, offsetY - cropY))
            // Only paintOver for unregistered sublayers (isOCG: false) — registered OCGs
            // are already absent from bgCanvas via setVisibility; calling paintOver on them
            // destroys the photo/background pixels behind the element.
            if (bgW > 0 && bgH > 0 && !ocgIsRegistered) paintOver(bgX, bgY, bgW, bgH)
            return true
          }

          // Step 1 — Extract this graphic layer using the best diff strategy:
          //
          // • Raster image layers (hasImage=true) OR isOCG:false sublayers with a parent:
          //   → Solo-vs-none diff: render only this OCG vs all hidden.
          //     Isolates the raster from other elements without bleed.
          //
          // • Vector / gradient layers (hasImage=false, isOCG:true):
          //   → Full-vs-without diff: render all OCGs vs all except this one.
          //     Gradient fills use PDF sh operators that clip to the CURRENT clipping
          //     region. In solo-only mode the clip is the full canvas, flooding it.
          //     Full render preserves the clip context so gradients stay bounded.
          const hasImage = ocgHasImage.get(ocgId) ?? false
          const parentId = ocgParentId.get(ocgId) ?? null
          // The effective registered OCG id we can call setVisibility on:
          // • for registered OCGs: use ocgId directly
          // • for isOCG:false sublayers: use their parent registered OCG (if known)
          const visId = ocgIsRegistered ? ocgId : parentId

          let baseCanvas: HTMLCanvasElement | null = null
          let artBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null

          if (visId && (hasImage || !ocgIsRegistered)) {
            // ── Solo-vs-none diff (raster images / sublayers) ─────────────────
            try {
              const soloCfg = await pdf.getOptionalContentConfig()
              const noneCfg = await pdf.getOptionalContentConfig()
              for (const { id, isOCG } of allOCGs) {
                if (isOCG) {
                  try { soloCfg.setVisibility(id, false) } catch { /* unsupported */ }
                  try { noneCfg.setVisibility(id, false) } catch { /* unsupported */ }
                }
              }
              try { soloCfg.setVisibility(visId, true) } catch { /* unsupported */ }

              const soloCanvas = document.createElement('canvas')
              soloCanvas.width = artW_px; soloCanvas.height = artH_px
              const soloCtx = soloCanvas.getContext('2d', { willReadFrequently: true })!
              await page.render({ canvas: soloCanvas, canvasContext: soloCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(soloCfg) }).promise

              const noneCanvas = document.createElement('canvas')
              noneCanvas.width = artW_px; noneCanvas.height = artH_px
              const noneCtx = noneCanvas.getContext('2d', { willReadFrequently: true })!
              await page.render({ canvas: noneCanvas, canvasContext: noneCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(noneCfg) }).promise

              const { canvas, bbox } = diffToIsolated(
                soloCtx.getImageData(0, 0, artW_px, artH_px).data,
                noneCtx.getImageData(0, 0, artW_px, artH_px).data,
                artW_px, artH_px
              )
              if (bbox) { baseCanvas = canvas; artBBox = bbox }
              console.log(`[AI Import] Solo/none diff for "${layerName}": bbox=${JSON.stringify(bbox)}`)
            } catch (e) {
              console.warn(`[AI Import] Solo/none diff failed for "${layerName}":`, e)
            }

            // Fallback for raster images: if solo-vs-none produced no bbox (image may not be
            // OCG-controlled in pdfjs isolation mode), try full-vs-without. Unlike gradients,
            // rasters don't have clip-flooding issues so this is safe.
            if (!artBBox && hasImage && ocgIsRegistered) {
              try {
                const withoutCfg = await pdf.getOptionalContentConfig()
                try { withoutCfg.setVisibility(ocgId, false) } catch { /* unsupported */ }
                const withoutCanvas = document.createElement('canvas')
                withoutCanvas.width = artW_px; withoutCanvas.height = artH_px
                const withoutCtx = withoutCanvas.getContext('2d', { willReadFrequently: true })!
                await page.render({ canvas: withoutCanvas, canvasContext: withoutCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(withoutCfg) }).promise
                const { canvas, bbox } = diffToIsolated(
                  fullCtx.getImageData(0, 0, artW_px, artH_px).data,
                  withoutCtx.getImageData(0, 0, artW_px, artH_px).data,
                  artW_px, artH_px
                )
                if (bbox) { baseCanvas = canvas; artBBox = bbox }
                console.log(`[AI Import] Image fallback full/without diff for "${layerName}": bbox=${JSON.stringify(bbox)}`)
              } catch (e) {
                console.warn(`[AI Import] Image fallback diff failed for "${layerName}":`, e)
              }
            }
          } else if (ocgIsRegistered && !hasImage) {
            // ── Full-vs-without diff (vector / gradient layers) ───────────────
            // Both renders include ALL non-OCG page content + clipping context,
            // so gradient sh operators are correctly bounded by their clip paths.
            try {
              const withoutCfg = await pdf.getOptionalContentConfig()
              try { withoutCfg.setVisibility(ocgId, false) } catch { /* unsupported */ }

              const withoutCanvas = document.createElement('canvas')
              withoutCanvas.width = artW_px; withoutCanvas.height = artH_px
              const withoutCtx = withoutCanvas.getContext('2d', { willReadFrequently: true })!
              await page.render({ canvas: withoutCanvas, canvasContext: withoutCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(withoutCfg) }).promise

              const { canvas, bbox } = diffToIsolated(
                fullCtx.getImageData(0, 0, artW_px, artH_px).data,
                withoutCtx.getImageData(0, 0, artW_px, artH_px).data,
                artW_px, artH_px
              )
              if (bbox) { baseCanvas = canvas; artBBox = bbox }
              console.log(`[AI Import] Full/without diff for "${layerName}": bbox=${JSON.stringify(bbox)}`)
            } catch (e) {
              console.warn(`[AI Import] Full/without diff failed for "${layerName}":`, e)
            }
          }

          // Step 2 — if bbox touches a boundary, capture overflow on padded canvas
          if (!imageUrl && artBBox) {
            const touchesRight  = artBBox.maxX >= artW_px - 4
            const touchesLeft   = artBBox.minX <= 4
            const touchesTop    = artBBox.minY <= 4
            const touchesBottom = artBBox.maxY >= artH_px - 4

            const canDoOverflow = visId && (touchesRight || touchesLeft || touchesTop || touchesBottom)
            if (canDoOverflow) {
              const overflowPad = ofPad
              const overflowW = ofW
              const overflowH = ofH
              try {
                // Use same diff strategy as Step 1 but on a padded overflow canvas
                const makeOFCanvas = async (cfg: Awaited<ReturnType<typeof pdf.getOptionalContentConfig>>) => {
                  const c = document.createElement('canvas')
                  c.width = overflowW; c.height = overflowH
                  const ctx = c.getContext('2d', { willReadFrequently: true })!
                  ctx.translate(overflowPad, overflowPad)
                  let clipSkipped = false
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ;(ctx as any).clip = function(...args: unknown[]) {
                    if (!clipSkipped) { clipSkipped = true; ctx.beginPath(); return }
                    CanvasRenderingContext2D.prototype.clip.apply(ctx, args as Parameters<CanvasRenderingContext2D['clip']>)
                  }
                  await page.render({ canvas: c, canvasContext: ctx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(cfg) }).promise
                  ctx.setTransform(1, 0, 0, 1, 0, 0)
                  return ctx.getImageData(0, 0, overflowW, overflowH).data
                }

                let ofSrcData: Uint8ClampedArray, ofBaseData: Uint8ClampedArray
                if (hasImage || !ocgIsRegistered) {
                  // Solo-vs-none for raster images / sublayers
                  const soloOFCfg = await pdf.getOptionalContentConfig()
                  const noneOFCfg = await pdf.getOptionalContentConfig()
                  for (const { id, isOCG } of allOCGs) {
                    if (isOCG) {
                      try { soloOFCfg.setVisibility(id, false) } catch { /* unsupported */ }
                      try { noneOFCfg.setVisibility(id, false) } catch { /* unsupported */ }
                    }
                  }
                  try { soloOFCfg.setVisibility(visId!, true) } catch { /* unsupported */ }
                  ofSrcData = await makeOFCanvas(soloOFCfg)
                  ofBaseData = await makeOFCanvas(noneOFCfg)
                } else {
                  // Full-vs-without for vector/gradient layers
                  const withoutOFCfg = await pdf.getOptionalContentConfig()
                  try { withoutOFCfg.setVisibility(ocgId, false) } catch { /* unsupported */ }
                  ofSrcData = await makeOFCanvas(fullRenderCfg)
                  ofBaseData = await makeOFCanvas(withoutOFCfg)
                }

                const { canvas: resultOFCanvas } = diffToIsolated(ofSrcData, ofBaseData, overflowW, overflowH)
                const resultData = resultOFCanvas.getContext('2d', { willReadFrequently: true })!
                  .getImageData(0, 0, overflowW, overflowH).data
                const isVisible = (idx: number) => resultData[idx + 3] > 10

                const margin = Math.round(20 * renderScale)
                let extMinX = artBBox.minX + overflowPad
                let extMinY = artBBox.minY + overflowPad
                let extMaxX = artBBox.maxX + overflowPad
                let extMaxY = artBBox.maxY + overflowPad
                let foundOverflow = false

                if (touchesRight) {
                  const bx0 = artW_px + overflowPad
                  const bx1 = Math.min(overflowW - 1, bx0 + overflowPad)
                  const by0 = Math.max(0, artBBox.minY + overflowPad - margin)
                  const by1 = Math.min(overflowH - 1, artBBox.maxY + overflowPad + margin)
                  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
                    if (isVisible((y * overflowW + x) * 4)) {
                      extMaxX = Math.max(extMaxX, x); extMinY = Math.min(extMinY, y); extMaxY = Math.max(extMaxY, y); foundOverflow = true
                    }
                  }
                }
                if (touchesLeft) {
                  const bx1 = overflowPad
                  const bx0 = Math.max(0, bx1 - overflowPad)
                  const by0 = Math.max(0, artBBox.minY + overflowPad - margin)
                  const by1 = Math.min(overflowH - 1, artBBox.maxY + overflowPad + margin)
                  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
                    if (isVisible((y * overflowW + x) * 4)) {
                      extMinX = Math.min(extMinX, x); extMinY = Math.min(extMinY, y); extMaxY = Math.max(extMaxY, y); foundOverflow = true
                    }
                  }
                }
                if (touchesBottom) {
                  const by0 = artH_px + overflowPad
                  const by1 = Math.min(overflowH - 1, by0 + overflowPad)
                  const bx0 = Math.max(0, artBBox.minX + overflowPad - margin)
                  const bx1 = Math.min(overflowW - 1, artBBox.maxX + overflowPad + margin)
                  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
                    if (isVisible((y * overflowW + x) * 4)) {
                      extMaxY = Math.max(extMaxY, y); extMinX = Math.min(extMinX, x); extMaxX = Math.max(extMaxX, x); foundOverflow = true
                    }
                  }
                }
                if (touchesTop) {
                  const by1 = overflowPad
                  const by0 = Math.max(0, by1 - overflowPad)
                  const bx0 = Math.max(0, artBBox.minX + overflowPad - margin)
                  const bx1 = Math.min(overflowW - 1, artBBox.maxX + overflowPad + margin)
                  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
                    if (isVisible((y * overflowW + x) * 4)) {
                      extMinY = Math.min(extMinY, y); extMinX = Math.min(extMinX, x); extMaxX = Math.max(extMaxX, x); foundOverflow = true
                    }
                  }
                }

                if (foundOverflow) {
                  const cropX = Math.max(0, extMinX - pad2)
                  const cropY = Math.max(0, extMinY - pad2)
                  const cropW = Math.min(overflowW - cropX, extMaxX - extMinX + pad2 * 2)
                  const cropH = Math.min(overflowH - cropY, extMaxY - extMinY + pad2 * 2)
                  applyGraphicCropFrom(resultOFCanvas, cropX, cropY, cropW, cropH, overflowPad, overflowPad)
                }
              } catch (e) {
                console.warn(`[AI Import] Overflow capture failed for "${layerName}":`, e)
              }
            }
          }

          // Step 3 — element fully inside artboard: crop from baseCanvas
          if (!imageUrl && artBBox && baseCanvas) {
            const cropX = Math.max(0, artBBox.minX - pad2)
            const cropY = Math.max(0, artBBox.minY - pad2)
            const cropW = Math.min(artW_px - cropX, artBBox.maxX - artBBox.minX + pad2 * 2)
            const cropH = Math.min(artH_px - cropY, artBBox.maxY - artBBox.minY + pad2 * 2)
            applyGraphicCropFrom(baseCanvas, cropX, cropY, cropW, cropH, 0, 0)
          }

          // Final fallback: operator list bbox (artboard-space coords)
          if (!imageUrl) {
            const opBBox = ocgPathBBox.get(ocgId)
            if (opBBox && opBBox.maxX > opBBox.minX && opBBox.maxY > opBBox.minY) {
              const cropX = Math.max(0, Math.floor(opBBox.minX) - pad2)
              const cropY = Math.max(0, Math.floor(opBBox.minY) - pad2)
              const cropW = Math.min(artW_px - cropX, Math.ceil(opBBox.maxX - opBBox.minX) + pad2 * 2)
              const cropH = Math.min(artH_px - cropY, Math.ceil(opBBox.maxY - opBBox.minY) + pad2 * 2)
              applyGraphicCropFrom(fullCanvas, cropX, cropY, cropW, cropH, 0, 0)
            }
          }

          extractedFields.push({
            type: 'graphic', layerName, isImageSlot, value: '', originalText: '',
            imageUrl, scale: 1, opacity: 1,
            x: gx, y: gy, width: gw, height: gh,
            fontSize: 0, color: '#ffffff', fontWeight: 400, fontStyle: 'normal', textAlign: 'left',
          })
        }

        // Reorder extractedFields to match Illustrator layer order (sortedEffectiveOCGs)
        const layerOrder = new Map<string, number>()
        sortedEffectiveOCGs.forEach((ocg, i) => {
          layerOrder.set(ocg.name.replace(/^\s*[*!]/, '').trim(), i)
        })
        extractedFields.sort((a, b) => (layerOrder.get(a.layerName) ?? 999) - (layerOrder.get(b.layerName) ?? 999))
      }

      // Remove fields that have no overlap with the artboard [0,1]×[0,1] area.
      // In Illustrator files with multiple artboards, other artboards' layers can
      // appear in the content stream but are positioned outside this artboard's bounds.
      for (let fi = extractedFields.length - 1; fi >= 0; fi--) {
        const f = extractedFields[fi]
        const x2 = f.x + Math.max(f.width, 0.02)
        const y2 = f.y + Math.max(f.height, 0.02)
        if (x2 <= 0 || f.x >= 1 || y2 <= 0 || f.y >= 1) {
          console.log(`[AI Import] Removing out-of-bounds field "${f.layerName}": x=${f.x.toFixed(3)} y=${f.y.toFixed(3)} w=${f.width.toFixed(3)} h=${f.height.toFixed(3)}`)
          extractedFields.splice(fi, 1)
        }
      }

      // Make bgCanvas transparent in !-image slot regions — but ONLY for bare page-background
      // pixels (those matching pageBgCanvas). Pixels from design layers that sit above
      // the image slot in the layer stack (e.g. "Element", "Background" overlays) are KEPT opaque
      // so they render correctly on top of the photo.
      //
      // Algorithm per pixel inside each image slot field's bbox:
      //   |bgCanvas – pageBgCanvas| ≤ 12 → page background only → alpha = 0 (transparent)
      //   |bgCanvas – pageBgCanvas| >  12 → design element       → keep (alpha unchanged)
      const hasImageField = extractedFields.some(f => f.isImageSlot === true)
      if (hasImageField) {
        const bgImgData = bgCtx.getImageData(0, 0, artW_px, artH_px)
        const bgPixels = bgImgData.data
        for (const field of extractedFields) {
          if (field.isImageSlot === true) {
            const x0 = Math.max(0, Math.floor(field.x * artW_px))
            const y0 = Math.max(0, Math.floor(field.y * artH_px))
            const x1 = Math.min(artW_px, Math.ceil((field.x + field.width) * artW_px))
            const y1 = Math.min(artH_px, Math.ceil((field.y + field.height) * artH_px))
            for (let py = y0; py < y1; py++) {
              for (let px2 = x0; px2 < x1; px2++) {
                const idx = (py * artW_px + px2) * 4
                const rgbDiff = Math.abs(bgPixels[idx]     - pageBgData[idx])
                              + Math.abs(bgPixels[idx + 1] - pageBgData[idx + 1])
                              + Math.abs(bgPixels[idx + 2] - pageBgData[idx + 2])
                // Also check that this pixel doesn't have significantly more alpha than
                // the page background — this catches dark/black design elements whose
                // RGB matches the background (0,0,0) but whose alpha differs.
                const alphaDiff = bgPixels[idx + 3] - pageBgData[idx + 3]
                if (rgbDiff <= 12 && alphaDiff <= 30) bgPixels[idx + 3] = 0
              }
            }
          }
        }
        bgCtx.putImageData(bgImgData, 0, 0)
      }

      return {
        backgroundImageUrl: bgCanvas.toDataURL('image/png'),
        artboardWidth: artboard.width,
        artboardHeight: artboard.height,
        artboardName: containerOCG
          ? containerOCG.name.replace(/^_+/, '').trim()
          : artboard.name,
        editableFields: extractedFields,
      }
    } catch (err) {
      console.error('[AI Import] processArtboardData error:', err)
      throw err
    }
  }, [])

  // ── Process all selected artboards ────────────────────────────────────────

  const processSelectedArtboards = useCallback(async () => {
    const boards = artboards.filter(b => selectedArtboards.has(b.pageNum))
    if (boards.length === 0) return
    setIsLoading(true)
    setError(null)
    setProcessingProgress({ current: 0, total: boards.length })
    const results: AIImportData[] = []
    for (let i = 0; i < boards.length; i++) {
      setProcessingProgress({ current: i + 1, total: boards.length })
      try {
        const result = await processArtboardData(boards[i])
        results.push(result)
      } catch {
        console.warn(`[AI Import] Skipping artboard "${boards[i].name}" due to error`)
      }
    }
    setIsLoading(false)
    setProcessingProgress(null)
    if (results.length === 0) {
      setError('Kein Artboard konnte verarbeitet werden.')
      return
    }
    setProcessedVariants(results)
    setActivePreviewIndex(0)
    setStep('fields')
  }, [artboards, selectedArtboards, processArtboardData])

  // ── Final import ──────────────────────────────────────────────────────────

  const handleImport = () => {
    if (processedVariants.length === 0) return
    onImport(processedVariants)
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const updateFieldValue = (index: number, value: string) => {
    setProcessedVariants(prev => {
      const updated = prev.map(v => ({ ...v, editableFields: [...v.editableFields] }))
      const thisLayerName = updated[activePreviewIndex].editableFields[index]?.layerName
      // Update active variant
      updated[activePreviewIndex].editableFields[index] = {
        ...updated[activePreviewIndex].editableFields[index], value
      }
      // Sync to matching text layers in other variants
      if (thisLayerName) {
        for (let vi = 0; vi < updated.length; vi++) {
          if (vi === activePreviewIndex) continue
          updated[vi].editableFields = updated[vi].editableFields.map(f =>
            f.type === 'text' && f.layerName === thisLayerName ? { ...f, value } : f
          )
        }
      }
      return updated
    })
  }

  const resetFieldValue = (index: number) => {
    setProcessedVariants(prev => {
      const updated = prev.map(v => ({ ...v, editableFields: [...v.editableFields] }))
      const thisLayerName = updated[activePreviewIndex].editableFields[index]?.layerName
      const origText = updated[activePreviewIndex].editableFields[index]?.originalText ?? ''
      updated[activePreviewIndex].editableFields[index] = {
        ...updated[activePreviewIndex].editableFields[index], value: origText
      }
      if (thisLayerName) {
        for (let vi = 0; vi < updated.length; vi++) {
          if (vi === activePreviewIndex) continue
          updated[vi].editableFields = updated[vi].editableFields.map(f =>
            f.type === 'text' && f.layerName === thisLayerName ? { ...f, value: f.originalText } : f
          )
        }
      }
      return updated
    })
  }

  const resetAllFields = () => {
    setProcessedVariants(prev =>
      prev.map(v => ({ ...v, editableFields: v.editableFields.map(f => ({ ...f, value: f.originalText })) }))
    )
  }

  const activeVariant = processedVariants[activePreviewIndex] ?? null
  const fields = activeVariant?.editableFields ?? []
  const backgroundUrl = activeVariant?.backgroundImageUrl ?? ''
  const hasAnyChange = processedVariants.some(v =>
    v.editableFields.some(f => f.type === 'text' && f.value !== f.originalText)
  )

  // ── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-[#0f0a1e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">Illustrator Import</h2>
            <p className="text-xs text-cyan-400 mt-0.5">
              {step === 'upload' && 'Schritt 1 — .ai Datei hochladen'}
              {step === 'artboards' && 'Schritt 2 — Artboards auswählen'}
              {step === 'fields' && 'Schritt 3 — Felder überprüfen & importieren'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">

          {/* ── Step 1: Upload ── */}
          {step === 'upload' && (
            <div className="space-y-4">
              <input ref={fileInputRef} type="file" accept=".ai,.pdf" onChange={handleFileChange} className="hidden" />
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 cursor-pointer text-center transition-all ${
                  isDragging
                    ? 'border-cyan-400 bg-cyan-500/10'
                    : 'border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/8'
                }`}
              >
                {isLoading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
                    <p className="text-white font-medium">Datei wird analysiert…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-gray-400" />
                    <p className="text-white font-semibold text-lg">Illustrator Datei hier ablegen</p>
                    <p className="text-gray-400 text-sm">oder klicken zum Auswählen · .ai Format</p>
                  </div>
                )}
              </div>
              <div className="bg-white/5 rounded-xl p-4 border border-white/10 text-xs text-gray-400 space-y-1">
                <p className="text-white font-medium text-sm mb-2">Voraussetzungen</p>
                <p>• Datei muss mit <span className="text-cyan-400">PDF-Kompatibilität</span> gespeichert sein (Illustrator-Standard)</p>
                <p>• Layer mit <span className="text-cyan-400">* Präfix</span> (z.B. <code className="bg-white/10 px-1 rounded">*Headline</code>) werden als editierbare Felder erkannt</p>
                <p>• Unterstützt einzelne und mehrere Artboards</p>
              </div>
              {error && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Artboard selection ── */}
          {step === 'artboards' && (
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                  {processingProgress && (
                    <p className="text-gray-400 text-sm">
                      Artboard {processingProgress.current} von {processingProgress.total} wird verarbeitet…
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-gray-400 text-sm">
                      {artboards.length === 1
                        ? 'Eine Seite gefunden:'
                        : `${artboards.length} Artboards gefunden — wähle aus, welche du importieren möchtest:`}
                    </p>
                    {artboards.length > 1 && (
                      <button
                        onClick={() => setSelectedArtboards(
                          selectedArtboards.size === artboards.length
                            ? new Set()
                            : new Set(artboards.map(b => b.pageNum))
                        )}
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        {selectedArtboards.size === artboards.length ? 'Alle abwählen' : 'Alle auswählen'}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {artboards.map((board) => {
                      const isSelected = selectedArtboards.has(board.pageNum)
                      return (
                        <button
                          key={board.pageNum}
                          onClick={() => {
                            setSelectedArtboards(prev => {
                              const next = new Set(prev)
                              if (next.has(board.pageNum)) next.delete(board.pageNum)
                              else next.add(board.pageNum)
                              return next
                            })
                          }}
                          className={`text-left rounded-xl p-3 transition-all border ${
                            isSelected
                              ? 'border-cyan-400 bg-cyan-500/10'
                              : 'border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/8'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${
                              isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-white/30'
                            }`}>
                              {isSelected && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                            </div>
                          </div>
                          <div className="flex justify-center mb-3 bg-black/30 rounded-lg overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={board.thumbUrl} alt={board.name} className="max-h-24 object-contain" />
                          </div>
                          <p className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-gray-300'}`}>{board.name}</p>
                          <p className="text-gray-500 text-xs">{board.width} × {board.height} px</p>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
              {error && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Field confirmation ── */}
          {step === 'fields' && (
            <div className="space-y-5">
              {isLoading ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                  <p className="text-gray-400 text-sm">Artboard wird verarbeitet…</p>
                </div>
              ) : (
                <>
                  {/* Artboard tabs — shown when multiple variants */}
                  {processedVariants.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {processedVariants.map((v, i) => (
                        <button
                          key={i}
                          onClick={() => setActivePreviewIndex(i)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            i === activePreviewIndex
                              ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                              : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-white'
                          }`}
                        >
                          {v.artboardName}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Artboard preview */}
                  {backgroundUrl && (
                    <div className="flex justify-center bg-black/40 rounded-xl overflow-hidden border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={backgroundUrl} alt="Artboard Preview" className="max-h-48 object-contain" />
                    </div>
                  )}

                  {/* Cross-artboard sync hint */}
                  {processedVariants.length > 1 && (
                    <p className="text-xs text-cyan-400/70 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2">
                      Text-Änderungen werden automatisch auf alle {processedVariants.length} Artboards übertragen.
                    </p>
                  )}

                  {fields.length === 0 ? (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300 space-y-1">
                      <p className="font-semibold">Kein Text im Artboard gefunden.</p>
                      <p>Stelle sicher, dass die .ai Datei mit <span className="text-white">PDF-Kompatibilität</span> gespeichert wurde und dass der Artboard Text enthält.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-400">
                          <span className="text-cyan-400 font-semibold">{fields.length} editierbare Felder</span> erkannt{processedVariants.length > 1 ? ` (Artboard: ${activeVariant?.artboardName})` : ''} — Texte jetzt anpassen oder später im Editor ändern:
                        </p>
                        {hasAnyChange && (
                          <button
                            onClick={resetAllFields}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Alle zurücksetzen
                          </button>
                        )}
                      </div>
                      {fields.map((field, i) => (
                        <div key={i}>
                          <Label className="text-gray-300 flex items-center gap-2 mb-2">
                            <span className="text-cyan-400 text-xs bg-cyan-500/20 px-2 py-0.5 rounded font-mono">{field.layerName}</span>
                            <span className="text-xs text-gray-500">{field.isImageSlot ? 'Bild-Layer' : field.type === 'graphic' ? 'Grafik-Layer' : 'Text-Layer'}</span>
                            {field.type === 'text' && field.value !== field.originalText && (
                              <button
                                onClick={() => resetFieldValue(i)}
                                title="Auf Original zurücksetzen"
                                className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-cyan-400 transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Reset
                              </button>
                            )}
                          </Label>
                          {field.type === 'graphic' ? (
                            field.imageUrl ? (
                              <div className="bg-black/30 rounded-lg border border-white/10 p-2 flex justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={field.imageUrl} alt={field.layerName} className="max-h-32 object-contain rounded" />
                              </div>
                            ) : (
                              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-xs text-yellow-300">
                                Grafik konnte nicht extrahiert werden — wird als Platzhalter importiert.
                              </div>
                            )
                          ) : (
                            <textarea
                              value={field.value}
                              onChange={(e) => updateFieldValue(i, e.target.value)}
                              className="w-full px-3 py-2 bg-white/5 border border-white/20 text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                              rows={field.value.includes('\n') ? 3 : 2}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {error && (
                <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-red-300 text-sm">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'artboards' && !isLoading && (
          <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center">
            <span className="text-sm text-gray-400">
              {selectedArtboards.size === 0
                ? 'Kein Artboard ausgewählt'
                : `${selectedArtboards.size} Artboard${selectedArtboards.size !== 1 ? 's' : ''} ausgewählt`}
            </span>
            <button
              onClick={processSelectedArtboards}
              disabled={selectedArtboards.size === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/30"
            >
              Weiter
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        {step === 'fields' && !isLoading && (
          <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center">
            <button
              onClick={() => setStep('artboards')}
              className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-all"
            >
              Zurück
            </button>
            <button
              onClick={handleImport}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold text-sm hover:opacity-90 transition-all shadow-lg shadow-cyan-500/30"
            >
              <FileCheck className="w-4 h-4" />
              {processedVariants.length > 1
                ? `${processedVariants.length} Artboards importieren`
                : 'Importieren'}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
