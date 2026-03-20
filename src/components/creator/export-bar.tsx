'use client'

import React, { useState, useMemo } from 'react'
import type { PostingConfig, Format, AIImportData } from '@/types/posting'
import { FORMAT_DIMENSIONS } from '@/types/posting'
import { Download, FileImage, Loader2, LogOut, BookmarkPlus } from 'lucide-react'
import { toast } from 'sonner'

// ── Format helpers ─────────────────────────────────────────────────────────────

const FORMAT_RATIOS: [Format, number][] = [
  ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['4:5', 4 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16],
]

function detectExportFormat(w: number, h: number): Format {
  const ratio = w / h
  return FORMAT_RATIOS.reduce((best, [fmt, r]) =>
    Math.abs(r - ratio) < Math.abs(FORMAT_RATIOS.find(([f]) => f === best)![1] - ratio) ? fmt : best
  , FORMAT_RATIOS[0][0])
}

function getFontFamily(brandFont: string): string {
  if (brandFont === 'Segoe UI') return '"Segoe UI", system-ui, sans-serif'
  if (brandFont === 'Inter') return '"Inter", system-ui, sans-serif'
  return '"Vazirmatn", system-ui, sans-serif'
}

// ── Canvas-based AI import capture ─────────────────────────────────────────────
// Bypasses html2canvas entirely — directly composes backgroundImageUrl + graphic
// imageUrls + text onto a native canvas. This avoids the scroll-offset bug in
// html2canvas that causes position:fixed elements to shift by window.scrollY.

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function captureAIVariant(variant: AIImportData, fontFamily: string): Promise<string> {
  const { artboardWidth: W, artboardHeight: H, backgroundImageUrl, editableFields } = variant

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Assign z-index to each field (same logic as posting-graphic.tsx)
  const fieldsWithZ = editableFields.map((field, i) => ({
    field,
    z: field.isImageSlot ? 1 : (editableFields.length - i + 3),
  }))

  // Pass 1: image-slot layers (z=1, sit below the background image)
  // NO clipping — the background layer (pass 2) is opaque outside the slot hole
  // and acts as the natural mask, matching the CSS overflow:visible behaviour.
  for (const { field } of fieldsWithZ.filter(f => f.z === 1)) {
    if (!field.imageUrl) continue
    const left = field.x * W
    const top = field.y * H
    const fw = field.width * W
    const fh = field.height * H
    ctx.save()
    ctx.globalAlpha = field.opacity ?? 1
    const img = await loadImage(field.imageUrl)
    // Contain-scale: fit whole image within slot (CSS objectFit:contain)
    const ia = img.width / img.height
    const sa = fw / fh
    let dw, dh
    if (ia > sa) { dw = fw; dh = fw / ia }   // wider than slot → scale by width
    else         { dh = fh; dw = fh * ia }   // taller than slot → scale by height
    // Apply field.scale / scaleY from content center anchor (matches CSS transformOrigin)
    const sx = field.scale ?? 1
    const sy = field.scaleY ?? sx
    const sdw = dw * sx
    const sdh = dh * sy
    const cx = (field.contentCenterX ?? 0.5) * W
    const cy = (field.contentCenterY ?? 0.5) * H
    ctx.drawImage(img, cx - sdw / 2, cy - sdh / 2, sdw, sdh)
    ctx.restore()
  }

  // Pass 2: background image (z=2)
  const bg = await loadImage(backgroundImageUrl)
  ctx.drawImage(bg, 0, 0, W, H)

  // Pass 3: non-slot layers sorted bottom-to-top (ascending z, z > 2)
  const topLayers = fieldsWithZ.filter(f => f.z > 2).sort((a, b) => a.z - b.z)

  for (const { field } of topLayers) {
    const left = field.x * W
    const top = field.y * H
    const fw = field.width * W

    ctx.save()
    ctx.globalAlpha = field.opacity ?? 1

    if (field.type === 'graphic') {
      if (!field.imageUrl) { ctx.restore(); continue }
      const img = await loadImage(field.imageUrl)
      const sx = field.scale ?? 1
      const sy = field.scaleY ?? sx
      if (sx !== 1 || sy !== 1) {
        const cx = (field.contentCenterX ?? 0.5) * W
        const cy = (field.contentCenterY ?? 0.5) * H
        ctx.translate(cx, cy)
        ctx.scale(sx, sy)
        ctx.translate(-cx, -cy)
      }
      // Full-artboard transparent PNG — always drawn at canvas dimensions
      ctx.drawImage(img, 0, 0, W, H)
    } else {
      // Text field — match CSS lineHeight: 1.25 rendering exactly:
      // half-leading = (lineHeight - fontSize) / 2 = 0.125 * fontSize appears
      // above the em square in CSS, so we offset canvas drawY by the same amount.
      const fontStyle = field.fontStyle === 'italic' ? 'italic ' : ''
      ctx.font = `${fontStyle}${field.fontWeight} ${field.fontSize}px ${fontFamily}`
      ctx.fillStyle = field.color
      ctx.textBaseline = 'top'
      ctx.textAlign = field.textAlign as CanvasTextAlign

      const textX = field.textAlign === 'center' ? left + fw / 2
        : field.textAlign === 'right' ? left + fw
        : left

      const lineHeight = field.fontSize * 1.25
      const halfLeading = field.fontSize * 0.125

      // Manual word-wrap to match CSS whiteSpace:pre-wrap + wordBreak:break-word.
      // DO NOT pass maxWidth to fillText — that scales/compresses text instead of wrapping.
      const wrapLine = (raw: string): string[] => {
        const words = raw.split(' ')
        const out: string[] = []
        let cur = ''
        for (const word of words) {
          const test = cur ? `${cur} ${word}` : word
          if (ctx.measureText(test).width > fw && cur) {
            out.push(cur)
            cur = word
          } else {
            cur = test
          }
        }
        if (cur) out.push(cur)
        return out.length ? out : ['']
      }

      const allLines = field.value.split('\n').flatMap(wrapLine)
      allLines.forEach((line, i) => {
        ctx.fillText(line, textX, top + halfLeading + i * lineHeight)
      })
    }

    ctx.restore()
  }

  return canvas.toDataURL('image/png', 1.0)
}

// ── html2canvas capture (normal / non-AI mode) ─────────────────────────────────

async function captureFormat(format: Format): Promise<string> {
  const { width, height } = FORMAT_DIMENSIONS[format]
  const element = document.getElementById(`export-${format}`)
  if (!element) throw new Error(`Export element not found: export-${format}`)

  // Briefly make the element visible so getBoundingClientRect() returns real dimensions.
  element.style.visibility = 'visible'
  await new Promise((r) => requestAnimationFrame(r))

  const gradientWidths = new Map<number, number>()
  try {
    const allEls = Array.from(element.querySelectorAll<HTMLElement>('*'))
    allEls.forEach((el, i) => {
      const cs = window.getComputedStyle(el)
      const bg = cs.backgroundImage
      if (bg && bg.includes('gradient')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0) gradientWidths.set(i, r.width)
      }
    })
  } finally {
    element.style.visibility = 'hidden'
  }

  const { default: html2canvas } = await import('html2canvas')

  const canvas = await html2canvas(element, {
    scale: 1,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    x: 0,
    y: 0,
    scrollX: 0,
    scrollY: 0,
    backgroundColor: '#0a0118',
    logging: false,
    useCORS: true,
    allowTaint: true,
    imageTimeout: 15000,
    onclone: (_clonedDoc, clonedEl) => {
      clonedEl.style.visibility = 'visible'
      clonedEl.style.width = `${width}px`
      clonedEl.style.height = `${height}px`
      clonedEl.style.overflow = 'hidden'
      clonedEl.style.position = 'fixed'
      clonedEl.style.top = '0'
      clonedEl.style.left = '0'

      if (gradientWidths.size > 0) {
        const clonedEls = Array.from(clonedEl.querySelectorAll<HTMLElement>('*'))
        gradientWidths.forEach((w, i) => {
          const el = clonedEls[i]
          if (el) { el.style.width = `${w}px`; el.style.flexShrink = '0'; el.style.minWidth = `${w}px` }
        })
      }
    },
  })

  return canvas.toDataURL('image/png', 1.0)
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function getFilename(config: PostingConfig, format: Format): string {
  const date = new Date().toISOString().slice(0, 10)
  const typeStr = config.postType.replace(/-/g, '_')
  const formatStr = format.replace(':', 'x')
  return `PKN_${typeStr}_${formatStr}_${date}.png`
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ExportBarProps {
  config: PostingConfig
  onSaveProject?: () => void
}

export function ExportBar({ config, onSaveProject }: ExportBarProps) {
  const [exporting, setExporting] = useState<string | null>(null)

  // In AI import mode, only show formats matching imported artboards
  const activeFormats = useMemo<Format[]>(() => {
    const allFormats: Format[] = ['1:1', '4:3', '3:4', '4:5', '16:9', '9:16']
    if (!config.aiImportVariants) return allFormats.filter(f => f !== '4:5')
    const seen = new Set<Format>()
    const result: Format[] = []
    for (const v of config.aiImportVariants.variants) {
      const fmt = detectExportFormat(v.artboardWidth, v.artboardHeight)
      if (!seen.has(fmt)) { seen.add(fmt); result.push(fmt) }
    }
    return result
  }, [config.aiImportVariants])

  // Resolve the correct AIImportData for a given format (active variant has user edits)
  const getAIVariant = (format: Format): AIImportData | null => {
    if (!config.aiImport) return null
    if (!config.aiImportVariants) return config.aiImport
    const { variants, activeVariantIndex } = config.aiImportVariants
    const idx = variants.findIndex(v => detectExportFormat(v.artboardWidth, v.artboardHeight) === format)
    if (idx === -1) return null
    return idx === activeVariantIndex ? config.aiImport : variants[idx]
  }

  const doCapture = async (format: Format): Promise<string> => {
    const variant = getAIVariant(format)
    if (variant) {
      return captureAIVariant(variant, getFontFamily(config.brandSettings.fontFamily))
    }
    await new Promise((r) => setTimeout(r, 200))
    return captureFormat(format)
  }

  const exportSingle = async (format: Format) => {
    if (exporting) return
    setExporting(format)
    try {
      const dataUrl = await doCapture(format)
      downloadDataUrl(dataUrl, getFilename(config, format))
      toast.success(`✓ ${format} exportiert`)
    } catch (err) {
      console.error('Export error:', err)
      toast.error(`Export fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`)
    } finally {
      setExporting(null)
    }
  }

  const exportAll = async () => {
    if (exporting) return
    setExporting('all')
    const exports: { dataUrl: string; filename: string }[] = []

    try {
      for (const format of activeFormats) {
        try {
          const dataUrl = await doCapture(format)
          exports.push({ dataUrl, filename: getFilename(config, format) })
        } catch (err) {
          console.error(`Export ${format} failed:`, err)
          toast.error(`${format} fehlgeschlagen`)
        }
      }

      if (exports.length === 0) { toast.error('Kein Export erfolgreich'); return }

      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const folder = zip.folder('PKN_Postings') ?? zip
      for (const { dataUrl, filename } of exports) {
        folder.file(filename, dataUrl.split(',')[1], { base64: true })
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const zipUrl = URL.createObjectURL(zipBlob)
      downloadDataUrl(zipUrl, `PKN_Postings_${new Date().toISOString().slice(0, 10)}.zip`)
      URL.revokeObjectURL(zipUrl)
      toast.success(`✓ ${exports.length} Formate als ZIP exportiert`)
    } catch (err) {
      console.error('ZIP export failed:', err)
      toast.error('ZIP Export fehlgeschlagen')
    } finally {
      setExporting(null)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/'
  }

  const isExporting = exporting !== null

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/60 backdrop-blur-xl z-50">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-sm transition-all"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>

          <div className="flex items-center gap-2">
            {activeFormats.map((format) => (
              <button
                key={format}
                onClick={() => exportSingle(format)}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting === format ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileImage className="w-3.5 h-3.5" />}
                {format}
              </button>
            ))}

            <div className="w-px h-8 bg-white/20 mx-1" />

            {onSaveProject && (
              <button
                onClick={onSaveProject}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 font-semibold text-sm border border-violet-500/30 transition-all"
              >
                <BookmarkPlus className="w-4 h-4" />
                Projekt speichern
              </button>
            )}

            <button
              onClick={exportAll}
              disabled={isExporting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed min-w-[160px] justify-center"
            >
              {exporting === 'all' ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Exportiere...</>
              ) : (
                <><Download className="w-4 h-4" />Export All (ZIP)</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
