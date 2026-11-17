import { createFileRoute } from '@tanstack/react-router'
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  Film,
  FolderOpen,
  FolderPlus,
  HelpCircle,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Music,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Shield,
  SkipBack,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PerCharColorEditor } from '#/components/editor/PerCharColorEditor'
import { ThumbnailDialog } from '#/components/editor/ThumbnailDialog'
import { Timeline } from '#/components/editor/Timeline'
import { VisualGuideOverlay } from '#/components/editor/VisualGuideOverlay'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Progress } from '#/components/ui/progress'
import { Slider } from '#/components/ui/slider'
import { Switch } from '#/components/ui/switch'
import {
  cacheLocalOnnxModel,
  remixAiSeparatedAudio,
  separateSpeechWithAi,
} from '#/editor/aiMusicRemoval'
import { exportFhdMp4 } from '#/editor/exporter'
import {
  clearAutosaveProject,
  loadAutosaveProject,
  parseProjectJson,
  resolveSavedAssetFiles,
  saveAssetHandle,
  saveAutosaveProject,
  saveBlobWithPicker,
  saveFileInDirectory,
  saveProjectWithHandle,
  serializeProject,
  type ProjectFileV1,
} from '#/editor/projectStorage'
import { drawTextClip } from '#/editor/render'
import {
  findActiveTextClips,
  findActiveVideoClip,
  findFreeTextLayer,
  formatTimecode,
  getProjectDuration,
  getVideoTimelineDuration,
  removeGapsLinked,
  splitClipAtTime,
  splitTextClipAtTime,
  trimClipLeftLinked,
  trimClipRightLinked,
} from '#/editor/timelineOps'
import {
  CANVAS_PRESETS,
  DEFAULT_FPS,
  detectResolutionTag,
  type AspectRatio,
  type MediaAsset,
  type MusicClip,
  type NineGridPosition,
  type SelectionTarget,
  type TextClip,
  type VideoClip,
} from '#/editor/types'
import { useMusicPlayer } from '#/editor/useMusicPlayer'

export const Route = createFileRoute('/editor')({ component: Editor })

const NINE_GRID_POSITIONS: { id: NineGridPosition; label: string }[] = [
  { id: 'top-left', label: '좌상' },
  { id: 'top-center', label: '상' },
  { id: 'top-right', label: '우상' },
  { id: 'middle-left', label: '좌' },
  { id: 'center', label: '중' },
  { id: 'middle-right', label: '우' },
  { id: 'bottom-left', label: '좌하' },
  { id: 'bottom-center', label: '하' },
  { id: 'bottom-right', label: '우하' },
]

// Temporarily hidden from UI until STFT/ONNX inference moves into a Web Worker
const ENABLE_AI_MUSIC_REMOVAL_UI = false

let idCounter = 1
function nextId(prefix: string) {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

function truncateMiddle(name: string, head = 12, tail = 8): string {
  if (name.length <= head + tail + 3) return name
  return `${name.slice(0, head)}...${name.slice(name.length - tail)}`
}

function readVideoMetadata(
  url: string,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    v.onloadedmetadata = () => {
      resolve({
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth || 1920,
        height: v.videoHeight || 1080,
      })
    }
    v.onerror = () => reject(new Error('비디오 메타데이터를 읽을 수 없습니다.'))
  })
}

function readAudioMetadata(url: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const a = document.createElement('audio')
    a.preload = 'metadata'
    a.src = url
    a.onloadedmetadata = () => {
      resolve({ duration: Number.isFinite(a.duration) ? a.duration : 0 })
    }
    a.onerror = () => reject(new Error('오디오 메타데이터를 읽을 수 없습니다.'))
  })
}

const UI_PREFS_STORAGE_KEY = 'myopencut.ui.prefs.v1'

function Editor() {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9')
  const [showSafeZone, setShowSafeZone] = useState(false)
  const [showCenterGuide, setShowCenterGuide] = useState(false)

  const [assets, setAssets] = useState<Record<string, MediaAsset>>({})
  const [videoClips, setVideoClips] = useState<VideoClip[]>([])
  const [textClips, setTextClips] = useState<TextClip[]>([])
  const [musicClip, setMusicClip] = useState<MusicClip | null>(null)

  const [selection, setSelection] = useState<SelectionTarget>(null)
  const [multiSelection, setMultiSelection] = useState<{
    videoIds: string[]
    textIds: string[]
  }>({ videoIds: [], textIds: [] })
  const [videoTrackHidden, setVideoTrackHidden] = useState(false)
  const [hiddenCaptionLayers, setHiddenCaptionLayers] = useState<number[]>([])
  const [musicTrackMuted, setMusicTrackMuted] = useState(false)
  const [audioDb, setAudioDb] = useState<[number, number]>([-60, -60])
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState(
    () => `kremble-${new Date().toISOString().slice(0, 10)}`,
  )
  const [workspaceDirHandle, setWorkspaceDirHandle] =
    useState<FileSystemDirectoryHandle | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const projectFileHandleRef = useRef<FileSystemFileHandle | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [pxPerSec, setPxPerSec] = useState(50)
  const [prefsReady, setPrefsReady] = useState(false)

  interface HistorySnapshot {
    videoClips: VideoClip[]
    textClips: TextClip[]
    musicClip: MusicClip | null
    playhead: number
    selection: SelectionTarget
  }
  const undoStackRef = useRef<HistorySnapshot[]>([])
  const redoStackRef = useRef<HistorySnapshot[]>([])
  const [, setHistoryTick] = useState(0)

  const snapshotNow = useCallback(
    (): HistorySnapshot => ({
      videoClips,
      textClips,
      musicClip,
      playhead,
      selection,
    }),
    [videoClips, textClips, musicClip, playhead, selection],
  )

  const pushHistory = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), snapshotNow()]
    redoStackRef.current = []
    setHistoryTick((t) => t + 1)
  }, [snapshotNow])

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current[undoStackRef.current.length - 1]
    if (!prev) return
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, snapshotNow()]
    setIsPlaying(false)
    setVideoClips(prev.videoClips)
    setTextClips(prev.textClips)
    setMusicClip(prev.musicClip)
    setPlayhead(prev.playhead)
    setSelection(prev.selection)
    setHistoryTick((t) => t + 1)
  }, [snapshotNow])

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current[redoStackRef.current.length - 1]
    if (!next) return
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, snapshotNow()]
    setIsPlaying(false)
    setVideoClips(next.videoClips)
    setTextClips(next.textClips)
    setMusicClip(next.musicClip)
    setPlayhead(next.playhead)
    setSelection(next.selection)
    setHistoryTick((t) => t + 1)
  }, [snapshotNow])

  const [thumbnailOpen, setThumbnailOpen] = useState(false)
  const [exportState, setExportState] = useState<{
    active: boolean
    progress: number
    status: string
    targetRatio: AspectRatio | null
    error: string | null
  }>({
    active: false,
    progress: 0,
    status: '',
    targetRatio: null,
    error: null,
  })
  const exportAbortRef = useRef<AbortController | null>(null)

  const previewStageRef = useRef<HTMLDivElement | null>(null)
  const previewDragRef = useRef<{
    clipId: string
    startX: number
    startY: number
    origOffsetX: number
    origOffsetY: number
    hasMoved: boolean
  } | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const aiAudioElRef = useRef<HTMLAudioElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const audioInputRef = useRef<HTMLInputElement | null>(null)
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const relinkInputRef = useRef<HTMLInputElement | null>(null)
  const onnxInputRef = useRef<HTMLInputElement | null>(null)
  const clipboardRef = useRef<
    | { kind: 'video'; clip: VideoClip }
    | { kind: 'text'; clip: TextClip }
    | {
        kind: 'multi'
        videos: VideoClip[]
        texts: TextClip[]
        baseStart: number
      }
    | null
  >(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [pendingProject, setPendingProject] = useState<ProjectFileV1 | null>(
    null,
  )
  const [pendingIsAutosave, setPendingIsAutosave] = useState(false)
  const [relinkNotice, setRelinkNotice] = useState<string | null>(null)
  const [aiRemovalState, setAiRemovalState] = useState<{
    active: boolean
    clipId: string | null
    progress: number
    status: string
    error: string | null
  }>({
    active: false,
    clipId: null,
    progress: 0,
    status: '',
    error: null,
  })

  // Restore saved UI preferences from localStorage on client mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          aspectRatio: AspectRatio
          showSafeZone: boolean
          showCenterGuide: boolean
          pxPerSec: number
          leftCollapsed: boolean
          rightCollapsed: boolean
        }>
        if (parsed.aspectRatio === '16:9' || parsed.aspectRatio === '9:16') {
          setAspectRatio(parsed.aspectRatio)
        }
        if (typeof parsed.showSafeZone === 'boolean') {
          setShowSafeZone(parsed.showSafeZone)
        }
        if (typeof parsed.showCenterGuide === 'boolean') {
          setShowCenterGuide(parsed.showCenterGuide)
        }
        if (
          typeof parsed.pxPerSec === 'number' &&
          parsed.pxPerSec >= 5 &&
          parsed.pxPerSec <= 240
        ) {
          setPxPerSec(parsed.pxPerSec)
        }
        if (typeof parsed.leftCollapsed === 'boolean') {
          setLeftCollapsed(parsed.leftCollapsed)
        }
        if (typeof parsed.rightCollapsed === 'boolean') {
          setRightCollapsed(parsed.rightCollapsed)
        }
      }
    } catch {
      // Ignore malformed or unavailable localStorage
    } finally {
      setPrefsReady(true)
    }
  }, [])

  // Persist UI preferences whenever they change (only after initial restore commit)
  useEffect(() => {
    if (!prefsReady) return
    try {
      window.localStorage.setItem(
        UI_PREFS_STORAGE_KEY,
        JSON.stringify({
          aspectRatio,
          showSafeZone,
          showCenterGuide,
          pxPerSec,
          leftCollapsed,
          rightCollapsed,
        }),
      )
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }, [
    prefsReady,
    aspectRatio,
    showSafeZone,
    showCenterGuide,
    pxPerSec,
    leftCollapsed,
    rightCollapsed,
  ])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const stage = previewStageRef.current
    if (!stage) return
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
    } else {
      await stage.requestFullscreen().catch(() => {})
    }
  }, [])

  const totalDuration = useMemo(
    () => getProjectDuration(videoClips, textClips),
    [videoClips, textClips],
  )
  const videoDuration = useMemo(
    () => getVideoTimelineDuration(videoClips),
    [videoClips],
  )

  const activeVideoClip = useMemo(
    () => findActiveVideoClip(videoClips, playhead),
    [videoClips, playhead],
  )

  useEffect(() => {
    if (!isPlaying || !activeVideoClip) return
    setSelection((prev) =>
      prev?.kind === 'video' && prev.id === activeVideoClip.id
        ? prev
        : { kind: 'video', id: activeVideoClip.id },
    )
  }, [isPlaying, activeVideoClip])
  const activeTextClips = useMemo(() => {
    const all = findActiveTextClips(textClips, playhead)
    if (hiddenCaptionLayers.length === 0) return all
    const hidden = new Set(hiddenCaptionLayers)
    return all.filter((t) => !hidden.has(t.layer ?? 0))
  }, [textClips, playhead, hiddenCaptionLayers])

  // Music playback with global fade-in/out (respects track mute toggle without mutating clip properties)
  useMusicPlayer({
    isPlaying,
    playhead,
    totalDuration: Math.max(videoDuration, totalDuration),
    musicClip: musicTrackMuted ? null : musicClip,
    assets,
  })

  // Live Stereo dB Meter sampling during playback
  const meterRef = useRef<{
    ctx: AudioContext
    analyserL: AnalyserNode
    analyserR: AnalyserNode
    videoEl: HTMLVideoElement
  } | null>(null)

  useEffect(() => {
    if (!isPlaying) {
      setAudioDb([-60, -60])
      return
    }
    const v = videoElRef.current
    if (!v) return

    let rafId = 0
    const setupAndSample = () => {
      try {
        if (!meterRef.current || meterRef.current.videoEl !== v) {
          const cap = (
            v as HTMLVideoElement & { captureStream?: () => MediaStream }
          ).captureStream?.()
          if (cap && cap.getAudioTracks().length > 0) {
            const ctx = new AudioContext()
            const src = ctx.createMediaStreamSource(cap)
            const splitter = ctx.createChannelSplitter(2)
            const analyserL = ctx.createAnalyser()
            const analyserR = ctx.createAnalyser()
            analyserL.fftSize = 256
            analyserR.fftSize = 256
            src.connect(splitter)
            splitter.connect(analyserL, 0)
            splitter.connect(analyserR, cap.getAudioTracks().length > 0 ? 1 : 0)
            meterRef.current = { ctx, analyserL, analyserR, videoEl: v }
          }
        }
      } catch {
        // Fallback to approximate meter if captureStream isn't supported
      }

      const bufL = new Float32Array(256)
      const bufR = new Float32Array(256)
      const poll = () => {
        const m = meterRef.current
        if (m && m.analyserL && m.analyserR) {
          if (m.ctx.state === 'suspended') {
            void m.ctx.resume().catch(() => {})
          }
          m.analyserL.getFloatTimeDomainData(bufL)
          m.analyserR.getFloatTimeDomainData(bufR)
          let sumL = 0
          let sumR = 0
          for (let i = 0; i < bufL.length; i++) {
            sumL += bufL[i] * bufL[i]
            sumR += bufR[i] * bufR[i]
          }
          const rmsL = Math.sqrt(sumL / bufL.length)
          const rmsR = Math.sqrt(sumR / bufR.length)
          const dbL = rmsL > 1e-4 ? Math.max(-60, 20 * Math.log10(rmsL)) : -60
          const dbR = rmsR > 1e-4 ? Math.max(-60, 20 * Math.log10(rmsR)) : -60
          setAudioDb([dbL, dbR])
        } else if (
          activeVideoClip &&
          !activeVideoClip.muted &&
          activeVideoClip.volume > 0
        ) {
          const baseDb = 20 * Math.log10(Math.max(0.01, activeVideoClip.volume)) - 14
          setAudioDb([baseDb, baseDb])
        } else {
          setAudioDb([-60, -60])
        }
        rafId = requestAnimationFrame(poll)
      }
      rafId = requestAnimationFrame(poll)
    }

    setupAndSample()
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, activeVideoClip])

  const activeAssetUrl = activeVideoClip
    ? assets[activeVideoClip.assetId]?.url ?? ''
    : ''

  // Sync hidden video element source, mute, and seek position
  useEffect(() => {
    const v = videoElRef.current
    if (!v) return
    if (!activeAssetUrl) {
      v.pause()
      return
    }
    if (v.getAttribute('data-url') !== activeAssetUrl) {
      v.setAttribute('data-url', activeAssetUrl)
      v.src = activeAssetUrl
      v.load()
    }
    if (activeVideoClip) {
      const usingAiAudio = Boolean(
        activeVideoClip.useAiCleanAudio && activeVideoClip.aiCleanAudioUrl,
      )
      v.muted = activeVideoClip.muted || usingAiAudio
      v.volume = Math.max(0, Math.min(1, activeVideoClip.volume))
      const targetSourceTime =
        activeVideoClip.sourceStart +
        Math.max(0, playhead - activeVideoClip.timelineStart)
      if (!isPlaying && Math.abs(v.currentTime - targetSourceTime) > 0.03) {
        v.currentTime = targetSourceTime
      }
    }
  }, [activeAssetUrl, activeVideoClip, playhead, isPlaying])

  // Sync AI-separated speech audio element during live preview
  useEffect(() => {
    if (typeof Audio === 'undefined') return
    if (!aiAudioElRef.current) {
      aiAudioElRef.current = new Audio()
    }
    const audio = aiAudioElRef.current
    const aiUrl =
      activeVideoClip?.useAiCleanAudio &&
      !activeVideoClip.muted &&
      activeVideoClip.aiCleanAudioUrl
        ? activeVideoClip.aiCleanAudioUrl
        : ''

    if (!aiUrl || !activeVideoClip) {
      if (!audio.paused) audio.pause()
      return
    }

    if (audio.getAttribute('data-url') !== aiUrl) {
      audio.setAttribute('data-url', aiUrl)
      audio.src = aiUrl
      audio.load()
    }
    audio.volume = Math.max(0, Math.min(1, activeVideoClip.volume))

    const targetTime =
      activeVideoClip.sourceStart +
      Math.max(0, playhead - activeVideoClip.timelineStart)

    if (isPlaying) {
      if (Math.abs(audio.currentTime - targetTime) > 0.2) {
        audio.currentTime = targetTime
      }
      if (audio.paused) {
        void audio.play().catch(() => {})
      }
    } else {
      if (!audio.paused) audio.pause()
      if (Math.abs(audio.currentTime - targetTime) > 0.05) {
        audio.currentTime = targetTime
      }
    }
  }, [activeVideoClip, playhead, isPlaying])

  // Load IndexedDB autosave on mount & auto-resolve saved file handles
  useEffect(() => {
    document.title = 'Kremble Cut | Phase8'
    let cancelled = false
    void loadAutosaveProject().then(async (saved) => {
      if (cancelled) return
      if (
        !saved ||
        (saved.videoClips.length === 0 &&
          saved.textClips.length === 0 &&
          !saved.musicClip)
      ) {
        setWelcomeOpen(true)
        return
      }
      const resolved = await resolveSavedAssetFiles(saved.assets)
      if (cancelled) return
      if (resolved.size >= saved.assets.length && saved.assets.length > 0) {
        applyRestoredProject(saved, resolved, false)
        return
      }
      setPendingProject(saved)
      setPendingIsAutosave(true)
      setWelcomeOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep latest serialized snapshot in a ref for the 5-minute workspace file autosave timer
  const latestSnapshotRef = useRef<ProjectFileV1 | null>(null)
  useEffect(() => {
    latestSnapshotRef.current = serializeProject({
      aspectRatio,
      playhead,
      assets,
      videoClips,
      textClips,
      musicClip,
    })
  }, [aspectRatio, playhead, assets, videoClips, textClips, musicClip])

  // Auto-save project file every 5 minutes when a project file handle is configured
  useEffect(() => {
    const timer = window.setInterval(() => {
      const handle = projectFileHandleRef.current
      const snapshot = latestSnapshotRef.current
      if (!handle || !snapshot) return
      void saveProjectWithHandle(snapshot, handle, false).then((res) => {
        if (res.saved) {
          setSaveFeedback('5분 자동 저장됨')
          window.setTimeout(() => setSaveFeedback(null), 2000)
        }
      })
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Debounced IndexedDB autosave whenever project state changes
  useEffect(() => {
    if (!prefsReady) return
    if (
      videoClips.length === 0 &&
      textClips.length === 0 &&
      !musicClip &&
      Object.keys(assets).length === 0
    ) {
      return
    }
    const timer = window.setTimeout(() => {
      const snapshot = serializeProject({
        aspectRatio,
        playhead,
        assets,
        videoClips,
        textClips,
        musicClip,
      })
      void saveAutosaveProject(snapshot)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [prefsReady, aspectRatio, playhead, assets, videoClips, textClips, musicClip])

  const applyRestoredProject = useCallback(
    (project: ProjectFileV1, fileMap: Map<string, File>, allowPartial = false) => {
      const nextAssets: Record<string, MediaAsset> = {}
      const missingNames: string[] = []

      for (const meta of project.assets) {
        const existing =
          assets[meta.id] ??
          Object.values(assets).find(
            (a) => a.name === meta.name && a.kind === meta.kind,
          )
        const matchedFile = fileMap.get(meta.id)
        if (matchedFile) {
          nextAssets[meta.id] = {
            id: meta.id,
            name: meta.name,
            kind: meta.kind,
            url: URL.createObjectURL(matchedFile),
            file: matchedFile,
            duration: meta.duration,
            width: meta.width,
            height: meta.height,
            resolutionTag:
              meta.kind === 'audio'
                ? 'AUDIO'
                : meta.height >= 2160
                  ? '4K'
                  : meta.height >= 1440
                    ? '2.7K'
                    : meta.height >= 1080
                      ? 'FHD'
                      : `${meta.height}p`,
          }
        } else if (existing) {
          nextAssets[meta.id] = { ...existing, id: meta.id }
        } else {
          missingNames.push(meta.name)
        }
      }

      if (missingNames.length > 0 && !allowPartial) {
        setPendingProject(project)
        setRelinkNotice(
          `원본 파일 ${missingNames.length}개(${missingNames.slice(0, 3).join(', ')}${missingNames.length > 3 ? ' 등' : ''})를 선택해 연결하세요.`,
        )
        return false
      }

      const validAssetIds = new Set(Object.keys(nextAssets))
      setAspectRatio(project.aspectRatio)
      setAssets(nextAssets)
      setVideoClips(
        project.videoClips.filter((c) => validAssetIds.has(c.assetId)),
      )
      setTextClips(project.textClips)
      setMusicClip(
        project.musicClip && validAssetIds.has(project.musicClip.assetId)
          ? project.musicClip
          : null,
      )
      setPlayhead(project.playhead ?? 0)
      setSelection(null)
      setPendingProject(null)
      setPendingIsAutosave(false)
      setRelinkNotice(null)
      return true
    },
    [assets],
  )

  const handleStartNewProject = useCallback(async () => {
    const rawName = newProjectName.trim() || `kremble-${new Date().toISOString().slice(0, 10)}`
    const fileName = rawName.endsWith('.json')
      ? rawName
      : `${rawName}.kremble.json`

    const win = window as Window & {
      showDirectoryPicker?: (opts?: {
        mode?: 'read' | 'readwrite'
      }) => Promise<FileSystemDirectoryHandle>
    }

    const emptyProject = serializeProject({
      aspectRatio,
      playhead: 0,
      assets: {},
      videoClips: [],
      textClips: [],
      musicClip: null,
    })

    if (typeof win.showDirectoryPicker === 'function') {
      try {
        const dirHandle = await win.showDirectoryPicker({ mode: 'readwrite' })
        const fileHandle = await dirHandle.getFileHandle(fileName, {
          create: true,
        })
        const writable = await fileHandle.createWritable()
        await writable.write(
          new Blob([JSON.stringify(emptyProject, null, 2)], {
            type: 'application/json',
          }),
        )
        await writable.close()
        setWorkspaceDirHandle(dirHandle)
        projectFileHandleRef.current = fileHandle
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    } else {
      const res = await saveProjectWithHandle(emptyProject, null, true)
      if (res.cancelled) return
      projectFileHandleRef.current = res.handle
    }

    setAssets({})
    setVideoClips([])
    setTextClips([])
    setMusicClip(null)
    setSelection(null)
    setMultiSelection({ videoIds: [], textIds: [] })
    setPlayhead(0)
    setPendingProject(null)
    setPendingIsAutosave(false)
    setRelinkNotice(null)
    void clearAutosaveProject()
    setWelcomeOpen(false)
    setSaveFeedback(`새 프로젝트 시작 (${fileName})`)
    window.setTimeout(() => setSaveFeedback(null), 2500)
  }, [newProjectName, aspectRatio])

  const handleSaveProject = useCallback(
    async (forceSaveAs = false) => {
      const project = serializeProject({
        aspectRatio,
        playhead,
        assets,
        videoClips,
        textClips,
        musicClip,
      })
      const res = await saveProjectWithHandle(
        project,
        projectFileHandleRef.current,
        forceSaveAs,
      )
      if (res.handle) {
        projectFileHandleRef.current = res.handle
      }
      if (res.saved) {
        setSaveFeedback('저장됨')
        window.setTimeout(() => setSaveFeedback(null), 1800)
      }
    },
    [aspectRatio, playhead, assets, videoClips, textClips, musicClip],
  )

  const handleImportProjectFile = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      try {
        const raw = await file.text()
        const parsed = parseProjectJson(raw)
        setPendingIsAutosave(false)
        const resolved = await resolveSavedAssetFiles(parsed.assets)
        applyRestoredProject(parsed, resolved, false)
      } catch (err) {
        setRelinkNotice(
          `프로젝트 파일을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
    [applyRestoredProject],
  )

  const handleRelinkFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !pendingProject) return
      const list = Array.from(files)
      const fileMap = new Map<string, File>()
      for (const meta of pendingProject.assets) {
        const exact = list.find(
          (f) => f.name === meta.name && (meta.size ? f.size === meta.size : true),
        )
        const byName = exact ?? list.find((f) => f.name === meta.name)
        if (byName) fileMap.set(meta.id, byName)
      }
      applyRestoredProject(pendingProject, fileMap, false)
    },
    [pendingProject, applyRestoredProject],
  )

  const handleRunAiMusicRemoval = useCallback(
    async (clip: VideoClip) => {
      const asset = assets[clip.assetId]
      if (!asset || aiRemovalState.active) return
      setAiRemovalState({
        active: true,
        clipId: clip.id,
        progress: 2,
        status: 'AI 모델 준비 중...',
        error: null,
      })
      try {
        const transientPreserve = clip.aiTransientPreserve ?? 0.75
        const ambienceBlend = clip.aiAmbienceBlend ?? 0
        const cleanUrl = await separateSpeechWithAi(
          asset.url,
          (pct, msg) => {
            setAiRemovalState((prev) => ({
              ...prev,
              progress: pct <= 1 ? Math.round(pct * 100) : Math.round(pct),
              status: msg,
            }))
          },
          { transientPreserve, ambienceBlend },
        )
        setVideoClips((prev) =>
          prev.map((c) => {
            if (c.assetId !== clip.assetId) return c
            return {
              ...c,
              aiCleanAudioUrl: cleanUrl,
              useAiCleanAudio: true,
              aiTransientPreserve: c.aiTransientPreserve ?? transientPreserve,
              aiAmbienceBlend: c.aiAmbienceBlend ?? ambienceBlend,
            }
          }),
        )
        setAiRemovalState({
          active: false,
          clipId: null,
          progress: 100,
          status: '완료',
          error: null,
        })
      } catch (err) {
        setAiRemovalState({
          active: false,
          clipId: clip.id,
          progress: 0,
          status: '',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [assets, aiRemovalState.active],
  )

  // Render transparent overlay canvas (captions & safe-zone) while hardware <video> renders footage
  const drawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    const previewW = aspectRatio === '16:9' ? 960 : 540
    const previewH = aspectRatio === '16:9' ? 540 : 960
    if (canvas.width !== previewW || canvas.height !== previewH) {
      canvas.width = previewW
      canvas.height = previewH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, previewW, previewH)

    for (const textClip of activeTextClips) {
      drawTextClip(ctx, previewW, previewH, textClip, playhead)
    }
  }, [aspectRatio, activeTextClips, playhead])

  const drawPreviewRef = useRef(drawPreview)
  drawPreviewRef.current = drawPreview

  const activeVideoClipRef = useRef(activeVideoClip)
  activeVideoClipRef.current = activeVideoClip

  const totalDurationRef = useRef(totalDuration)
  totalDurationRef.current = totalDuration

  useEffect(() => {
    drawPreview()
  }, [drawPreview, playhead])

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      videoElRef.current?.pause()
      return
    }

    let rafId = 0
    let lastTs = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000)
      lastTs = now

      const v = videoElRef.current
      const clip = activeVideoClipRef.current
      const total = totalDurationRef.current

      if (v && clip && activeAssetUrl && v.paused && v.readyState >= 2) {
        void v.play().catch(() => {})
      }

      setPlayhead((prev) => {
        const next = prev + dt
        if (total > 0 && next >= total) {
          v?.pause()
          setIsPlaying(false)
          return total
        }
        return next
      })

      drawPreviewRef.current()
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, activeAssetUrl])

  // Keep video element in sync when a clip transition occurs mid-playback
  useEffect(() => {
    const v = videoElRef.current
    if (!v || !isPlaying || !activeVideoClip) return
    const expected =
      activeVideoClip.sourceStart + (playhead - activeVideoClip.timelineStart)
    if (Math.abs(v.currentTime - expected) > 0.25) {
      v.currentTime = expected
    }
  }, [activeVideoClip?.id, isPlaying])

  const appendVideoAssetToTimeline = useCallback(
    (asset: MediaAsset, targetRatio: AspectRatio) => {
      const clipId = nextId('vclip')
      setVideoClips((prev) => {
        const start = getVideoTimelineDuration(prev)
        const newClip: VideoClip = {
          id: clipId,
          assetId: asset.id,
          name: asset.name,
          timelineStart: start,
          duration: asset.duration || 5,
          sourceStart: 0,
          sourceDuration: asset.duration || 5,
          fitMode: targetRatio === '9:16' ? 'cover' : 'contain',
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          volume: 1,
          muted: false,
        }
        return [...prev, newClip]
      })
      setSelection({ kind: 'video', id: clipId })
    },
    [],
  )

  const handleImportVideos = async (
    files: FileList | File[] | null,
    handles?: FileSystemFileHandle[],
  ) => {
    if (!files || files.length === 0) return
    const wasEmptyProject = videoClips.length === 0 && textClips.length === 0
    const list = Array.from(files)
    let createdDefaultCaptions = false

    for (let idx = 0; idx < list.length; idx++) {
      const file = list[idx]
      const url = URL.createObjectURL(file)
      try {
        const meta = await readVideoMetadata(url)
        const asset: MediaAsset = {
          id: nextId('asset'),
          name: file.name,
          kind: 'video',
          url,
          file,
          duration: meta.duration,
          width: meta.width,
          height: meta.height,
          resolutionTag: detectResolutionTag(meta.width, meta.height),
        }
        if (handles?.[idx]) {
          void saveAssetHandle(asset.id, handles[idx])
          void saveAssetHandle(`${file.name}::${file.size}`, handles[idx])
        }
        setAssets((prev) => ({ ...prev, [asset.id]: asset }))
        appendVideoAssetToTimeline(asset, aspectRatio)

        // When starting a brand new project, create 3 default 10s captions:
        // Layer 0 (캡션 1): 전체화면 텍스트 (10s)
        // Layer 1 (캡션 2): 하단 가운데 정렬 기본 (10s)
        // Layer 2 (캡션 3): 상단 오른쪽 정렬 기본 (10s)
        if (wasEmptyProject && !createdDefaultCaptions) {
          createdDefaultCaptions = true
          const fullSize = aspectRatio === '9:16' ? 140 : 180
          const bottomY = aspectRatio === '9:16' ? 0.76 : 0.86
          const topY = aspectRatio === '9:16' ? 0.16 : 0.13
          const rightX = aspectRatio === '9:16' ? 0.86 : 0.92
          const defaultCaptions: TextClip[] = [
            {
              id: nextId('text'),
              text: '전체화면 텍스트',
              defaultColor: '#FFFFFF',
              charColors: {},
              fontSize: fullSize,
              fontWeight: 800,
              strokeColor: '#000000',
              strokeWidth: Number((fullSize * 0.1).toFixed(1)),
              backgroundColor: '',
              timelineStart: 0,
              duration: 10,
              layer: 0,
              x: 0.5,
              y: 0.5,
              align: 'center',
              isDynamic: true,
              transition: 'shrink',
              transitionDuration: 0.35,
              transitionStartPos: 'center',
              transitionEndPos: 'center',
              transitionEndBehavior: 'stay',
            },
            {
              id: nextId('text'),
              text: '캡션을 입력하세요',
              defaultColor: '#FFFFFF',
              charColors: {},
              fontSize: 64,
              fontWeight: 700,
              strokeColor: '#000000',
              strokeWidth: 6.4,
              backgroundColor: '',
              timelineStart: 0,
              duration: 10,
              layer: 1,
              x: 0.5,
              y: bottomY,
              align: 'center',
              transition: 'none',
            },
            {
              id: nextId('text'),
              text: '상단 캡션',
              defaultColor: '#FFFFFF',
              charColors: {},
              fontSize: 64,
              fontWeight: 700,
              strokeColor: '#000000',
              strokeWidth: 6.4,
              backgroundColor: '',
              timelineStart: 0,
              duration: 10,
              layer: 2,
              x: rightX,
              y: topY,
              align: 'right',
              transition: 'none',
            },
          ]
          setTextClips(defaultCaptions)
        }
      } catch {
        URL.revokeObjectURL(url)
      }
    }
  }

  const pickVideosWithHandles = async () => {
    const win = window as Window & {
      showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>
    }
    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const handles = await win.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: '비디오 파일',
              accept: {
                'video/*': ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'],
              },
            },
          ],
        })
        const files = await Promise.all(handles.map((h) => h.getFile()))
        await handleImportVideos(files, handles)
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    }
    videoInputRef.current?.click()
  }

  const handleImportMusic = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const url = URL.createObjectURL(file)
    try {
      const meta = await readAudioMetadata(url)
      const asset: MediaAsset = {
        id: nextId('music-asset'),
        name: file.name,
        kind: 'audio',
        url,
        file,
        duration: meta.duration,
        width: 0,
        height: 0,
        resolutionTag: 'Audio',
      }
      setAssets((prev) => ({ ...prev, [asset.id]: asset }))
      const mId = nextId('music')
      setMusicClip({
        id: mId,
        assetId: asset.id,
        name: file.name,
        sourceDuration: meta.duration,
        volume: 0.8,
        fadeInSec: 1,
        fadeOutSec: 1,
        loop: true,
        enabled: true,
      })
      setSelection({ kind: 'music', id: mId })
    } catch {
      URL.revokeObjectURL(url)
    }
  }

  const handleSwitchAspectRatio = (nextRatio: AspectRatio) => {
    setAspectRatio(nextRatio)
    setVideoClips((prev) =>
      prev.map((c) => ({
        ...c,
        fitMode: nextRatio === '9:16' ? 'cover' : 'contain',
      })),
    )
  }

  // Timeline operations
  const selectedVideoClip =
    selection?.kind === 'video'
      ? videoClips.find((c) => c.id === selection.id) ?? null
      : null

  const selectedTextClip =
    selection?.kind === 'text'
      ? textClips.find((t) => t.id === selection.id) ?? null
      : null

  const handleTrimLeft = useCallback(() => {
    if (selection?.kind === 'text') {
      const target = textClips.find((t) => t.id === selection.id)
      if (!target) return
      const tEnd = target.timelineStart + target.duration
      if (playhead <= target.timelineStart || playhead >= tEnd - 0.1) return
      pushHistory()
      setTextClips((prev) =>
        prev.map((t) =>
          t.id === selection.id
            ? { ...t, timelineStart: playhead, duration: tEnd - playhead }
            : t,
        ),
      )
      return
    }
    if (selection?.kind !== 'video') return
    const res = trimClipLeftLinked(videoClips, textClips, selection.id, playhead)
    if (res.nextPlayhead === null) return
    pushHistory()
    setVideoClips(res.clips)
    setTextClips(res.texts)
    setPlayhead(res.nextPlayhead)
  }, [selection, playhead, videoClips, textClips, pushHistory])

  const handleTrimRight = useCallback(() => {
    if (selection?.kind === 'text') {
      const target = textClips.find((t) => t.id === selection.id)
      if (!target) return
      const tEnd = target.timelineStart + target.duration
      if (playhead >= tEnd || playhead <= target.timelineStart + 0.1) return
      pushHistory()
      setTextClips((prev) =>
        prev.map((t) =>
          t.id === selection.id
            ? { ...t, duration: playhead - target.timelineStart }
            : t,
        ),
      )
      return
    }
    if (selection?.kind !== 'video') return
    const res = trimClipRightLinked(
      videoClips,
      textClips,
      selection.id,
      playhead,
    )
    if (res.clips === videoClips) return
    pushHistory()
    setVideoClips(res.clips)
    setTextClips(res.texts)
  }, [selection, playhead, videoClips, textClips, pushHistory])

  const handleSplit = useCallback(() => {
    if (selection?.kind === 'text') {
      const res = splitTextClipAtTime(textClips, selection.id, playhead, () =>
        nextId('text'),
      )
      if (!res.rightId) return
      pushHistory()
      setTextClips(res.texts)
      setSelection({ kind: 'text', id: res.rightId })
      return
    }
    const targetVideoId =
      selection?.kind === 'video' ? selection.id : activeVideoClip?.id
    if (!targetVideoId) return
    const res = splitClipAtTime(videoClips, targetVideoId, playhead, () =>
      nextId('vclip'),
    )
    if (!res.rightId) return
    pushHistory()
    setVideoClips(res.clips)
    // Also split any text clips overlapping playhead
    let nextTexts = textClips
    for (const t of textClips) {
      if (
        playhead > t.timelineStart + 0.1 &&
        playhead < t.timelineStart + t.duration - 0.1
      ) {
        nextTexts = splitTextClipAtTime(nextTexts, t.id, playhead, () =>
          nextId('text'),
        ).texts
      }
    }
    setTextClips(nextTexts)
    setSelection({ kind: 'video', id: res.rightId })
  }, [selection, activeVideoClip, playhead, videoClips, textClips, pushHistory])

  const handleRemoveGaps = useCallback(() => {
    if (videoClips.length === 0) return
    pushHistory()
    const res = removeGapsLinked(videoClips, textClips)
    setVideoClips(res.clips)
    setTextClips(res.texts)
  }, [videoClips, textClips, pushHistory])

  const handleCopySelected = useCallback(() => {
    const multiCount =
      multiSelection.videoIds.length + multiSelection.textIds.length
    if (multiCount > 1) {
      const videos = videoClips
        .filter((c) => multiSelection.videoIds.includes(c.id))
        .map((c) => ({ ...c }))
      const texts = textClips
        .filter((t) => multiSelection.textIds.includes(t.id))
        .map((t) => ({ ...t, charColors: { ...t.charColors } }))
      const allStarts = [
        ...videos.map((v) => v.timelineStart),
        ...texts.map((t) => t.timelineStart),
      ]
      const baseStart = allStarts.length > 0 ? Math.min(...allStarts) : 0
      clipboardRef.current = { kind: 'multi', videos, texts, baseStart }
      return
    }
    if (selection?.kind === 'video') {
      const found = videoClips.find((c) => c.id === selection.id)
      if (found) clipboardRef.current = { kind: 'video', clip: { ...found } }
    } else if (selection?.kind === 'text') {
      const found = textClips.find((t) => t.id === selection.id)
      if (found) {
        clipboardRef.current = {
          kind: 'text',
          clip: { ...found, charColors: { ...found.charColors } },
        }
      }
    }
  }, [selection, multiSelection, videoClips, textClips])

  const handlePasteAtPlayhead = useCallback(() => {
    const copied = clipboardRef.current
    if (!copied) return
    pushHistory()
    if (copied.kind === 'multi') {
      const newVideoIds: string[] = []
      const newTextIds: string[] = []
      const addedVideos: VideoClip[] = copied.videos.map((v) => {
        const id = nextId('vclip')
        newVideoIds.push(id)
        return {
          ...v,
          id,
          timelineStart: Math.max(0, playhead + (v.timelineStart - copied.baseStart)),
        }
      })
      const workingTexts = [...textClips]
      const addedTexts: TextClip[] = copied.texts.map((t) => {
        const id = nextId('text')
        newTextIds.push(id)
        const start = Math.max(0, playhead + (t.timelineStart - copied.baseStart))
        const layer = findFreeTextLayer(workingTexts, start, t.duration)
        const cloned: TextClip = {
          ...t,
          id,
          timelineStart: start,
          layer,
          charColors: { ...t.charColors },
        }
        workingTexts.push(cloned)
        return cloned
      })
      if (addedVideos.length > 0) {
        setVideoClips((prev) => [...prev, ...addedVideos])
      }
      if (addedTexts.length > 0) {
        setTextClips((prev) => [...prev, ...addedTexts])
      }
      setSelection(null)
      setMultiSelection({ videoIds: newVideoIds, textIds: newTextIds })
      return
    }
    if (copied.kind === 'video') {
      const id = nextId('vclip')
      const cloned: VideoClip = {
        ...copied.clip,
        id,
        timelineStart: playhead,
      }
      setVideoClips((prev) => [...prev, cloned])
      setSelection({ kind: 'video', id })
      setMultiSelection({ videoIds: [], textIds: [] })
    } else {
      const id = nextId('text')
      const layer = findFreeTextLayer(
        textClips,
        playhead,
        copied.clip.duration,
      )
      const cloned: TextClip = {
        ...copied.clip,
        id,
        timelineStart: playhead,
        layer,
        charColors: { ...copied.clip.charColors },
      }
      setTextClips((prev) => [...prev, cloned])
      setSelection({ kind: 'text', id })
      setMultiSelection({ videoIds: [], textIds: [] })
    }
  }, [playhead, textClips, pushHistory])

  const handleDuplicateVideoClip = useCallback(
    (id: string): string | null => {
      const src = videoClips.find((c) => c.id === id)
      if (!src) return null
      const newId = nextId('vclip')
      setVideoClips((prev) => [...prev, { ...src, id: newId }])
      return newId
    },
    [videoClips],
  )

  const handleDuplicateTextClip = useCallback(
    (id: string): string | null => {
      const src = textClips.find((t) => t.id === id)
      if (!src) return null
      const newId = nextId('text')
      setTextClips((prev) => [
        ...prev,
        { ...src, id: newId, charColors: { ...src.charColors } },
      ])
      return newId
    },
    [textClips],
  )

  const handleAddText = useCallback(() => {
    pushHistory()
    const id = nextId('text')
    const timelineStart = activeVideoClip ? activeVideoClip.timelineStart : playhead
    const duration = activeVideoClip ? activeVideoClip.duration : 3
    const layer = findFreeTextLayer(textClips, timelineStart, duration)
    const bottomY = aspectRatio === '9:16' ? 0.76 : 0.86
    const topY = aspectRatio === '9:16' ? 0.16 : 0.13
    const newText: TextClip = {
      id,
      text: '캡션을 입력하세요',
      defaultColor: '#FFFFFF',
      charColors: {},
      fontSize: 64,
      fontWeight: 700,
      strokeColor: '#000000',
      strokeWidth: 6.4,
      backgroundColor: '',
      timelineStart,
      duration,
      layer,
      x: 0.5,
      y: Math.max(topY, bottomY - layer * 0.14),
      align: 'center',
      transition: 'none',
    }
    setTextClips((prev) => [...prev, newText])
    setSelection({ kind: 'text', id })
    setMultiSelection({ videoIds: [], textIds: [] })
  }, [playhead, activeVideoClip, textClips, aspectRatio, pushHistory])

  const handleAddDynamicText = useCallback(() => {
    pushHistory()
    const id = nextId('text')
    const timelineStart = activeVideoClip ? activeVideoClip.timelineStart : playhead
    const duration = activeVideoClip ? activeVideoClip.duration : 3
    const layer = findFreeTextLayer(textClips, timelineStart, duration)
    const defaultSize = aspectRatio === '9:16' ? 140 : 180
    const newText: TextClip = {
      id,
      text: '전체화면 텍스트',
      defaultColor: '#FFFFFF',
      charColors: {},
      fontSize: defaultSize,
      fontWeight: 800,
      strokeColor: '#000000',
      strokeWidth: Number((defaultSize * 0.1).toFixed(1)),
      backgroundColor: '',
      timelineStart,
      duration,
      layer,
      x: 0.5,
      y: 0.5,
      align: 'center',
      isDynamic: true,
      transition: 'shrink',
      transitionDuration: 0.35,
      transitionStartPos: 'center',
      transitionEndPos: 'center',
      transitionEndBehavior: 'stay',
    }
    setTextClips((prev) => [...prev, newText])
    setSelection({ kind: 'text', id })
    setMultiSelection({ videoIds: [], textIds: [] })
  }, [playhead, activeVideoClip, textClips, aspectRatio, pushHistory])

  const handleMarqueeSelect = useCallback(
    (sel: { videoIds: string[]; textIds: string[] }) => {
      setMultiSelection(sel)
      const total = sel.videoIds.length + sel.textIds.length
      if (total === 1) {
        if (sel.videoIds.length === 1) {
          setSelection({ kind: 'video', id: sel.videoIds[0] })
        } else {
          setSelection({ kind: 'text', id: sel.textIds[0] })
        }
      } else {
        setSelection(null)
      }
    },
    [],
  )

  const handleToggleMultiSelect = useCallback(
    (target: { kind: 'video' | 'text'; id: string }) => {
      setMultiSelection((prev) => {
        const videoSet = new Set(prev.videoIds)
        const textSet = new Set(prev.textIds)
        if (videoSet.size + textSet.size === 0 && selection) {
          if (selection.kind === 'video') videoSet.add(selection.id)
          if (selection.kind === 'text') textSet.add(selection.id)
        }
        if (target.kind === 'video') {
          if (videoSet.has(target.id)) videoSet.delete(target.id)
          else videoSet.add(target.id)
        } else {
          if (textSet.has(target.id)) textSet.delete(target.id)
          else textSet.add(target.id)
        }
        const next = {
          videoIds: Array.from(videoSet),
          textIds: Array.from(textSet),
        }
        const total = next.videoIds.length + next.textIds.length
        if (total === 1) {
          setSelection(
            next.videoIds.length === 1
              ? { kind: 'video', id: next.videoIds[0] }
              : { kind: 'text', id: next.textIds[0] },
          )
        } else {
          setSelection(null)
        }
        return next
      })
    },
    [selection],
  )

  const handleMoveMultiClips = useCallback(
    (stepDelta: number) => {
      if (Math.abs(stepDelta) < 1e-6) return
      const vSet = new Set(multiSelection.videoIds)
      const tSet = new Set(multiSelection.textIds)
      if (vSet.size > 0) {
        setVideoClips((prev) =>
          prev.map((c) =>
            vSet.has(c.id)
              ? { ...c, timelineStart: Math.max(0, c.timelineStart + stepDelta) }
              : c,
          ),
        )
      }
      if (tSet.size > 0) {
        setTextClips((prev) =>
          prev.map((t) =>
            tSet.has(t.id)
              ? { ...t, timelineStart: Math.max(0, t.timelineStart + stepDelta) }
              : t,
          ),
        )
      }
    },
    [multiSelection],
  )

  const handleDeleteSelected = useCallback(() => {
    const multiTotal =
      multiSelection.videoIds.length + multiSelection.textIds.length
    if (multiTotal > 0) {
      pushHistory()
      const vSet = new Set(multiSelection.videoIds)
      const tSet = new Set(multiSelection.textIds)
      if (vSet.size > 0) {
        setVideoClips((prev) => prev.filter((c) => !vSet.has(c.id)))
      }
      if (tSet.size > 0) {
        setTextClips((prev) => prev.filter((t) => !tSet.has(t.id)))
      }
      setMultiSelection({ videoIds: [], textIds: [] })
      setSelection(null)
      return
    }
    if (!selection) return
    pushHistory()
    if (selection.kind === 'video') {
      setVideoClips((prev) => prev.filter((c) => c.id !== selection.id))
    } else if (selection.kind === 'text') {
      setTextClips((prev) => prev.filter((t) => t.id !== selection.id))
    } else if (selection.kind === 'music') {
      setMusicClip(null)
    }
    setSelection(null)
  }, [selection, multiSelection, pushHistory])

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
      videoElRef.current?.pause()
      return
    }
    if (totalDuration <= 0) return
    if (playhead >= totalDuration - 0.02) {
      setPlayhead(0)
      const firstClip = [...videoClips].sort(
        (a, b) => a.timelineStart - b.timelineStart,
      )[0]
      if (firstClip && videoElRef.current) {
        const firstUrl = assets[firstClip.assetId]?.url ?? ''
        if (firstUrl) {
          if (videoElRef.current.getAttribute('data-url') !== firstUrl) {
            videoElRef.current.setAttribute('data-url', firstUrl)
            videoElRef.current.src = firstUrl
            videoElRef.current.load()
          }
          videoElRef.current.currentTime = firstClip.sourceStart
        }
      }
    }
    const v = videoElRef.current
    if (v && v.readyState >= 2) {
      void v.play().catch(() => {})
    }
    setIsPlaying(true)
  }, [isPlaying, totalDuration, playhead, videoClips, assets])

  // Keyboard shortcuts (Premiere Pro compatible)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const mod = e.ctrlKey || e.metaKey

      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if ((e.key === 'z' || e.key === 'Z') && mod) {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      } else if ((e.key === 'y' || e.key === 'Y') && mod) {
        e.preventDefault()
        handleRedo()
      } else if ((e.key === 'c' || e.key === 'C') && mod) {
        e.preventDefault()
        handleCopySelected()
      } else if ((e.key === 'v' || e.key === 'V') && mod) {
        e.preventDefault()
        handlePasteAtPlayhead()
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        if (mod) {
          handleSplit()
        } else {
          setIsPlaying(false)
          videoElRef.current?.pause()
        }
      } else if (e.key === 'l' || e.key === 'L') {
        if (!mod) {
          e.preventDefault()
          if (!isPlaying) togglePlay()
        }
      } else if (e.key === 'q' || e.key === 'Q' || e.key === '[') {
        e.preventDefault()
        handleTrimLeft()
      } else if (e.key === 'w' || e.key === 'W' || e.key === ']') {
        e.preventDefault()
        handleTrimRight()
      } else if (e.key === 's' || e.key === 'S') {
        if (!mod) {
          e.preventDefault()
          handleSplit()
        }
      } else if (e.key === 't' || e.key === 'T') {
        if (!mod) {
          e.preventDefault()
          handleAddText()
        }
      } else if ((e.key === 'm' || e.key === 'M') && mod) {
        e.preventDefault()
        void handleExport(aspectRatio)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteSelected()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIsPlaying(false)
        const step = e.shiftKey ? 5 / DEFAULT_FPS : 1 / DEFAULT_FPS
        setPlayhead((p) => Math.max(0, p - step))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIsPlaying(false)
        const step = e.shiftKey ? 5 / DEFAULT_FPS : 1 / DEFAULT_FPS
        setPlayhead((p) => Math.min(totalDuration, p + step))
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        setIsPlaying(false)
        const points = Array.from(
          new Set([
            0,
            totalDuration,
            ...videoClips.flatMap((c) => [
              c.timelineStart,
              c.timelineStart + c.duration,
            ]),
          ]),
        ).sort((a, b) => a - b)
        if (e.key === 'ArrowUp') {
          const prev = [...points].reverse().find((pt) => pt < playhead - 0.01)
          if (prev !== undefined) setPlayhead(prev)
        } else {
          const next = points.find((pt) => pt > playhead + 0.01)
          if (next !== undefined) setPlayhead(next)
        }
      } else if (e.key === 'Home') {
        e.preventDefault()
        setIsPlaying(false)
        setPlayhead(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setIsPlaying(false)
        setPlayhead(totalDuration)
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setPxPerSec((z) => Math.min(240, z + 15))
      } else if (e.key === '-') {
        e.preventDefault()
        setPxPerSec((z) => Math.max(5, z - 15))
      } else if (e.key === '\\') {
        e.preventDefault()
        if (totalDuration > 0) {
          setPxPerSec(Math.max(5, Math.min(240, Math.round(700 / totalDuration))))
        }
      } else if (e.code === 'Backquote') {
        e.preventDefault()
        void toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    togglePlay,
    handleUndo,
    handleRedo,
    handleCopySelected,
    handlePasteAtPlayhead,
    isPlaying,
    handleTrimLeft,
    handleTrimRight,
    handleSplit,
    handleAddText,
    handleDeleteSelected,
    toggleFullscreen,
    aspectRatio,
    totalDuration,
    videoClips,
    playhead,
  ])

  const handleExport = async (targetRatio: AspectRatio) => {
    if (videoClips.length === 0) return
    setIsPlaying(false)
    const controller = new AbortController()
    exportAbortRef.current = controller

    setExportState({
      active: true,
      progress: 0,
      status: '내보내기 준비 중...',
      targetRatio,
      error: null,
    })

    // If exporting in a ratio different from current preview, adjust fitMode for export
    const exportClips = videoClips.map((c) => ({
      ...c,
      fitMode:
        targetRatio === aspectRatio
          ? c.fitMode
          : targetRatio === '9:16'
            ? ('cover' as const)
            : ('contain' as const),
    }))

    try {
      const blob = await exportFhdMp4({
        aspectRatio: targetRatio,
        fps: DEFAULT_FPS,
        videoClips: exportClips,
        textClips,
        musicClip,
        assets,
        videoTrackHidden,
        hiddenCaptionLayers,
        musicTrackMuted,
        signal: controller.signal,
        onProgress: (progress, status) => {
          setExportState((prev) => ({ ...prev, progress, status }))
        },
      })

      const mp4Name = `kremble-cut-fhd-${targetRatio.replace(':', 'x')}-30fps.mp4`
      let saved = false
      if (workspaceDirHandle) {
        saved = await saveFileInDirectory(workspaceDirHandle, mp4Name, blob)
      }
      if (!saved) {
        saved = await saveBlobWithPicker(
          blob,
          mp4Name,
          'MP4 비디오 파일',
          'video/mp4',
          ['.mp4'],
        )
      }

      setExportState({
        active: false,
        progress: saved ? 1 : 0,
        status: saved
          ? workspaceDirHandle
            ? `작업 폴더에 저장됨: ${mp4Name}`
            : '완료'
          : '저장 취소됨',
        targetRatio: null,
        error: null,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setExportState({
          active: false,
          progress: 0,
          status: '',
          targetRatio: null,
          error: null,
        })
        return
      }
      setExportState((prev) => ({
        ...prev,
        active: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  return (
    <div className="dark flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleImportVideos(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          void handleImportMusic(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,.myopencut.json,application/json"
        className="hidden"
        onChange={(e) => {
          void handleImportProjectFile(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={relinkInputRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleRelinkFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={onnxInputRef}
        type="file"
        accept=".onnx"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          try {
            await cacheLocalOnnxModel(file)
            if (selectedVideoClip) {
              void handleRunAiMusicRemoval(selectedVideoClip)
            }
          } catch (err) {
            setAiRemovalState((prev) => ({
              ...prev,
              error: err instanceof Error ? err.message : String(err),
            }))
          }
        }}
      />

      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/90">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Film className="w-4 h-4 text-sky-400" />
            <span>Kremble Cut</span>
          </div>
          {saveFeedback && (
            <span className="rounded bg-emerald-950/70 border border-emerald-700/50 px-2 py-0.5 text-[11px] text-emerald-300">
              {saveFeedback}
            </span>
          )}
        </div>

        {/* Aspect Ratio Switcher */}
        <div
          data-guide="aspect-ratio"
          className="flex items-center gap-1.5 rounded-lg bg-zinc-950 p-1 border border-zinc-800"
        >
          <Button
            type="button"
            size="sm"
            variant={aspectRatio === '16:9' ? 'default' : 'ghost'}
            className={`h-7 px-2.5 text-xs ${
              aspectRatio === '16:9'
                ? 'bg-sky-500 hover:bg-sky-600 text-white'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
            onClick={() => handleSwitchAspectRatio('16:9')}
          >
            <RectangleHorizontal className="w-3.5 h-3.5 mr-1.5" />
            16:9 가로
          </Button>
          <Button
            type="button"
            size="sm"
            variant={aspectRatio === '9:16' ? 'default' : 'ghost'}
            className={`h-7 px-2.5 text-xs ${
              aspectRatio === '9:16'
                ? 'bg-sky-500 hover:bg-sky-600 text-white'
                : 'text-zinc-400 hover:text-zinc-100'
            }`}
            onClick={() => handleSwitchAspectRatio('9:16')}
          >
            <RectangleVertical className="w-3.5 h-3.5 mr-1.5" />
            9:16 숏폼 비율
          </Button>
        </div>

        {/* Actions: Project Save/SaveAs/Load, Safe Zone, Center Guide, Thumbnail, FHD Exports */}
        <div className="flex flex-wrap items-center gap-2">
          <div data-guide="header-save" className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs border-zinc-700 text-zinc-200 hover:bg-zinc-800"
              onClick={() => void handleSaveProject(false)}
              title="저장 (최초 1회 위치 지정 후 같은 파일에 바로 덮어쓰기)"
            >
              <Save className="w-3.5 h-3.5 mr-1" />
              저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs border-zinc-700 text-zinc-200 hover:bg-zinc-800"
              onClick={() => void handleSaveProject(true)}
              title="새 위치/파일 이름으로 저장"
            >
              다른 이름으로 저장
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs border-zinc-700 text-zinc-200 hover:bg-zinc-800"
              onClick={() => projectInputRef.current?.click()}
              title="프로젝트 파일 불러오기"
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1" />
              불러오기
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            variant={showSafeZone ? 'default' : 'outline'}
            className={`h-8 text-xs ${
              showSafeZone
                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                : 'border-zinc-700 text-zinc-300'
            }`}
            onClick={() => setShowSafeZone((s) => !s)}
          >
            <Shield className="w-3.5 h-3.5 mr-1" />
            세이프존
          </Button>

          <Button
            type="button"
            size="sm"
            variant={showCenterGuide ? 'default' : 'outline'}
            className={`h-8 text-xs ${
              showCenterGuide
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'border-zinc-700 text-zinc-300'
            }`}
            onClick={() => setShowCenterGuide((s) => !s)}
            title="가로·세로 중앙 가이드선 켜기/끄기"
          >
            <Crosshair className="w-3.5 h-3.5 mr-1" />
            중앙선
          </Button>

          <div data-guide="export-actions" className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!activeVideoClip}
              className="h-8 text-xs border-amber-500/50 text-amber-300 hover:bg-amber-950/40"
              onClick={() => {
                setIsPlaying(false)
                setThumbnailOpen(true)
              }}
            >
              <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
              현재 프레임 썸네일
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={videoClips.length === 0 || exportState.active}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => void handleExport('16:9')}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              FHD 16:9 내보내기
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={videoClips.length === 0 || exportState.active}
              className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => void handleExport('9:16')}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              FHD 9:16 내보내기
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-zinc-300 hover:text-white"
            onClick={() => setGuideOpen(true)}
            title="화면 구성 요소별 비주얼 가이드 보기"
          >
            <HelpCircle className="w-3.5 h-3.5 mr-1 text-sky-400" />
            가이드
          </Button>
        </div>
      </header>

      {/* Export Progress / Error Banner */}
      {(exportState.active || exportState.error) && (
        <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between gap-4">
          {exportState.active ? (
            <>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>{exportState.status}</span>
                  <span className="font-mono">
                    {Math.round(exportState.progress * 100)}%
                  </span>
                </div>
                <Progress value={exportState.progress * 100} className="h-2" />
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="border-zinc-700 text-zinc-300"
                onClick={() => exportAbortRef.current?.abort()}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                취소
              </Button>
            </>
          ) : (
            <div className="flex items-center justify-between w-full text-xs text-rose-400">
              <span>내보내기 오류: {exportState.error}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() =>
                  setExportState((prev) => ({ ...prev, error: null }))
                }
              >
                닫기
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Autosave Restore / Missing Media Relink Banner */}
      {(pendingProject || relinkNotice) && (
        <div className="px-4 py-2 bg-sky-950/50 border-b border-sky-800/60 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-sky-200">
            {pendingProject ? (
              pendingIsAutosave ? (
                <span>
                  이전 작업 자동 저장본이 있습니다 (비디오{' '}
                  {pendingProject.videoClips.length}개, 자막{' '}
                  {pendingProject.textClips.length}개).{' '}
                  {pendingProject.assets.length > 0
                    ? `원본 파일 ${pendingProject.assets.length}개를 선택해 복원하세요.`
                    : '바로 복원할 수 있습니다.'}
                </span>
              ) : (
                <span>
                  {relinkNotice ??
                    `프로젝트의 원본 미디어 ${pendingProject.assets.length}개를 선택해 연결하세요.`}
                </span>
              )
            ) : (
              <span>{relinkNotice}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {pendingProject && pendingProject.assets.length === 0 && (
              <Button
                type="button"
                size="xs"
                className="bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => applyRestoredProject(pendingProject, new Map(), true)}
              >
                복원하기
              </Button>
            )}
            {pendingProject && pendingProject.assets.length > 0 && (
              <Button
                type="button"
                size="xs"
                className="bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => relinkInputRef.current?.click()}
              >
                <Upload className="w-3 h-3 mr-1" />
                원본 파일 선택하여 복원
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-zinc-300 hover:text-white"
              onClick={() => {
                if (pendingIsAutosave) {
                  void clearAutosaveProject()
                }
                setPendingProject(null)
                setPendingIsAutosave(false)
                setRelinkNotice(null)
              }}
            >
              무시
            </Button>
          </div>
        </div>
      )}

      {/* Main 3-Column Workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Media & Music Panel (collapsible) */}
        {leftCollapsed ? (
          <aside className="w-9 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col items-center py-2.5 gap-3">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => setLeftCollapsed(false)}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
              title="미디어 패널 펼치기"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={() => setLeftCollapsed(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 tracking-wider [writing-mode:vertical-rl]"
              title="미디어 패널 펼치기"
            >
              미디어
            </button>
          </aside>
        ) : (
          <aside
            data-guide="media-panel"
            className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                미디어
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => setLeftCollapsed(true)}
                className="h-6 w-6 text-zinc-400 hover:text-zinc-100"
                title="왼쪽 사이드로 최소화"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="p-3 border-b border-zinc-800 space-y-2">
            <Button
              type="button"
              size="sm"
              className="w-full bg-sky-500 hover:bg-sky-600 text-white text-xs"
              onClick={() => void pickVideosWithHandles()}
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />
              영상 추가 (2.7K / 4K)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full border-emerald-700/60 text-emerald-300 hover:bg-emerald-950/40 text-xs"
              onClick={() => audioInputRef.current?.click()}
            >
              <Music className="w-3.5 h-3.5 mr-1.5" />
              배경 음악 추가
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              불러온 미디어
            </p>
            {Object.values(assets).length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">
                상단 버튼으로 영상이나
                <br />
                음악 파일을 추가하세요.
              </p>
            ) : (
              Object.values(assets).map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-md border border-zinc-800 bg-zinc-900/80 p-2 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className="font-medium text-zinc-200 min-w-0 truncate"
                      title={asset.name}
                    >
                      {truncateMiddle(asset.name)}
                    </span>
                    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-sky-300">
                      {asset.resolutionTag}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>{asset.duration.toFixed(1)}초</span>
                    {asset.kind === 'video' && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="h-5 px-1.5 text-[11px] text-sky-400 hover:text-sky-300"
                        onClick={() =>
                          appendVideoAssetToTimeline(asset, aspectRatio)
                        }
                      >
                        <Plus className="w-3 h-3 mr-0.5" />
                        트랙에 추가
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
        )}

        {/* Center: Canvas Preview + Transport */}
        <main
          data-guide="preview-stage"
          className="flex-1 flex flex-col min-w-0 bg-zinc-950"
        >
          <div
            ref={previewStageRef}
            className="relative flex-1 flex items-center justify-center p-4 min-h-0 overflow-hidden bg-zinc-950 [container-type:size]"
          >
            {isFullscreen && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void toggleFullscreen()}
                className="absolute top-4 right-4 z-30 border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800"
              >
                <Minimize2 className="w-4 h-4 mr-1.5" />
                전체화면 닫기 (ESC)
              </Button>
            )}
            <div
              onPointerDown={(e) => {
                if (!activeVideoClip) return
                setSelection({ kind: 'video', id: activeVideoClip.id })
                previewDragRef.current = {
                  clipId: activeVideoClip.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  origOffsetX: activeVideoClip.offsetX,
                  origOffsetY: activeVideoClip.offsetY,
                  hasMoved: false,
                }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const drag = previewDragRef.current
                if (!drag || e.buttons !== 1) return
                const dx = e.clientX - drag.startX
                const dy = e.clientY - drag.startY
                if (!drag.hasMoved) {
                  if (Math.hypot(dx, dy) < 3) return
                  drag.hasMoved = true
                  pushHistory()
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const nextX = Math.max(
                  -1,
                  Math.min(1, drag.origOffsetX + (dx / Math.max(1, rect.width)) * 2),
                )
                const nextY = Math.max(
                  -1,
                  Math.min(1, drag.origOffsetY + (dy / Math.max(1, rect.height)) * 2),
                )
                setVideoClips((prev) =>
                  prev.map((c) =>
                    c.id === drag.clipId
                      ? { ...c, offsetX: nextX, offsetY: nextY }
                      : c,
                  ),
                )
              }}
              onPointerUp={() => {
                previewDragRef.current = null
              }}
              onPointerCancel={() => {
                previewDragRef.current = null
              }}
              className={`relative flex items-center justify-center rounded-md border border-zinc-800 shadow-2xl bg-black overflow-hidden ${
                activeVideoClip ? 'cursor-move' : ''
              }`}
              style={{
                width:
                  aspectRatio === '16:9'
                    ? 'min(100cqw, calc(100cqh * 16 / 9))'
                    : 'min(100cqw, calc(100cqh * 9 / 16))',
                height:
                  aspectRatio === '16:9'
                    ? 'min(100cqh, calc(100cqw * 9 / 16))'
                    : 'min(100cqh, calc(100cqw * 16 / 9))',
              }}
            >
              {/* Hardware-accelerated native <video> preview (avoids 4K per-frame canvas copy) */}
              <video
                ref={videoElRef}
                playsInline
                preload="auto"
                onLoadedData={drawPreview}
                onSeeked={drawPreview}
                className={`w-full h-full pointer-events-none transition-opacity ${
                  activeVideoClip && !videoTrackHidden ? 'opacity-100' : 'opacity-0'
                } ${
                  activeVideoClip?.fitMode === 'cover'
                    ? 'object-cover'
                    : 'object-contain'
                }`}
                style={
                  activeVideoClip
                    ? {
                        objectPosition: `${50 - activeVideoClip.offsetX * 50}% ${50 - activeVideoClip.offsetY * 50}%`,
                        transform:
                          activeVideoClip.fitMode === 'cover'
                            ? `scale(${activeVideoClip.scale})`
                            : `translate(${activeVideoClip.offsetX * 25}%, ${activeVideoClip.offsetY * 25}%) scale(${activeVideoClip.scale})`,
                      }
                    : undefined
                }
              />
              <canvas
                ref={previewCanvasRef}
                className="pointer-events-none absolute inset-0 z-10 w-full h-full"
              />
              {showSafeZone && (
                <div
                  className="pointer-events-none absolute z-20 border-2 border-dashed border-sky-400/85 bg-sky-400/5"
                  style={
                    aspectRatio === '9:16'
                      ? {
                          left: '8%',
                          right: '14%',
                          top: '12%',
                          bottom: '20%',
                        }
                      : {
                          left: '8%',
                          right: '8%',
                          top: '8%',
                          bottom: '8%',
                        }
                  }
                />
              )}
              {showCenterGuide && (
                <div className="pointer-events-none absolute inset-0 z-20">
                  <div className="absolute left-0 right-0 top-1/2 -translate-y-px border-t border-dashed border-amber-400/85" />
                  <div className="absolute top-0 bottom-0 left-1/2 -translate-x-px border-l border-dashed border-amber-400/85" />
                </div>
              )}
              {videoClips.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center text-center p-6">
                  <p className="text-sm font-medium text-zinc-400">
                    영상을 추가하면 여기에 미리보기가 표시됩니다
                  </p>
                  <p className="text-xs text-zinc-600 mt-1">
                    {CANVAS_PRESETS[aspectRatio].label} · {DEFAULT_FPS}fps
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Transport Bar */}
          <div className="flex items-center justify-center gap-3 py-2 px-4 border-t border-zinc-800/80 bg-zinc-900/50">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setIsPlaying(false)
                setPlayhead(0)
              }}
              title="처음으로"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setIsPlaying(false)
                setPlayhead((p) => Math.max(0, p - 1 / DEFAULT_FPS))
              }}
              title="-1 프레임 (←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 px-4 bg-sky-500 hover:bg-sky-600 text-white"
              onClick={togglePlay}
              title="재생 / 일시정지 (Space)"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 mr-1" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              {isPlaying ? '일시정지' : '재생'}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                setIsPlaying(false)
                setPlayhead((p) => Math.min(totalDuration, p + 1 / DEFAULT_FPS))
              }}
              title="+1 프레임 (→)"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="ml-2 font-mono text-xs text-zinc-300">
              {formatTimecode(playhead, DEFAULT_FPS)} /{' '}
              {formatTimecode(totalDuration, DEFAULT_FPS)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void toggleFullscreen()}
              className="ml-2 h-8 px-2.5 text-xs border-zinc-700 text-zinc-200 hover:bg-zinc-800"
              title="전체 화면 미리보기 (ESC로 종료)"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5 mr-1" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 mr-1" />
              )}
              전체화면
            </Button>
          </div>
        </main>

        {/* Right: Inspector (collapsible to maximize center preview) */}
        {rightCollapsed ? (
          <aside className="w-9 shrink-0 border-l border-zinc-800 bg-zinc-900/40 flex flex-col items-center py-2.5 gap-3">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={() => setRightCollapsed(false)}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-100"
              title="오른쪽 패널 펼치기"
            >
              <PanelRightOpen className="w-4 h-4" />
            </Button>
            <button
              type="button"
              onClick={() => setRightCollapsed(false)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 tracking-wider [writing-mode:vertical-rl]"
              title="오른쪽 패널 펼치기"
            >
              속성 · 단축키
            </button>
          </aside>
        ) : (
          <aside
            data-guide="inspector"
            className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-900/40 flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-zinc-800/80 shrink-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                속성 · 단축키
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => setRightCollapsed(true)}
                className="h-6 w-6 text-zinc-400 hover:text-zinc-100"
                title="오른쪽 사이드로 최소화"
              >
                <PanelRightClose className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
          {/* Multi-Selection Batch Edit Inspector */}
          {multiSelection.videoIds.length + multiSelection.textIds.length > 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                  다중 선택 일괄 수정
                </h3>
                <span className="text-[11px] font-mono text-zinc-400">
                  비디오 {multiSelection.videoIds.length} · 캡션{' '}
                  {multiSelection.textIds.length}
                </span>
              </div>

              {multiSelection.videoIds.length > 0 && (
                <div className="space-y-3 rounded-md border border-sky-800/50 bg-sky-950/20 p-2.5">
                  <div className="text-[11px] font-semibold text-sky-300">
                    선택된 비디오 ({multiSelection.videoIds.length}개)
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="border-zinc-700 text-zinc-200 text-[11px]"
                      onClick={() => {
                        pushHistory()
                        const vSet = new Set(multiSelection.videoIds)
                        setVideoClips((prev) =>
                          prev.map((c) =>
                            vSet.has(c.id) ? { ...c, fitMode: 'cover' } : c,
                          ),
                        )
                      }}
                    >
                      전체 꽉 채우기
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="border-zinc-700 text-zinc-200 text-[11px]"
                      onClick={() => {
                        pushHistory()
                        const vSet = new Set(multiSelection.videoIds)
                        setVideoClips((prev) =>
                          prev.map((c) =>
                            vSet.has(c.id) ? { ...c, fitMode: 'contain' } : c,
                          ),
                        )
                      }}
                    >
                      전체 원본 비율
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-300">일괄 음소거</Label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="h-6 text-[11px] border-zinc-700"
                        onClick={() => {
                          pushHistory()
                          const vSet = new Set(multiSelection.videoIds)
                          setVideoClips((prev) =>
                            prev.map((c) =>
                              vSet.has(c.id) ? { ...c, muted: true } : c,
                            ),
                          )
                        }}
                      >
                        음소거 ON
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        className="h-6 text-[11px] border-zinc-700"
                        onClick={() => {
                          pushHistory()
                          const vSet = new Set(multiSelection.videoIds)
                          setVideoClips((prev) =>
                            prev.map((c) =>
                              vSet.has(c.id) ? { ...c, muted: false } : c,
                            ),
                          )
                        }}
                      >
                        해제
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-zinc-300">
                      <span>일괄 볼륨</span>
                      <span className="font-mono text-[11px] text-sky-300">
                        {Math.round(
                          ((videoClips.find((c) =>
                            multiSelection.videoIds.includes(c.id),
                          )?.volume ?? 1) *
                            100),
                        )}
                        %
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[
                        videoClips.find((c) =>
                          multiSelection.videoIds.includes(c.id),
                        )?.volume ?? 1,
                      ]}
                      onValueChange={(raw) => {
                        const val = Array.isArray(raw) ? raw[0] : raw
                        const vSet = new Set(multiSelection.videoIds)
                        setVideoClips((prev) =>
                          prev.map((c) =>
                            vSet.has(c.id) ? { ...c, volume: val } : c,
                          ),
                        )
                      }}
                    />
                  </div>
                </div>
              )}

              {multiSelection.textIds.length > 0 && (
                <div className="space-y-3 rounded-md border border-violet-800/50 bg-violet-950/20 p-2.5">
                  <div className="text-[11px] font-semibold text-violet-300">
                    선택된 캡션 ({multiSelection.textIds.length}개)
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-zinc-300">
                      <span>일괄 글자 크기</span>
                      <input
                        type="number"
                        min={12}
                        max={300}
                        step={2}
                        defaultValue={64}
                        onBlur={(e) => {
                          const raw = Number(e.target.value)
                          if (!Number.isFinite(raw)) return
                          const val = Math.max(12, Math.min(300, raw))
                          pushHistory()
                          const tSet = new Set(multiSelection.textIds)
                          setTextClips((prev) =>
                            prev.map((t) =>
                              tSet.has(t.id)
                                ? {
                                    ...t,
                                    fontSize: val,
                                    strokeWidth: Number((val * 0.1).toFixed(1)),
                                  }
                                : t,
                            ),
                          )
                        }}
                        className="w-16 h-6 rounded bg-zinc-900 border border-zinc-700 px-1.5 text-right font-mono text-xs text-zinc-100"
                      />
                    </div>
                    <Slider
                      min={24}
                      max={200}
                      step={2}
                      defaultValue={[64]}
                      onValueChange={(raw) => {
                        const val = Array.isArray(raw) ? raw[0] : raw
                        const tSet = new Set(multiSelection.textIds)
                        setTextClips((prev) =>
                          prev.map((t) =>
                            tSet.has(t.id)
                              ? {
                                  ...t,
                                  fontSize: val,
                                  strokeWidth: Number((val * 0.1).toFixed(1)),
                                }
                              : t,
                          ),
                        )
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                      기본 글자색
                      <input
                        type="color"
                        defaultValue="#FFFFFF"
                        onChange={(e) => {
                          const tSet = new Set(multiSelection.textIds)
                          const val = e.target.value
                          setTextClips((prev) =>
                            prev.map((t) =>
                              tSet.has(t.id) ? { ...t, defaultColor: val } : t,
                            ),
                          )
                        }}
                        className="w-5 h-5 rounded bg-transparent cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                      외곽선
                      <input
                        type="color"
                        defaultValue="#000000"
                        onChange={(e) => {
                          const tSet = new Set(multiSelection.textIds)
                          const val = e.target.value
                          setTextClips((prev) =>
                            prev.map((t) =>
                              tSet.has(t.id) ? { ...t, strokeColor: val } : t,
                            ),
                          )
                        }}
                        className="w-5 h-5 rounded bg-transparent cursor-pointer"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          { key: 'left', label: '좌', x: 0.08 },
                          { key: 'center', label: '중', x: 0.5 },
                          {
                            key: 'right',
                            label: '우',
                            x: aspectRatio === '9:16' ? 0.86 : 0.92,
                          },
                        ] as const
                      ).map((opt) => (
                        <Button
                          key={opt.key}
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-6 px-1 text-[11px] border-zinc-700"
                          onClick={() => {
                            pushHistory()
                            const tSet = new Set(multiSelection.textIds)
                            setTextClips((prev) =>
                              prev.map((t) =>
                                tSet.has(t.id)
                                  ? { ...t, align: opt.key, x: opt.x }
                                  : t,
                              ),
                            )
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(
                        [
                          {
                            key: 'top',
                            label: '상',
                            y: aspectRatio === '9:16' ? 0.16 : 0.13,
                          },
                          { key: 'middle', label: '중', y: 0.5 },
                          {
                            key: 'bottom',
                            label: '하',
                            y: aspectRatio === '9:16' ? 0.76 : 0.86,
                          },
                        ] as const
                      ).map((opt) => (
                        <Button
                          key={opt.key}
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-6 px-1 text-[11px] border-zinc-700"
                          onClick={() => {
                            pushHistory()
                            const tSet = new Set(multiSelection.textIds)
                            setTextClips((prev) =>
                              prev.map((t) =>
                                tSet.has(t.id) ? { ...t, y: opt.y } : t,
                              ),
                            )
                          }}
                        >
                          {opt.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Selected Video Clip Inspector */}
          {selectedVideoClip && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                  비디오 클립 설정
                </h3>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {selectedVideoClip.name}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-zinc-300">
                  화면 비율 맞춤 ({aspectRatio})
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      selectedVideoClip.fitMode === 'cover'
                        ? 'default'
                        : 'outline'
                    }
                    className={
                      selectedVideoClip.fitMode === 'cover'
                        ? 'bg-sky-500 text-white text-xs'
                        : 'border-zinc-700 text-zinc-300 text-xs'
                    }
                    onClick={() =>
                      setVideoClips((prev) =>
                        prev.map((c) =>
                          c.id === selectedVideoClip.id
                            ? { ...c, fitMode: 'cover' }
                            : c,
                        ),
                      )
                    }
                  >
                    꽉 채우기 (Cover)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      selectedVideoClip.fitMode === 'contain'
                        ? 'default'
                        : 'outline'
                    }
                    className={
                      selectedVideoClip.fitMode === 'contain'
                        ? 'bg-sky-500 text-white text-xs'
                        : 'border-zinc-700 text-zinc-300 text-xs'
                    }
                    onClick={() =>
                      setVideoClips((prev) =>
                        prev.map((c) =>
                          c.id === selectedVideoClip.id
                            ? { ...c, fitMode: 'contain' }
                            : c,
                        ),
                      )
                    }
                  >
                    전체 보기 (Fit)
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>확대 / 축소</span>
                  <span className="font-mono">
                    {selectedVideoClip.scale.toFixed(2)}x
                  </span>
                </div>
                <Slider
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={[selectedVideoClip.scale]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setVideoClips((prev) =>
                      prev.map((c) =>
                        c.id === selectedVideoClip.id
                          ? { ...c, scale: val }
                          : c,
                      ),
                    )
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>좌우 위치 (Pan X)</span>
                  <span className="font-mono">
                    {Math.round(selectedVideoClip.offsetX * 100)}%
                  </span>
                </div>
                <Slider
                  min={-1}
                  max={1}
                  step={0.02}
                  value={[selectedVideoClip.offsetX]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setVideoClips((prev) =>
                      prev.map((c) =>
                        c.id === selectedVideoClip.id
                          ? { ...c, offsetX: val }
                          : c,
                      ),
                    )
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>상하 위치 (Pan Y)</span>
                  <span className="font-mono">
                    {Math.round(selectedVideoClip.offsetY * 100)}%
                  </span>
                </div>
                <Slider
                  min={-1}
                  max={1}
                  step={0.02}
                  value={[selectedVideoClip.offsetY]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setVideoClips((prev) =>
                      prev.map((c) =>
                        c.id === selectedVideoClip.id
                          ? { ...c, offsetY: val }
                          : c,
                      ),
                    )
                  }}
                />
              </div>

              <div className="pt-2 border-t border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-zinc-300">
                    원본 영상 음소거
                  </Label>
                  <Switch
                    checked={selectedVideoClip.muted}
                    onCheckedChange={(checked) =>
                      setVideoClips((prev) =>
                        prev.map((c) =>
                          c.id === selectedVideoClip.id
                            ? { ...c, muted: checked }
                            : c,
                        ),
                      )
                    }
                  />
                </div>
                {!selectedVideoClip.muted && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-zinc-400">
                        <span>클립 볼륨</span>
                        <span>{Math.round(selectedVideoClip.volume * 100)}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={[selectedVideoClip.volume]}
                        onValueChange={(raw) => {
                          const val = Array.isArray(raw) ? raw[0] : raw
                          setVideoClips((prev) =>
                            prev.map((c) =>
                              c.id === selectedVideoClip.id
                                ? { ...c, volume: val }
                                : c,
                            ),
                          )
                        }}
                      />
                    </div>

                    {ENABLE_AI_MUSIC_REMOVAL_UI && (
                    <div className="pt-2 border-t border-zinc-800/70 space-y-2.5">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs text-zinc-300 flex items-center gap-1">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                            녹음된 음악 제거 (AI)
                          </Label>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={aiRemovalState.active}
                            className="h-7 text-[11px] border-emerald-600/50 text-emerald-300 hover:bg-emerald-950/50"
                            onClick={() =>
                              void handleRunAiMusicRemoval(selectedVideoClip)
                            }
                          >
                            {aiRemovalState.active &&
                            aiRemovalState.clipId === selectedVideoClip.id
                              ? '분석 중...'
                              : selectedVideoClip.aiCleanAudioUrl
                                ? 'AI 다시 분석'
                                : 'AI 분리 실행'}
                          </Button>
                        </div>

                        {aiRemovalState.active &&
                          aiRemovalState.clipId === selectedVideoClip.id && (
                            <div className="space-y-1">
                              <div className="flex justify-between text-[11px] text-emerald-300">
                                <span className="truncate">
                                  {aiRemovalState.status}
                                </span>
                                <span className="font-mono">
                                  {aiRemovalState.progress}%
                                </span>
                              </div>
                              <Progress
                                value={aiRemovalState.progress}
                                className="h-1.5"
                              />
                            </div>
                          )}

                        {aiRemovalState.error &&
                          aiRemovalState.clipId === selectedVideoClip.id && (
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-red-400">
                                {aiRemovalState.error}
                              </p>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                className="h-6 text-[11px] border-zinc-700 text-zinc-300"
                                onClick={() => onnxInputRef.current?.click()}
                              >
                                모델 파일(.onnx) 직접 불러오기
                              </Button>
                            </div>
                          )}

                        {selectedVideoClip.aiCleanAudioUrl && (
                          <div className="space-y-2.5 rounded bg-emerald-950/30 border border-emerald-800/40 px-2.5 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-emerald-300">
                                AI 음성 분리 결과 적용
                              </span>
                              <Switch
                                checked={Boolean(selectedVideoClip.useAiCleanAudio)}
                                onCheckedChange={(checked) =>
                                  setVideoClips((prev) =>
                                    prev.map((c) =>
                                      c.id === selectedVideoClip.id
                                        ? { ...c, useAiCleanAudio: checked }
                                        : c,
                                    ),
                                  )
                                }
                              />
                            </div>

                            {selectedVideoClip.useAiCleanAudio && (
                              <>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-[11px] text-zinc-300">
                                    <span>바벨·충격음 보존</span>
                                    <span className="font-mono">
                                      {Math.round(
                                        (selectedVideoClip.aiTransientPreserve ??
                                          0.75) * 100,
                                      )}
                                      %
                                    </span>
                                  </div>
                                  <Slider
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={[
                                      selectedVideoClip.aiTransientPreserve ??
                                        0.75,
                                    ]}
                                    onValueChange={(raw) => {
                                      const val = Array.isArray(raw)
                                        ? raw[0]
                                        : raw
                                      const asset =
                                        assets[selectedVideoClip.assetId]
                                      const remixed = asset
                                        ? remixAiSeparatedAudio(asset.url, {
                                            transientPreserve: val,
                                            ambienceBlend:
                                              selectedVideoClip.aiAmbienceBlend ??
                                              0,
                                          })
                                        : null
                                      setVideoClips((prev) =>
                                        prev.map((c) =>
                                          c.assetId ===
                                          selectedVideoClip.assetId
                                            ? {
                                                ...c,
                                                aiTransientPreserve: val,
                                                ...(remixed
                                                  ? { aiCleanAudioUrl: remixed }
                                                  : {}),
                                              }
                                            : c,
                                        ),
                                      )
                                    }}
                                  />
                                </div>

                                <div className="space-y-1">
                                  <div className="flex justify-between text-[11px] text-zinc-400">
                                    <span>원본 배경음 살짝 섞기</span>
                                    <span className="font-mono">
                                      {Math.round(
                                        (selectedVideoClip.aiAmbienceBlend ??
                                          0) * 100,
                                      )}
                                      %
                                    </span>
                                  </div>
                                  <Slider
                                    min={0}
                                    max={0.4}
                                    step={0.02}
                                    value={[
                                      selectedVideoClip.aiAmbienceBlend ?? 0,
                                    ]}
                                    onValueChange={(raw) => {
                                      const val = Array.isArray(raw)
                                        ? raw[0]
                                        : raw
                                      const asset =
                                        assets[selectedVideoClip.assetId]
                                      const remixed = asset
                                        ? remixAiSeparatedAudio(asset.url, {
                                            transientPreserve:
                                              selectedVideoClip.aiTransientPreserve ??
                                              0.75,
                                            ambienceBlend: val,
                                          })
                                        : null
                                      setVideoClips((prev) =>
                                        prev.map((c) =>
                                          c.assetId ===
                                          selectedVideoClip.assetId
                                            ? {
                                                ...c,
                                                aiAmbienceBlend: val,
                                                ...(remixed
                                                  ? { aiCleanAudioUrl: remixed }
                                                  : {}),
                                              }
                                            : c,
                                        ),
                                      )
                                    }}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-zinc-500">
                          브라우저 내 AI 모델(Kim_Vocal_2)로 녹음된 배경음악을
                          제거하고 사람 목소리만 추출합니다. (서버 비용 $0)
                        </p>
                      </div>
                    </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected Caption / Dynamic Text Inspector */}
          {selectedTextClip && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    selectedTextClip.isDynamic
                      ? 'text-amber-400'
                      : 'text-violet-400'
                  }`}
                >
                  {selectedTextClip.isDynamic
                    ? '전체화면 텍스트 설정'
                    : '캡션 설정'}
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={(selectedTextClip.layer ?? 0) <= 0}
                    className="h-6 px-1.5 text-[11px] border-zinc-700 text-zinc-300"
                    onClick={() =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? { ...t, layer: Math.max(0, (t.layer ?? 0) - 1) }
                            : t,
                        ),
                      )
                    }
                    title="아래 레이어로 이동"
                  >
                    -
                  </Button>
                  <span className="text-[11px] font-mono text-violet-300 px-1">
                    레이어 {(selectedTextClip.layer ?? 0) + 1}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-6 px-1.5 text-[11px] border-zinc-700 text-zinc-300"
                    onClick={() =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? { ...t, layer: (t.layer ?? 0) + 1 }
                            : t,
                        ),
                      )
                    }
                    title="위 레이어로 이동"
                  >
                    +
                  </Button>
                </div>
              </div>

              <PerCharColorEditor
                clip={selectedTextClip}
                onChange={(patch) =>
                  setTextClips((prev) =>
                    prev.map((t) =>
                      t.id === selectedTextClip.id ? { ...t, ...patch } : t,
                    ),
                  )
                }
              />

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-400">
                    시작 시간 (초)
                  </Label>
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    value={Number(selectedTextClip.timelineStart.toFixed(2))}
                    onChange={(e) =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? {
                                ...t,
                                timelineStart: Math.max(
                                  0,
                                  Number(e.target.value) || 0,
                                ),
                              }
                            : t,
                        ),
                      )
                    }
                    className="h-8 bg-zinc-900 border-zinc-700 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-400">
                    지속 시간 (초)
                  </Label>
                  <Input
                    type="number"
                    step={0.1}
                    min={0.2}
                    value={Number(selectedTextClip.duration.toFixed(2))}
                    onChange={(e) =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? {
                                ...t,
                                duration: Math.max(
                                  0.2,
                                  Number(e.target.value) || 0.2,
                                ),
                              }
                            : t,
                        ),
                      )
                    }
                    className="h-8 bg-zinc-900 border-zinc-700 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span>글자 크기</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={12}
                      max={300}
                      step={1}
                      value={selectedTextClip.fontSize}
                      onChange={(e) => {
                        const raw = Number(e.target.value)
                        if (!Number.isFinite(raw)) return
                        const val = Math.max(12, Math.min(300, raw))
                        setTextClips((prev) =>
                          prev.map((t) =>
                            t.id === selectedTextClip.id
                              ? {
                                  ...t,
                                  fontSize: val,
                                  strokeWidth: Number((val * 0.1).toFixed(1)),
                                }
                              : t,
                          ),
                        )
                      }}
                      className="w-14 h-6 rounded bg-zinc-900 border border-zinc-700 px-1.5 text-right font-mono text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-zinc-500">px</span>
                  </div>
                </div>
                <Slider
                  min={24}
                  max={160}
                  step={2}
                  value={[selectedTextClip.fontSize]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setTextClips((prev) =>
                      prev.map((t) =>
                        t.id === selectedTextClip.id
                          ? {
                              ...t,
                              fontSize: val,
                              strokeWidth: Number((val * 0.1).toFixed(1)),
                            }
                          : t,
                      ),
                    )
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">가로 정렬</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { key: 'left', label: '왼쪽', x: 0.08 },
                        { key: 'center', label: '가운데', x: 0.5 },
                        {
                          key: 'right',
                          label: '오른쪽',
                          x: aspectRatio === '9:16' ? 0.86 : 0.92,
                        },
                      ] as const
                    ).map((opt) => {
                      const active = selectedTextClip.align === opt.key
                      return (
                        <Button
                          key={opt.key}
                          type="button"
                          size="xs"
                          variant={active ? 'default' : 'outline'}
                          className={`h-7 px-1 text-[11px] ${
                            active
                              ? 'bg-violet-600 hover:bg-violet-700 text-white'
                              : 'border-zinc-700 text-zinc-300'
                          }`}
                          onClick={() =>
                            setTextClips((prev) =>
                              prev.map((t) =>
                                t.id === selectedTextClip.id
                                  ? { ...t, align: opt.key, x: opt.x }
                                  : t,
                              ),
                            )
                          }
                        >
                          {opt.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">세로 정렬</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        {
                          key: 'top',
                          label: '위',
                          y: aspectRatio === '9:16' ? 0.16 : 0.13,
                        },
                        { key: 'middle', label: '가운데', y: 0.5 },
                        {
                          key: 'bottom',
                          label: '아래',
                          y: aspectRatio === '9:16' ? 0.76 : 0.86,
                        },
                      ] as const
                    ).map((opt) => {
                      const active =
                        Math.abs(selectedTextClip.y - opt.y) < 0.03
                      return (
                        <Button
                          key={opt.key}
                          type="button"
                          size="xs"
                          variant={active ? 'default' : 'outline'}
                          className={`h-7 px-1 text-[11px] ${
                            active
                              ? 'bg-violet-600 hover:bg-violet-700 text-white'
                              : 'border-zinc-700 text-zinc-300'
                          }`}
                          onClick={() =>
                            setTextClips((prev) =>
                              prev.map((t) =>
                                t.id === selectedTextClip.id
                                  ? { ...t, y: opt.y }
                                  : t,
                              ),
                            )
                          }
                        >
                          {opt.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-zinc-300">
                  <span>세로 위치 (Y)</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={5}
                      max={95}
                      step={1}
                      value={Math.round(selectedTextClip.y * 100)}
                      onChange={(e) => {
                        const raw = Number(e.target.value)
                        if (!Number.isFinite(raw)) return
                        const val = Math.max(0.05, Math.min(0.95, raw / 100))
                        setTextClips((prev) =>
                          prev.map((t) =>
                            t.id === selectedTextClip.id ? { ...t, y: val } : t,
                          ),
                        )
                      }}
                      className="w-14 h-6 rounded bg-zinc-900 border border-zinc-700 px-1.5 text-right font-mono text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-zinc-500">%</span>
                  </div>
                </div>
                <Slider
                  min={aspectRatio === '9:16' ? 0.15 : 0.11}
                  max={aspectRatio === '9:16' ? 0.77 : 0.89}
                  step={0.01}
                  value={[selectedTextClip.y]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setTextClips((prev) =>
                      prev.map((t) =>
                        t.id === selectedTextClip.id ? { ...t, y: val } : t,
                      ),
                    )
                  }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="text-bg-box"
                    checked={Boolean(selectedTextClip.backgroundColor)}
                    onCheckedChange={(checked) =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? {
                                ...t,
                                backgroundColor: checked
                                  ? 'rgba(0, 0, 0, 0.65)'
                                  : '',
                              }
                            : t,
                        ),
                      )
                    }
                  />
                  <Label
                    htmlFor="text-bg-box"
                    className="text-xs text-zinc-300 cursor-pointer"
                  >
                    자막 배경 박스
                  </Label>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                  외곽선
                  <input
                    type="color"
                    value={selectedTextClip.strokeColor}
                    onChange={(e) =>
                      setTextClips((prev) =>
                        prev.map((t) =>
                          t.id === selectedTextClip.id
                            ? { ...t, strokeColor: e.target.value }
                            : t,
                        ),
                      )
                    }
                    className="w-5 h-5 rounded bg-transparent cursor-pointer"
                  />
                </label>
              </div>

              {/* Transition Effect Controls (Dynamic Text / Caption) */}
              <div className="pt-2 border-t border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-zinc-300">트랜지션 효과</Label>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { key: 'none', label: '없음' },
                        { key: 'shrink', label: '축소' },
                        { key: 'grow', label: '확대' },
                      ] as const
                    ).map((opt) => {
                      const active =
                        (selectedTextClip.transition ?? 'none') === opt.key
                      return (
                        <Button
                          key={opt.key}
                          type="button"
                          size="xs"
                          variant={active ? 'default' : 'outline'}
                          className={`h-6 px-2 text-[11px] ${
                            active
                              ? 'bg-amber-600 hover:bg-amber-700 text-white'
                              : 'border-zinc-700 text-zinc-300'
                          }`}
                          onClick={() =>
                            setTextClips((prev) =>
                              prev.map((t) =>
                                t.id === selectedTextClip.id
                                  ? {
                                      ...t,
                                      transition: opt.key,
                                      transitionDuration:
                                        t.transitionDuration ?? 0.35,
                                      transitionStartPos:
                                        t.transitionStartPos ?? 'center',
                                      transitionEndPos:
                                        t.transitionEndPos ?? 'center',
                                      transitionEndBehavior:
                                        t.transitionEndBehavior ?? 'stay',
                                    }
                                  : t,
                              ),
                            )
                          }
                        >
                          {opt.label}
                        </Button>
                      )
                    })}
                  </div>
                </div>

                {(selectedTextClip.transition ?? 'none') !== 'none' && (
                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-zinc-300">
                        <span>트랜지션 유지 시간</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0.05}
                            max={5}
                            step={0.05}
                            value={Number(
                              (
                                selectedTextClip.transitionDuration ?? 0.35
                              ).toFixed(2),
                            )}
                            onChange={(e) => {
                              const raw = Number(e.target.value)
                              if (!Number.isFinite(raw)) return
                              const val = Math.max(0.05, Math.min(5, raw))
                              setTextClips((prev) =>
                                prev.map((t) =>
                                  t.id === selectedTextClip.id
                                    ? { ...t, transitionDuration: val }
                                    : t,
                                ),
                              )
                            }}
                            className="w-14 h-6 rounded bg-zinc-900 border border-zinc-700 px-1.5 text-right font-mono text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                          />
                          <span className="text-[11px] text-zinc-500">초</span>
                        </div>
                      </div>
                      <Slider
                        min={0.05}
                        max={3}
                        step={0.05}
                        value={[selectedTextClip.transitionDuration ?? 0.35]}
                        onValueChange={(raw) => {
                          const val = Array.isArray(raw) ? raw[0] : raw
                          setTextClips((prev) =>
                            prev.map((t) =>
                              t.id === selectedTextClip.id
                                ? { ...t, transitionDuration: val }
                                : t,
                            ),
                          )
                        }}
                      />
                    </div>

                    {/* 9-grid Start & End Positions inside Safe Zone */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-zinc-400">
                          시작 위치 (세이프존)
                        </Label>
                        <div className="grid grid-cols-3 gap-1">
                          {NINE_GRID_POSITIONS.map((pos) => {
                            const active =
                              (selectedTextClip.transitionStartPos ??
                                'center') === pos.id
                            return (
                              <Button
                                key={`start-${pos.id}`}
                                type="button"
                                size="xs"
                                variant={active ? 'default' : 'outline'}
                                className={`h-6 px-0 text-[10px] ${
                                  active
                                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                    : 'border-zinc-700 text-zinc-300'
                                }`}
                                onClick={() =>
                                  setTextClips((prev) =>
                                    prev.map((t) =>
                                      t.id === selectedTextClip.id
                                        ? { ...t, transitionStartPos: pos.id }
                                        : t,
                                    ),
                                  )
                                }
                              >
                                {pos.label}
                              </Button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[11px] text-zinc-400">
                          마지막 위치 (세이프존)
                        </Label>
                        <div className="grid grid-cols-3 gap-1">
                          {NINE_GRID_POSITIONS.map((pos) => {
                            const active =
                              (selectedTextClip.transitionEndPos ?? 'center') ===
                              pos.id
                            return (
                              <Button
                                key={`end-${pos.id}`}
                                type="button"
                                size="xs"
                                variant={active ? 'default' : 'outline'}
                                className={`h-6 px-0 text-[10px] ${
                                  active
                                    ? 'bg-sky-600 hover:bg-sky-700 text-white'
                                    : 'border-zinc-700 text-zinc-300'
                                }`}
                                onClick={() =>
                                  setTextClips((prev) =>
                                    prev.map((t) =>
                                      t.id === selectedTextClip.id
                                        ? { ...t, transitionEndPos: pos.id }
                                        : t,
                                    ),
                                  )
                                }
                              >
                                {pos.label}
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    {/* End Behavior: Stay vs Fade-out */}
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[11px] text-zinc-300">
                        트랜지션 종료 후
                      </Label>
                      <div className="grid grid-cols-2 gap-1">
                        {(
                          [
                            { key: 'stay', label: '그대로 유지' },
                            { key: 'fade-out', label: '페이드아웃' },
                          ] as const
                        ).map((opt) => {
                          const active =
                            (selectedTextClip.transitionEndBehavior ?? 'stay') ===
                            opt.key
                          return (
                            <Button
                              key={opt.key}
                              type="button"
                              size="xs"
                              variant={active ? 'default' : 'outline'}
                              className={`h-6 px-2 text-[11px] ${
                                active
                                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                  : 'border-zinc-700 text-zinc-300'
                              }`}
                              onClick={() =>
                                setTextClips((prev) =>
                                  prev.map((t) =>
                                    t.id === selectedTextClip.id
                                      ? { ...t, transitionEndBehavior: opt.key }
                                      : t,
                                  ),
                                )
                              }
                            >
                              {opt.label}
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Music Settings (always shown when music exists or when music is selected) */}
          {musicClip && (
            <div className="space-y-3 pt-2 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  배경 음악 (전체 영상 기준)
                </h3>
                <Switch
                  checked={musicClip.enabled}
                  onCheckedChange={(checked) =>
                    setMusicClip((prev) =>
                      prev ? { ...prev, enabled: checked } : prev,
                    )
                  }
                />
              </div>
              <p className="text-xs text-zinc-400 truncate">{musicClip.name}</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">
                    Fade-in (초)
                  </Label>
                  <Input
                    type="number"
                    step={0.5}
                    min={0}
                    max={15}
                    value={musicClip.fadeInSec}
                    onChange={(e) =>
                      setMusicClip((prev) =>
                        prev
                          ? {
                              ...prev,
                              fadeInSec: Math.max(
                                0,
                                Number(e.target.value) || 0,
                              ),
                            }
                          : prev,
                      )
                    }
                    className="h-8 bg-zinc-900 border-zinc-700 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300">
                    Fade-out (초)
                  </Label>
                  <Input
                    type="number"
                    step={0.5}
                    min={0}
                    max={15}
                    value={musicClip.fadeOutSec}
                    onChange={(e) =>
                      setMusicClip((prev) =>
                        prev
                          ? {
                              ...prev,
                              fadeOutSec: Math.max(
                                0,
                                Number(e.target.value) || 0,
                              ),
                            }
                          : prev,
                      )
                    }
                    className="h-8 bg-zinc-900 border-zinc-700 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-300">
                  <span>음악 볼륨</span>
                  <span className="font-mono">
                    {Math.round(musicClip.volume * 100)}%
                  </span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[musicClip.volume]}
                  onValueChange={(raw) => {
                    const val = Array.isArray(raw) ? raw[0] : raw
                    setMusicClip((prev) =>
                      prev ? { ...prev, volume: val } : prev,
                    )
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="music-loop"
                  checked={musicClip.loop}
                  onCheckedChange={(checked) =>
                    setMusicClip((prev) =>
                      prev ? { ...prev, loop: Boolean(checked) } : prev,
                    )
                  }
                />
                <Label
                  htmlFor="music-loop"
                  className="text-xs text-zinc-300 cursor-pointer"
                >
                  전체 영상 길이에 맞춰 반복
                </Label>
              </div>
            </div>
          )}

          {!selectedVideoClip && !selectedTextClip && !musicClip && (
            <div className="text-xs text-zinc-500 space-y-2 py-4">
              <p className="font-medium text-zinc-400">
                단축키 안내 (Premiere Pro 호환)
              </p>
              <ul className="space-y-1 text-[11px]">
                <li>• Space / K / L: 재생 · 일시정지</li>
                <li>• Q / W: 클립 왼쪽 / 오른쪽 자르기</li>
                <li>• Ctrl+K (또는 S): 클립 분리하기</li>
                <li>• ← / → (Shift: 5프레임): 프레임 이동</li>
                <li>• ↑ / ↓: 이전 / 다음 클립 경계 이동</li>
                <li>• Home / End: 처음 / 끝으로 이동</li>
                <li>• = / - / \: 타임라인 확대 · 축소 · 맞춤</li>
                <li>• ` (백틱): 전체화면 미리보기</li>
                <li>• T: 캡션 추가</li>
                <li>• Ctrl+M: 현재 비율 FHD 내보내기</li>
                <li>• Ctrl+C / Ctrl+V / Alt+드래그: 복사 · 붙여넣기</li>
                <li>• Ctrl+Z / Ctrl+Shift+Z: 실행 취소 · 다시 실행</li>
                <li>• Delete: 선택 항목 삭제</li>
              </ul>
            </div>
          )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom: Multi-track Timeline */}
      <div data-guide="timeline">
        <Timeline
        playhead={playhead}
        totalDuration={totalDuration}
        pxPerSec={pxPerSec}
        onPxPerSecChange={setPxPerSec}
        onSeek={(t) => {
          setIsPlaying(false)
          setPlayhead(t)
        }}
        videoClips={videoClips}
        textClips={textClips}
        musicClip={musicClip}
        assets={assets}
        selection={selection}
        multiSelection={multiSelection}
        onSelect={(target) => {
          setMultiSelection({ videoIds: [], textIds: [] })
          setSelection(target)
        }}
        onToggleMultiSelect={handleToggleMultiSelect}
        onMarqueeSelect={handleMarqueeSelect}
        onMoveMultiClips={handleMoveMultiClips}
        onTrimLeft={handleTrimLeft}
        onTrimRight={handleTrimRight}
        onSplit={handleSplit}
        onRemoveGaps={handleRemoveGaps}
        onAddText={handleAddText}
        onAddDynamicText={handleAddDynamicText}
        onDeleteSelected={handleDeleteSelected}
        onBeginDrag={pushHistory}
        onMoveVideoClip={(id, nextStart) =>
          setVideoClips((prev) =>
            prev.map((c) =>
              c.id === id ? { ...c, timelineStart: nextStart } : c,
            ),
          )
        }
        onMoveTextClip={(id, nextStart, nextLayer) =>
          setTextClips((prev) =>
            prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    timelineStart: nextStart,
                    ...(nextLayer !== undefined ? { layer: nextLayer } : {}),
                  }
                : t,
            ),
          )
        }
        onResizeVideoClip={(id, nextStart, nextDuration, nextSourceStart) =>
          setVideoClips((prev) =>
            prev.map((c) =>
              c.id === id
                ? {
                    ...c,
                    timelineStart: nextStart,
                    duration: nextDuration,
                    sourceStart: nextSourceStart,
                  }
                : c,
            ),
          )
        }
        onResizeTextClip={(id, nextStart, nextDuration) =>
          setTextClips((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, timelineStart: nextStart, duration: nextDuration }
                : t,
            ),
          )
        }
        onDuplicateVideoClip={handleDuplicateVideoClip}
        onDuplicateTextClip={handleDuplicateTextClip}
        onToggleTrackSelect={(kind, layer) => {
          if (kind === 'video') {
            const allIds = videoClips.map((c) => c.id)
            const allSelected =
              allIds.length > 0 &&
              allIds.every((id) => multiSelection.videoIds.includes(id))
            if (allSelected) {
              setMultiSelection((prev) => ({ ...prev, videoIds: [] }))
              setSelection(null)
            } else {
              setMultiSelection({ videoIds: allIds, textIds: [] })
              setSelection(
                allIds.length === 1 ? { kind: 'video', id: allIds[0] } : null,
              )
            }
          } else if (kind === 'text') {
            const layerIds = textClips
              .filter((t) => (t.layer ?? 0) === (layer ?? 0))
              .map((t) => t.id)
            const allSelected =
              layerIds.length > 0 &&
              layerIds.every((id) => multiSelection.textIds.includes(id))
            if (allSelected) {
              setMultiSelection((prev) => ({
                ...prev,
                textIds: prev.textIds.filter((id) => !layerIds.includes(id)),
              }))
              setSelection(null)
            } else {
              setMultiSelection({ videoIds: [], textIds: layerIds })
              setSelection(
                layerIds.length === 1 ? { kind: 'text', id: layerIds[0] } : null,
              )
            }
          } else if (kind === 'music' && musicClip) {
            setMultiSelection({ videoIds: [], textIds: [] })
            setSelection((prev) =>
              prev?.kind === 'music' && prev.id === musicClip.id
                ? null
                : { kind: 'music', id: musicClip.id },
            )
          }
        }}
        videoTrackHidden={videoTrackHidden}
        hiddenCaptionLayers={hiddenCaptionLayers}
        musicTrackMuted={musicTrackMuted}
        onToggleVideoTrackHidden={() => setVideoTrackHidden((v) => !v)}
        onToggleCaptionLayerHidden={(layer) =>
          setHiddenCaptionLayers((prev) =>
            prev.includes(layer)
              ? prev.filter((l) => l !== layer)
              : [...prev, layer],
          )
        }
        onToggleMusicTrackMuted={() => setMusicTrackMuted((m) => !m)}
        audioDb={audioDb}
      />
      </div>

      {/* Thumbnail Generator Modal */}
      <ThumbnailDialog
        open={thumbnailOpen}
        onOpenChange={setThumbnailOpen}
        aspectRatio={aspectRatio}
        playhead={playhead}
        videoElement={videoElRef.current}
        videoClip={activeVideoClip}
        activeTexts={activeTextClips}
        workspaceDirHandle={workspaceDirHandle}
      />

      {/* Welcome / Project Setup Dialog */}
      <Dialog open={welcomeOpen} onOpenChange={setWelcomeOpen}>
        <DialogContent className="sm:max-w-[520px] bg-zinc-950 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Film className="w-5 h-5 text-sky-400" />
              Kremble Cut 시작하기
            </DialogTitle>
            <DialogDescription className="text-zinc-400 text-xs">
              새 프로젝트의 작업 폴더와 파일 이름을 설정하거나, 화면 구성
              가이드를 먼저 살펴보세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="rounded-lg border border-sky-800/50 bg-sky-950/20 p-3.5 space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-300">
                <FolderPlus className="w-4 h-4" />
                새 프로젝트 시작
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-zinc-300">
                  프로젝트 파일 이름
                </Label>
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="예: squat-vlog-01"
                  className="h-8 bg-zinc-900 border-zinc-700 text-xs"
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                폴더를 선택하면 해당 폴더가 작업 폴더로 지정되며, 프로젝트
                파일(5분마다 자동 저장)·내보낸 MP4·썸네일이 모두 작업 폴더에
                바로 저장됩니다.
              </p>
              <Button
                type="button"
                className="w-full bg-sky-500 hover:bg-sky-600 text-white text-xs"
                onClick={() => void handleStartNewProject()}
              >
                <FolderPlus className="w-3.5 h-3.5 mr-1.5" />
                작업 폴더 선택하고 새 프로젝트 시작
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                className="h-10 border-zinc-700 bg-zinc-900/70 hover:bg-zinc-800 text-zinc-200 text-xs"
                onClick={() => {
                  setWelcomeOpen(false)
                  setGuideOpen(true)
                }}
              >
                <BookOpen className="w-4 h-4 mr-1.5 text-amber-400" />
                사용 가이드 보기
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 border-zinc-700 bg-zinc-900/70 hover:bg-zinc-800 text-zinc-300 text-xs"
                onClick={() => {
                  setWelcomeOpen(false)
                  projectInputRef.current?.click()
                }}
              >
                <FolderOpen className="w-4 h-4 mr-1.5 text-emerald-400" />
                기존 프로젝트 열기
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Interactive Visual Guide Overlay */}
      <VisualGuideOverlay
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onStartNewProject={() => setWelcomeOpen(true)}
      />
    </div>
  )
}
