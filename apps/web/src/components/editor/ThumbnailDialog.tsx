import { useEffect, useRef, useState } from 'react'
import { Download, Image as ImageIcon } from 'lucide-react'
import { PerCharColorEditor } from '#/components/editor/PerCharColorEditor'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Label } from '#/components/ui/label'
import { Slider } from '#/components/ui/slider'
import { saveFileInDirectory } from '#/editor/projectStorage'
import { renderThumbnailFrame } from '#/editor/render'
import {
  CANVAS_PRESETS,
  type AspectRatio,
  type NineGridPosition,
  type TextClip,
  type ThumbnailOptions,
  type VideoClip,
} from '#/editor/types'

const GRID_POSITIONS: { id: NineGridPosition; label: string }[] = [
  { id: 'top-left', label: '좌상' },
  { id: 'top-center', label: '상' },
  { id: 'top-right', label: '우상' },
  { id: 'middle-left', label: '좌' },
  { id: 'center', label: '중앙' },
  { id: 'middle-right', label: '우' },
  { id: 'bottom-left', label: '좌하' },
  { id: 'bottom-center', label: '하' },
  { id: 'bottom-right', label: '우하' },
]

interface ThumbnailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  aspectRatio: AspectRatio
  playhead: number
  videoElement: HTMLVideoElement | null
  videoClip: VideoClip | null
  activeTexts: TextClip[]
  workspaceDirHandle?: FileSystemDirectoryHandle | null
}

const THUMB_PREFS_KEY = 'myopencut.thumbnail.prefs.v1'

export function ThumbnailDialog({
  open,
  onOpenChange,
  aspectRatio,
  playhead,
  videoElement,
  videoClip,
  activeTexts,
  workspaceDirHandle = null,
}: ThumbnailDialogProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [showSafeZone, setShowSafeZone] = useState(true)
  const [options, setOptions] = useState<ThumbnailOptions>({
    dimEnabled: false,
    dimPercent: 20,
    overrideTextEnabled: false,
    overrideText: '',
    overrideTextColor: '#FFFFFF',
    overrideCharColors: {},
    overrideStrokeColor: '#000000',
    placementMode: 'safe-fill',
    gridPosition: 'center',
    gridFontSize: 110,
  })
  const [prefsReady, setPrefsReady] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(THUMB_PREFS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          showSafeZone: boolean
          options: Partial<ThumbnailOptions>
        }>
        if (typeof parsed.showSafeZone === 'boolean') {
          setShowSafeZone(parsed.showSafeZone)
        }
        if (parsed.options && typeof parsed.options === 'object') {
          setOptions((prev) => ({
            ...prev,
            ...parsed.options,
            overrideText: prev.overrideText,
          }))
        }
      }
    } catch {
      // Ignore malformed or unavailable localStorage
    } finally {
      setPrefsReady(true)
    }
  }, [])

  useEffect(() => {
    if (!prefsReady) return
    try {
      const { overrideText: _ignored, ...persistableOptions } = options
      window.localStorage.setItem(
        THUMB_PREFS_KEY,
        JSON.stringify({ showSafeZone, options: persistableOptions }),
      )
    } catch {
      // Ignore storage errors
    }
  }, [prefsReady, showSafeZone, options])

  const preset = CANVAS_PRESETS[aspectRatio]

  // Capture a snapshot of the video frame each time dialog opens (with rAF retry so portal canvas is mounted)
  const [frameBitmap, setFrameBitmap] = useState<HTMLCanvasElement | null>(null)
  const [renderTick, setRenderTick] = useState(0)

  useEffect(() => {
    if (!open) return
    if (!videoElement || !videoClip || videoElement.readyState < 2) {
      setFrameBitmap(null)
    } else {
      const snap = document.createElement('canvas')
      snap.width = videoElement.videoWidth || preset.width
      snap.height = videoElement.videoHeight || preset.height
      const sCtx = snap.getContext('2d')
      if (sCtx) {
        sCtx.drawImage(videoElement, 0, 0, snap.width, snap.height)
        setFrameBitmap(snap)
      }
    }
    const raf1 = requestAnimationFrame(() => setRenderTick((t) => t + 1))
    const timer = window.setTimeout(() => setRenderTick((t) => t + 1), 60)
    return () => {
      cancelAnimationFrame(raf1)
      window.clearTimeout(timer)
    }
  }, [open, videoElement, videoClip, preset.width, preset.height])

  useEffect(() => {
    if (!open) return
    const canvas = previewCanvasRef.current
    if (!canvas) return
    canvas.width = preset.width
    canvas.height = preset.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderThumbnailFrame({
      ctx,
      width: preset.width,
      height: preset.height,
      aspectRatio,
      videoElement: frameBitmap,
      videoClip,
      activeTexts,
      currentTime: playhead,
      options,
      showSafeZone,
    })
  }, [
    open,
    renderTick,
    preset.width,
    preset.height,
    aspectRatio,
    frameBitmap,
    videoClip,
    activeTexts,
    playhead,
    options,
    showSafeZone,
  ])

  const handleDownload = (format: 'png' | 'jpeg') => {
    const outCanvas = document.createElement('canvas')
    outCanvas.width = preset.width
    outCanvas.height = preset.height
    const ctx = outCanvas.getContext('2d')
    if (!ctx) return

    renderThumbnailFrame({
      ctx,
      width: preset.width,
      height: preset.height,
      aspectRatio,
      videoElement: frameBitmap,
      videoClip,
      activeTexts,
      currentTime: playhead,
      options,
      showSafeZone: false,
    })

    const mime = format === 'png' ? 'image/png' : 'image/jpeg'
    const fileName = `thumbnail-${aspectRatio.replace(':', 'x')}-${playhead.toFixed(2)}s.${format}`
    outCanvas.toBlob(
      async (blob) => {
        if (!blob) return
        if (workspaceDirHandle) {
          const ok = await saveFileInDirectory(
            workspaceDirHandle,
            fileName,
            blob,
          )
          if (ok) {
            setSavedNotice(`작업 폴더에 저장됨: ${fileName}`)
            window.setTimeout(() => setSavedNotice(null), 2200)
            return
          }
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
      },
      mime,
      0.95,
    )
  }

  const thumbTextAdapter: TextClip = {
    id: 'thumb-override',
    text: options.overrideText,
    defaultColor: options.overrideTextColor,
    charColors: options.overrideCharColors ?? {},
    fontSize: options.gridFontSize,
    fontWeight: 800,
    strokeColor: options.overrideStrokeColor,
    strokeWidth: 6,
    backgroundColor: '',
    timelineStart: 0,
    duration: 1,
    x: 0.5,
    y: 0.5,
    align: 'center',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[92vw] w-[1080px] max-h-[88vh] overflow-hidden p-4 bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-sky-400" />
              현재 프레임 썸네일 ({playhead.toFixed(2)}초 · {preset.label})
            </span>
            {savedNotice && (
              <span className="rounded bg-emerald-950/70 border border-emerald-700/50 px-2 py-0.5 text-[11px] font-normal text-emerald-300">
                {savedNotice}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          {/* Preview */}
          <div className="md:col-span-6 flex flex-col items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
            <canvas
              ref={previewCanvasRef}
              className="max-h-[56vh] max-w-full rounded shadow-lg border border-zinc-800 object-contain"
              style={{
                aspectRatio: `${preset.width} / ${preset.height}`,
              }}
            />
            <div className="mt-2 flex items-center gap-2 self-end">
              <Checkbox
                id="thumb-safezone"
                checked={showSafeZone}
                onCheckedChange={(v) => setShowSafeZone(Boolean(v))}
              />
              <Label
                htmlFor="thumb-safezone"
                className="text-xs text-zinc-400 cursor-pointer"
              >
                세이프존 가이드 표시 (저장 시 미포함)
              </Label>
            </div>
          </div>

          {/* Controls */}
          <div className="md:col-span-6 space-y-2.5 max-h-[72vh] overflow-y-auto pr-1">
            {/* Dim Option */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="thumb-dim"
                    checked={options.dimEnabled}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        dimEnabled: Boolean(checked),
                        dimPercent:
                          Boolean(checked) && prev.dimPercent === 0
                            ? 20
                            : prev.dimPercent,
                      }))
                    }
                  />
                  <Label
                    htmlFor="thumb-dim"
                    className="text-xs font-medium cursor-pointer"
                  >
                    배경 딤(Dim) 적용
                  </Label>
                </div>
                <span className="text-xs font-mono text-sky-400">
                  {options.dimEnabled ? `${options.dimPercent}%` : 'OFF'}
                </span>
              </div>
              {options.dimEnabled && (
                <Slider
                  min={5}
                  max={80}
                  step={5}
                  value={[options.dimPercent]}
                  onValueChange={(val) => {
                    const v = Array.isArray(val) ? val[0] : val
                    setOptions((prev) => ({ ...prev, dimPercent: v }))
                  }}
                />
              )}
            </div>

            {/* Replacement Overlay Text */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="thumb-override"
                    checked={options.overrideTextEnabled}
                    onCheckedChange={(checked) =>
                      setOptions((prev) => ({
                        ...prev,
                        overrideTextEnabled: Boolean(checked),
                      }))
                    }
                  />
                  <Label
                    htmlFor="thumb-override"
                    className="text-xs font-medium cursor-pointer"
                  >
                    기존 텍스트 대체 오버레이 입력
                  </Label>
                </div>
                {options.overrideTextEnabled && (
                  <label className="flex items-center gap-1.5 text-xs text-zinc-300">
                    외곽선
                    <input
                      type="color"
                      value={options.overrideStrokeColor}
                      onChange={(e) =>
                        setOptions((prev) => ({
                          ...prev,
                          overrideStrokeColor: e.target.value,
                        }))
                      }
                      className="w-5 h-5 rounded bg-transparent cursor-pointer"
                    />
                  </label>
                )}
              </div>

              {options.overrideTextEnabled && (
                <div className="space-y-2.5 pt-0.5">
                  <PerCharColorEditor
                    clip={thumbTextAdapter}
                    onChange={(patch) =>
                      setOptions((prev) => ({
                        ...prev,
                        ...(patch.text !== undefined
                          ? { overrideText: patch.text }
                          : {}),
                        ...(patch.defaultColor !== undefined
                          ? { overrideTextColor: patch.defaultColor }
                          : {}),
                        ...(patch.charColors !== undefined
                          ? { overrideCharColors: patch.charColors }
                          : {}),
                      }))
                    }
                  />

                  {/* Placement Mode */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant={
                        options.placementMode === 'safe-fill'
                          ? 'default'
                          : 'outline'
                      }
                      className={
                        options.placementMode === 'safe-fill'
                          ? 'bg-sky-500 hover:bg-sky-600 text-white'
                          : 'border-zinc-700 text-zinc-300'
                      }
                      onClick={() =>
                        setOptions((prev) => ({
                          ...prev,
                          placementMode: 'safe-fill',
                        }))
                      }
                    >
                      세이프존 꽉 채우기
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant={
                        options.placementMode === 'grid-9'
                          ? 'default'
                          : 'outline'
                      }
                      className={
                        options.placementMode === 'grid-9'
                          ? 'bg-sky-500 hover:bg-sky-600 text-white'
                          : 'border-zinc-700 text-zinc-300'
                      }
                      onClick={() =>
                        setOptions((prev) => ({
                          ...prev,
                          placementMode: 'grid-9',
                        }))
                      }
                    >
                      9개 방위 배치
                    </Button>
                  </div>

                  {options.placementMode === 'grid-9' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-1">
                        {GRID_POSITIONS.map((pos) => (
                          <Button
                            key={pos.id}
                            type="button"
                            size="xs"
                            variant={
                              options.gridPosition === pos.id
                                ? 'default'
                                : 'outline'
                            }
                            className={`h-6 text-[11px] ${
                              options.gridPosition === pos.id
                                ? 'bg-sky-500 hover:bg-sky-600 text-white'
                                : 'border-zinc-700 text-zinc-300'
                            }`}
                            onClick={() =>
                              setOptions((prev) => ({
                                ...prev,
                                gridPosition: pos.id,
                              }))
                            }
                          >
                            {pos.label}
                          </Button>
                        ))}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>글자 크기</span>
                          <span className="font-mono">{options.gridFontSize}px</span>
                        </div>
                        <Slider
                          min={40}
                          max={240}
                          step={4}
                          value={[options.gridFontSize]}
                          onValueChange={(val) => {
                            const v = Array.isArray(val) ? val[0] : val
                            setOptions((prev) => ({ ...prev, gridFontSize: v }))
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-0.5">
              <Button
                type="button"
                size="sm"
                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white"
                onClick={() => handleDownload('png')}
              >
                <Download className="w-4 h-4 mr-1.5" />
                PNG 저장
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                onClick={() => handleDownload('jpeg')}
              >
                <Download className="w-4 h-4 mr-1.5" />
                JPG 저장
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
