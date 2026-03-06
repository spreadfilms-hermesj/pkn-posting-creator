'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Upload, X, ChevronRight, Loader2, FileCheck, AlertCircle } from 'lucide-react'
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

      // ── Collect all OCGs + find starred ones ──────────────────────────────
      const ocgConfig = await pdf.getOptionalContentConfig()

      const allOCGs: { id: string; name: string }[] = []
      const starredOCGs: { id: string; name: string }[] = []
      try {
        for (const entry of Array.from(ocgConfig as unknown as Iterable<[unknown, unknown]>)) {
          const [id, group] = entry as [string, { name?: string }]
          const name = (group as { name?: string })?.name ?? ''
          if (name) allOCGs.push({ id, name })
          // Match * prefix, trim whitespace, also catch leading space + *
          if (name.trimStart().startsWith('*')) starredOCGs.push({ id, name: name.trim() })
        }
      } catch { /* OCG iteration not supported */ }

      // Debug — open browser console to see all layer names
      console.log('[AI Import] All OCGs:', allOCGs.map(g => `${g.id}: "${g.name}"`))
      console.log('[AI Import] Starred OCGs:', starredOCGs)

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
      console.log('[AI Import] Starred OCGs:', starredOCGs.map(g => `${g.id}: "${g.name}"`))

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

      const fullCanvas = document.createElement('canvas')
      fullCanvas.width = Math.round(renderVp.width)
      fullCanvas.height = Math.round(renderVp.height)
      const fullCtx = fullCanvas.getContext('2d')!
      await page.render({ canvas: fullCanvas, canvasContext: fullCtx, viewport: renderVp }).promise

      // ── Render background (all starred layers hidden) ─────────────────────
      const bgCanvas = document.createElement('canvas')
      bgCanvas.width = fullCanvas.width
      bgCanvas.height = fullCanvas.height
      const bgCtx = bgCanvas.getContext('2d')!
      for (const { id } of starredOCGs) {
        try { ocgConfig.setVisibility(id, false) } catch { /* unsupported */ }
      }
      await page.render({
        canvas: bgCanvas, canvasContext: bgCtx, viewport: renderVp,
        optionalContentConfigPromise: Promise.resolve(ocgConfig),
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

      // ── For each starred OCG: classify as text or graphic ─────────────────
      // Use OCG-grouped text map (from marked content markers) to definitively
      // know which OCG contains text. No index-matching needed.
      const extractedFields: AIEditableField[] = []

      if (starredOCGs.length === 0) {
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
        // Use OCG text map to determine which starred OCGs have text
        // Also try matching via fallback positional blocks for OCGs whose ID
        // doesn't appear in the map (pdfjs version differences in OC tag format)
        const usedFallbackBlocks = new Set<number>()

        for (const { id: ocgId, name: ocgRawName } of starredOCGs) {
          const layerName = ocgRawName.replace(/^\s*\*/, '').trim()

          // Check if this OCG has text in the map (direct match by ID)
          let ocgItems = ocgTextMap.get(ocgId) ?? null

          // If not found, try matching by looking at all map keys for partial match
          if (!ocgItems) {
            for (const [key, items] of Array.from(ocgTextMap.entries())) {
              if (key.includes(ocgId) || ocgId.includes(key)) { ocgItems = items; break }
            }
          }

          if (ocgItems && ocgItems.length > 0) {
            // ── Text field ───────────────────────────────────────────────
            const cluster = clusterItems(ocgItems)
            const block = cluster.flat()
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
          } else {
            // OCG text map had no match — try fallback positional blocks
            // by finding an unused block (for backward compatibility)
            let fallbackBlock: RichItem[] | null = null
            for (let fi = 0; fi < fallbackBlocks.length; fi++) {
              if (!usedFallbackBlocks.has(fi)) {
                fallbackBlock = fallbackBlocks[fi]
                usedFallbackBlocks.add(fi)
                break
              }
            }

            if (fallbackBlock) {
              // ── Text field (fallback matching) ────────────────────────
              const block = fallbackBlock
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
            } else {
              // ── Graphic field: pixel-diff full vs (full without this layer) ──
              console.log(`[AI Import] Layer "${layerName}" has no text → graphic extraction`)

              let imageUrl: string | undefined
              let gx = 0.05, gy = 0.3, gw = 0.4, gh = 0.4

              try {
                // Render page without this specific layer
                const withoutCfg = await pdf.getOptionalContentConfig()
                try { withoutCfg.setVisibility(ocgId, false) } catch { /* unsupported */ }
                const withoutCanvas = document.createElement('canvas')
                withoutCanvas.width = fullCanvas.width
                withoutCanvas.height = fullCanvas.height
                const withoutCtx = withoutCanvas.getContext('2d')!
                await page.render({ canvas: withoutCanvas, canvasContext: withoutCtx, viewport: renderVp, optionalContentConfigPromise: Promise.resolve(withoutCfg) }).promise

                const fullData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height).data
                const withoutData = withoutCtx.getImageData(0, 0, withoutCanvas.width, withoutCanvas.height).data
                const bbox = pixelDiff(fullData, withoutData, fullCanvas.width, fullCanvas.height)
                console.log(`[AI Import] Graphic "${layerName}" pixel diff bbox:`, bbox)

                if (bbox) {
                  const pad2 = 8
                  const cropX = Math.max(0, bbox.minX - pad2)
                  const cropY = Math.max(0, bbox.minY - pad2)
                  const cropW = Math.min(fullCanvas.width - cropX, bbox.maxX - bbox.minX + pad2 * 2)
                  const cropH = Math.min(fullCanvas.height - cropY, bbox.maxY - bbox.minY + pad2 * 2)

                  // Crop the graphic from the full render
                  const cropCanvas = document.createElement('canvas')
                  cropCanvas.width = cropW
                  cropCanvas.height = cropH
                  cropCanvas.getContext('2d')!.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
                  imageUrl = cropCanvas.toDataURL('image/png')

                  gx = cropX / fullCanvas.width
                  gy = cropY / fullCanvas.height
                  gw = cropW / fullCanvas.width
                  gh = cropH / fullCanvas.height

                  // Erase the graphic region from bgCanvas
                  paintOver(cropX, cropY, cropW, cropH)
                }
              } catch (e) {
                console.warn('[AI Import] Graphic extraction failed:', e)
              }

              extractedFields.push({
                type: 'graphic', layerName, value: '', originalText: '',
                imageUrl, scale: 1,
                x: gx, y: gy, width: gw, height: gh,
                fontSize: 0, color: '#ffffff', fontWeight: 'normal', fontStyle: 'normal', textAlign: 'left',
              })
            }
          }
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
                      <p className="text-sm text-gray-400">
                        <span className="text-cyan-400 font-semibold">{fields.length} editierbare Felder</span> erkannt — Texte jetzt anpassen oder später im Editor ändern:
                      </p>
                      {fields.map((field, i) => (
                        <div key={i}>
                          <Label className="text-gray-300 flex items-center gap-2 mb-2">
                            <span className="text-cyan-400 text-xs bg-cyan-500/20 px-2 py-0.5 rounded font-mono">*{field.layerName}</span>
                            <span className="text-xs text-gray-500">Layer</span>
                          </Label>
                          <textarea
                            value={field.value}
                            onChange={(e) => updateFieldValue(i, e.target.value)}
                            className="w-full px-3 py-2 bg-white/5 border border-white/20 text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                            rows={field.value.includes('\n') ? 3 : 2}
                          />
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
