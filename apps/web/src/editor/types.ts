export type AspectRatio = '16:9' | '9:16'

export const DEFAULT_FPS = 30

export const CANVAS_PRESETS: Record<
  AspectRatio,
  { width: number; height: number; label: string; shortLabel: string }
> = {
  '16:9': {
    width: 1920,
    height: 1080,
    label: 'FHD 16:9 (1920×1080)',
    shortLabel: '16:9 가로',
  },
  '9:16': {
    width: 1080,
    height: 1920,
    label: 'FHD 9:16 (1080×1920)',
    shortLabel: '9:16 숏폼',
  },
}

export interface MediaAsset {
  id: string
  name: string
  kind: 'video' | 'audio'
  url: string
  file: File
  duration: number
  width: number
  height: number
  resolutionTag: string
}

export interface VideoClip {
  id: string
  assetId: string
  name: string
  timelineStart: number
  duration: number
  sourceStart: number
  sourceDuration: number
  fitMode: 'cover' | 'contain'
  scale: number
  offsetX: number // -1 to 1 normalized pan
  offsetY: number // -1 to 1 normalized pan
  volume: number // 0 to 1
  muted: boolean
  removeMusic?: boolean
  removeMusicStrength?: number // 0 to 1, default 0.75
  aiCleanAudioUrl?: string
  useAiCleanAudio?: boolean
  aiTransientPreserve?: number // 0 to 1, default 0.75 (preserves barbell drops / impacts)
  aiAmbienceBlend?: number // 0 to 1, default 0
}

export interface TextClip {
  id: string
  text: string
  defaultColor: string
  /** Sparse map of character index -> hex color */
  charColors: Record<number, string>
  fontSize: number // in 1080p-relative px
  fontWeight: number
  strokeColor: string
  strokeWidth: number
  backgroundColor: string // '' or 'rgba(...)'
  timelineStart: number
  duration: number
  layer?: number // 0-indexed text layer (0 = bottom, higher = on top)
  x: number // 0..1 normalized
  y: number // 0..1 normalized
  align: 'left' | 'center' | 'right'
  isDynamic?: boolean
  transition?: 'none' | 'shrink' | 'grow'
  transitionDuration?: number // seconds, default 0.35
  transitionStartPos?: NineGridPosition
  transitionEndPos?: NineGridPosition
  transitionEndBehavior?: 'stay' | 'fade-out'
}

export interface MusicClip {
  id: string
  assetId: string
  name: string
  sourceDuration: number
  volume: number // 0..1
  fadeInSec: number // default 1
  fadeOutSec: number // default 1
  loop: boolean
  enabled: boolean
}

export type NineGridPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export interface ThumbnailOptions {
  dimEnabled: boolean
  dimPercent: number // default 20 when dimEnabled is checked
  overrideTextEnabled: boolean
  overrideText: string
  overrideTextColor: string
  overrideCharColors?: Record<number, string>
  overrideStrokeColor: string
  placementMode: 'safe-fill' | 'grid-9'
  gridPosition: NineGridPosition
  gridFontSize: number
}

export type SelectionTarget =
  | { kind: 'video'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'music'; id: string }
  | null

export function detectResolutionTag(width: number, height: number): string {
  const maxDim = Math.max(width, height)
  if (maxDim >= 3800) return '4K'
  if (maxDim >= 2500) return '2.7K'
  if (maxDim >= 1900) return 'FHD'
  if (maxDim >= 1200) return 'HD'
  return `${width}×${height}`
}
