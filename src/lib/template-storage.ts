import type { TemplateGroup, ProjectDraft } from '@/types/posting'

const DB_NAME = 'pkn-posting-creator'
const DB_VERSION = 2
const STORE = 'templateGroups'
const DRAFTS_STORE = 'projectDrafts'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) db.createObjectStore(DRAFTS_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadTemplateGroups(): Promise<TemplateGroup[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get('groups')
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveTemplateGroups(groups: TemplateGroup[]): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(groups, 'groups')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // silently ignore — storage unavailable
  }
}

export async function loadProjectDrafts(): Promise<ProjectDraft[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const req = db.transaction(DRAFTS_STORE, 'readonly').objectStore(DRAFTS_STORE).get('drafts')
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveProjectDrafts(drafts: ProjectDraft[]): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFTS_STORE, 'readwrite')
      tx.objectStore(DRAFTS_STORE).put(drafts, 'drafts')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // silently ignore — storage unavailable
  }
}
