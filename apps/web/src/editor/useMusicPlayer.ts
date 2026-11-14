import { useEffect, useRef } from 'react'
import { computeMusicGainAtTime } from './timelineOps'
import type { MediaAsset, MusicClip } from './types'

export function useMusicPlayer(params: {
  isPlaying: boolean
  playhead: number
  totalDuration: number
  musicClip: MusicClip | null
  assets: Record<string, MediaAsset>
}) {
  const { isPlaying, playhead, totalDuration, musicClip, assets } = params
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const loadedUrlRef = useRef<string | null>(null)

  const musicUrl =
    musicClip && musicClip.enabled
      ? (assets[musicClip.assetId]?.url ?? null)
      : null

  // Manage audio element lifecycle
  useEffect(() => {
    if (!musicUrl) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
      loadedUrlRef.current = null
      return
    }

    if (loadedUrlRef.current !== musicUrl) {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      const audio = new Audio(musicUrl)
      audio.preload = 'auto'
      audioRef.current = audio
      loadedUrlRef.current = musicUrl
    }
  }, [musicUrl])

  // Sync loop, play/pause, seek, and global fade-in/out volume
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicClip || !musicClip.enabled) return

    audio.loop = musicClip.loop
    const gain = computeMusicGainAtTime(musicClip, playhead, totalDuration)
    audio.volume = Math.max(0, Math.min(1, gain))

    if (isPlaying) {
      if (!musicClip.loop && playhead >= musicClip.sourceDuration) {
        audio.pause()
        return
      }
      const targetTime = musicClip.sourceDuration > 0
        ? playhead % musicClip.sourceDuration
        : playhead
      if (Math.abs(audio.currentTime - targetTime) > 0.25) {
        audio.currentTime = targetTime
      }
      if (audio.paused) {
        void audio.play().catch(() => {
          // Ignore autoplay restriction errors before user gesture
        })
      }
    } else {
      if (!audio.paused) {
        audio.pause()
      }
    }
  }, [isPlaying, playhead, totalDuration, musicClip])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
    }
  }, [])
}
