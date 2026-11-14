import { describe, expect, it } from 'vitest'
import {
  computeMusicGainAtTime,
  removeGaps,
  splitClipAtTime,
  trimClipLeft,
  trimClipRight,
} from './timelineOps'
import type { MusicClip, VideoClip } from './types'

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'c1',
    assetId: 'a1',
    name: 'clip.mp4',
    timelineStart: 0,
    duration: 10,
    sourceStart: 0,
    sourceDuration: 10,
    fitMode: 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    volume: 1,
    muted: false,
    ...overrides,
  }
}

describe('timelineOps', () => {
  it('trims clip left to playhead, ripples current and subsequent clips left, and returns nextPlayhead', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, duration: 10, sourceStart: 1 }),
      makeClip({ id: 'c2', timelineStart: 12, duration: 4 }),
    ]
    const { clips: next, nextPlayhead } = trimClipLeft(clips, 'c1', 5)
    expect(nextPlayhead).toBe(2)
    expect(next[0].timelineStart).toBe(2)
    expect(next[0].sourceStart).toBe(4)
    expect(next[0].duration).toBe(7)
    expect(next[1].timelineStart).toBe(9)
  })

  it('trims clip right to playhead and ripples subsequent clips left', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, duration: 10 }),
      makeClip({ id: 'c2', timelineStart: 12, duration: 4 }),
      makeClip({ id: 'c3', timelineStart: 16, duration: 5 }),
    ]
    const next = trimClipRight(clips, 'c1', 7)
    expect(next[0].timelineStart).toBe(2)
    expect(next[0].duration).toBe(5)
    expect(next[1].timelineStart).toBe(7)
    expect(next[2].timelineStart).toBe(11)
  })

  it('splits clip into two independent clips at playhead', () => {
    const clips = [makeClip({ id: 'c1', timelineStart: 1, duration: 8, sourceStart: 2 })]
    const { clips: next, rightId } = splitClipAtTime(clips, 'c1', 4, () => 'c2')
    expect(rightId).toBe('c2')
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ id: 'c1', timelineStart: 1, duration: 3, sourceStart: 2 })
    expect(next[1]).toMatchObject({ id: 'c2', timelineStart: 4, duration: 5, sourceStart: 5 })
  })

  it('removes all gaps between video clips sequentially from 0s', () => {
    const clips = [
      makeClip({ id: 'c1', timelineStart: 2, duration: 4 }),
      makeClip({ id: 'c2', timelineStart: 10, duration: 3 }),
      makeClip({ id: 'c3', timelineStart: 18, duration: 5 }),
    ]
    const next = removeGaps(clips)
    expect(next.map((c) => [c.id, c.timelineStart, c.duration])).toEqual([
      ['c1', 0, 4],
      ['c2', 4, 3],
      ['c3', 7, 5],
    ])
  })

  it('computes global music fade-in and fade-out relative to total video duration', () => {
    const music: MusicClip = {
      id: 'm1',
      assetId: 'ma1',
      name: 'bgm.mp3',
      sourceDuration: 60,
      volume: 0.8,
      fadeInSec: 1,
      fadeOutSec: 2,
      loop: true,
      enabled: true,
    }
    expect(computeMusicGainAtTime(music, 0, 20)).toBeCloseTo(0)
    expect(computeMusicGainAtTime(music, 0.5, 20)).toBeCloseTo(0.4)
    expect(computeMusicGainAtTime(music, 1, 20)).toBeCloseTo(0.8)
    expect(computeMusicGainAtTime(music, 10, 20)).toBeCloseTo(0.8)
    expect(computeMusicGainAtTime(music, 19, 20)).toBeCloseTo(0.4)
    expect(computeMusicGainAtTime(music, 20, 20)).toBeCloseTo(0)
  })
})
