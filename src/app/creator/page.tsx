'use client'

import React, { useState } from 'react'
import { Sparkles, Archive, X, FileCode2 } from 'lucide-react'
import type { PostingConfig } from '@/types/posting'
import { defaultConfig } from '@/types/posting'
import { CreatorSidebar } from '@/components/creator/creator-sidebar'
import { PreviewCanvas } from '@/components/creator/preview-canvas'
import { ExportBar } from '@/components/creator/export-bar'
import { AIImportDialog } from '@/components/creator/ai-import-dialog'

export default function CreatorPage() {
  const [config, setConfig] = useState<PostingConfig>(defaultConfig)
  const [showAIImport, setShowAIImport] = useState(false)

  const updateConfig = (updates: Partial<PostingConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
  }

  return (
    <div className="min-h-screen bg-[#0a0118] relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px]" />
        {/* Deterministic stars for app bg */}
        {Array.from({ length: 50 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full"
            style={{
              top: `${((i * 7 + 13) % 100)}%`,
              left: `${((i * 11 + 7) % 100)}%`,
              opacity: ((i % 7) / 10) + 0.1,
            }}
          />
        ))}
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-white">PKN Posting Creator</h1>
                  <p className="text-xs text-cyan-400">Mission Control</p>
                </div>
              </div>

              {/* AI Import Button */}
              <button
                onClick={() => setShowAIImport(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 text-cyan-300 border border-cyan-500/30 text-sm font-medium transition-all"
              >
                <FileCode2 className="w-4 h-4" />
                AI importieren
              </button>

              {/* Preset Buttons */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Presets:</span>
                <button
                  onClick={() => updateConfig({
                    ...defaultConfig,
                    headline: 'IT KOSMOS Conference 2026',
                    subline: 'Join the Mission to the Future of Technology',
                  })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 border border-white/10 transition-all"
                >
                  PKN Standard
                </button>
                <button
                  onClick={() => updateConfig({
                    ...defaultConfig,
                    spaceBackgroundEnabled: false,
                    pillEnabled: false,
                    ctaMode: 'off',
                    highlightEnabled: false,
                    glowIntensity: 'low',
                    backgroundDensity: 'low',
                  })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 border border-white/10 transition-all"
                >
                  Minimal
                </button>
                <button
                  onClick={() => updateConfig({
                    ...defaultConfig,
                    postType: 'event',
                    spaceBackgroundEnabled: true,
                    backgroundDensity: 'high',
                    glowIntensity: 'high',
                    ctaMode: 'primary',
                    statsMode: 'three',
                  })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 transition-all"
                >
                  Event Strong
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Layout */}
        <div className="flex h-[calc(100vh-57px)]">
          <CreatorSidebar config={config} updateConfig={updateConfig} />
          <PreviewCanvas config={config} updateConfig={updateConfig} />
        </div>

        {/* Export Bar */}
        <ExportBar config={config} />
      </div>

      {/* AI Import Dialog */}
      {showAIImport && (
        <AIImportDialog
          onImport={(aiImportData) => {
            updateConfig({ aiImport: aiImportData })
            setShowAIImport(false)
          }}
          onClose={() => setShowAIImport(false)}
        />
      )}
    </div>
  )
}
