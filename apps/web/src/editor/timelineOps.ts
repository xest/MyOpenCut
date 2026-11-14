import type { MusicClip, TextClip, VideoClip } from './types'

const MIN_CLIP_DURATION = 0.1

export function getVideoTimelineDuration(clips: VideoClip[]): number {
  if (clips.length === 0) return 0
  return clips.reduce(
    (max, clip) => Math.max(max, clip.timelineStart + clip.duration),
    0,
  )
}

export function getProjectDuration(
  clips: VideoClip[],
  texts: TextClip[],
): number {
  const videoEnd = getVideoTimelineDuration(clips)
  const textEnd = texts.reduce(
    (max, t) => Math.max(max, t.timelineStart + t.duration),
    0,
  )
  return Math.max(videoEnd, textEnd)
}

export function findActiveVideoClip(
  clips: VideoClip[],
  time: number,
): VideoClip | null {
  // Prefer the latest-starting clip if any overlap exists
  let match: VideoClip | null = null
  for (const clip of clips) {
    if (time >= clip.timelineStart && time < clip.timelineStart + clip.duration) {
      if (!match || clip.timelineStart >= match.timelineStart) {
        match = clip
      }
    }
  }
  return match
}

export function findActiveTextClips(
  texts: TextClip[],
  time: number,
): TextClip[] {
  return texts
    .filter((t) => time >= t.timelineStart && time < t.timelineStart + t.duration)
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0))
}

/**
 * Returns the lowest 0-indexed text layer that has no overlapping text clip
 * in the interval [start, start + duration).
 */
export function findFreeTextLayer(
  texts: TextClip[],
  start: number,
  duration: number,
): number {
  const end = start + duration
  let layer = 0
  while (true) {
    const conflict = texts.some((t) => {
      if ((t.layer ?? 0) !== layer) return false
      const tEnd = t.timelineStart + t.duration
      return start < tEnd - 0.001 && end > t.timelineStart + 0.001
    })
    if (!conflict) return layer
    layer += 1
  }
}

/**
 * Trim selected clip's left edge (start) to playheadTime, ripple current and subsequent clips left,
 * and return the new playhead position (the clip's original start).
 */
export function trimClipLeft(
  clips: VideoClip[],
  clipId: string,
  playheadTime: number,
): { clips: VideoClip[]; nextPlayhead: number | null } {
  const target = clips.find((c) => c.id === clipId)
  if (!target) return { clips, nextPlayhead: null }
  const clipEnd = target.timelineStart + target.duration
  if (
    playheadTime <= target.timelineStart ||
    playheadTime >= clipEnd - MIN_CLIP_DURATION
  ) {
    return { clips, nextPlayhead: null }
  }
  const oldStart = target.timelineStart
  const delta = playheadTime - oldStart

  const nextClips = clips.map((clip) => {
    if (clip.id === clipId) {
      return {
        ...clip,
        timelineStart: oldStart,
        sourceStart: clip.sourceStart + delta,
        duration: clip.duration - delta,
      }
    }
    if (clip.timelineStart > oldStart) {
      return {
        ...clip,
        timelineStart: Math.max(0, clip.timelineStart - delta),
      }
    }
    return clip
  })

  return { clips: nextClips, nextPlayhead: oldStart }
}

/**
 * Trim selected clip's right edge (end) to playheadTime and ripple subsequent clips left.
 */
export function trimClipRight(
  clips: VideoClip[],
  clipId: string,
  playheadTime: number,
): VideoClip[] {
  const target = clips.find((c) => c.id === clipId)
  if (!target) return clips
  const clipEnd = target.timelineStart + target.duration
  if (
    playheadTime >= clipEnd ||
    playheadTime <= target.timelineStart + MIN_CLIP_DURATION
  ) {
    return clips
  }
  const trimmedAmount = clipEnd - playheadTime

  return clips.map((clip) => {
    if (clip.id === clipId) {
      return {
        ...clip,
        duration: playheadTime - clip.timelineStart,
      }
    }
    if (clip.timelineStart >= clipEnd - 0.001) {
      return {
        ...clip,
        timelineStart: Math.max(
          playheadTime,
          clip.timelineStart - trimmedAmount,
        ),
      }
    }
    return clip
  })
}

/**
 * Split clip into two independent clips at playheadTime.
 */
export function splitClipAtTime(
  clips: VideoClip[],
  clipId: string,
  playheadTime: number,
  createId: () => string,
): { clips: VideoClip[]; rightId: string | null } {
  const index = clips.findIndex((c) => c.id === clipId)
  if (index === -1) return { clips, rightId: null }

  const clip = clips[index]
  const clipEnd = clip.timelineStart + clip.duration
  if (
    playheadTime <= clip.timelineStart + MIN_CLIP_DURATION ||
    playheadTime >= clipEnd - MIN_CLIP_DURATION
  ) {
    return { clips, rightId: null }
  }

  const leftDuration = playheadTime - clip.timelineStart
  const rightDuration = clipEnd - playheadTime
  const rightId = createId()

  const leftClip: VideoClip = {
    ...clip,
    duration: leftDuration,
  }

  const rightClip: VideoClip = {
    ...clip,
    id: rightId,
    timelineStart: playheadTime,
    sourceStart: clip.sourceStart + leftDuration,
    duration: rightDuration,
  }

  const next = [...clips]
  next.splice(index, 1, leftClip, rightClip)
  return { clips: next, rightId }
}

/**
 * Remove all gaps between video clips by sorting by timelineStart and packing sequentially from 0s.
 */
export function removeGaps(clips: VideoClip[]): VideoClip[] {
  const sorted = [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
  let cursor = 0
  return sorted.map((clip) => {
    const updated: VideoClip = {
      ...clip,
      timelineStart: cursor,
    }
    cursor += clip.duration
    return updated
  })
}

/**
 * Compute background music gain at `time` relative to `totalVideoDuration`.
 * Applies automatic fade-in [0, fadeInSec] and fade-out [totalDuration - fadeOutSec, totalDuration].
 */
export function computeMusicGainAtTime(
  music: MusicClip,
  time: number,
  totalVideoDuration: number,
): number {
  if (!music.enabled || totalVideoDuration <= 0) return 0
  if (time < 0 || time > totalVideoDuration) return 0
  if (!music.loop && time > music.sourceDuration) return 0

  let factor = 1
  if (music.fadeInSec > 0 && time < music.fadeInSec) {
    factor = Math.min(factor, Math.max(0, time / music.fadeInSec))
  }
  const fadeOutStart = Math.max(0, totalVideoDuration - music.fadeOutSec)
  if (music.fadeOutSec > 0 && time > fadeOutStart) {
    const remaining = Math.max(0, totalVideoDuration - time)
    factor = Math.min(factor, remaining / music.fadeOutSec)
  }

  return Math.max(0, Math.min(1, music.volume * factor))
}

export function formatTimecode(seconds: number, fps = 30): string {
  const clamped = Math.max(0, seconds)
  const mins = Math.floor(clamped / 60)
  const secs = Math.floor(clamped % 60)
  const frames = Math.floor((clamped % 1) * fps)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}
