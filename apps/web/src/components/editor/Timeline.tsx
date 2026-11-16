import { useEffect, useRef } from 'react'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Music,
  Scissors,
  Space,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Slider } from '#/components/ui/slider'
import { formatTimecode } from '#/editor/timelineOps'
import type {
  MediaAsset,
  MusicClip,
  SelectionTarget,
  TextClip,
  VideoClip,
} from '#/editor/types'

interface TimelineProps {
  playhead: number
  totalDuration: number
  pxPerSec: number
  onPxPerSecChange: (val: number) => void
  onSeek: (time: number) => void
  videoClips: VideoClip[]
  textClips: TextClip[]
  musicClip: MusicClip | null
  assets: Record<string, MediaAsset>
  selection: SelectionTarget
  onSelect: (target: SelectionTarget) => void
  onTrimLeft: () => void
  onTrimRight: () => void
  onSplit: () => void
  onRemoveGaps: () => void
  onAddText: () => void
  onDeleteSelected: () => void
  onBeginDrag?: () => void
  onMoveVideoClip: (id: string, nextStart: number) => void
  onMoveTextClip: (id: string, nextStart: number, nextLayer?: number) => void
  onResizeTextClip: (id: string, nextStart: number, nextDuration: number) => void
  onDuplicateVideoClip: (id: string) => string | null
  onDuplicateTextClip: (id: string) => string | null
}

export function Timeline({
  playhead,
  totalDuration,
  pxPerSec,
  onPxPerSecChange,
  onSeek,
  videoClips,
  textClips,
  musicClip,
  assets,
  selection,
  onSelect,
  onTrimLeft,
  onTrimRight,
  onSplit,
  onRemoveGaps,
  onAddText,
  onDeleteSelected,
  onBeginDrag,
  onMoveVideoClip,
  onMoveTextClip,
  onResizeTextClip,
  onDuplicateVideoClip,
  onDuplicateTextClip,
}: TimelineProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind: 'video' | 'text'
    mode: 'move' | 'resize-left' | 'resize-right'
    id: string
    startX: number
    startY: number
    origStart: number
    origLayer: number
    duration: number
    altCopy: boolean
    hasMoved: boolean
  } | null>(null)
  const textLayerCount = Math.max(
    1,
    ...textClips.map((t) => (t.layer ?? 0) + 1),
  )
  const displayedTextLayers = Array.from(
    { length: textLayerCount },
    (_, idx) => textLayerCount - 1 - idx,
  )
  const timelineLength = Math.max(totalDuration + 4, 15)
  const trackWidthPx = Math.max(800, timelineLength * pxPerSec)

  const MIN_ZOOM = 5
  const MAX_ZOOM = 240
  const clampZoom = (v: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v))

  useEffect(() => {
    const el = tracksRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault()
        const factor = e.deltaY < 0 ? 1.15 : 0.85
        onPxPerSecChange(Math.round(clampZoom(pxPerSec * factor)))
        return
      }
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta !== 0) {
        e.preventDefault()
        el.scrollLeft += delta
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pxPerSec, onPxPerSecChange])

  // Auto-scroll timeline horizontally when playhead crosses visible left/right bounds
  useEffect(() => {
    const el = tracksRef.current
    if (!el) return
    const playheadX = playhead * pxPerSec
    const viewLeft = el.scrollLeft
    const viewRight = viewLeft + el.clientWidth
    const margin = Math.min(48, el.clientWidth * 0.15)

    if (playheadX > viewRight - margin) {
      el.scrollLeft = playheadX - el.clientWidth + margin
    } else if (playheadX < viewLeft + margin) {
      el.scrollLeft = Math.max(0, playheadX - margin)
    }
  }, [playhead, pxPerSec])

  const handleFitZoom = () => {
    const el = tracksRef.current
    if (!el || totalDuration <= 0) return
    const available = Math.max(300, el.clientWidth - 40)
    const target = Math.round(clampZoom(available / Math.max(totalDuration, 1)))
    onPxPerSecChange(target)
  }

  const handleScrub = (clientX: number) => {
    const el = tracksRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left + el.scrollLeft
    const time = Math.max(0, Math.min(timelineLength, x / pxPerSec))
    onSeek(time)
  }

  const handlePointerDownRuler = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    handleScrub(e.clientX)
  }

  const handlePointerMoveRuler = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    handleScrub(e.clientX)
  }

  const snapTime = (rawTime: number, kind: 'video' | 'text', id: string) => {
    const clamped = Math.max(0, rawTime)
    const snapThreshold = 8 / pxPerSec
    const targets = [0, playhead]
    if (kind === 'video') {
      for (const c of videoClips) {
        if (c.id === id) continue
        targets.push(c.timelineStart, c.timelineStart + c.duration)
      }
    } else {
      for (const t of textClips) {
        if (t.id === id) continue
        targets.push(t.timelineStart, t.timelineStart + t.duration)
      }
    }
    let best = clamped
    let bestDist = snapThreshold
    for (const target of targets) {
      const dist = Math.abs(clamped - target)
      if (dist < bestDist) {
        best = target
        bestDist = dist
      }
    }
    return best
  }

  const startClipDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: 'video' | 'text',
    id: string,
    origStart: number,
    duration: number,
    origLayer = 0,
    mode: 'move' | 'resize-left' | 'resize-right' = 'move',
  ) => {
    e.stopPropagation()
    onSelect({ kind, id })
    dragRef.current = {
      kind,
      mode,
      id,
      startX: e.clientX,
      startY: e.clientY,
      origStart,
      origLayer,
      duration,
      altCopy: mode === 'move' && e.altKey,
      hasMoved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveClipDrag = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || e.buttons !== 1) return
    if (!drag.hasMoved) {
      if (
        Math.abs(e.clientX - drag.startX) < 3 &&
        Math.abs(e.clientY - drag.startY) < 3
      ) {
        return
      }
      drag.hasMoved = true
      onBeginDrag?.()
      if (drag.altCopy) {
        const dupId =
          drag.kind === 'video'
            ? onDuplicateVideoClip(drag.id)
            : onDuplicateTextClip(drag.id)
        if (dupId) {
          drag.id = dupId
          onSelect({ kind: drag.kind, id: dupId })
        }
      }
    }

    const deltaSec = (e.clientX - drag.startX) / pxPerSec

    if (drag.kind === 'text' && drag.mode === 'resize-left') {
      const origEnd = drag.origStart + drag.duration
      const rawStart = Math.min(origEnd - 0.1, drag.origStart + deltaSec)
      const snappedStart = Math.min(
        origEnd - 0.1,
        snapTime(rawStart, 'text', drag.id),
      )
      onResizeTextClip(drag.id, snappedStart, origEnd - snappedStart)
      return
    }

    if (drag.kind === 'text' && drag.mode === 'resize-right') {
      const rawEnd = Math.max(
        drag.origStart + 0.1,
        drag.origStart + drag.duration + deltaSec,
      )
      const snappedEnd = Math.max(
        drag.origStart + 0.1,
        snapTime(rawEnd, 'text', drag.id),
      )
      onResizeTextClip(drag.id, drag.origStart, snappedEnd - drag.origStart)
      return
    }

    const nextStart = snapTime(drag.origStart + deltaSec, drag.kind, drag.id)
    if (drag.kind === 'video') {
      onMoveVideoClip(drag.id, nextStart)
    } else {
      const layerDelta = Math.round((drag.startY - e.clientY) / 36)
      const nextLayer = Math.max(
        0,
        Math.min(textLayerCount, drag.origLayer + layerDelta),
      )
      onMoveTextClip(drag.id, nextStart, nextLayer)
    }
  }

  const endClipDrag = () => {
    dragRef.current = null
  }

  const rulerStep =
    pxPerSec >= 120
      ? 0.5
      : pxPerSec >= 60
        ? 1
        : pxPerSec >= 25
          ? 2
          : pxPerSec >= 10
            ? 5
            : 10
  const rulerTicks: number[] = []
  for (let t = 0; t <= timelineLength; t += rulerStep) {
    rulerTicks.push(Number(t.toFixed(1)))
  }

  const hasVideoSelection = selection?.kind === 'video'

  return (
    <div className="flex flex-col border-t border-zinc-800 bg-zinc-950 select-none">
      {/* Timeline Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/70">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasVideoSelection}
            onClick={onTrimLeft}
            className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100"
            title="플레이헤드 기준으로 클립 왼쪽 자르기 (단축키: Q 또는 [)"
          >
            <ArrowLeftToLine className="w-3.5 h-3.5 mr-1 text-sky-400" />
            왼쪽 자르기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasVideoSelection}
            onClick={onTrimRight}
            className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100"
            title="플레이헤드 기준으로 클립 오른쪽 자르기 (단축키: W 또는 ])"
          >
            <ArrowRightToLine className="w-3.5 h-3.5 mr-1 text-sky-400" />
            오른쪽 자르기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hasVideoSelection}
            onClick={onSplit}
            className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100"
            title="플레이헤드 위치에서 클립 분리하기 (단축키: Ctrl+K 또는 S)"
          >
            <Scissors className="w-3.5 h-3.5 mr-1 text-amber-400" />
            분리하기
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={videoClips.length === 0}
            onClick={onRemoveGaps}
            className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100"
            title="모든 비디오 클립 사이의 공백을 한 번에 제거합니다"
          >
            <Space className="w-3.5 h-3.5 mr-1 text-emerald-400" />
            클립 사이 공백 제거
          </Button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAddText}
            className="h-7 px-2.5 text-xs border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100"
          >
            <Type className="w-3.5 h-3.5 mr-1 text-violet-400" />
            텍스트/캡션 추가
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!selection}
            onClick={onDeleteSelected}
            className="h-7 px-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
            title="선택한 클립 삭제 (Delete)"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            삭제
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={pxPerSec <= MIN_ZOOM}
            onClick={() => onPxPerSecChange(clampZoom(pxPerSec - 10))}
            className="h-6 w-6 text-zinc-400 hover:text-zinc-100"
            title="타임라인 축소 (단축키: - 또는 Ctrl + 마우스 휠)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Slider
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={5}
            value={[pxPerSec]}
            onValueChange={(val) =>
              onPxPerSecChange(clampZoom(Array.isArray(val) ? val[0] : val))
            }
            className="w-24"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={pxPerSec >= MAX_ZOOM}
            onClick={() => onPxPerSecChange(clampZoom(pxPerSec + 10))}
            className="h-6 w-6 text-zinc-400 hover:text-zinc-100"
            title="타임라인 확대 (단축키: = 또는 Ctrl + 마우스 휠)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={totalDuration <= 0}
            onClick={handleFitZoom}
            className="h-6 px-2 text-[11px] border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            title="전체 영상 길이에 맞춰 타임라인 축소/확대"
          >
            전체 맞춤
          </Button>
          <span className="text-[11px] font-mono text-zinc-400 w-12 text-right">
            {pxPerSec}px/s
          </span>
        </div>
      </div>

      {/* Scrollable Tracks */}
      <div className="flex">
        {/* Track Labels */}
        <div className="w-28 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col">
          <div className="h-7 border-b border-zinc-800 px-2 flex items-center text-[10px] font-mono text-zinc-500">
            {formatTimecode(playhead)}
          </div>
          {displayedTextLayers.map((layerIdx) => (
            <div
              key={`text-label-${layerIdx}`}
              className="h-9 border-b border-zinc-800/70 px-2.5 flex items-center gap-1.5 text-xs text-violet-300"
            >
              <Type className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                {textLayerCount > 1 ? `텍스트 ${layerIdx + 1}` : '텍스트'}
              </span>
            </div>
          ))}
          <div className="h-14 border-b border-zinc-800/70 px-2.5 flex items-center gap-1.5 text-xs text-sky-300">
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
            <span className="truncate">비디오</span>
          </div>
          <div className="h-11 px-2.5 flex items-center gap-1.5 text-xs text-emerald-300">
            <Music className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">음악</span>
          </div>
        </div>

        {/* Timeline Canvas Area */}
        <div
          ref={tracksRef}
          className="relative flex-1 overflow-x-auto bg-zinc-950"
        >
          <div
            className="relative"
            style={{ width: `${trackWidthPx}px` }}
          >
            {/* Ruler */}
            <div
              onPointerDown={handlePointerDownRuler}
              onPointerMove={handlePointerMoveRuler}
              className="relative h-7 border-b border-zinc-800 bg-zinc-900/50 cursor-ew-resize"
            >
              {rulerTicks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 bottom-0 border-l border-zinc-700/70 pl-1 text-[10px] font-mono text-zinc-400 flex items-center"
                  style={{ left: `${t * pxPerSec}px` }}
                >
                  {t}s
                </div>
              ))}
            </div>

            {/* Text / Caption Multi-Layer Tracks */}
            {displayedTextLayers.map((layerIdx) => (
              <div
                key={`text-track-${layerIdx}`}
                className="relative h-9 border-b border-zinc-800/70 bg-zinc-950/80"
                onClick={(e) => {
                  if (e.target === e.currentTarget) handleScrub(e.clientX)
                }}
              >
                {textClips
                  .filter((t) => (t.layer ?? 0) === layerIdx)
                  .map((t) => {
                    const isSelected =
                      selection?.kind === 'text' && selection.id === t.id
                    const left = t.timelineStart * pxPerSec
                    const width = Math.max(24, t.duration * pxPerSec)
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) =>
                          startClipDrag(
                            e,
                            'text',
                            t.id,
                            t.timelineStart,
                            t.duration,
                            t.layer ?? 0,
                            'move',
                          )
                        }
                        onPointerMove={moveClipDrag}
                        onPointerUp={endClipDrag}
                        onPointerCancel={endClipDrag}
                        style={{ left: `${left}px`, width: `${width}px` }}
                        className={`group absolute top-1 bottom-1 rounded px-2.5 flex items-center text-left text-xs truncate border transition-colors cursor-grab active:cursor-grabbing ${
                          isSelected
                            ? 'bg-violet-600/40 border-violet-400 text-white'
                            : 'bg-violet-950/60 border-violet-700/60 text-violet-200 hover:border-violet-500'
                        }`}
                      >
                        <div
                          onPointerDown={(e) =>
                            startClipDrag(
                              e,
                              'text',
                              t.id,
                              t.timelineStart,
                              t.duration,
                              t.layer ?? 0,
                              'resize-left',
                            )
                          }
                          onPointerMove={moveClipDrag}
                          onPointerUp={endClipDrag}
                          onPointerCancel={endClipDrag}
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-violet-400/50 rounded-l"
                          title="왼쪽 경계 드래그로 시작/길이 조절"
                        />
                        <span className="truncate pointer-events-none">
                          {t.text || '(빈 텍스트)'}
                        </span>
                        <div
                          onPointerDown={(e) =>
                            startClipDrag(
                              e,
                              'text',
                              t.id,
                              t.timelineStart,
                              t.duration,
                              t.layer ?? 0,
                              'resize-right',
                            )
                          }
                          onPointerMove={moveClipDrag}
                          onPointerUp={endClipDrag}
                          onPointerCancel={endClipDrag}
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-violet-400/50 rounded-r"
                          title="오른쪽 경계 드래그로 길이 조절"
                        />
                      </div>
                    )
                  })}
              </div>
            ))}

            {/* Video Track */}
            <div
              className="relative h-14 border-b border-zinc-800/70 bg-zinc-950"
              onClick={(e) => {
                if (e.target === e.currentTarget) handleScrub(e.clientX)
              }}
            >
              {videoClips.map((clip) => {
                const isSelected =
                  selection?.kind === 'video' && selection.id === clip.id
                const left = clip.timelineStart * pxPerSec
                const width = Math.max(20, clip.duration * pxPerSec)
                const asset = assets[clip.assetId]
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onPointerDown={(e) =>
                      startClipDrag(
                        e,
                        'video',
                        clip.id,
                        clip.timelineStart,
                        clip.duration,
                      )
                    }
                    onPointerMove={moveClipDrag}
                    onPointerUp={endClipDrag}
                    onPointerCancel={endClipDrag}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    className={`absolute top-1.5 bottom-1.5 rounded px-2 flex flex-col justify-center text-left border transition-colors overflow-hidden cursor-grab active:cursor-grabbing ${
                      isSelected
                        ? 'bg-sky-600/35 border-sky-400 text-white ring-1 ring-sky-400/50'
                        : 'bg-sky-950/60 border-sky-800/70 text-sky-100 hover:border-sky-600'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 w-full">
                      {asset?.resolutionTag && (
                        <span className="shrink-0 rounded bg-sky-500/25 px-1 py-0.2 text-[9px] font-semibold text-sky-300">
                          {asset.resolutionTag}
                        </span>
                      )}
                      <span className="text-xs font-medium truncate">
                        {clip.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-sky-300/70">
                      {clip.duration.toFixed(2)}s
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Music Track (spans total video duration with fade-in/out visualization) */}
            <div
              className="relative h-11 bg-zinc-950/90"
              onClick={(e) => {
                if (e.target === e.currentTarget) handleScrub(e.clientX)
              }}
            >
              {musicClip && totalDuration > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect({ kind: 'music', id: musicClip.id })
                  }}
                  style={{
                    left: '0px',
                    width: `${Math.max(40, totalDuration * pxPerSec)}px`,
                  }}
                  className={`absolute top-1.5 bottom-1.5 rounded px-2 flex items-center justify-between text-xs border overflow-hidden ${
                    selection?.kind === 'music'
                      ? 'bg-emerald-600/35 border-emerald-400 text-white'
                      : 'bg-emerald-950/60 border-emerald-800/70 text-emerald-200 hover:border-emerald-600'
                  } ${!musicClip.enabled ? 'opacity-45' : ''}`}
                >
                  {/* Visual Fade-In ramp */}
                  {musicClip.fadeInSec > 0 && (
                    <div
                      className="pointer-events-none absolute left-0 top-0 bottom-0 bg-gradient-to-r from-black/65 to-transparent"
                      style={{
                        width: `${Math.min(totalDuration, musicClip.fadeInSec) * pxPerSec}px`,
                      }}
                    />
                  )}
                  {/* Visual Fade-Out ramp */}
                  {musicClip.fadeOutSec > 0 && (
                    <div
                      className="pointer-events-none absolute right-0 top-0 bottom-0 bg-gradient-to-l from-black/65 to-transparent"
                      style={{
                        width: `${Math.min(totalDuration, musicClip.fadeOutSec) * pxPerSec}px`,
                      }}
                    />
                  )}
                  <span className="relative z-10 truncate font-medium">
                    ♪ {musicClip.name}
                  </span>
                  <span className="relative z-10 shrink-0 text-[10px] font-mono text-emerald-300/80 ml-2">
                    Fade {musicClip.fadeInSec}s / {musicClip.fadeOutSec}s
                  </span>
                </button>
              )}
            </div>

            {/* Playhead Line */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-rose-500"
              style={{ left: `${playhead * pxPerSec}px` }}
            >
              <div className="w-3 h-3 -ml-[5px] bg-rose-500 rotate-45 -mt-1 rounded-[1px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
