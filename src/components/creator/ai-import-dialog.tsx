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

      // Collect OCG layers
      const ocgConfig = await pdf.getOptionalContentConfig()
      const starredOCGs: { id: string; name: string }[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [id, group] of Array.from(ocgConfig as unknown as Map<string, { name: string }>)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = group as any
        if (g?.name?.startsWith('*')) {
          starredOCGs.push({ id: id as string, name: g.name })
        }
      }

      // Extract text per OCG using marked content
      const textContent = await page.getTextContent({ includeMarkedContent: true })
      const textByOCGId: Record<string, { texts: string[]; items: { transform: number[]; str: string; hasEOL: boolean }[] }> = {}
      let currentId: string | null = null

      for (const item of textContent.items) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mc = item as any
        if (mc.type === 'beginMarkedContentProps' && mc.id) {
          currentId = mc.id
        } else if (mc.type === 'endMarkedContent') {
          currentId = null
        } else if (typeof mc.str === 'string' && currentId) {
          if (!textByOCGId[currentId]) textByOCGId[currentId] = { texts: [], items: [] }
          if (mc.str.trim()) textByOCGId[currentId].texts.push(mc.str)
          textByOCGId[currentId].items.push(mc)
        }
      }

      // Hide starred OCGs for the background render
      for (const { id } of starredOCGs) {
        try { ocgConfig.setVisibility(id, false) } catch { /* unsupported */ }
      }

      // Render background at 2× for crispness
      const renderScale = Math.max(2, 1080 / artboard.width)
      const renderVp = page.getViewport({ scale: renderScale })
      const bgCanvas = document.createElement('canvas')
      bgCanvas.width = Math.round(renderVp.width)
      bgCanvas.height = Math.round(renderVp.height)
      const bgCtx = bgCanvas.getContext('2d')!
      await page.render({
        canvas: bgCanvas,
        canvasContext: bgCtx,
        viewport: renderVp,
        optionalContentConfigPromise: Promise.resolve(ocgConfig),
      }).promise
      const bgUrl = bgCanvas.toDataURL('image/png')
      setBackgroundUrl(bgUrl)

      // Build AIEditableField list
      const extractedFields: AIEditableField[] = []

      for (const { id, name } of starredOCGs) {
        const data = textByOCGId[id]
        const extractedText = data?.texts.join(' ').trim() ?? ''

        let x = 0.05
        let y = 0.05 + extractedFields.length * 0.18
        let width = 0.6
        let fontSize = 36
        let fontWeight: 'normal' | 'bold' = 'bold'

        if (data?.items?.length) {
          // Use the first text item's position
          const topItem = data.items.reduce((best, cur) => {
            // highest in page = largest PDF y = smallest viewport y after convert
            const [, vy] = vp1.convertToViewportPoint(cur.transform[4], cur.transform[5])
            const [, bvy] = vp1.convertToViewportPoint(best.transform[4], best.transform[5])
            return vy < bvy ? cur : best
          })

          const [vx, vy] = vp1.convertToViewportPoint(topItem.transform[4], topItem.transform[5])
          const fs = Math.abs(topItem.transform[3]) || Math.abs(topItem.transform[0]) || 36

          // Bounding box: scan all items
          let maxVx = vx
          for (const it of data.items) {
            const [ivx] = vp1.convertToViewportPoint(it.transform[4], it.transform[5])
            const iw = (it as { width?: number }).width ?? 0
            maxVx = Math.max(maxVx, ivx + iw)
          }

          x = Math.max(0, vx / vp1.width)
          y = Math.max(0, (vy - fs) / vp1.height)
          width = Math.min(0.95, Math.max(0.3, (maxVx - vx) / vp1.width))
          fontSize = fs
          fontWeight = fs >= 20 ? 'bold' : 'normal'
        }

        extractedFields.push({
          layerName: name.slice(1), // strip the *
          value: extractedText,
          originalText: extractedText,
          x,
          y,
          width,
          fontSize,
          color: '#ffffff',
          fontWeight,
          fontStyle: 'normal',
          textAlign: 'left',
        })
      }

      // Fallback: if OCG text mapping found nothing, do positional extraction
      if (extractedFields.length === 0 && starredOCGs.length > 0) {
        const allTexts = textContent.items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((it: any) => typeof it.str === 'string' && it.str.trim())
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => {
            const [, ay] = vp1.convertToViewportPoint(a.transform[4], a.transform[5])
            const [, by] = vp1.convertToViewportPoint(b.transform[4], b.transform[5])
            return ay - by
          })

        starredOCGs.forEach(({ name }, i) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const item = allTexts[i] as any
          const text = item?.str?.trim() ?? ''
          const [vx, vy] = item
            ? vp1.convertToViewportPoint(item.transform[4], item.transform[5])
            : [60, 60 + i * 120]
          const fs = item ? Math.abs(item.transform[3]) || 36 : 36

          extractedFields.push({
            layerName: name.slice(1),
            value: text,
            originalText: text,
            x: Math.max(0, vx / vp1.width),
            y: Math.max(0, (vy - fs) / vp1.height),
            width: 0.6,
            fontSize: fs,
            color: '#ffffff',
            fontWeight: 'bold',
            fontStyle: 'normal',
            textAlign: 'left',
          })
        })
      }

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
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-sm text-yellow-300">
                      Keine Layer mit <code className="bg-white/10 px-1 rounded">*</code> Präfix gefunden.
                      Der Artboard wird ohne editierbare Felder importiert.
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
