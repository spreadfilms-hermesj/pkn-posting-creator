'use client'

import React from 'react'
import type { PostingConfig } from '@/types/posting'
import { FORMAT_DIMENSIONS } from '@/types/posting'
import { ArrowRight, Calendar, MapPin, Users } from 'lucide-react'

interface PostingGraphicProps {
  config: PostingConfig
  forExport?: boolean
  selectedFieldIndex?: number | null
  onSelectField?: (i: number) => void
}

// Context so HeadlineText knows whether it's rendering for export (no gradient text)
// or for live preview (full CSS gradient text).
const ExportContext = React.createContext(false)


// Deterministic star positions — NO Math.random, same output every call
function generateStarPositions(count: number) {
  const stars: { top: string; left: string; opacity: number }[] = []
  for (let i = 0; i < count; i++) {
    const x = (((i * 2654435761) >>> 0) % 10000) / 100
    const y = (((i * 1234567891) >>> 0) % 10000) / 100
    const op = ((((i * 987654321) >>> 0) % 50) / 100) + 0.2
    stars.push({ top: `${y}%`, left: `${x}%`, opacity: op })
  }
  return stars
}

export function PostingGraphic({ config, forExport = false, selectedFieldIndex, onSelectField }: PostingGraphicProps) {
  const { width, height } = config.aiImport
    ? { width: config.aiImport.artboardWidth, height: config.aiImport.artboardHeight }
    : FORMAT_DIMENSIONS[config.format]
  const fontFamily = config.brandSettings.fontFamily === 'Segoe UI'
    ? '"Segoe UI", system-ui, sans-serif'
    : config.brandSettings.fontFamily === 'Inter'
    ? '"Inter", system-ui, sans-serif'
    : '"Vazirmatn", system-ui, sans-serif'

  const starCount = config.backgroundDensity === 'low' ? 30 : config.backgroundDensity === 'medium' ? 60 : 100
  const glowOpacity = config.glowIntensity === 'low' ? 0.15 : config.glowIntensity === 'medium' ? 0.25 : 0.4

  const isCarousel = config.postType === 'carousel'
  const currentSlide = isCarousel ? config.carouselSlides[config.currentSlideIndex] : null
  const activeImage = isCarousel && currentSlide ? currentSlide.image : config.image
  const activeGradient = isCarousel && currentSlide ? currentSlide.backgroundGradient : config.backgroundGradient

  const stars = generateStarPositions(starCount)

  // ── AI Import mode: render artboard background + editable overlays ─────────
  if (config.aiImport) {
    const { backgroundImageUrl, artboardWidth, artboardHeight, editableFields } = config.aiImport
    return (
      <ExportContext.Provider value={forExport}>
        <div style={{ position: 'relative', overflow: forExport ? 'hidden' : 'visible', width: artboardWidth, height: artboardHeight, flexShrink: 0, fontFamily }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backgroundImageUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}
          />
          {editableFields.map((field, i) => {
            const isSelected = !forExport && selectedFieldIndex === i
            const left = field.x * artboardWidth
            const top = field.y * artboardHeight
            const w = field.width * artboardWidth
            const h = field.height * artboardHeight
            // Image-slot layers (!-prefixed) sit BELOW all other editable fields (z=1).
            // Background canvas is z=2. Other fields use descending zIndex so that
            // editableFields[0] (topmost Illustrator layer) renders on top and the last
            // field (bottommost layer) sits just above the background — preserving the
            // exact layer order from the Illustrator panel.
            const isImageLayer = field.isImageSlot === true
            const layerZ = isImageLayer ? 1 : (editableFields.length - i + 3)
            const sharedStyle: React.CSSProperties = {
              position: 'absolute',
              left,
              top,
              cursor: forExport ? 'default' : 'pointer',
              outline: isSelected ? '2px solid #22d3ee' : 'none',
              outlineOffset: 6,
              borderRadius: 2,
              opacity: field.opacity ?? 1,
              zIndex: layerZ,
            }

            if (field.type === 'graphic') {
              return (
                <div
                  key={i}
                  onClick={forExport ? undefined : () => onSelectField?.(i)}
                  style={{
                    ...sharedStyle,
                    width: w,
                    height: h,
                    transformOrigin: 'center',
                    transform: field.scale !== 1 ? `scale(${field.scale})` : undefined,
                  }}
                >
                  {field.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={field.imageUrl}
                      alt={field.layerName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    // Placeholder when graphic extraction failed
                    !forExport && (
                      <div style={{
                        width: '100%', height: '100%', minWidth: 60, minHeight: 40,
                        border: '1px dashed rgba(34,211,238,0.4)',
                        borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'rgba(34,211,238,0.6)', fontSize: 11,
                      }}>
                        {field.layerName}
                      </div>
                    )
                  )}
                </div>
              )
            }

            return (
              <div
                key={i}
                onClick={forExport ? undefined : () => onSelectField?.(i)}
                style={{
                  ...sharedStyle,
                  width: w,
                  fontSize: field.fontSize,
                  color: field.color,
                  fontWeight: field.fontWeight,
                  fontStyle: field.fontStyle,
                  textAlign: field.textAlign,
                  lineHeight: 1.25,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {field.value}
              </div>
            )
          })}
        </div>
      </ExportContext.Provider>
    )
  }

  return (
    <ExportContext.Provider value={forExport}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          width,
          height,
          fontFamily,
          background: 'linear-gradient(135deg, #0a0118 0%, #1a0a2e 50%, #0a0118 100%)',
          flexShrink: 0,
        }}
      >
        {/* Gradient overlay */}
        {activeGradient && (
          <div style={{ position: 'absolute', inset: 0, background: activeGradient }} />
        )}

        {/* Image background */}
        {activeImage && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeImage}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: `brightness(${1 - config.imageDarken / 100})`,
              }}
              crossOrigin="anonymous"
            />
            <div style={{
              position: 'absolute', inset: 0,
              background: `linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.6) 100%)`,
              opacity: config.imageDarken / 100,
            }} />
          </div>
        )}

        {/* Space background — stars rendered AFTER gradient/image so they're always visible */}
        {config.spaceBackgroundEnabled && stars.map((star, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: 4,
              height: 4,
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              top: star.top,
              left: star.left,
              opacity: star.opacity,
            }}
          />
        ))}

        {/* Glow effects — rendered after gradient/image, always visible */}
        {config.spaceBackgroundEnabled && (
          <>
            <div style={{
              position: 'absolute', top: 0, right: 0,
              width: '50%', height: '50%',
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(6,182,212,${glowOpacity}) 0%, transparent 70%)`,
            }} />
            <div style={{
              position: 'absolute', bottom: 0, left: 0,
              width: '50%', height: '50%',
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(37,99,235,${glowOpacity}) 0%, transparent 70%)`,
            }} />
            <div style={{
              position: 'absolute',
              top: '25%', left: '25%',
              width: '50%', height: '50%',
              borderRadius: '50%',
              background: `radial-gradient(circle, rgba(147,51,234,${glowOpacity * 0.7}) 0%, transparent 70%)`,
            }} />
          </>
        )}

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 10, height: '100%' }}>
          {config.postType === 'event' && <EventLayout config={config} />}
          {config.postType === 'announcement' && <AnnouncementLayout config={config} />}
          {config.postType === 'pure-visual' && <PureVisualLayout config={config} />}
          {config.postType === 'quote' && <QuoteLayout config={config} />}
          {config.postType === 'stat' && <StatLayout config={config} />}
          {config.postType === 'service' && <ServiceLayout config={config} />}
          {config.postType === 'hiring' && <HiringLayout config={config} />}
          {config.postType === 'reminder' && <ReminderLayout config={config} />}
          {config.postType === 'presentation' && <PresentationLayout config={config} />}
          {config.postType === 'carousel' && <CarouselLayout config={config} />}
        </div>

        {/* Logo */}
        {config.logoEnabled && <LogoComponent config={config} />}
      </div>
    </ExportContext.Provider>
  )
}

// ─── Shared Primitives ──────────────────────────────────────────────────────

/** Glass card — uses rgba background instead of backdrop-blur (html2canvas compat) */
function GlassCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backgroundColor: 'rgba(0,0,0,0.55)',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: 24,
      ...style,
    }}>
      {children}
    </div>
  )
}

function Pill({ label, config }: { label: string; config: PostingConfig }) {
  const c = config.brandSettings.primaryColor
  return (
    <div style={{
      display: 'inline-flex',
      alignSelf: 'flex-start',
      width: 'fit-content',
      alignItems: 'center',
      padding: '8px 24px',
      borderRadius: 9999,
      backgroundColor: `${c}33`,
      border: `1px solid ${c}80`,
    }}>
      <span style={{
        fontSize: 14,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: c,
        whiteSpace: 'nowrap',
      }}>{label}</span>
    </div>
  )
}

function CTAButton({ label, mode, config }: { label: string; mode: 'primary' | 'secondary'; config: PostingConfig }) {
  const primary = config.brandSettings.primaryColor
  const secondary = config.brandSettings.secondaryColor
  const isPrimary = mode === 'primary'

  // If secondary is near-black (luminance < 0.15), use #2563eb for the gradient
  // end so the button always shows a visible, colorful Cyan→Blue gradient.
  const getEndColor = () => {
    const h = secondary.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.15 ? '#2563eb' : secondary
  }

  return (
    <div style={{
      display: 'inline-flex',
      alignSelf: 'flex-start',
      width: 'fit-content',
      alignItems: 'center',
      gap: 12,
      padding: '16px 32px',
      borderRadius: 12,
      fontWeight: 700,
      fontSize: 18,
      color: '#ffffff',
      background: isPrimary
        ? `linear-gradient(to right, ${primary} 0%, ${getEndColor()} 100%)`
        : 'rgba(255,255,255,0.12)',
      border: isPrimary ? 'none' : '1px solid rgba(255,255,255,0.3)',
      cursor: 'default',
      whiteSpace: 'nowrap',
    }}>
      {label}
      {/* Unicode arrow — SVG icons are not reliably rendered by html2canvas */}
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>→</span>
    </div>
  )
}

function HeadlineText({ config, style }: { config: PostingConfig; style?: React.CSSProperties }) {
  const isExport = React.useContext(ExportContext)
  const primary = config.brandSettings.primaryColor

  if (!config.highlightEnabled || !config.highlightWord || !config.headline.includes(config.highlightWord)) {
    return <span style={style}>{config.headline}</span>
  }
  const parts = config.headline.split(config.highlightWord)

  // In export (html2canvas): bg-clip-text is not supported → solid primary color
  // In preview: real CSS gradient text via WebkitBackgroundClip
  const highlightStyle: React.CSSProperties = isExport
    ? { color: primary }
    : {
        backgroundImage: `linear-gradient(to right, ${primary}, #2563eb)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }

  return (
    <span style={style}>
      {parts[0]}
      <span style={highlightStyle}>{config.highlightWord}</span>
      {parts.slice(1).join(config.highlightWord)}
    </span>
  )
}

function LogoComponent({ config }: { config: PostingConfig }) {
  const pos = config.logoPosition
  const posStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 20,
    top: pos === 'top-left' || pos === 'top-right' ? 48 : undefined,
    bottom: pos === 'bottom-left' || pos === 'bottom-right' ? 48 : undefined,
    left: pos === 'top-left' || pos === 'bottom-left' ? 48 : undefined,
    right: pos === 'top-right' || pos === 'bottom-right' ? 48 : undefined,
  }

  const sizeH = config.brandSettings.logoSize === 'small' ? 64 : config.brandSettings.logoSize === 'large' ? 128 : 96

  const getFilter = () => {
    switch (config.brandSettings.logoColor) {
      case 'white': return 'brightness(0) invert(1)'
      case 'black': return 'brightness(0)'
      case 'primary': return 'brightness(0) invert(1) sepia(1) saturate(5) hue-rotate(165deg)' // approximates cyan
      default: return 'none'
    }
  }

  if (!config.brandSettings.logo) {
    // Text logo
    return (
      <div style={posStyle}>
        <div style={{
          padding: '16px 32px',
          borderRadius: 16,
          border: '2px solid rgba(255,255,255,0.1)',
          background: `linear-gradient(135deg, ${config.brandSettings.primaryColor}, ${config.brandSettings.secondaryColor})`,
        }}>
          <span style={{
            fontSize: config.brandSettings.logoSize === 'small' ? 24 : config.brandSettings.logoSize === 'large' ? 48 : 36,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '0.1em',
          }}>
            {config.brandSettings.logoText}
          </span>
        </div>
      </div>
    )
  }

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={config.brandSettings.logo}
      alt="Logo"
      crossOrigin="anonymous"
      style={{ height: sizeH, objectFit: 'contain', display: 'block', filter: getFilter() }}
    />
  )

  return (
    <div style={posStyle}>
      {config.brandSettings.logoBackground ? (
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 16,
          border: '1px solid rgba(255,255,255,0.2)',
        }}>
          {img}
        </div>
      ) : img}
    </div>
  )
}

// ─── Layout Components ───────────────────────────────────────────────────────

function EventLayout({ config }: { config: PostingConfig }) {
  const isH = config.format === '16:9' || config.format === '4:3'
  const px = isH ? 48 : 64
  const headlineSize = isH ? 52 : 64

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '100%',
      padding: `40px ${px}px`,
      gap: 40,
      boxSizing: 'border-box',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
        {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}

        <HeadlineText config={config} style={{
          fontSize: headlineSize,
          fontWeight: 800,
          color: '#ffffff',
          lineHeight: 1.2,
          display: 'block',
        }} />

        <span style={{ fontSize: isH ? 20 : 24, color: '#d1d5db', lineHeight: 1.5, display: 'block' }}>
          {config.subline}
        </span>

        {config.metaLine && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: config.brandSettings.primaryColor }}>
              <Calendar style={{ width: 20, height: 20, flexShrink: 0 }} />
              <span style={{ fontSize: 18 }}>{config.metaLine.split('·')[0]?.trim()}</span>
            </div>
            {config.metaLine.includes('·') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: config.brandSettings.primaryColor }}>
                <MapPin style={{ width: 20, height: 20, flexShrink: 0 }} />
                <span style={{ fontSize: 18 }}>{config.metaLine.split('·')[1]?.trim()}</span>
              </div>
            )}
          </div>
        )}

        {config.ctaMode !== 'off' && (
          <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
        )}
      </div>

      {config.featuredImage && (
        <div style={{ width: isH ? 280 : 400, flexShrink: 0 }}>
          <GlassCard style={{ padding: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={config.featuredImage}
              alt="Featured"
              crossOrigin="anonymous"
              style={{ width: '100%', height: isH ? 280 : 400, objectFit: 'cover', borderRadius: 16, display: 'block' }}
            />
          </GlassCard>
        </div>
      )}
    </div>
  )
}

function AnnouncementLayout({ config }: { config: PostingConfig }) {
  const isV = config.format === '9:16' || config.format === '3:4'
  const headlineSize = isV ? 80 : 68
  const padding = isV ? 80 : 64

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
      <GlassCard style={{ padding, maxWidth: 900 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 32 }}>
          {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
          <HeadlineText config={config} style={{ fontSize: headlineSize, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, display: 'block' }} />
          <span style={{ fontSize: 36, color: '#d1d5db', lineHeight: 1.4, display: 'block' }}>{config.subline}</span>
          {config.ctaMode !== 'off' && (
            <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
          )}
        </div>
      </GlassCard>
    </div>
  )
}

function PureVisualLayout({ config }: { config: PostingConfig }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', height: '100%', padding: 64, boxSizing: 'border-box' }}>
      {config.headline && (
        <GlassCard style={{ padding: 40 }}>
          <span style={{ fontSize: 60, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, display: 'block' }}>
            {config.headline}
          </span>
        </GlassCard>
      )}
    </div>
  )
}

function QuoteLayout({ config }: { config: PostingConfig }) {
  const isV = config.format === '9:16' || config.format === '3:4'
  const textSize = isV ? 56 : 48
  const padding = isV ? 80 : 64

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
      <GlassCard style={{ padding, maxWidth: 900 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
          {config.pillEnabled && (
            <div style={{ marginBottom: 32 }}><Pill label={config.pillLabel} config={config} /></div>
          )}
          <span style={{ fontSize: textSize, fontWeight: 800, color: '#ffffff', lineHeight: 1.25, fontStyle: 'italic', display: 'block' }}>
            &ldquo;{config.headline}&rdquo;
          </span>
          {config.subline && (
            <span style={{ fontSize: 28, fontWeight: 600, color: config.brandSettings.primaryColor, marginTop: 24, display: 'block' }}>
              — {config.subline}
            </span>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

function StatLayout({ config }: { config: PostingConfig }) {
  const showStats = config.statsMode !== 'off'
  const statsCount = config.statsMode === 'three' ? 3 : 1
  const isV = config.format === '9:16' || config.format === '3:4'

  const statColors = [
    { from: '#22d3ee', to: '#3b82f6' },
    { from: '#3b82f6', to: '#a855f7' },
    { from: '#a855f7', to: '#ec4899' },
  ]

  const stats = [
    { value: config.stat1Value, label: config.stat1Label },
    { value: config.stat2Value, label: config.stat2Label },
    { value: config.stat3Value, label: config.stat3Label },
  ]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      padding: '0 80px',
      gap: 56,
      boxSizing: 'border-box',
    }}>
      {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}

      {showStats && (
        <div style={{ display: 'flex', flexDirection: isV ? 'column' : 'row', gap: 32 }}>
          {stats.slice(0, statsCount).map((stat, i) => (
            <GlassCard key={i} style={{ padding: 56, textAlign: 'center', minWidth: 200 }}>
              <div style={{
                fontSize: 80,
                fontWeight: 800,
                // html2canvas doesn't support gradient text — use solid color instead
                color: statColors[i].from,
                lineHeight: 1,
              }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 20, color: '#d1d5db', marginTop: 20, fontWeight: 500 }}>
                {stat.label}
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <span style={{ fontSize: 56, fontWeight: 800, color: '#ffffff', textAlign: 'center', maxWidth: 800, lineHeight: 1.2, display: 'block' }}>
        {config.headline}
      </span>
    </div>
  )
}

function ServiceLayout({ config }: { config: PostingConfig }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: '100%', padding: '0 64px', gap: 48, boxSizing: 'border-box' }}>
      <div style={{ flex: 1 }}>
        <GlassCard style={{ padding: 56 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
            {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
            <span style={{ fontSize: 56, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, display: 'block' }}>{config.headline}</span>
            <span style={{ fontSize: 24, color: '#d1d5db', lineHeight: 1.5, display: 'block' }}>{config.subline}</span>
            {config.ctaMode !== 'off' && (
              <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
            )}
          </div>
        </GlassCard>
      </div>
      {config.featuredImage && (
        <div style={{ width: 380, flexShrink: 0 }}>
          <GlassCard style={{ padding: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={config.featuredImage} alt="" crossOrigin="anonymous"
              style={{ width: '100%', height: 480, objectFit: 'cover', borderRadius: 16, display: 'block' }} />
          </GlassCard>
        </div>
      )}
    </div>
  )
}

function HiringLayout({ config }: { config: PostingConfig }) {
  const primary = config.brandSettings.primaryColor

  if (config.featuredImage) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', padding: '0 64px', gap: 48, boxSizing: 'border-box' }}>
        <div style={{ flex: 1 }}>
          <GlassCard style={{ padding: 48 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
              {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: `linear-gradient(135deg, ${primary}, #2563eb)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users style={{ width: 32, height: 32, color: '#ffffff' }} />
              </div>
              <span style={{ fontSize: 48, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, display: 'block' }}>{config.headline}</span>
              <span style={{ fontSize: 22, color: '#d1d5db', lineHeight: 1.5, display: 'block' }}>{config.subline}</span>
              {config.metaLine && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: primary }}>
                  <MapPin style={{ width: 18, height: 18 }} />
                  <span style={{ fontSize: 18 }}>{config.metaLine}</span>
                </div>
              )}
              {config.ctaMode !== 'off' && (
                <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
              )}
            </div>
          </GlassCard>
        </div>
        <div style={{ width: 380, flexShrink: 0 }}>
          <GlassCard style={{ padding: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={config.featuredImage} alt="" crossOrigin="anonymous"
              style={{ width: '100%', height: 480, objectFit: 'cover', borderRadius: 16, display: 'block' }} />
          </GlassCard>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
      <GlassCard style={{ padding: 64, maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: `linear-gradient(135deg, ${primary}, #2563eb)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Users style={{ width: 40, height: 40, color: '#ffffff' }} />
          </div>
          <span style={{ fontSize: 56, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, display: 'block' }}>{config.headline}</span>
          <span style={{ fontSize: 28, color: '#d1d5db', lineHeight: 1.4, display: 'block' }}>{config.subline}</span>
          {config.metaLine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: primary }}>
              <MapPin style={{ width: 20, height: 20 }} />
              <span style={{ fontSize: 20 }}>{config.metaLine}</span>
            </div>
          )}
          {config.ctaMode !== 'off' && (
            <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
          )}
        </div>
      </GlassCard>
    </div>
  )
}

function ReminderLayout({ config }: { config: PostingConfig }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
      <GlassCard style={{ padding: 48, maxWidth: 800, textAlign: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
          <span style={{ fontSize: 48, fontWeight: 800, color: '#ffffff', lineHeight: 1.2, display: 'block' }}>{config.headline}</span>
          {config.subline && (
            <span style={{ fontSize: 20, color: '#d1d5db', lineHeight: 1.5, display: 'block' }}>{config.subline}</span>
          )}
        </div>
      </GlassCard>
    </div>
  )
}

function PresentationLayout({ config }: { config: PostingConfig }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
      <GlassCard style={{ padding: 64, maxWidth: 900 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
          {config.pillEnabled && <Pill label={config.pillLabel} config={config} />}
          <HeadlineText config={config} style={{ fontSize: 68, fontWeight: 800, color: '#ffffff', lineHeight: 1.15, display: 'block' }} />
          <span style={{ fontSize: 28, color: '#d1d5db', lineHeight: 1.4, display: 'block' }}>{config.subline}</span>
          {config.ctaMode !== 'off' && (
            <CTAButton label={config.ctaLabel} mode={config.ctaMode} config={config} />
          )}
        </div>
      </GlassCard>
    </div>
  )
}

function CarouselLayout({ config }: { config: PostingConfig }) {
  const currentSlide = config.carouselSlides[config.currentSlideIndex]

  if (!currentSlide) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 80px', boxSizing: 'border-box' }}>
        <GlassCard style={{ padding: 80, textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center' }}>
            <span style={{ fontSize: 56 }}>📱</span>
            <span style={{ fontSize: 36, fontWeight: 800, color: '#ffffff', display: 'block' }}>Keine Slides</span>
            <span style={{ fontSize: 20, color: '#9ca3af', display: 'block' }}>Slides im Carousel Manager hinzufügen</span>
          </div>
        </GlassCard>
      </div>
    )
  }

  const slideConfig: PostingConfig = {
    ...config,
    postType: currentSlide.slideType,
    image: currentSlide.image,
    backgroundGradient: currentSlide.backgroundGradient,
    featuredImage: currentSlide.featuredImage,
    headline: currentSlide.headline,
    subline: currentSlide.subline,
    pillLabel: currentSlide.pillLabel,
    ctaLabel: currentSlide.ctaLabel,
    metaLine: currentSlide.metaLine,
  }

  return (
    <>
      {currentSlide.slideType === 'event' && <EventLayout config={slideConfig} />}
      {currentSlide.slideType === 'announcement' && <AnnouncementLayout config={slideConfig} />}
      {currentSlide.slideType === 'pure-visual' && <PureVisualLayout config={slideConfig} />}
      {currentSlide.slideType === 'quote' && <QuoteLayout config={slideConfig} />}
      {currentSlide.slideType === 'stat' && <StatLayout config={slideConfig} />}
      {currentSlide.slideType === 'service' && <ServiceLayout config={slideConfig} />}
      {currentSlide.slideType === 'hiring' && <HiringLayout config={slideConfig} />}
      {currentSlide.slideType === 'reminder' && <ReminderLayout config={slideConfig} />}
      {currentSlide.slideType === 'presentation' && <PresentationLayout config={slideConfig} />}

      {/* Slide indicator dots */}
      <div style={{ position: 'absolute', bottom: 24, right: 24, display: 'flex', gap: 8 }}>
        {config.carouselSlides.map((_, idx) => (
          <div
            key={idx}
            style={{
              height: 12,
              width: idx === config.currentSlideIndex ? 32 : 12,
              borderRadius: 9999,
              backgroundColor: idx === config.currentSlideIndex ? config.brandSettings.primaryColor : 'rgba(255,255,255,0.3)',
            }}
          />
        ))}
      </div>
    </>
  )
}
