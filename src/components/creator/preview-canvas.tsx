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
  '16:9': '1200 × 675 px',
  '9:16': '1080 × 1920 px',
}

const FORMATS: Format[] = ['1:1', '4:3', '3:4', '16:9', '9:16']

export function PreviewCanvas({ config, updateConfig, selectedFieldIndex, onSelectField, variants, activeVariantIndex, onSwitchVariant }: PreviewCanvasProps) {
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
    const maxW = 100
    const maxH = 100
    const scale = Math.min(maxW / width, maxH / height)
    return { scale, width: Math.round(width * scale), height: Math.round(height * scale) }
  }

  const mainPreview = getMainPreviewScale()

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-40">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
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
          {!config.aiImport && (
            <div className="flex gap-2">
              {FORMATS.map((format) => (
                <button
                  key={format}
                  onClick={() => updateConfig({ format })}
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
          )}
        </div>

        {/* Main Preview */}
        <div className="relative flex justify-center items-start" style={{ minHeight: `${mainPreview.height + 32}px` }}>
          <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-3xl blur-xl" />
          <div
            className="relative rounded-2xl border-2 border-cyan-500/50 overflow-hidden shadow-2xl"
            style={{ width: mainPreview.width, height: mainPreview.height }}
          >
            <div
              style={{
                transform: `scale(${mainPreview.scale})`,
                transformOrigin: 'top left',
                width: config.aiImport ? config.aiImport.artboardWidth : FORMAT_DIMENSIONS[config.format].width,
                height: config.aiImport ? config.aiImport.artboardHeight : FORMAT_DIMENSIONS[config.format].height,
              }}
            >
              <PostingGraphic config={config} selectedFieldIndex={selectedFieldIndex} onSelectField={onSelectField} />
            </div>
          </div>
        </div>

        {/* Mini Previews — format thumbnails in normal mode */}
        {!config.aiImport && (
          <div className="mt-8 flex gap-4 justify-center flex-wrap">
            {FORMATS.map((format) => {
              const mini = getMiniScale(format)
              const { width: fw, height: fh } = FORMAT_DIMENSIONS[format]
              return (
                <div key={format} className="flex flex-col items-center gap-1">
                  <p className="text-xs text-gray-400">{format}</p>
                  <div
                    className="relative rounded border border-white/10 overflow-hidden cursor-pointer hover:border-cyan-500/50 transition-all"
                    style={{ width: mini.width, height: mini.height }}
                    onClick={() => updateConfig({ format })}
                  >
                    <div
                      style={{
                        transform: `scale(${mini.scale})`,
                        transformOrigin: 'top left',
                        width: fw,
                        height: fh,
                      }}
                    >
                      <PostingGraphic config={{ ...config, format }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* AI Import variant switcher — inline below canvas, same style as mini previews */}
        {config.aiImport && variants && variants.length > 1 && (
          <div className="mt-8 flex gap-4 justify-center flex-wrap">
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
                    <img src={v.backgroundImageUrl} alt={v.artboardName} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-[10px] text-gray-500">{v.artboardWidth}×{v.artboardHeight}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/*
        Export containers: position:fixed at top:0,left:0 so html2canvas knows
        exactly where they are (no scroll offset, no off-screen layout issues).
        visibility:hidden keeps them invisible to the user.
        Each format is stacked at the same position — only one gets captured at a time.
      */}
      {FORMATS.map((format) => {
        const { width, height } = FORMAT_DIMENSIONS[format]
        return (
          <div
            key={format}
            id={`export-${format}`}
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width,
              height,
              overflow: 'hidden',
              visibility: 'hidden',
              pointerEvents: 'none',
              zIndex: -9999,
            }}
          >
            <PostingGraphic config={{ ...config, format }} forExport={true} />
          </div>
        )
      })}

    </div>
  )
}
