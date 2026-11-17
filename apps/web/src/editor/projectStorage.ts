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
const HANDLE_STORE = 'handles'
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

export async function saveBlobWithPicker(
  blob: Blob,
  suggestedName: string,
  description: string,
  mime: string,
  extensions: string[],
): Promise<boolean> {
  const win = window as Window & {
    showSaveFilePicker?: (opts?: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>
        close: () => Promise<void>
      }>
    }>
  }
  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [mime]: extensions } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return false
      }
      // Fall back to anchor download if picker fails
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
  return true
}

export async function saveProjectWithHandle(
  project: ProjectFileV1,
  existingHandle: FileSystemFileHandle | null,
  forceSaveAs = false,
): Promise<{
  saved: boolean
  handle: FileSystemFileHandle | null
  cancelled?: boolean
}> {
  const json = JSON.stringify(project, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const stamp = new Date().toISOString().slice(0, 10)
  const suggestedName = `project-${stamp}.kremble.json`

  const win = window as Window & {
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>
  }

  if (!forceSaveAs && existingHandle) {
    try {
      const writable = await existingHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { saved: true, handle: existingHandle }
    } catch {
      // Fall through to picker if handle permission expired
    }
  }

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'Kremble Cut 프로젝트 파일',
            accept: { 'application/json': ['.json'] },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return { saved: true, handle }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { saved: false, handle: existingHandle, cancelled: true }
      }
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  URL.revokeObjectURL(url)
  return { saved: true, handle: existingHandle }
}

export async function downloadProjectJson(
  project: ProjectFileV1,
  filename?: string,
): Promise<boolean> {
  const json = JSON.stringify(project, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const stamp = new Date().toISOString().slice(0, 10)
  return saveBlobWithPicker(
    blob,
    filename ?? `project-${stamp}.kremble.json`,
    'Kremble Cut 프로젝트 파일',
    'application/json',
    ['.json'],
  )
}

export function parseProjectJson(raw: string): ProjectFileV1 {
  const data = JSON.parse(raw) as Partial<ProjectFileV1>
  if (data.version !== 1 || !Array.isArray(data.videoClips)) {
    throw new Error('올바른 Kremble Cut 프로젝트 파일(.json)이 아닙니다.')
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
    const req = window.indexedDB.open(AUTOSAVE_DB_NAME, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE)
      }
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveAssetHandle(
  key: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return
  try {
    const db = await openAutosaveDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite')
      tx.objectStore(HANDLE_STORE).put(handle, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // Ignore storage errors
  }
}

export async function resolveSavedAssetFiles(
  manifest: ProjectAssetManifest[],
): Promise<Map<string, File>> {
  const result = new Map<string, File>()
  if (typeof window === 'undefined' || !window.indexedDB || manifest.length === 0) {
    return result
  }
  try {
    const db = await openAutosaveDb()
    const entries: { key: string; handle: FileSystemFileHandle }[] =
      await new Promise((resolve) => {
        const tx = db.transaction(HANDLE_STORE, 'readonly')
        const store = tx.objectStore(HANDLE_STORE)
        const out: { key: string; handle: FileSystemFileHandle }[] = []
        const req = store.openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (cursor) {
            out.push({
              key: String(cursor.key),
              handle: cursor.value as FileSystemFileHandle,
            })
            cursor.continue()
          } else {
            resolve(out)
          }
        }
        req.onerror = () => resolve([])
      })
    db.close()

    for (const meta of manifest) {
      const byId = entries.find((e) => e.key === meta.id)
      const bySignature = entries.find(
        (e) => e.key === `${meta.name}::${meta.size}`,
      )
      const entry = byId ?? bySignature
      if (!entry) continue
      const h = entry.handle as FileSystemFileHandle & {
        queryPermission?: (opts: { mode: 'read' }) => Promise<string>
        requestPermission?: (opts: { mode: 'read' }) => Promise<string>
      }
      try {
        let perm = h.queryPermission
          ? await h.queryPermission({ mode: 'read' })
          : 'granted'
        if (perm !== 'granted' && h.requestPermission) {
          perm = await h.requestPermission({ mode: 'read' })
        }
        if (perm === 'granted') {
          const file = await h.getFile()
          result.set(meta.id, file)
        }
      } catch {
        // Ignore inaccessible handle
      }
    }
  } catch {
    // Ignore DB errors
  }
  return result
}

export async function saveFileInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob,
): Promise<boolean> {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch {
    return false
  }
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
