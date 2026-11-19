import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Lock,
  Music,
  Scissors,
  Space,
  Sparkles,
  Trash2,
  Type,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Slider } from '#/components/ui/slider'
import { findActiveVideoClip, formatTimecode } from '#/editor/timelineOps'
import {
  DEFAULT_TRANSITION_DURATION,
  type MediaAsset,
  type MusicClip,
  type SelectionTarget,
  type TextClip,
  type VideoClip,
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
  multiSelection?: { videoIds: string[]; textIds: string[] }
  onSelect: (target: SelectionTarget) => void
  onToggleMultiSelect?: (target: { kind: 'video' | 'text'; id: string }) => void
  onMarqueeSelect?: (sel: { videoIds: string[]; textIds: string[] }) => void
  onMoveMultiClips?: (deltaSec: number) => void
  onTrimLeft: () => void
  onTrimRight: () => void
  onSplit: () => void
  onRemoveGaps: () => void
  onAddText: () => void
  onAddDynamicText?: () => void
  onDeleteSelected: () => void
  onBeginDrag?: () => void
  onMoveVideoClip: (id: string, nextStart: number) => void
  onMoveTextClip: (id: string, nextStart: number, nextLayer?: number) => void
  onResizeVideoClip?: (
    id: string,
    nextStart: number,
    nextDuration: number,
    nextSourceStart: number,
  ) => void
  onResizeTextClip: (id: string, nextStart: number, nextDuration: number) => void
  onDuplicateVideoClip: (id: string) => string | null
  onDuplicateTextClip: (id: string) => string | null
  onToggleTrackSelect?: (kind: 'video' | 'text' | 'music', layer?: number) => void
  videoTrackHidden?: boolean
  hiddenCaptionLayers?: number[]
  musicTrackMuted?: boolean
  videoTrackLocked?: boolean
  lockedCaptionLayers?: number[]
  musicTrackLocked?: boolean
  onToggleVideoTrackHidden?: () => void
  onToggleCaptionLayerHidden?: (layer: number) => void
  onToggleMusicTrackMuted?: () => void
  onToggleVideoTrackLocked?: () => void
  onToggleCaptionLayerLocked?: (layer: number) => void
  onToggleMusicTrackLocked?: () => void
  audioDb?: [number, number]
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
  multiSelection,
  onSelect,
  onToggleMultiSelect,
  onMarqueeSelect,
  onMoveMultiClips,
  onTrimLeft,
  onTrimRight,
  onSplit,
  onRemoveGaps,
  onAddText,
  onAddDynamicText,
  onDeleteSelected,
  onBeginDrag,
  onMoveVideoClip,
  onMoveTextClip,
  onResizeVideoClip,
  onResizeTextClip,
  onDuplicateVideoClip,
  onDuplicateTextClip,
  onToggleTrackSelect,
  videoTrackHidden = false,
  hiddenCaptionLayers = [],
  musicTrackMuted = false,
  videoTrackLocked = false,
  lockedCaptionLayers = [],
  musicTrackLocked = false,
  onToggleVideoTrackHidden,
  onToggleCaptionLayerHidden,
  onToggleMusicTrackMuted,
  onToggleVideoTrackLocked,
  onToggleCaptionLayerLocked,
  onToggleMusicTrackLocked,
  audioDb = [-60, -60],
}: TimelineProps) {
  const tracksRef = useRef<HTMLDivElement | null>(null)
  const tracksAreaRef = useRef<HTMLDivElement | null>(null)
  const marqueeRef = useRef<{
    startClientX: number
    startClientY: number
    startLocalX: number
    startLocalY: number
    hasMoved: boolean
  } | null>(null)
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [snapLineTime, setSnapLineTime] = useState<number | null>(null)
  const dragRef = useRef<{
    kind: 'video' | 'text'
    mode: 'move' | 'resize-left' | 'resize-right'
    id: string
    startX: number
    startY: number
    origStart: number
    origSourceStart: number
    origSourceDuration: number
    origLayer: number
    duration: number
    altCopy: boolean
    lastDeltaSec: number
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

  const MIN_ZOOM = 1
  const MAX_ZOOM = 240
  const clampZoom = (v: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v))

  useEffect(() => {
    const el = tracksRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta !== 0) {
        e.preventDefault()
        el.scrollLeft += delta
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

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
    const snapThreshold = 12 / pxPerSec
    const targets = [0, playhead]
    for (const c of videoClips) {
      if (kind === 'video' && c.id === id) continue
      targets.push(c.timelineStart, c.timelineStart + c.duration)
    }
    for (const t of textClips) {
      if (kind === 'text' && t.id === id) continue
      targets.push(t.timelineStart, t.timelineStart + t.duration)
      if ((t.transition ?? 'none') !== 'none') {
        targets.push(
          t.timelineStart + Math.max(0.05, t.transitionDuration ?? DEFAULT_TRANSITION_DURATION),
        )
      }
    }
    let best = clamped
    let bestDist = snapThreshold
    let snapped = false
    for (const target of targets) {
      const dist = Math.abs(clamped - target)
      if (dist < bestDist) {
        best = target
        bestDist = dist
        snapped = true
      }
    }
    setSnapLineTime(snapped ? best : null)
    return best
  }

  const isClipInMulti = (kind: 'video' | 'text', id: string) =>
    kind === 'video'
      ? Boolean(multiSelection?.videoIds.includes(id))
      : Boolean(multiSelection?.textIds.includes(id))

  const isTrackLocked = (kind: 'video' | 'text', layer = 0) =>
    kind === 'video' ? videoTrackLocked : lockedCaptionLayers.includes(layer)

  const startClipDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: 'video' | 'text',
    id: string,
    origStart: number,
    duration: number,
    origLayer = 0,
    mode: 'move' | 'resize-left' | 'resize-right' = 'move',
    origSourceStart = 0,
    origSourceDuration = duration,
  ) => {
    e.stopPropagation()
    if (isTrackLocked(kind, origLayer)) {
      return
    }
    if (e.shiftKey && mode === 'move' && onToggleMultiSelect) {
      onToggleMultiSelect({ kind, id })
      return
    }
    if (!isClipInMulti(kind, id)) {
      onSelect({ kind, id })
    }
    dragRef.current = {
      kind,
      mode,
      id,
      startX: e.clientX,
      startY: e.clientY,
      origStart,
      origSourceStart,
      origSourceDuration,
      origLayer,
      duration,
      altCopy: mode === 'move' && e.altKey,
      lastDeltaSec: 0,
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

    if (
      drag.mode === 'move' &&
      !drag.altCopy &&
      isClipInMulti(drag.kind, drag.id) &&
      onMoveMultiClips &&
      (multiSelection?.videoIds.length ?? 0) +
        (multiSelection?.textIds.length ?? 0) >
        1
    ) {
      const stepDelta = deltaSec - drag.lastDeltaSec
      drag.lastDeltaSec = deltaSec
      onMoveMultiClips(stepDelta)
      return
    }

    if (drag.kind === 'video' && drag.mode === 'resize-left' && onResizeVideoClip) {
      const origEnd = drag.origStart + drag.duration
      const minStart = drag.origStart - drag.origSourceStart
      const maxStart = origEnd - 0.1
      const rawStart = Math.max(minStart, Math.min(maxStart, drag.origStart + deltaSec))
      const snappedStart = Math.max(
        minStart,
        Math.min(maxStart, snapTime(rawStart, 'video', drag.id)),
      )
      const nextSourceStart = drag.origSourceStart + (snappedStart - drag.origStart)
      onResizeVideoClip(
        drag.id,
        snappedStart,
        origEnd - snappedStart,
        nextSourceStart,
      )
      return
    }

    if (drag.kind === 'video' && drag.mode === 'resize-right' && onResizeVideoClip) {
      const minEnd = drag.origStart + 0.1
      const maxEnd =
        drag.origStart + (drag.origSourceDuration - drag.origSourceStart)
      const rawEnd = Math.max(
        minEnd,
        Math.min(maxEnd, drag.origStart + drag.duration + deltaSec),
      )
      const snappedEnd = Math.max(
        minEnd,
        Math.min(maxEnd, snapTime(rawEnd, 'video', drag.id)),
      )
      onResizeVideoClip(
        drag.id,
        drag.origStart,
        snappedEnd - drag.origStart,
        drag.origSourceStart,
      )
      return
    }

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
    setSnapLineTime(null)
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
            title="캡션 추가 (단축키: T)"
          >
            <Type className="w-3.5 h-3.5 mr-1 text-violet-400" />
            캡션 추가
          </Button>
          {onAddDynamicText && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAddDynamicText}
              className="h-7 px-2.5 text-xs border-amber-600/50 bg-zinc-900 hover:bg-amber-950/40 text-amber-200"
              title="축소·확대 트랜지션이 적용된 전체화면 텍스트 추가"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-400" />
              전체화면 텍스트
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={
              !selection &&
              (multiSelection?.videoIds.length ?? 0) +
                (multiSelection?.textIds.length ?? 0) ===
                0
            }
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
        <div className="w-36 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col">
          <div className="h-7 border-b border-zinc-800 px-2 flex items-center text-[10px] font-mono text-zinc-500">
            {formatTimecode(playhead)}
          </div>
          {displayedTextLayers.map((layerIdx) => {
            const isHidden = hiddenCaptionLayers.includes(layerIdx)
            const isLocked = lockedCaptionLayers.includes(layerIdx)
            return (
              <div
                key={`text-label-${layerIdx}`}
                onClick={() => {
                  if (!isLocked) onToggleTrackSelect?.('text', layerIdx)
                }}
                className={`h-9 border-b border-zinc-800/70 px-2 flex items-center gap-1.5 text-xs ${
                  isLocked
                    ? 'cursor-not-allowed bg-zinc-900/70 text-zinc-400'
                    : 'cursor-pointer hover:bg-zinc-800/40'
                } ${isHidden ? 'text-zinc-500' : 'text-violet-300'}`}
                title={
                  isLocked
                    ? '잠긴 트랙 (자물쇠를 눌러 잠금 해제)'
                    : '클릭하여 이 트랙의 모든 캡션 선택/해제'
                }
              >
                <input
                  type="checkbox"
                  checked={!isHidden}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleCaptionLayerHidden?.(layerIdx)}
                  className="h-3.5 w-3.5 accent-violet-500 cursor-pointer shrink-0"
                  title="캡션 레이어 보이기/숨기기"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleCaptionLayerLocked?.(layerIdx)
                  }}
                  className={`p-0.5 rounded hover:bg-zinc-700/60 shrink-0 ${
                    isLocked ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  title={isLocked ? '트랙 잠금 해제' : '트랙 잠금'}
                >
                  {isLocked ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <Unlock className="w-3 h-3" />
                  )}
                </button>
                <Type className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {textLayerCount > 1 ? `캡션 ${layerIdx + 1}` : '캡션'}
                </span>
              </div>
            )
          })}
          <div
            onClick={() => {
              if (!videoTrackLocked) onToggleTrackSelect?.('video')
            }}
            className={`h-14 border-b border-zinc-800/70 px-2 flex items-center gap-1.5 text-xs ${
              videoTrackLocked
                ? 'cursor-not-allowed bg-zinc-900/70 text-zinc-400'
                : 'cursor-pointer hover:bg-zinc-800/40'
            } ${videoTrackHidden ? 'text-zinc-500' : 'text-sky-300'}`}
            title={
              videoTrackLocked
                ? '잠긴 트랙 (자물쇠를 눌러 잠금 해제)'
                : '클릭하여 모든 비디오 클립 선택/해제'
            }
          >
            <input
              type="checkbox"
              checked={!videoTrackHidden}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleVideoTrackHidden?.()}
              className="h-3.5 w-3.5 accent-sky-500 cursor-pointer shrink-0"
              title="비디오 트랙 보이기/숨기기"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleVideoTrackLocked?.()
              }}
              className={`p-0.5 rounded hover:bg-zinc-700/60 shrink-0 ${
                videoTrackLocked
                  ? 'text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={videoTrackLocked ? '비디오 트랙 잠금 해제' : '비디오 트랙 잠금'}
            >
              {videoTrackLocked ? (
                <Lock className="w-3 h-3" />
              ) : (
                <Unlock className="w-3 h-3" />
              )}
            </button>
            <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
            <span className="truncate">비디오</span>
          </div>
          <div
            onClick={() => {
              if (!musicTrackLocked) onToggleTrackSelect?.('music')
            }}
            className={`h-11 px-2 flex items-center gap-1.5 text-xs ${
              musicTrackLocked
                ? 'cursor-not-allowed bg-zinc-900/70 text-zinc-400'
                : 'cursor-pointer hover:bg-zinc-800/40'
            } ${musicTrackMuted ? 'text-zinc-500' : 'text-emerald-300'}`}
            title={
              musicTrackLocked
                ? '잠긴 트랙 (자물쇠를 눌러 잠금 해제)'
                : '클릭하여 음악 트랙 선택/해제'
            }
          >
            <input
              type="checkbox"
              checked={!musicTrackMuted}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleMusicTrackMuted?.()}
              className="h-3.5 w-3.5 accent-emerald-500 cursor-pointer shrink-0"
              title="음악 트랙 소리 켜기/끄기"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleMusicTrackLocked?.()
              }}
              className={`p-0.5 rounded hover:bg-zinc-700/60 shrink-0 ${
                musicTrackLocked
                  ? 'text-amber-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={musicTrackLocked ? '음악 트랙 잠금 해제' : '음악 트랙 잠금'}
            >
              {musicTrackLocked ? (
                <Lock className="w-3 h-3" />
              ) : (
                <Unlock className="w-3 h-3" />
              )}
            </button>
            <Music className="w-3 h-3 shrink-0" />
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

            {/* Marquee-selectable Tracks Wrapper (Captions + Video) */}
            <div
              ref={tracksAreaRef}
              className="relative"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const area = tracksAreaRef.current
                if (!area) return
                const rect = area.getBoundingClientRect()
                marqueeRef.current = {
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  startLocalX: e.clientX - rect.left,
                  startLocalY: e.clientY - rect.top,
                  hasMoved: false,
                }
                area.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const m = marqueeRef.current
                const area = tracksAreaRef.current
                if (!m || !area || e.buttons !== 1) return
                const dx = e.clientX - m.startClientX
                const dy = e.clientY - m.startClientY
                if (!m.hasMoved) {
                  if (Math.hypot(dx, dy) < 5) return
                  m.hasMoved = true
                }
                const rect = area.getBoundingClientRect()
                const curLocalX = Math.max(
                  0,
                  Math.min(rect.width, e.clientX - rect.left),
                )
                const curLocalY = Math.max(
                  0,
                  Math.min(rect.height, e.clientY - rect.top),
                )
                const left = Math.min(m.startLocalX, curLocalX)
                const top = Math.min(m.startLocalY, curLocalY)
                const width = Math.abs(curLocalX - m.startLocalX)
                const height = Math.abs(curLocalY - m.startLocalY)
                setMarqueeBox({ left, top, width, height })

                const selRect = {
                  left: rect.left + left,
                  right: rect.left + left + width,
                  top: rect.top + top,
                  bottom: rect.top + top + height,
                }
                const videoIds: string[] = []
                const textIds: string[] = []
                const nodes = area.querySelectorAll<HTMLElement>(
                  '[data-clip-kind][data-clip-id]',
                )
                nodes.forEach((node) => {
                  const r = node.getBoundingClientRect()
                  const intersects =
                    r.left <= selRect.right &&
                    r.right >= selRect.left &&
                    r.top <= selRect.bottom &&
                    r.bottom >= selRect.top
                  if (!intersects) return
                  if (node.dataset.clipLocked === 'true') return
                  const kind = node.dataset.clipKind
                  const id = node.dataset.clipId
                  if (!id) return
                  if (kind === 'video') videoIds.push(id)
                  if (kind === 'text') textIds.push(id)
                })
                onMarqueeSelect?.({ videoIds, textIds })
              }}
              onPointerUp={(e) => {
                const m = marqueeRef.current
                marqueeRef.current = null
                setMarqueeBox(null)
                if (m && !m.hasMoved) {
                  onMarqueeSelect?.({ videoIds: [], textIds: [] })
                  handleScrub(e.clientX)
                }
              }}
              onPointerCancel={() => {
                marqueeRef.current = null
                setMarqueeBox(null)
              }}
            >
            {/* Caption Multi-Layer Tracks */}
            {displayedTextLayers.map((layerIdx) => (
              <div
                key={`text-track-${layerIdx}`}
                className="relative h-9 border-b border-zinc-800/70 bg-zinc-950/80"
              >
                {textClips
                  .filter((t) => (t.layer ?? 0) === layerIdx)
                  .map((t) => {
                    const isSelected =
                      (selection?.kind === 'text' && selection.id === t.id) ||
                      isClipInMulti('text', t.id)
                    const left = t.timelineStart * pxPerSec
                    const width = Math.max(24, t.duration * pxPerSec)
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        data-clip-kind="text"
                        data-clip-id={t.id}
                        data-clip-locked={
                          lockedCaptionLayers.includes(layerIdx)
                            ? 'true'
                            : 'false'
                        }
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
                        className={`group absolute top-1 bottom-1 rounded px-2.5 flex items-center text-left text-xs truncate border transition-colors ${
                          lockedCaptionLayers.includes(layerIdx)
                            ? 'opacity-65 cursor-not-allowed'
                            : 'cursor-grab active:cursor-grabbing'
                        } ${
                          isSelected
                            ? t.isDynamic
                              ? 'bg-amber-600/40 border-amber-400 text-white ring-1 ring-amber-400/50'
                              : 'bg-violet-600/40 border-violet-400 text-white ring-1 ring-violet-400/50'
                            : t.isDynamic
                              ? 'bg-amber-950/60 border-amber-700/60 text-amber-200 hover:border-amber-500'
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
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            if (lockedCaptionLayers.includes(layerIdx)) return
                            const targetVideo =
                              findActiveVideoClip(videoClips, playhead) ??
                              videoClips.find(
                                (v) =>
                                  t.timelineStart < v.timelineStart + v.duration &&
                                  t.timelineStart + t.duration > v.timelineStart,
                              )
                            if (!targetVideo) return
                            onBeginDrag?.()
                            const end = t.timelineStart + t.duration
                            const nextStart = targetVideo.timelineStart
                            const nextDuration = Math.max(0.1, end - nextStart)
                            onResizeTextClip(t.id, nextStart, nextDuration)
                          }}
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-violet-400/50 rounded-l"
                          title="왼쪽 경계 드래그로 시작/길이 조절 (더블클릭: 현재 영상 클립 왼쪽 맞춤)"
                        />
                        <span className="truncate pointer-events-none flex items-center gap-1">
                          {t.isDynamic && (
                            <Sparkles className="w-3 h-3 text-amber-300 shrink-0" />
                          )}
                          {t.text || '(빈 캡션)'}
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
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            if (lockedCaptionLayers.includes(layerIdx)) return
                            const targetVideo =
                              findActiveVideoClip(videoClips, playhead) ??
                              videoClips.find(
                                (v) =>
                                  t.timelineStart < v.timelineStart + v.duration &&
                                  t.timelineStart + t.duration > v.timelineStart,
                              )
                            if (!targetVideo) return
                            onBeginDrag?.()
                            const targetEnd =
                              targetVideo.timelineStart + targetVideo.duration
                            const nextDuration = Math.max(
                              0.1,
                              targetEnd - t.timelineStart,
                            )
                            onResizeTextClip(t.id, t.timelineStart, nextDuration)
                          }}
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-violet-400/50 rounded-r"
                          title="오른쪽 경계 드래그로 길이 조절 (더블클릭: 현재 영상 클립 오른쪽 맞춤)"
                        />
                      </div>
                    )
                  })}
              </div>
            ))}

            {/* Video Track */}
            <div className="relative h-14 border-b border-zinc-800/70 bg-zinc-950">
              {videoClips.map((clip) => {
                const isSelected =
                  (selection?.kind === 'video' && selection.id === clip.id) ||
                  isClipInMulti('video', clip.id)
                const left = clip.timelineStart * pxPerSec
                const width = Math.max(20, clip.duration * pxPerSec)
                const asset = assets[clip.assetId]
                return (
                  <div
                    key={clip.id}
                    role="button"
                    tabIndex={0}
                    data-clip-kind="video"
                    data-clip-id={clip.id}
                    data-clip-locked={videoTrackLocked ? 'true' : 'false'}
                    onPointerDown={(e) =>
                      startClipDrag(
                        e,
                        'video',
                        clip.id,
                        clip.timelineStart,
                        clip.duration,
                        0,
                        'move',
                        clip.sourceStart,
                        clip.sourceDuration,
                      )
                    }
                    onPointerMove={moveClipDrag}
                    onPointerUp={endClipDrag}
                    onPointerCancel={endClipDrag}
                    style={{ left: `${left}px`, width: `${width}px` }}
                    className={`group absolute top-1.5 bottom-1.5 rounded px-2.5 flex flex-col justify-center text-left border transition-colors overflow-hidden ${
                      videoTrackLocked
                        ? 'opacity-65 cursor-not-allowed'
                        : 'cursor-grab active:cursor-grabbing'
                    } ${
                      isSelected
                        ? 'bg-sky-600/35 border-sky-400 text-white ring-1 ring-sky-400/50'
                        : 'bg-sky-950/60 border-sky-800/70 text-sky-100 hover:border-sky-600'
                    }`}
                  >
                    <div
                      onPointerDown={(e) =>
                        startClipDrag(
                          e,
                          'video',
                          clip.id,
                          clip.timelineStart,
                          clip.duration,
                          0,
                          'resize-left',
                          clip.sourceStart,
                          clip.sourceDuration,
                        )
                      }
                      onPointerMove={moveClipDrag}
                      onPointerUp={endClipDrag}
                      onPointerCancel={endClipDrag}
                      className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-sky-400/50 rounded-l"
                      title="왼쪽 경계 드래그로 시작/길이 조절"
                    />
                    <div className="flex items-center gap-1.5 w-full pointer-events-none">
                      {asset?.resolutionTag && (
                        <span className="shrink-0 rounded bg-sky-500/25 px-1 py-0.2 text-[9px] font-semibold text-sky-300">
                          {asset.resolutionTag}
                        </span>
                      )}
                      <span className="text-xs font-medium truncate">
                        {clip.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-sky-300/70 pointer-events-none">
                      {clip.duration.toFixed(2)}s
                    </span>
                    <div
                      onPointerDown={(e) =>
                        startClipDrag(
                          e,
                          'video',
                          clip.id,
                          clip.timelineStart,
                          clip.duration,
                          0,
                          'resize-right',
                          clip.sourceStart,
                          clip.sourceDuration,
                        )
                      }
                      onPointerMove={moveClipDrag}
                      onPointerUp={endClipDrag}
                      onPointerCancel={endClipDrag}
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-sky-400/50 rounded-r"
                      title="오른쪽 경계 드래그로 길이 조절"
                    />
                  </div>
                )
              })}
            </div>

            {snapLineTime !== null && (
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]"
                style={{ left: `${snapLineTime * pxPerSec}px` }}
              />
            )}

            {marqueeBox && (
              <div
                className="pointer-events-none absolute z-30 border border-sky-400 bg-sky-400/15 rounded-[2px]"
                style={{
                  left: `${marqueeBox.left}px`,
                  top: `${marqueeBox.top}px`,
                  width: `${marqueeBox.width}px`,
                  height: `${marqueeBox.height}px`,
                }}
              />
            )}
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

        {/* Premiere-style Narrow Stereo dB Meter */}
        <div
          className="w-9 shrink-0 border-l border-zinc-800 bg-zinc-950 px-1 py-1.5 flex flex-col items-center justify-between select-none"
          title="오디오 출력 레벨 (dBFS)"
        >
          <span className="text-[9px] font-mono text-zinc-500 leading-none">
            dB
          </span>
          <div className="flex-1 w-full flex items-stretch justify-center gap-1 my-1">
            {([0, 1] as const).map((ch) => {
              const db = Math.max(-60, Math.min(0, audioDb[ch]))
              const pct = ((db + 60) / 60) * 100
              return (
                <div
                  key={ch}
                  className="relative w-2 h-full rounded-[2px] bg-zinc-900 border border-zinc-800 overflow-hidden"
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 transition-[height] duration-75"
                    style={{
                      height: `${pct}%`,
                      background:
                        'linear-gradient(to top, #22c55e 0%, #22c55e 68%, #eab308 82%, #ef4444 96%)',
                    }}
                  />
                </div>
              )
            })}
          </div>
          <span className="text-[9px] font-mono text-zinc-400 leading-none">
            {Math.max(audioDb[0], audioDb[1]) <= -59
              ? '-∞'
              : `${Math.round(Math.max(audioDb[0], audioDb[1]))}`}
          </span>
        </div>
      </div>
    </div>
  )
}
