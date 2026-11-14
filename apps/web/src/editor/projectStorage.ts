import type { AspectRatio, MediaAsset, MusicClip, TextClip, VideoClip } from './types'

export interface ProjectAssetManifest {
  id: string
  name: string
  kind: 'video' | 'audio'
  size: number
  duration: number
  width: number
  height: number
  resolutionTag: string
}

export interface ProjectFileV1 {
  version: 1
  savedAt: string
  aspectRatio: AspectRatio
  playhead: number
  assets: ProjectAssetManifest[]
  videoClips: VideoClip[]
  textClips: TextClip[]
  musicClip: MusicClip | null
}

const AUTOSAVE_DB_NAME = 'myopencut_db'
const AUTOSAVE_STORE = 'autosave'
const AUTOSAVE_KEY = 'latest_project_v1'

export function serializeProject(params: {
  aspectRatio: AspectRatio
  playhead: number
  assets: Record<string, MediaAsset>
  videoClips: VideoClip[]
  textClips: TextClip[]
  musicClip: MusicClip | null
}): ProjectFileV1 {
  const manifestAssets: ProjectAssetManifest[] = Object.values(params.assets).map(
    (a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      size: a.file.size,
      duration: a.duration,
      width: a.width,
      height: a.height,
      resolutionTag: a.resolutionTag,
    }),
  )

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    aspectRatio: params.aspectRatio,
    playhead: params.playhead,
    assets: manifestAssets,
    videoClips: params.videoClips.map((c) => ({
      ...c,
      // Blob URLs cannot be serialized across sessions
      aiCleanAudioUrl: undefined,
      useAiCleanAudio: false,
    })),
    textClips: params.textClips,
    musicClip: params.musicClip,
  }
}

export function downloadProjectJson(project: ProjectFileV1, filename?: string) {
  const json = JSON.stringify(project, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = filename ?? `project-${stamp}.myopencut.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function parseProjectJson(raw: string): ProjectFileV1 {
  const data = JSON.parse(raw) as Partial<ProjectFileV1>
  if (data.version !== 1 || !Array.isArray(data.videoClips)) {
    throw new Error('올바른 MyOpenCut 프로젝트 파일(.myopencut.json)이 아닙니다.')
  }
  return {
    version: 1,
    savedAt: data.savedAt ?? new Date().toISOString(),
    aspectRatio: data.aspectRatio === '9:16' ? '9:16' : '16:9',
    playhead: typeof data.playhead === 'number' ? data.playhead : 0,
    assets: Array.isArray(data.assets) ? data.assets : [],
    videoClips: data.videoClips,
    textClips: Array.isArray(data.textClips) ? data.textClips : [],
    musicClip: data.musicClip ?? null,
  }
}

function openAutosaveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(AUTOSAVE_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveAutosaveProject(project: ProjectFileV1): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  try {
    const db = await openAutosaveDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite')
      tx.objectStore(AUTOSAVE_STORE).put(project, AUTOSAVE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Ignore IndexedDB errors in private mode
  }
}

export async function loadAutosaveProject(): Promise<ProjectFileV1 | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null
  try {
    const db = await openAutosaveDb()
    const result = await new Promise<ProjectFileV1 | null>((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readonly')
      const req = tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY)
      req.onsuccess = () => resolve((req.result as ProjectFileV1) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

export async function clearAutosaveProject(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  try {
    const db = await openAutosaveDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(AUTOSAVE_STORE, 'readwrite')
      tx.objectStore(AUTOSAVE_STORE).delete(AUTOSAVE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Ignore
  }
}
