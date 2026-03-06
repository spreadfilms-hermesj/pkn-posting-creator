'use client'

import React, { useState, useEffect } from 'react'
import type { PostingConfig } from '@/types/posting'
import { MediaUploader } from './media-uploader'
import { PostTypeSelector } from './post-type-selector'
import { BrandToggles } from './brand-toggles'
import { BrandSettingsComponent } from './brand-settings'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronDown, ChevronUp, FileCode2 } from 'lucide-react'

interface CreatorSidebarProps {
  config: PostingConfig
  updateConfig: (updates: Partial<PostingConfig>) => void
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

export function CreatorSidebar({ config, updateConfig }: CreatorSidebarProps) {
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
                onClick={() => updateConfig({ aiImport: null })}
                className="text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-500/20 transition-all"
              >
                Entfernen
              </button>
            </div>
            <div className="px-6 pb-6 space-y-5">
              {config.aiImport.editableFields.length === 0 ? (
                <p className="text-sm text-gray-400">Keine editierbaren Felder (keine Layer mit * Präfix gefunden).</p>
              ) : (
                config.aiImport.editableFields.map((field, i) => {
                  const updateField = (updates: Partial<typeof field>) => {
                    const updated = config.aiImport!.editableFields.map((f, fi) =>
                      fi === i ? { ...f, ...updates } : f
                    )
                    updateConfig({ aiImport: { ...config.aiImport!, editableFields: updated } })
                  }
                  return (
                    <div key={i} className="space-y-2">
                      <Label className="text-gray-300 flex items-center gap-2">
                        <span className="font-mono text-xs bg-white/10 px-2 py-0.5 rounded text-cyan-400">*{field.layerName}</span>
                      </Label>
                      <textarea
                        value={field.value}
                        onChange={(e) => updateField({ value: e.target.value })}
                        className="w-full px-3 py-2 bg-white/5 border border-white/20 text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                        rows={field.value.includes('\n') ? 3 : 2}
                      />
                      {/* Position & Size controls */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-xs text-gray-500 mb-1">X (%)</p>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={Math.round(field.x * 1000) / 10}
                            onChange={(e) => updateField({ x: parseFloat(e.target.value) / 100 })}
                            className="w-full px-2 py-1.5 bg-white/5 border border-white/20 text-white rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Y (%)</p>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={Math.round(field.y * 1000) / 10}
                            onChange={(e) => updateField({ y: parseFloat(e.target.value) / 100 })}
                            className="w-full px-2 py-1.5 bg-white/5 border border-white/20 text-white rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Größe (px)</p>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={Math.round(field.fontSize)}
                            onChange={(e) => updateField({ fontSize: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1.5 bg-white/5 border border-white/20 text-white rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                      </div>
                      {/* Color */}
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-gray-500">Farbe</p>
                        <input
                          type="color"
                          value={field.color.startsWith('#') ? field.color : '#ffffff'}
                          onChange={(e) => updateField({ color: e.target.value })}
                          className="w-7 h-7 rounded cursor-pointer bg-transparent border border-white/20"
                        />
                        <span className="text-xs text-gray-500 font-mono">{field.color}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
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
