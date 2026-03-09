'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Upload, X, ChevronRight, Loader2, FileCheck, AlertCircle, RotateCcw } from 'lucide-react'
import type { AIImportData, AIEditableField } from '@/types/posting'
import { Label } from '@/components/ui/label'

interface AIImportDialogProps {
  onImport: (data: AIImportData) => void
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
  const [selectedArtboard, setSelectedArtboard] = useState<ArtboardInfo | null>(null)
  const [fields, setFields] = useState<AIEditableField[]>([])
  const [backgroundUrl, setBackgroundUrl] = useState<string>('')

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

        const label = pageLabels?.[i - 1]
        const name = label
          ? label
          : pdf.numPages === 1
          ? file.name.replace(/\.ai$/i, '')
          : `Artboard ${i}`

        boards.push({
          pageNum: i,
          name,
          width: Math.round(vp.width),
          height: Math.round(vp.height),
          thumbUrl: canvas.toDataURL('image/jpeg', 0.8),
        })
      }

      setArtboards(boards)
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

  const processArtboard = useCallback(async (artboard: ArtboardInfo) => {
    setIsLoading(true)
    setError(null)
    setSelectedArtboard(artboard)

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

      // id: string ID (OCG ref like "25R", or synthetic "layer:*Grafik" for sublayers)
      // isOCG: true = registered OCG (can use setVisibility), false = sublayer marker only
      const allOCGs: { id: string; name: string; isOCG: boolean }[] = []

      for (let j = 0; j < firstOpList.fnArray.length; j++) {
        if (firstOpList.fnArray[j] === pdfjs.OPS.beginMarkedContentProps) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = firstOpList.argsArray[j] as any[]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const props = args[1] as Record<string, any> | null
          const tag = String(args[0] ?? '')

          if (tag === 'OC' && props?.id) {
            // Registered PDF OCG – can use setVisibility()
            const ocgId = String(props.id)
            if (!allOCGs.find(g => g.id === ocgId)) {
              try {
                const group = ocgConfig.getGroup(ocgId) as { name?: string } | null
                allOCGs.push({ id: ocgId, name: group?.name ?? ocgId, isOCG: true })
              } catch {
                allOCGs.push({ id: ocgId, name: ocgId, isOCG: true })
              }
            }
          } else if (props) {
            // Illustrator sublayer marker – name stored in properties dict
            // Illustrator encodes sublayer names as /Name key in the BDC properties
            const layerName = String(props.Name ?? props.name ?? props.N ?? '')
            if (layerName) {
              const syntheticId = `layer:${layerName}`
              if (!allOCGs.find(g => g.id === syntheticId)) {
                allOCGs.push({ id: syntheticId, name: layerName, isOCG: false })
              }
            }
          }

          // Debug all markers to console
          console.log(`[AI Import] BDC marker: tag="${tag}" id=${props?.id ?? '-'} name=${props?.Name ?? props?.name ?? '-'}`)
        }
      }

      const starredOCGs = allOCGs.filter(g => g.name.trimStart().startsWith('*'))
      // If no starred OCGs (sublayers not individually exported), fall back to all
      const effectiveOCGs = starredOCGs.length > 0 ? starredOCGs : allOCGs

      console.log('[AI Import] All OCGs:', allOCGs.map(g => `${g.id} (${g.isOCG ? 'OCG' : 'layer'}): "${g.name}"`))
      console.log('[AI Import] Effective OCGs:', effectiveOCGs.map(g => `${g.id}: "${g.name}"`))

      // ── Extract text content, grouped by OCG via marked content markers ────
      // getTextContent with includeMarkedContent returns both text items and
      // beginMarkedContentProps/endMarkedContent markers. OC-tagged markers
      // tell us exactly which OCG each text item belongs to.
      const textContent = await page.getTextContent({ includeMarkedContent: true })

      type RichItem = { str: string; vx: number; vy: number; fontSize: number; width: number }
      // Map from OCG ID → text items found in that OCG's marked content section
      const ocgTextMap = new Map<string, RichItem[]>()
      // Text items outside any OC group (for fallback)
      const ungroupedItems: RichItem[] = []

      {
        let currentOCGId: string | null = null
        let mcDepth = 0
        let ocgStartDepth = -1
        for (const item of textContent.items) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = item as any
          if (it.type === 'beginMarkedContentProps' && it.tag === 'OC') {
            mcDepth++
            if (currentOCGId === null) {
              // Use the id field directly, or fall back to checking the properties object
              const ocId = it.id ?? it.properties?.id ?? it.properties?.OCMD?.id ?? null
              if (ocId) { currentOCGId = String(ocId); ocgStartDepth = mcDepth }
            }
          } else if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') {
            mcDepth++
          } else if (it.type === 'endMarkedContent') {
            if (mcDepth === ocgStartDepth) { currentOCGId = null; ocgStartDepth = -1 }
            mcDepth = Math.max(0, mcDepth - 1)
          } else if (typeof it.str === 'string' && it.str.trim()) {
            const [vx, vy] = vp1.convertToViewportPoint(it.transform[4], it.transform[5])
            const fontSize = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 12
            const rich: RichItem = { str: it.str, vx, vy, fontSize, width: it.width ?? 0 }
            if (currentOCGId !== null) {
              if (!ocgTextMap.has(currentOCGId)) ocgTextMap.set(currentOCGId, [])
              ocgTextMap.get(currentOCGId)!.push(rich)
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

      // Force all effective OCGs visible for full render (some may default to hidden)
      const fullRenderCfg = await pdf.getOptionalContentConfig()
      for (const { id, isOCG } of effectiveOCGs) {
        if (isOCG) try { fullRenderCfg.setVisibility(id, true) } catch { /* unsupported */ }
      }

      // fullCanvas = artboard-sized render with all layers visible (used for artboard diff fallback)
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = artW_px; fullCanvas.height = artH_px
      const fullCtx = fullCanvas.getContext('2d')!
      await page.render({ canvas: fullCanvas, canvasContext: fullCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(fullRenderCfg) }).promise

      // ── Render background (all effective OCG layers hidden) ───────────────
      // bgCanvas is artboard-sized only — used as the displayed background image
      const bgCfg = await pdf.getOptionalContentConfig()
      for (const { id, isOCG } of effectiveOCGs) {
        if (isOCG) try { bgCfg.setVisibility(id, false) } catch { /* unsupported */ }
      }
      const bgCanvas = document.createElement('canvas')
      bgCanvas.width = artW_px
      bgCanvas.height = artH_px
      const bgCtx = bgCanvas.getContext('2d')!
      await page.render({
        canvas: bgCanvas, canvasContext: bgCtx, viewport: renderVp,
        optionalContentConfigPromise: Promise.resolve(bgCfg),
      }).promise

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
      for (const { id } of effectiveOCGs) ocgIsText.set(id, false)

      try {
        const opList = firstOpList
        const { OPS } = pdfjs
        let mcDepth = 0
        const ocgStack: {id: string, depth: number}[] = []
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
            if (bTag === 'OC' && props?.id) {
              const ocgId = String(props.id)
              if (ocgIsText.has(ocgId)) matchedId = ocgId
            } else if (props) {
              // Illustrator sublayer: check Name key
              const layerName = String(props.Name ?? props.name ?? props.N ?? '')
              if (layerName) {
                const syntheticId = `layer:${layerName}`
                if (ocgIsText.has(syntheticId)) matchedId = syntheticId
              }
            }
            if (matchedId) {
              ocgStack.push({id: matchedId, depth: mcDepth})
              if (!ocgFirstIdx.has(matchedId)) ocgFirstIdx.set(matchedId, j)
            }
          } else if (fn === OPS.beginMarkedContent) {
            mcDepth++
          } else if (fn === OPS.endMarkedContent) {
            if (ocgStack.length > 0 && ocgStack[ocgStack.length - 1].depth === mcDepth) ocgStack.pop()
            mcDepth = Math.max(0, mcDepth - 1)
          }

          const inOCG = ocgStack.length > 0 ? ocgStack[ocgStack.length - 1].id : null
          if (!inOCG) continue

          if (fn === OPS.showText || fn === OPS.showSpacedText ||
              fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
            ocgIsText.set(inOCG, true)
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
      console.log('[AI Import] OCG path bboxes:', Array.from(ocgPathBBox.entries()))

      // Separate and order OCGs
      const textStarredOCGs = effectiveOCGs
        .filter(ocg => ocgIsText.get(ocg.id) === true)
        .sort((a, b) => (ocgFirstIdx.get(a.id) ?? 0) - (ocgFirstIdx.get(b.id) ?? 0))
      const graphicStarredOCGs = effectiveOCGs.filter(ocg => ocgIsText.get(ocg.id) !== true)

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
            const w = it.width > 2 ? it.width : it.str.length * it.fontSize * 0.55
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
            x: Math.max(0, minVx / vp1.width), y: Math.max(0, topVy / vp1.height),
            width: Math.min(0.95, Math.max(0.4, (maxVx - minVx) / vp1.width)),
            height: Math.max(0.05, (bottomVy - topVy) / vp1.height),
            scale: 1, fontSize: fs, color: '#ffffff',
            fontWeight: fs >= 18 ? 'bold' : 'normal', fontStyle: 'normal', textAlign: 'left',
          })
        })
      } else {
        // ── Process text OCGs (correctly ordered by operator list position) ──
        for (let ti = 0; ti < textStarredOCGs.length; ti++) {
          const { name: ocgRawName, id: ocgId } = textStarredOCGs[ti]
          const layerName = ocgRawName.replace(/^\s*\*/, '').trim()

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
            const w = it.width > 2 ? it.width : it.str.length * it.fontSize * 0.55
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
          extractedFields.push({
            type: 'text', layerName, value: text, originalText: text,
            x: Math.max(0, minVx / vp1.width), y: Math.max(0, topVy / vp1.height),
            width: Math.min(0.95, Math.max(0.4, (maxVx - minVx) / vp1.width)),
            height: Math.max(0.05, (bottomVy - topVy) / vp1.height),
            scale: 1, fontSize: fs, color: '#ffffff',
            fontWeight: fs >= 18 ? 'bold' : 'normal', fontStyle: 'normal', textAlign: 'left',
          })
        }

        // ── Process graphic OCGs ──────────────────────────────────────────
        for (const { id: ocgId, name: ocgRawName, isOCG: ocgIsRegistered } of graphicStarredOCGs) {
          const layerName = ocgRawName.replace(/^\s*\*/, '').trim()
          console.log(`[AI Import] Extracting graphic: "${layerName}" (${ocgId})`)

          let imageUrl: string | undefined
          let gx = 0.05, gy = 0.3, gw = 0.4, gh = 0.4
          const pad2 = 16

          // Helper: crop a rect from an artboard-sized canvas, set normalized position.
          // offsetX/offsetY: how far the artboard origin is shifted in the source canvas.
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
            if (bgW > 0 && bgH > 0) paintOver(bgX, bgY, bgW, bgH)
            return true
          }

          // ── Render only this OCG with transparent background ─────────────
          // Like copy-paste from Illustrator into another app: the element is
          // isolated on transparency so no background bleeds through.
          // We hide all other OCGs and render with background:'transparent',
          // then scan for non-transparent pixels to find the true bbox.
          const isolateCfg = await pdf.getOptionalContentConfig()
          for (const { id: eid, isOCG: eidIsOCG } of allOCGs) {
            if (eidIsOCG) try { isolateCfg.setVisibility(eid, false) } catch { /* unsupported */ }
          }
          try { isolateCfg.setVisibility(ocgId, true) } catch { /* unsupported */ }

          // Helper: find bbox of non-transparent pixels in ImageData
          const alphaBBox = (data: Uint8ClampedArray, w: number, h: number) => {
            let minX = w, minY = h, maxX = -1, maxY = -1
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
              if (data[(y * w + x) * 4 + 3] > 10) {
                if (x < minX) minX = x; if (x > maxX) maxX = x
                if (y < minY) minY = y; if (y > maxY) maxY = y
              }
            }
            return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null
          }

          // Step 1 — render only this OCG at artboard size, transparent bg
          let baseCanvas: HTMLCanvasElement | null = null
          let artBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null
          try {
            baseCanvas = document.createElement('canvas')
            baseCanvas.width = artW_px; baseCanvas.height = artH_px
            const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true })!
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.render({ canvas: baseCanvas, canvasContext: baseCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(isolateCfg), background: 'transparent' as any }).promise
            artBBox = alphaBBox(baseCtx.getImageData(0, 0, artW_px, artH_px).data, artW_px, artH_px)
          } catch (e) {
            console.warn(`[AI Import] Isolated render failed for "${layerName}":`, e)
          }

          // Step 2 — if bbox touches a boundary, try overflow capture on padded canvas
          if (!imageUrl && artBBox) {
            const touchesRight  = artBBox.maxX >= artW_px - 4
            const touchesLeft   = artBBox.minX <= 4
            const touchesTop    = artBBox.minY <= 4
            const touchesBottom = artBBox.maxY >= artH_px - 4

            if (touchesRight || touchesLeft || touchesTop || touchesBottom) {
              const overflowPad = Math.round(200 * renderScale)
              const overflowW = artW_px + 2 * overflowPad
              const overflowH = artH_px + 2 * overflowPad
              try {
                const overflowCanvas = document.createElement('canvas')
                overflowCanvas.width = overflowW; overflowCanvas.height = overflowH
                const overflowCtx = overflowCanvas.getContext('2d', { willReadFrequently: true })!
                overflowCtx.translate(overflowPad, overflowPad)

                // Skip the first clip() — the Illustrator artboard boundary clip
                let firstClipSkipped = false
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(overflowCtx as any).clip = function(...args: unknown[]) {
                  if (!firstClipSkipped) { firstClipSkipped = true; overflowCtx.beginPath(); return }
                  CanvasRenderingContext2D.prototype.clip.apply(overflowCtx, args as Parameters<CanvasRenderingContext2D['clip']>)
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await page.render({ canvas: overflowCanvas, canvasContext: overflowCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(isolateCfg), background: 'transparent' as any }).promise
                overflowCtx.setTransform(1, 0, 0, 1, 0, 0)

                const overflowData = overflowCtx.getImageData(0, 0, overflowW, overflowH).data
                const margin = Math.round(20 * renderScale)
                const isVisible = (idx: number) => overflowData[idx + 3] > 10

                // Extend artboard bbox with any overflow pixels found in narrow band
                // outside the specific boundary, restricted to element's y/x range
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
                  applyGraphicCropFrom(overflowCanvas, cropX, cropY, cropW, cropH, overflowPad, overflowPad)
                }
              } catch (e) {
                console.warn(`[AI Import] Overflow capture failed for "${layerName}":`, e)
              }
            }
          }

          // Step 3 — no overflow found, or element is fully inside artboard:
          // crop from the isolated transparent baseCanvas
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
            type: 'graphic', layerName, value: '', originalText: '',
            imageUrl, scale: 1,
            x: gx, y: gy, width: gw, height: gh,
            fontSize: 0, color: '#ffffff', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left',
          })
        }
      }

      setBackgroundUrl(bgCanvas.toDataURL('image/png'))

      setFields(extractedFields)
      setStep('fields')
    } catch (err) {
      console.error(err)
      setError('Artboard konnte nicht verarbeitet werden.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ── Final import ──────────────────────────────────────────────────────────

  const handleImport = () => {
    if (!selectedArtboard) return
    onImport({
      backgroundImageUrl: backgroundUrl,
      artboardWidth: selectedArtboard.width,
      artboardHeight: selectedArtboard.height,
      artboardName: selectedArtboard.name,
      editableFields: fields,
    })
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
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)))
  }

  const resetFieldValue = (index: number) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value: f.originalText } : f)))
  }

  const resetAllFields = () => {
    setFields((prev) => prev.map((f) => ({ ...f, value: f.originalText })))
  }

  const hasAnyChange = fields.some((f) => f.type === 'text' && f.value !== f.originalText)

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
              {step === 'artboards' && 'Schritt 2 — Artboard auswählen'}
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
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
                </div>
              ) : (
                <>
                  <p className="text-gray-400 text-sm">
                    {artboards.length === 1
                      ? 'Eine Seite gefunden — Artboard bestätigen:'
                      : `${artboards.length} Artboards gefunden — welchen möchtest du importieren?`}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {artboards.map((board) => (
                      <button
                        key={board.pageNum}
                        onClick={() => processArtboard(board)}
                        className="group text-left border border-white/10 hover:border-cyan-400 bg-white/5 hover:bg-cyan-500/10 rounded-xl p-3 transition-all"
                      >
                        <div className="flex justify-center mb-3 bg-black/30 rounded-lg overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={board.thumbUrl} alt={board.name} className="max-h-24 object-contain" />
                        </div>
                        <p className="text-white text-sm font-semibold truncate">{board.name}</p>
                        <p className="text-gray-500 text-xs">{board.width} × {board.height} px</p>
                      </button>
                    ))}
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
                  {/* Artboard preview */}
                  {backgroundUrl && (
                    <div className="flex justify-center bg-black/40 rounded-xl overflow-hidden border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={backgroundUrl} alt="Artboard Preview" className="max-h-48 object-contain" />
                    </div>
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
                          <span className="text-cyan-400 font-semibold">{fields.length} editierbare Felder</span> erkannt — Texte jetzt anpassen oder später im Editor ändern:
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
                            <span className="text-cyan-400 text-xs bg-cyan-500/20 px-2 py-0.5 rounded font-mono">*{field.layerName}</span>
                            <span className="text-xs text-gray-500">{field.type === 'graphic' ? 'Grafik-Layer' : 'Text-Layer'}</span>
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
              Importieren
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
