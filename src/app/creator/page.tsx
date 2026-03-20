'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Archive, X } from 'lucide-react'
import type { PostingConfig, Format, TemplateGroup, ProjectDraft } from '@/types/posting'
import { defaultConfig } from '@/types/posting'
import { CreatorSidebar } from '@/components/creator/creator-sidebar'
import { PostingGraphic } from '@/components/creator/posting-graphic'
import { PreviewCanvas } from '@/components/creator/preview-canvas'
import { ExportBar } from '@/components/creator/export-bar'
import { AIImportDialog } from '@/components/creator/ai-import-dialog'
import { loadTemplateGroups, saveTemplateGroups, loadProjectDrafts, saveProjectDrafts } from '@/lib/template-storage'
import { toast } from 'sonner'


const FORMAT_RATIOS: [Format, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['4:5', 4 / 5],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
]

function detectFormat(width: number, height: number): Format {
  const ratio = width / height
  return FORMAT_RATIOS.reduce((best, [fmt, r]) =>
    Math.abs(r - ratio) < Math.abs(FORMAT_RATIOS.find(([f]) => f === best)![1] - ratio) ? fmt : best
  , FORMAT_RATIOS[0][0])
}

// Strip trailing format suffix like _9:16, _16:9, _4:5, _1:1, _4:3, _3:4
function extractBaseName(artboardName: string): string {
  return artboardName.replace(/_\d+:\d+$/, '').trim() || artboardName
}

export default function CreatorPage() {
  const [config, setConfig] = useState<PostingConfig>(defaultConfig)
  const [showAIImport, setShowAIImport] = useState(false)
  const [selectedFieldIndex, setSelectedFieldIndex] = useState<number | null>(null)
  // Template library — accumulates all AI imports across sessions; lives outside PostingConfig
  const [templateGroups, setTemplateGroups] = useState<TemplateGroup[]>([])
  const [templateMode, setTemplateMode] = useState(false)
  // When set, the next AI import will replace this template group
  const [replacingBaseName, setReplacingBaseName] = useState<string | null>(null)
  // Project drafts
  const [projectDrafts, setProjectDrafts] = useState<ProjectDraft[]>([])
  const [showSaveDraft, setShowSaveDraft] = useState(false)
  const [showUserProjects, setShowUserProjects] = useState(false)
  const [draftNameInput, setDraftNameInput] = useState('')
  const [customizeMode, setCustomizeMode] = useState(false)
  const [pendingDeleteDraftId, setPendingDeleteDraftId] = useState<string | null>(null)
  const [renamingDraftId, setRenamingDraftId] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')

  // Load persisted template groups from IndexedDB on mount
  useEffect(() => {
    loadTemplateGroups().then(saved => {
      if (saved.length > 0) setTemplateGroups(saved)
    })
  }, [])

  // Persist template groups to IndexedDB whenever they change
  useEffect(() => {
    saveTemplateGroups(templateGroups)
  }, [templateGroups])

  // Load persisted drafts from IndexedDB on mount
  useEffect(() => {
    loadProjectDrafts().then(saved => { if (saved.length > 0) setProjectDrafts(saved) })
  }, [])

  // Persist drafts to IndexedDB whenever they change
  useEffect(() => {
    saveProjectDrafts(projectDrafts)
  }, [projectDrafts])

  // ── Global undo history ───────────────────────────────────────────────────
  const configRef = useRef<PostingConfig>(defaultConfig)
  const historyRef = useRef<PostingConfig[]>([defaultConfig])
  const historyIdxRef = useRef(0)

  const updateConfig = useCallback((updates: Partial<PostingConfig>) => {
    const next = { ...configRef.current, ...updates }
    configRef.current = next
    // Trim any redo states, push new state, cap at 100 entries
    historyRef.current = [...historyRef.current.slice(0, historyIdxRef.current + 1), next].slice(-100)
    historyIdxRef.current = historyRef.current.length - 1
    setConfig(next)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (historyIdxRef.current > 0) {
          historyIdxRef.current--
          const prev = historyRef.current[historyIdxRef.current]
          configRef.current = prev
          setConfig(prev)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const switchTemplate = useCallback((baseName: string) => {
    const group = templateGroups.find(g => g.baseName === baseName)
    if (!group) return
    const variants = group.variants
    updateConfig({
      aiImport: variants[0],
      aiImportVariants: variants.length > 1 ? { variants, activeVariantIndex: 0 } : null,
      format: detectFormat(variants[0].artboardWidth, variants[0].artboardHeight),
    })
  }, [templateGroups, updateConfig])

  const removeTemplate = useCallback((baseName: string) => {
    setTemplateGroups(prev => prev.filter(g => g.baseName !== baseName))
    // If it was the active template, clear the canvas
    if (config.aiImport && extractBaseName(config.aiImport.artboardName) === baseName) {
      updateConfig({ aiImport: null, aiImportVariants: null })
    }
  }, [config.aiImport, updateConfig])

  const replaceTemplate = useCallback((baseName: string) => {
    setReplacingBaseName(baseName)
    setShowAIImport(true)
  }, [])

  // Base name of the currently active AI import (used to highlight active template button)
  const activeTemplateName = config.aiImport ? extractBaseName(config.aiImport.artboardName) : null

  const openSaveDraft = useCallback(() => {
    const base = activeTemplateName ?? 'Entwurf'
    const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    setDraftNameInput(`${base} — ${date}`)
    setShowSaveDraft(true)
  }, [activeTemplateName])

  const confirmSaveDraft = useCallback(() => {
    if (!config.aiImport) return
    const draft: ProjectDraft = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: draftNameInput.trim() || 'Entwurf',
      createdAt: new Date().toISOString(),
      aiImport: config.aiImport,
      aiImportVariants: config.aiImportVariants,
      format: config.format,
      templateBaseName: activeTemplateName ?? undefined,
    }
    setProjectDrafts(prev => [draft, ...prev])
    setShowSaveDraft(false)
  }, [config.aiImport, config.aiImportVariants, config.format, activeTemplateName, draftNameInput])

  const loadDraft = useCallback((draft: ProjectDraft) => {
    updateConfig({
      aiImport: draft.aiImport,
      aiImportVariants: draft.aiImportVariants,
      format: draft.format,
    })
    setTemplateMode(true)
  }, [updateConfig])

  const deleteDraft = useCallback((id: string) => {
    setProjectDrafts(prev => prev.filter(d => d.id !== id))
  }, [])

  const renameDraft = useCallback((id: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) setProjectDrafts(prev => prev.map(d => d.id === id ? { ...d, name: trimmed } : d))
    setRenamingDraftId(null)
  }, [])

  const saveAsDefault = useCallback(() => {
    if (!config.aiImport || !activeTemplateName) return
    setTemplateGroups(prev => prev.map(g => {
      if (g.baseName !== activeTemplateName) return g
      const variantIdx = config.aiImportVariants?.activeVariantIndex ?? 0
      const updatedVariants = g.variants.map((v, vi) =>
        vi === variantIdx ? { ...v, editableFields: config.aiImport!.editableFields } : v
      )
      return { ...g, variants: updatedVariants }
    }))
    // Also sync into aiImportVariants so the live variants reflect the new default
    if (config.aiImportVariants) {
      const variantIdx = config.aiImportVariants.activeVariantIndex
      const updatedVariants = config.aiImportVariants.variants.map((v, vi) =>
        vi === variantIdx ? { ...v, editableFields: config.aiImport!.editableFields } : v
      )
      updateConfig({ aiImportVariants: { ...config.aiImportVariants, variants: updatedVariants } })
    }
    toast.success('Template-Standard gespeichert')
  }, [config.aiImport, config.aiImportVariants, activeTemplateName, updateConfig])

  return (
    <div className="h-screen bg-[#0a0118] relative overflow-hidden">
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

              {/* Preset Buttons */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Presets:</span>
                <button
                  onClick={() => { setTemplateMode(false); updateConfig({ ...defaultConfig, headline: 'IT KOSMOS Conference 2026', subline: 'Join the Mission to the Future of Technology' }) }}
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 border border-white/10 transition-all"
                >
                  PKN Standard
                </button>
                <button
                  onClick={() => { setTemplateMode(false); updateConfig({ ...defaultConfig, spaceBackgroundEnabled: false, pillEnabled: false, ctaMode: 'off', highlightEnabled: false, glowIntensity: 'low', backgroundDensity: 'low' }) }}
                  className="px-3 py-1.5 rounded-lg text-xs bg-white/10 hover:bg-white/20 text-gray-300 border border-white/10 transition-all"
                >
                  Minimal
                </button>
                <button
                  onClick={() => { setTemplateMode(false); updateConfig({ ...defaultConfig, postType: 'event', spaceBackgroundEnabled: true, backgroundDensity: 'high', glowIntensity: 'high', ctaMode: 'primary', statsMode: 'three' }) }}
                  className="px-3 py-1.5 rounded-lg text-xs bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 transition-all"
                >
                  Event Strong
                </button>
                <button
                  onClick={() => { setTemplateMode(true); updateConfig({ aiImport: null, aiImportVariants: null }) }}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    templateMode
                      ? 'bg-violet-500/30 text-violet-200 border-violet-500/50'
                      : 'bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border-violet-500/30'
                  }`}
                >
                  Template
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Layout */}
        <div className="flex h-[calc(100vh-57px)]">
          <CreatorSidebar
            config={config}
            updateConfig={updateConfig}
            selectedFieldIndex={selectedFieldIndex}
            templateGroups={templateGroups}
            templateMode={templateMode}
            activeTemplateName={activeTemplateName}
            onSelectTemplate={switchTemplate}
            onOpenAIImport={() => setShowAIImport(true)}
            onRemoveTemplate={removeTemplate}
            onReplaceTemplate={replaceTemplate}
            customizeMode={customizeMode}
            onCustomizeModeChange={setCustomizeMode}
            onSaveAsDefault={config.aiImport && activeTemplateName ? saveAsDefault : undefined}
          />
          {!(templateMode && !config.aiImport) && <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <PreviewCanvas
              config={config}
              updateConfig={updateConfig}
              templateMode={templateMode}
              selectedFieldIndex={selectedFieldIndex}
              onSelectField={setSelectedFieldIndex}
              variants={config.aiImportVariants && config.aiImportVariants.variants.length > 1 ? config.aiImportVariants.variants : undefined}
              activeVariantIndex={config.aiImportVariants?.activeVariantIndex}
              onSwitchVariant={(i) => {
                const vars = config.aiImportVariants!
                const currentIdx = vars.activeVariantIndex
                // Persist edits from the current variant before switching
                const updatedVariants = vars.variants.map((v, vi) =>
                  vi === currentIdx && config.aiImport ? config.aiImport : v
                )
                const next = updatedVariants[i]
                updateConfig({
                  aiImport: next,
                  aiImportVariants: { variants: updatedVariants, activeVariantIndex: i },
                  format: detectFormat(next.artboardWidth, next.artboardHeight),
                })
              }}
            />
          </div>}
        </div>

        {/* Export Bar */}
        <ExportBar
          config={config}
          onSaveProject={config.aiImport ? openSaveDraft : undefined}
          onOpenUserProjects={() => setShowUserProjects(v => !v)}
          userProjectCount={projectDrafts.length}
        />
      </div>

      {/* AI Import Dialog */}
      {showAIImport && (
        <AIImportDialog
          onImport={(incomingGroups) => {
            // In replace mode: remove the old group at its position, insert new groups there
            setTemplateGroups(prev => {
              let next = [...prev]
              if (replacingBaseName) {
                const replaceIdx = next.findIndex(g => g.baseName === replacingBaseName)
                if (replaceIdx >= 0) next.splice(replaceIdx, 1)
              }
              for (const group of incomingGroups) {
                const idx = next.findIndex(g => g.baseName === group.baseName)
                if (idx >= 0) { next[idx] = group } else { next = [...next, group] }
              }
              return next
            })
            setReplacingBaseName(null)
            setTemplateMode(true)
            // Activate the first group's first variant
            const first = incomingGroups[0]
            const variants = first.variants
            updateConfig({
              aiImport: variants[0],
              aiImportVariants: variants.length > 1 ? { variants, activeVariantIndex: 0 } : null,
              format: detectFormat(variants[0].artboardWidth, variants[0].artboardHeight),
            })
            setShowAIImport(false)
          }}
          onClose={() => { setShowAIImport(false); setReplacingBaseName(null) }}
        />
      )}

      {/* User Projects Panel — slides up from export bar */}
      {showUserProjects && (
        <div className="fixed bottom-[57px] left-0 right-0 z-40 bg-[#0d0820]/95 backdrop-blur-xl border-t border-white/10 shadow-2xl max-h-[55vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">User Projects</span>
              <span className="text-[10px] bg-white/10 text-gray-400 px-2 py-0.5 rounded-full">{projectDrafts.length}</span>
            </div>
            <button onClick={() => setShowUserProjects(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          {projectDrafts.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-500 text-center">Noch keine gespeicherten Projekte.</p>
          ) : (
            <div className="overflow-y-auto px-6 py-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {projectDrafts.map(draft => {
                const artW = draft.aiImport.artboardWidth
                const artH = draft.aiImport.artboardHeight
                const THUMB = 90
                const thumbScale = THUMB / artW
                const thumbH = Math.round(artH * thumbScale)
                const thumbConfig = { ...defaultConfig, aiImport: draft.aiImport, aiImportVariants: null }
                const dateStr = new Date(draft.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
                const isRenaming = renamingDraftId === draft.id
                return (
                  <div key={draft.id} className="flex flex-col rounded-xl overflow-hidden border border-white/10 bg-white/5 hover:bg-white/10 transition-all group">
                    <div style={{ width: THUMB, height: thumbH, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
                      <div style={{ transform: `scale(${thumbScale})`, transformOrigin: 'top left', width: artW, height: artH, pointerEvents: 'none' }}>
                        <PostingGraphic config={thumbConfig} />
                      </div>
                    </div>
                    <div className="px-1.5 py-1.5 flex-1 flex flex-col gap-0.5">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameInput}
                          onChange={e => setRenameInput(e.target.value)}
                          onBlur={() => renameDraft(draft.id, renameInput)}
                          onKeyDown={e => { if (e.key === 'Enter') renameDraft(draft.id, renameInput); if (e.key === 'Escape') setRenamingDraftId(null) }}
                          className="text-[10px] font-semibold text-white bg-white/10 border border-cyan-500/50 rounded px-1 py-0.5 w-full outline-none"
                        />
                      ) : (
                        <p
                          className="text-[10px] font-semibold text-gray-200 truncate cursor-text"
                          title="Doppelklick zum Umbenennen"
                          onDoubleClick={() => { setRenamingDraftId(draft.id); setRenameInput(draft.name) }}
                        >{draft.name}</p>
                      )}
                      {draft.templateBaseName && <p className="text-[9px] text-gray-500 truncate">{draft.templateBaseName}</p>}
                      <p className="text-[9px] text-gray-600">{dateStr}</p>
                      <div className="flex gap-1 mt-1">
                        {pendingDeleteDraftId === draft.id ? (
                          <>
                            <button onClick={() => setPendingDeleteDraftId(null)} className="flex-1 py-0.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 text-[9px] border border-white/20 transition-all">Nein</button>
                            <button onClick={() => { deleteDraft(draft.id); setPendingDeleteDraftId(null) }} className="flex-1 py-0.5 rounded bg-red-500/30 hover:bg-red-500/50 text-red-300 text-[9px] border border-red-500/40 transition-all">Ja</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { loadDraft(draft); setShowUserProjects(false) }} className="flex-1 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-300 text-[9px] font-medium border border-cyan-500/30 transition-all">Laden</button>
                            <button onClick={() => setPendingDeleteDraftId(draft.id)} className="py-0.5 px-1.5 rounded bg-white/5 hover:bg-red-500/20 text-gray-500 hover:text-red-400 text-[9px] border border-white/10 hover:border-red-500/30 transition-all"><X className="w-2.5 h-2.5" /></button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Save Draft Dialog */}
      {showSaveDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#13082a] border border-white/10 rounded-2xl shadow-2xl p-6 w-[360px] flex flex-col gap-4">
            <div>
              <h2 className="text-base font-bold text-white mb-1">Projekt speichern</h2>
              <p className="text-xs text-gray-400">Gib dem Entwurf einen Namen um ihn später wiederzufinden.</p>
            </div>
            <input
              type="text"
              value={draftNameInput}
              onChange={e => setDraftNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmSaveDraft(); if (e.key === 'Escape') setShowSaveDraft(false) }}
              className="w-full px-3 py-2.5 bg-black/40 border border-white/15 text-white rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
              placeholder="Entwurf Name..."
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowSaveDraft(false)}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 text-sm font-medium border border-white/10 transition-all"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmSaveDraft}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white text-sm font-semibold transition-all"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
