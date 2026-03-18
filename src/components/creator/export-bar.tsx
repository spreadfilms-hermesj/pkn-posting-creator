'use client'

import React, { useState, useMemo } from 'react'
import type { PostingConfig, Format } from '@/types/posting'
import { FORMAT_DIMENSIONS } from '@/types/posting'

const FORMAT_RATIOS: [Format, number][] = [
  ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['4:5', 4 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16],
]
function detectExportFormat(w: number, h: number): Format {
  const ratio = w / h
  return FORMAT_RATIOS.reduce((best, [fmt, r]) =>
    Math.abs(r - ratio) < Math.abs(FORMAT_RATIOS.find(([f]) => f === best)![1] - ratio) ? fmt : best
  , FORMAT_RATIOS[0][0])
}
import { Download, FileImage, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'

interface ExportBarProps {
  config: PostingConfig
}

async function captureFormat(format: Format): Promise<string> {
  const { width, height } = FORMAT_DIMENSIONS[format]
  const element = document.getElementById(`export-${format}`)
  if (!element) throw new Error(`Export element not found: export-${format}`)

  // Briefly make the element visible so getBoundingClientRect() returns real dimensions.
  // We need to measure gradient elements' widths BEFORE html2canvas clones the DOM,
  // because visibility:hidden causes getBoundingClientRect to return 0.
  element.style.visibility = 'visible'
  await new Promise((r) => requestAnimationFrame(r)) // one paint frame so layout is computed

  // Build a map: element index → pixel width, for all elements with a gradient background
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
    element.style.visibility = 'hidden' // always hide again, even if measuring fails
  }

  // Dynamically import html2canvas
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

      // Apply pre-measured pixel widths to gradient elements in the clone
      // so html2canvas computes gradient color stops against the correct size.
      if (gradientWidths.size > 0) {
        const clonedEls = Array.from(clonedEl.querySelectorAll<HTMLElement>('*'))
        gradientWidths.forEach((w, i) => {
          const el = clonedEls[i]
          if (el) {
            el.style.width = `${w}px`
            el.style.flexShrink = '0'
            el.style.minWidth = `${w}px`
          }
        })
      }
    },
  })

  // Canvas should now be exactly width × height
  return canvas.toDataURL('image/png', 1.0)
}

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

export function ExportBar({ config }: ExportBarProps) {
  const [exporting, setExporting] = useState<string | null>(null)

  // In AI import mode, only show formats that have a matching imported artboard
  const activeFormats = useMemo<Format[]>(() => {
    const allFormats: Format[] = ['1:1', '4:3', '3:4', '4:5', '16:9', '9:16']
    if (!config.aiImportVariants) return allFormats.filter(f => f !== '4:5') // normal mode: all except 4:5
    const seen = new Set<Format>()
    const result: Format[] = []
    for (const v of config.aiImportVariants.variants) {
      const fmt = detectExportFormat(v.artboardWidth, v.artboardHeight)
      if (!seen.has(fmt)) { seen.add(fmt); result.push(fmt) }
    }
    return result
  }, [config.aiImportVariants])

  const exportSingle = async (format: Format) => {
    if (exporting) return
    setExporting(format)
    try {
      // Small pause so React has rendered the export containers
      await new Promise((r) => setTimeout(r, 200))
      const dataUrl = await captureFormat(format)
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

    const formats: Format[] = activeFormats
    const exports: { dataUrl: string; filename: string }[] = []

    try {
      for (const format of formats) {
        try {
          await new Promise((r) => setTimeout(r, 200))
          const dataUrl = await captureFormat(format)
          exports.push({ dataUrl, filename: getFilename(config, format) })
        } catch (err) {
          console.error(`Export ${format} failed:`, err)
          toast.error(`${format} fehlgeschlagen`)
        }
      }

      if (exports.length === 0) {
        toast.error('Kein Export erfolgreich')
        return
      }

      // Build ZIP
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const folder = zip.folder('PKN_Postings') ?? zip

      for (const { dataUrl, filename } of exports) {
        const base64 = dataUrl.split(',')[1]
        folder.file(filename, base64, { base64: true })
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const zipUrl = URL.createObjectURL(zipBlob)
      const date = new Date().toISOString().slice(0, 10)
      downloadDataUrl(zipUrl, `PKN_Postings_${date}.zip`)
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
          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 text-sm transition-all"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>

          <div className="flex items-center gap-2">
            {/* Individual format buttons */}
            {activeFormats.map((format) => (
              <button
                key={format}
                onClick={() => exportSingle(format)}
                disabled={isExporting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting === format ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileImage className="w-3.5 h-3.5" />
                )}
                {format}
              </button>
            ))}

            <div className="w-px h-8 bg-white/20 mx-1" />

            {/* Export All ZIP */}
            <button
              onClick={exportAll}
              disabled={isExporting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed min-w-[160px] justify-center"
            >
              {exporting === 'all' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exportiere...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export All (ZIP)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
