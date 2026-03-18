'use client'

import React from 'react'
import type { PostingConfig, Format, AIImportData } from '@/types/posting'
import { FORMAT_DIMENSIONS } from '@/types/posting'
import { PostingGraphic } from './posting-graphic'

interface PreviewCanvasProps {
  config: PostingConfig
  updateConfig: (updates: Partial<PostingConfig>) => void
  selectedFieldIndex: number | null
  onSelectField: (i: number) => void
  variants?: AIImportData[]
  activeVariantIndex?: number
  onSwitchVariant?: (i: number) => void
}

const FORMAT_LABELS: Record<Format, string> = {
  '1:1': '1080 × 1080 px',
  '4:3': '1200 × 900 px',
  '3:4': '900 × 1200 px',
  '4:5': '1080 × 1350 px',
  '16:9': '1920 × 1080 px',
  '9:16': '1080 × 1920 px',
}

const FORMATS: Format[] = ['1:1', '4:3', '3:4', '4:5', '16:9', '9:16']

const FORMAT_ASPECT_RATIOS: [Format, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
]

function detectFormat(width: number, height: number): Format {
  const ratio = width / height
  return FORMAT_ASPECT_RATIOS.reduce((best, [fmt, r]) =>
    Math.abs(r - ratio) < Math.abs(FORMAT_ASPECT_RATIOS.find(([f]) => f === best)![1] - ratio) ? fmt : best
  , FORMAT_ASPECT_RATIOS[0][0])
}

export function PreviewCanvas({ config, updateConfig, selectedFieldIndex, onSelectField, variants, activeVariantIndex, onSwitchVariant }: PreviewCanvasProps) {

  // ── Base fit scale (same as before) ─────────────────────────────────────────
  const getMainPreviewScale = () => {
    const dims = config.aiImport
      ? { width: config.aiImport.artboardWidth, height: config.aiImport.artboardHeight }
      : FORMAT_DIMENSIONS[config.format]
    const maxWidth = 750
    const maxHeight = 570
    const scaleX = maxWidth / dims.width
    const scaleY = maxHeight / dims.height
    const scale = Math.min(scaleX, scaleY, 1)
    return { scale, width: Math.round(dims.width * scale), height: Math.round(dims.height * scale) }
  }

  const getMiniScale = (format: Format) => {
    const { width, height } = FORMAT_DIMENSIONS[format]
    const maxW = 100; const maxH = 100
    const scale = Math.min(maxW / width, maxH / height)
    return { scale, width: Math.round(width * scale), height: Math.round(height * scale) }
  }

  const mainPreview = getMainPreviewScale()

  // ── Zoom & pan state ─────────────────────────────────────────────────────────
  const [zoom, setZoom] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [spaceDown, setSpaceDown] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const dragRef = React.useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const viewportRef = React.useRef<HTMLDivElement>(null)

  // Reset zoom/pan whenever the artboard or format changes
  React.useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.format, config.aiImport?.artboardWidth, config.aiImport?.artboardHeight])

  // Space bar — activate pan tool (skip when typing in inputs)
  React.useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      e.preventDefault()
      setSpaceDown(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setSpaceDown(false)
      setDragging(false)
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // Drag — use window-level events so fast mouse moves don't drop the drag
  React.useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      setPan({
        x: dragRef.current.panX + e.clientX - dragRef.current.x,
        y: dragRef.current.panY + e.clientY - dragRef.current.y,
      })
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging])

  // Wheel zoom — non-passive so we can preventDefault (stops page scroll)
  const handleWheel = React.useCallback((e: WheelEvent) => {
    e.preventDefault()
    const vp = viewportRef.current
    if (!vp) return
    const rect = vp.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const vw = rect.width
    const vh = rect.height
    // Smooth zoom factor scaled by scroll magnitude
    const factor = Math.pow(0.999, e.deltaY)
    setZoom(prevZoom => {
      const newZoom = Math.min(Math.max(prevZoom * factor, 0.1), 10)
      // Zoom toward cursor: keep the canvas point under the cursor fixed
      setPan(prev => ({
        x: mx - vw / 2 - (mx - vw / 2 - prev.x) * newZoom / prevZoom,
        y: my - vh / 2 - (my - vh / 2 - prev.y) * newZoom / prevZoom,
      }))
      return newZoom
    })
  }, [])

  React.useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    vp.addEventListener('wheel', handleWheel, { passive: false })
    return () => vp.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (!spaceDown) return
    e.preventDefault()
    setDragging(true)
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [spaceDown, pan])

  // ── AI format switcher ───────────────────────────────────────────────────────
  const variantFormatMap = React.useMemo<Map<Format, number>>(() => {
    const map = new Map<Format, number>()
    if (!config.aiImport || !variants) return map
    variants.forEach((v, i) => {
      const fmt = detectFormat(v.artboardWidth, v.artboardHeight)
      if (!map.has(fmt)) map.set(fmt, i)
    })
    return map
  }, [config.aiImport, variants])

  const visibleFormats = config.aiImport ? FORMATS.filter(f => variantFormatMap.has(f)) : FORMATS

  const handleFormatClick = (format: Format) => {
    if (config.aiImport && onSwitchVariant) {
      const idx = variantFormatMap.get(format)
      if (idx !== undefined) onSwitchVariant(idx)
    } else {
      updateConfig({ format })
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const nativeW = config.aiImport ? config.aiImport.artboardWidth : FORMAT_DIMENSIONS[config.format].width
  const nativeH = config.aiImport ? config.aiImport.artboardHeight : FORMAT_DIMENSIONS[config.format].height
  const totalScale = mainPreview.scale * zoom
  const viewportHeight = mainPreview.height + 64
  const isZoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-40">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">Live Preview</h2>
            {config.aiImport ? (
              <>
                <p className="text-sm text-gray-400">{config.aiImport.artboardName} · {config.aiImport.artboardWidth} × {config.aiImport.artboardHeight} px</p>
                <p className="text-xs text-cyan-400 mt-1">AI Import — Felder links bearbeiten</p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400">{FORMAT_LABELS[config.format]}</p>
                <p className="text-xs text-cyan-400 mt-1">✓ Was du siehst = Finales Posting</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom reset badge — shown when zoomed */}
            {isZoomed && (
              <button
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
                className="text-xs text-gray-300 bg-white/10 hover:bg-white/20 px-2 py-1 rounded transition-all"
                title="Reset zoom"
              >
                {Math.round(totalScale * 100)}%
              </button>
            )}
            {/* Format switcher */}
            {visibleFormats.map((format) => (
              <button
                key={format}
                onClick={() => handleFormatClick(format)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  config.format === format
                    ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/50'
                    : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                }`}
              >
                {format}
              </button>
            ))}
          </div>
        </div>

        {/* ── Zoom/Pan Viewport ─────────────────────────────────────────────── */}
        <div
          ref={viewportRef}
          className="relative overflow-hidden rounded-xl mb-2"
          style={{
            height: viewportHeight,
            cursor: dragging ? 'grabbing' : spaceDown ? 'grab' : 'default',
            userSelect: 'none',
          }}
          onMouseDown={handleMouseDown}
          // Prevent field-click events from firing while in pan mode
          onClickCapture={(e) => { if (spaceDown) e.stopPropagation() }}
        >
          {/* Glow */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-3xl blur-xl"
              style={{ width: mainPreview.width + 80, height: mainPreview.height + 80 }} />
          </div>

          {/* Canvas — centered in viewport, then transformed by zoom+pan */}
          <div
            className="absolute rounded-2xl border-2 border-cyan-500/50 overflow-hidden shadow-2xl"
            style={{
              left: '50%',
              top: '50%',
              width: nativeW,
              height: nativeH,
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${totalScale})`,
              transformOrigin: 'center center',
              // Disable pointer events on canvas content while in pan mode so
              // mouse events reach the viewport div for dragging
              pointerEvents: spaceDown ? 'none' : 'auto',
            }}
          >
            <PostingGraphic config={config} selectedFieldIndex={selectedFieldIndex} onSelectField={onSelectField} />
          </div>

          {/* Zoom level indicator (bottom-right, always visible) */}
          <div className="absolute bottom-2 right-2 flex items-center gap-1 pointer-events-none">
            <span className="text-[10px] text-gray-500 bg-black/40 px-1.5 py-0.5 rounded select-none">
              {Math.round(totalScale * 100)}%
            </span>
          </div>

          {/* Space hint */}
          {spaceDown && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 bg-black/50 px-2 py-1 rounded pointer-events-none select-none">
              {dragging ? 'Panning…' : 'Click and drag to pan'}
            </div>
          )}
        </div>

        {/* Hint bar */}
        <p className="text-[10px] text-gray-600 text-right mb-6 select-none">
          Scroll to zoom · Hold <kbd className="bg-white/10 px-1 rounded">Space</kbd> + drag to pan
        </p>

        {/* Mini Previews — normal mode */}
        {!config.aiImport && (
          <div className="mt-2 flex gap-4 justify-center flex-wrap">
            {visibleFormats.map((format) => {
              const mini = getMiniScale(format)
              const { width: fw, height: fh } = FORMAT_DIMENSIONS[format]
              return (
                <div key={format} className="flex flex-col items-center gap-1">
                  <p className="text-xs text-gray-400">{format}</p>
                  <div
                    className="relative rounded border border-white/10 overflow-hidden cursor-pointer hover:border-cyan-500/50 transition-all"
                    style={{ width: mini.width, height: mini.height }}
                    onClick={() => handleFormatClick(format)}
                  >
                    <div style={{ transform: `scale(${mini.scale})`, transformOrigin: 'top left', width: fw, height: fh }}>
                      <PostingGraphic config={{ ...config, format }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* AI Import variant switcher */}
        {config.aiImport && variants && variants.length > 1 && (
          <div className="mt-2 flex gap-4 justify-center flex-wrap">
            {variants.map((v, i) => {
              const thumbW = 80
              const thumbH = Math.round(thumbW * v.artboardHeight / Math.max(v.artboardWidth, 1))
              const isActive = i === activeVariantIndex
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <p className={`text-xs truncate max-w-[90px] text-center ${isActive ? 'text-cyan-400' : 'text-gray-400'}`}>{v.artboardName}</p>
                  <div
                    className={`relative rounded border overflow-hidden cursor-pointer transition-all ${
                      isActive ? 'border-cyan-400 shadow-lg shadow-cyan-500/30' : 'border-white/10 hover:border-cyan-500/50'
                    }`}
                    style={{ width: thumbW, height: thumbH }}
                    onClick={() => onSwitchVariant?.(i)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.thumbnailUrl ?? v.backgroundImageUrl} alt={v.artboardName} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-[10px] text-gray-500">{v.artboardWidth}×{v.artboardHeight}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Export containers (unchanged) */}
      {FORMATS.map((format) => {
        const { width, height } = FORMAT_DIMENSIONS[format]
        let exportConfig = { ...config, format }
        if (config.aiImport && config.aiImportVariants) {
          const variantIdx = variantFormatMap.get(format)
          if (variantIdx === undefined) return null
          const variantData = variantIdx === config.aiImportVariants.activeVariantIndex
            ? config.aiImport
            : config.aiImportVariants.variants[variantIdx]
          exportConfig = { ...config, format, aiImport: variantData }
        }
        return (
          <div
            key={format}
            id={`export-${format}`}
            aria-hidden="true"
            style={{
              position: 'fixed', top: 0, left: 0, width, height,
              overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', zIndex: -9999,
            }}
          >
            <PostingGraphic config={exportConfig} forExport={true} />
          </div>
        )
      })}
    </div>
  )
}
