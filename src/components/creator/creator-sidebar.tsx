'use client'

import React, { useState, useEffect, useRef } from 'react'
import type { PostingConfig } from '@/types/posting'
import { MediaUploader } from './media-uploader'
import { PostTypeSelector } from './post-type-selector'
import { BrandToggles } from './brand-toggles'
import { BrandSettingsComponent } from './brand-settings'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown, ChevronUp, FileCode2, Eye, EyeOff, Upload } from 'lucide-react'

interface CreatorSidebarProps {
  config: PostingConfig
  updateConfig: (updates: Partial<PostingConfig>) => void
  selectedFieldIndex: number | null
}

interface SectionProps {
  title: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

function Section({ title, isOpen, onToggle, children }: SectionProps) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <span className="text-base font-semibold text-white">{title}</span>
        {isOpen ? <ChevronUp className="w-5 h-5 text-cyan-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>
      {isOpen && <div className="px-6 pb-6">{children}</div>}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500" />
    </label>
  )
}

import type { AIImportData, AIEditableField, AIImportVariants } from '@/types/posting'

function AIFieldItem({
  field,
  index,
  aiImport,
  updateConfig,
  isSelected,
  aiImportVariants,
}: {
  field: AIEditableField
  index: number
  aiImport: AIImportData
  updateConfig: (updates: Partial<PostingConfig>) => void
  isSelected: boolean
  aiImportVariants: AIImportVariants | null
}) {
  const [open, setOpen] = useState(true)
  const ref = React.useRef<HTMLDivElement>(null)
  // Track Shift key for spinner-click detection (mouse clicks don't fire onKeyDown)
  const shiftRef = React.useRef(false)

  React.useEffect(() => {
    const track = (e: KeyboardEvent) => { shiftRef.current = e.shiftKey }
    window.addEventListener('keydown', track, true)
    window.addEventListener('keyup', track, true)
    return () => { window.removeEventListener('keydown', track, true); window.removeEventListener('keyup', track, true) }
  }, [])

  React.useEffect(() => {
    if (isSelected) {
      setOpen(true)
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isSelected])

  const imageInputRef = useRef<HTMLInputElement>(null)

  const updateField = (updates: Partial<AIEditableField>) => {
    const updatedFields = aiImport.editableFields.map((f, fi) =>
      fi === index ? { ...f, ...updates } : f
    )
    const updatedAiImport = { ...aiImport, editableFields: updatedFields }

    // Sync text value changes to matching layers in all other variants
    if ('value' in updates && aiImportVariants && updates.value !== undefined) {
      const thisLayerName = field.layerName
      const syncedVariants = aiImportVariants.variants.map((v, vi) => {
        if (vi === aiImportVariants.activeVariantIndex) return updatedAiImport
        return {
          ...v,
          editableFields: v.editableFields.map(f2 =>
            f2.type === 'text' && f2.layerName === thisLayerName
              ? { ...f2, value: updates.value! }
              : f2
          ),
        }
      })
      updateConfig({
        aiImport: updatedAiImport,
        aiImportVariants: { ...aiImportVariants, variants: syncedVariants },
      })
      return
    }

    // Sync image uploads to matching image-slot layers in all other variants
    if ('imageUrl' in updates && field.isImageSlot && aiImportVariants && updates.imageUrl !== undefined) {
      const thisLayerName = field.layerName
      const syncedVariants = aiImportVariants.variants.map((v, vi) => {
        if (vi === aiImportVariants.activeVariantIndex) return updatedAiImport
        return {
          ...v,
          editableFields: v.editableFields.map(f2 =>
            f2.isImageSlot && f2.layerName === thisLayerName
              ? { ...f2, imageUrl: updates.imageUrl! }
              : f2
          ),
        }
      })
      updateConfig({
        aiImport: updatedAiImport,
        aiImportVariants: { ...aiImportVariants, variants: syncedVariants },
      })
      return
    }

    updateConfig({ aiImport: updatedAiImport })
  }

  const handleImageReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const url = ev.target?.result as string
      if (!url) return
      // Auto-scale: slot uses objectFit:cover so it fills the slot with no
      // letterboxing. Scale the slot so it covers the full artboard in both
      // dimensions — take the larger of height-fill / width-fill ratios.
      const sh = field.height * aiImport.artboardHeight
      const sw = field.width * aiImport.artboardWidth
      const autoScale = Math.max(
        aiImport.artboardHeight / sh,
        aiImport.artboardWidth / sw,
      )
      updateField({ imageUrl: url, scale: autoScale })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // Returns onKeyDown + onChange handlers for a numeric input.
  // ArrowUp/Down apply baseStep; Shift+ArrowUp/Down or Shift+spinner apply shiftStep.
  const numericProps = (
    getVal: () => number,
    onUpdate: (v: number) => void,
    baseStep: number,
    shiftStep: number,
    min = -Infinity,
    max = Infinity
  ) => ({
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      const step = e.shiftKey ? shiftStep : baseStep
      const dir = e.key === 'ArrowUp' ? 1 : -1
      onUpdate(Math.max(min, Math.min(max, Math.round((getVal() + dir * step) * 1000) / 1000)))
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = parseFloat(e.target.value)
      if (isNaN(newVal)) return
      if (shiftRef.current) {
        // Spinner clicked while Shift held: detect direction, apply shiftStep
        const dir = newVal >= getVal() ? 1 : -1
        onUpdate(Math.max(min, Math.min(max, Math.round((getVal() + dir * shiftStep) * 1000) / 1000)))
      } else {
        onUpdate(Math.max(min, Math.min(max, newVal)))
      }
    },
  })

  return (
    <div ref={ref} className="border-t border-white/10 first:border-t-0">
      {/* Header row — After Effects style */}
      <div className={`flex items-center gap-1 pr-2 transition-colors ${isSelected ? 'bg-cyan-500/10' : ''}`}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 px-4 py-2 text-left hover:bg-white/5"
        >
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'} ${isSelected ? 'text-cyan-400' : 'text-gray-500'}`}
          />
          <span className={`font-mono text-xs font-semibold tracking-wide ${(field.opacity ?? 1) === 0 ? 'opacity-30' : ''} ${isSelected ? 'text-cyan-300' : 'text-cyan-400'}`}>{field.layerName}</span>
          {field.isImageSlot && <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">Bild</span>}
          {field.type === 'graphic' && !field.isImageSlot && <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">Grafik</span>}
          {isSelected && <span className="ml-auto text-[10px] text-cyan-500 font-normal">aktiv</span>}
        </button>
        <button
          onClick={() => updateField({ opacity: (field.opacity ?? 1) > 0 ? 0 : 1 })}
          className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
          title={(field.opacity ?? 1) > 0 ? 'Layer ausblenden' : 'Layer einblenden'}
        >
          {(field.opacity ?? 1) > 0
            ? <Eye className="w-3.5 h-3.5 text-gray-400" />
            : <EyeOff className="w-3.5 h-3.5 text-gray-600" />
          }
        </button>
      </div>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          {field.type !== 'graphic' && (
            <textarea
              value={field.value}
              onChange={(e) => updateField({ value: e.target.value })}
              className="w-full px-3 py-2 bg-black/30 border border-white/10 text-white rounded text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
              rows={field.value.includes('\n') ? 3 : 2}
            />
          )}
          {field.type === 'graphic' && (
            <>
              {field.isImageSlot === true && (
                <>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageReplace}
                  />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/40 rounded text-xs text-gray-300 hover:text-cyan-300 transition-all"
                  >
                    <Upload className="w-3 h-3" />
                    {field.imageUrl ? 'Bild ersetzen' : 'Bild hochladen'}
                  </button>
                </>
              )}
              {!field.imageUrl && (
                <p className="text-xs text-yellow-400/80 bg-yellow-500/10 rounded px-2 py-1.5">
                  Grafik konnte nicht isoliert werden — Position & Skalierung trotzdem einstellbar.
                </p>
              )}
            </>
          )}
          {/* Compact property row */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-3 text-right shrink-0">X</span>
            <input
              type="number" min={-200} max={200} step={0.1}
              value={Math.round(field.x * 1000) / 10}
              className="w-16 px-1.5 py-1 bg-black/40 border border-white/10 text-cyan-300 rounded text-xs focus:outline-none focus:border-cyan-500 tabular-nums"
              {...numericProps(
                () => Math.round(field.x * 1000) / 10,
                (v) => updateField({ x: v / 100 }),
                0.1, 1, -200, 200
              )}
            />
            <span className="w-3 text-right shrink-0">Y</span>
            <input
              type="number" min={-200} max={200} step={0.1}
              value={Math.round(field.y * 1000) / 10}
              className="w-16 px-1.5 py-1 bg-black/40 border border-white/10 text-cyan-300 rounded text-xs focus:outline-none focus:border-cyan-500 tabular-nums"
              {...numericProps(
                () => Math.round(field.y * 1000) / 10,
                (v) => updateField({ y: v / 100 }),
                0.1, 1, -200, 200
              )}
            />
            {field.type === 'graphic' ? (
              <>
                <span className="shrink-0">×</span>
                <input
                  type="number" min={0.1} max={5} step={0.05}
                  value={Math.round((field.scale ?? 1) * 100) / 100}
                  className="w-14 px-1.5 py-1 bg-black/40 border border-white/10 text-cyan-300 rounded text-xs focus:outline-none focus:border-cyan-500 tabular-nums"
                  {...numericProps(
                    () => field.scale ?? 1,
                    (v) => updateField({ scale: v }),
                    0.05, 1, 0.1, 5
                  )}
                />
              </>
            ) : (
              <>
                <span className="shrink-0">px</span>
                <input
                  type="number" min={1} step={1}
                  value={Math.round(field.fontSize)}
                  onChange={(e) => updateField({ fontSize: parseFloat(e.target.value) })}
                  className="w-14 px-1.5 py-1 bg-black/40 border border-white/10 text-cyan-300 rounded text-xs focus:outline-none focus:border-cyan-500 tabular-nums"
                />
                <input
                  type="color"
                  value={field.color.startsWith('#') ? field.color : '#ffffff'}
                  onChange={(e) => updateField({ color: e.target.value })}
                  className="w-6 h-6 rounded cursor-pointer border border-white/20 bg-transparent shrink-0"
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AIFieldList({
  fields,
  aiImport,
  updateConfig,
  selectedFieldIndex,
  aiImportVariants,
}: {
  fields: AIEditableField[]
  aiImport: AIImportData
  updateConfig: (updates: Partial<PostingConfig>) => void
  selectedFieldIndex: number | null
  aiImportVariants: AIImportVariants | null
}) {
  if (fields.length === 0) {
    return (
      <p className="px-6 pb-4 text-sm text-gray-400">
        Keine editierbaren Felder (keine Layer mit * Präfix gefunden).
      </p>
    )
  }
  return (
    <div className="pb-2">
      {fields.map((field, i) => {
        if (field.type === 'graphic' && !field.imageUrl) return null
        if (field.isDecorativeLayer) return null
        return <AIFieldItem key={i} field={field} index={i} aiImport={aiImport} updateConfig={updateConfig} isSelected={selectedFieldIndex === i} aiImportVariants={aiImportVariants} />
      })}
    </div>
  )
}

export function CreatorSidebar({ config, updateConfig, selectedFieldIndex }: CreatorSidebarProps) {
  const [openSections, setOpenSections] = useState<string[]>(['media', 'type', 'content'])

  const toggleSection = (section: string) => {
    setOpenSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    )
  }

  useEffect(() => {
    if (config.postType === 'carousel' && !openSections.includes('carousel')) {
      setOpenSections((prev) => [...prev, 'carousel'])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.postType])

  return (
    <div className="w-[400px] min-w-[400px] border-r border-white/10 bg-black/20 backdrop-blur-xl overflow-y-auto">
      <div className="p-4 pb-24 space-y-3">

        {/* AI Import — shown when an AI file has been imported */}
        {config.aiImport && (
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-cyan-400" />
                <span className="text-base font-semibold text-white">AI Import</span>
                <span className="text-xs bg-cyan-500/30 text-cyan-300 px-2 py-0.5 rounded-full">
                  {config.aiImport.artboardName}
                </span>
              </div>
              <button
                onClick={() => updateConfig({ aiImport: null, aiImportVariants: null })}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-500/20 transition-all"
              >
                Entfernen
              </button>
            </div>
            <AIFieldList fields={config.aiImport.editableFields} aiImport={config.aiImport} updateConfig={updateConfig} selectedFieldIndex={selectedFieldIndex} aiImportVariants={config.aiImportVariants ?? null} />

          </div>
        )}

        {/* Brand / CI */}
        <Section
          title="0. Brand / CI"
          isOpen={openSections.includes('brand-settings')}
          onToggle={() => toggleSection('brand-settings')}
        >
          <BrandSettingsComponent config={config} updateConfig={updateConfig} />
        </Section>

        {/* Media */}
        <Section
          title="1. Media"
          isOpen={openSections.includes('media')}
          onToggle={() => toggleSection('media')}
        >
          <MediaUploader config={config} updateConfig={updateConfig} />
        </Section>

        {/* Post Type */}
        <Section
          title="2. Post Type"
          isOpen={openSections.includes('type')}
          onToggle={() => toggleSection('type')}
        >
          <PostTypeSelector config={config} updateConfig={updateConfig} />
        </Section>

        {/* Content */}
        <Section
          title="3. Content"
          isOpen={openSections.includes('content')}
          onToggle={() => toggleSection('content')}
        >
          <div className="space-y-4">
            {/* Headline */}
            <div>
              <Label htmlFor="headline" className="text-gray-300">Headline</Label>
              <Input
                id="headline"
                value={config.headline}
                onChange={(e) => {
                  const newHeadline = e.target.value
                  const updates: Partial<PostingConfig> = { headline: newHeadline }
                  // If highlightWord no longer exists in the new headline, clear it
                  if (config.highlightEnabled && config.highlightWord && !newHeadline.includes(config.highlightWord)) {
                    updates.highlightWord = ''
                  }
                  updateConfig(updates)
                }}
                className="mt-2 bg-white/5 border-white/20 text-white placeholder-gray-600"
                placeholder="Deine Headline..."
              />
            </div>

            {/* Subline */}
            <div>
              <Label htmlFor="subline" className="text-gray-300">Subline</Label>
              <textarea
                id="subline"
                value={config.subline}
                onChange={(e) => updateConfig({ subline: e.target.value })}
                className="mt-2 w-full px-3 py-2 bg-white/5 border border-white/20 text-white placeholder-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                placeholder="Deine Subline..."
                rows={2}
              />
            </div>

            {/* Pill */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-gray-300">Pill/Tag</Label>
                <Toggle checked={config.pillEnabled} onChange={(v) => updateConfig({ pillEnabled: v })} />
              </div>
              {config.pillEnabled && (
                <Input
                  value={config.pillLabel}
                  onChange={(e) => updateConfig({ pillLabel: e.target.value })}
                  className="bg-white/5 border-white/20 text-white"
                  placeholder="Event, Webinar, Update..."
                />
              )}
            </div>

            {/* CTA */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-gray-300">Call-to-Action</Label>
                <Toggle
                  checked={config.ctaMode !== 'off'}
                  onChange={(v) => updateConfig({ ctaMode: v ? 'primary' : 'off' })}
                />
              </div>
              {config.ctaMode !== 'off' && (
                <div className="space-y-2">
                  <Input
                    value={config.ctaLabel}
                    onChange={(e) => updateConfig({ ctaLabel: e.target.value })}
                    className="bg-white/5 border-white/20 text-white"
                    placeholder="Jetzt anmelden..."
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateConfig({ ctaMode: 'primary' })}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${config.ctaMode === 'primary' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'}`}
                    >
                      Primary
                    </button>
                    <button
                      onClick={() => updateConfig({ ctaMode: 'secondary' })}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${config.ctaMode === 'secondary' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'}`}
                    >
                      Secondary
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Meta Line */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-gray-300">Meta Info</Label>
                <Toggle
                  checked={config.metaLine !== ''}
                  onChange={(v) => updateConfig({ metaLine: v ? '15. März 2026 · Vienna' : '' })}
                />
              </div>
              {config.metaLine !== '' && (
                <Input
                  value={config.metaLine}
                  onChange={(e) => updateConfig({ metaLine: e.target.value })}
                  className="bg-white/5 border-white/20 text-white"
                  placeholder="15. März 2026 · Vienna"
                />
              )}
            </div>

            {/* Statistics */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-gray-300">Statistics</Label>
                <Toggle
                  checked={config.statsMode !== 'off'}
                  onChange={(v) => updateConfig({
                    statsMode: v ? 'one' : 'off',
                    // Auto-switch to Statistics post type when enabling
                    ...(v && config.postType !== 'stat' ? { postType: 'stat' } : {}),
                  })}
                />
              </div>
              {config.statsMode !== 'off' && (
                <div className="space-y-3">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => updateConfig({ statsMode: 'one' })}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${config.statsMode === 'one' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'}`}
                    >
                      1 Stat
                    </button>
                    <button
                      onClick={() => updateConfig({ statsMode: 'three' })}
                      className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${config.statsMode === 'three' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'}`}
                    >
                      3 Stats
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={config.stat1Value} onChange={(e) => updateConfig({ stat1Value: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="500+" />
                    <Input value={config.stat1Label} onChange={(e) => updateConfig({ stat1Label: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="Label" />
                  </div>
                  {config.statsMode === 'three' && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={config.stat2Value} onChange={(e) => updateConfig({ stat2Value: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="50+" />
                        <Input value={config.stat2Label} onChange={(e) => updateConfig({ stat2Label: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="Label" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input value={config.stat3Value} onChange={(e) => updateConfig({ stat3Value: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="3" />
                        <Input value={config.stat3Label} onChange={(e) => updateConfig({ stat3Label: e.target.value })} className="bg-white/5 border-white/20 text-white" placeholder="Label" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Highlight Word */}
            <div className="pt-3 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-gray-300">Highlight Word</Label>
                <Toggle checked={config.highlightEnabled} onChange={(v) => updateConfig({ highlightEnabled: v })} />
              </div>
              {config.highlightEnabled && (
                <>
                  <Input
                    value={config.highlightWord}
                    onChange={(e) => updateConfig({ highlightWord: e.target.value })}
                    className="bg-white/5 border-white/20 text-white"
                    placeholder="Wort eingeben oder unten wählen…"
                  />
                  {/* Clickable word chips from the current headline */}
                  {config.headline && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {Array.from(new Set(config.headline.split(/\s+/).filter((w) => w.length > 1))).map((word) => (
                        <button
                          key={word}
                          onClick={() => updateConfig({ highlightWord: word })}
                          className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                            config.highlightWord === word
                              ? 'bg-cyan-500 text-white'
                              : 'bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white'
                          }`}
                        >
                          {word}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-2">Wird mit Farbverlauf hervorgehoben</p>
                </>
              )}
            </div>
          </div>
        </Section>

        {/* Brand Controls */}
        <Section
          title="4. Brand Controls"
          isOpen={openSections.includes('brand')}
          onToggle={() => toggleSection('brand')}
        >
          <BrandToggles config={config} updateConfig={updateConfig} />
        </Section>

        {/* Format */}
        <Section
          title="5. Format"
          isOpen={openSections.includes('format')}
          onToggle={() => toggleSection('format')}
        >
          <div className="space-y-2">
            {([
              { format: '1:1', label: '1:1 Square', desc: '1080 × 1080 px (Instagram Post)' },
              { format: '4:3', label: '4:3 Landscape', desc: '1200 × 900 px (Classic)' },
              { format: '3:4', label: '3:4 Portrait', desc: '900 × 1200 px (Feed Post)' },
              { format: '16:9', label: '16:9 Wide', desc: '1200 × 675 px (YouTube, LinkedIn)' },
              { format: '9:16', label: '9:16 Story', desc: '1080 × 1920 px (Instagram, TikTok)' },
            ] as const).map(({ format, label, desc }) => (
              <button
                key={format}
                onClick={() => updateConfig({ format })}
                className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                  config.format === format
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-white/20 bg-white/5 hover:border-white/40'
                }`}
              >
                <div className="text-white font-semibold text-sm">{label}</div>
                <div className="text-gray-400 text-xs">{desc}</div>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
