import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { createMusicRemovalChain } from './audioDsp'
import { renderFrame } from './render'
import {
  findActiveTextClips,
  findActiveVideoClip,
  getVideoTimelineDuration,
} from './timelineOps'
import {
  CANVAS_PRESETS,
  DEFAULT_FPS,
  type AspectRatio,
  type MediaAsset,
  type MusicClip,
  type TextClip,
  type VideoClip,
} from './types'

export interface ExportOptions {
  aspectRatio: AspectRatio
  fps?: number
  videoClips: VideoClip[]
  textClips: TextClip[]
  musicClip: MusicClip | null
  assets: Record<string, MediaAsset>
  onProgress?: (progress: number, status: string) => void
  signal?: AbortSignal
}

async function seekVideo(
  video: HTMLVideoElement,
  targetTime: number,
): Promise<void> {
  const clamped = Math.max(0, Math.min(targetTime, video.duration || targetTime))
  if (Math.abs(video.currentTime - clamped) < 0.004 && video.readyState >= 2) {
    return
  }
  await new Promise<void>((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('비디오 프레임 탐색 중 오류가 발생했습니다.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = clamped
  })
}

async function createHiddenVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('비디오 소스를 로드할 수 없습니다.'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('error', onError)
    }
    if (video.readyState >= 2) {
      resolve()
      return
    }
    video.addEventListener('loadeddata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
  return video
}

async function decodeAssetAudio(
  url: string,
  sampleRate: number,
): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    const tempCtx = new OfflineAudioContext(2, sampleRate, sampleRate)
    return await tempCtx.decodeAudioData(arrayBuffer)
  } catch {
    return null
  }
}

async function renderMixedAudio(
  totalDuration: number,
  videoClips: VideoClip[],
  musicClip: MusicClip | null,
  assets: Record<string, MediaAsset>,
): Promise<AudioBuffer | null> {
  const sampleRate = 48000
  const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate))
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate)
  const decodedCache = new Map<string, AudioBuffer | null>()

  const getDecoded = async (assetId: string) => {
    if (decodedCache.has(assetId)) return decodedCache.get(assetId) ?? null
    const asset = assets[assetId]
    if (!asset) return null
    const buf = await decodeAssetAudio(asset.url, sampleRate)
    decodedCache.set(assetId, buf)
    return buf
  }

  let hasAnyAudio = false

  // Schedule unmuted video clips audio
  for (const clip of videoClips) {
    if (clip.muted || clip.volume <= 0) continue
    const useAi = Boolean(clip.useAiCleanAudio && clip.aiCleanAudioUrl)
    const buf = useAi
      ? await decodeAssetAudio(clip.aiCleanAudioUrl!, 48000)
      : await getDecoded(clip.assetId)
    if (!buf) continue
    hasAnyAudio = true
    const src = offline.createBufferSource()
    src.buffer = buf
    const gain = offline.createGain()
    gain.gain.setValueAtTime(clip.volume, clip.timelineStart)
    if (!useAi && clip.removeMusic) {
      createMusicRemovalChain(
        offline,
        src,
        gain,
        true,
        clip.removeMusicStrength ?? 0.75,
      )
    } else {
      src.connect(gain)
    }
    gain.connect(offline.destination)
    src.start(clip.timelineStart, clip.sourceStart, clip.duration)
  }

  // Schedule background music with global fade-in / fade-out
  if (musicClip && musicClip.enabled && musicClip.volume > 0) {
    const musicBuf = await getDecoded(musicClip.assetId)
    if (musicBuf) {
      hasAnyAudio = true
      const musicGain = offline.createGain()
      const maxVol = Math.max(0, Math.min(1, musicClip.volume))
      const fadeIn = Math.max(0, Math.min(musicClip.fadeInSec, totalDuration / 2))
      const fadeOut = Math.max(
        0,
        Math.min(musicClip.fadeOutSec, totalDuration / 2),
      )

      if (fadeIn > 0) {
        musicGain.gain.setValueAtTime(0, 0)
        musicGain.gain.linearRampToValueAtTime(maxVol, fadeIn)
      } else {
        musicGain.gain.setValueAtTime(maxVol, 0)
      }

      const fadeOutStart = Math.max(fadeIn, totalDuration - fadeOut)
      if (fadeOut > 0) {
        musicGain.gain.setValueAtTime(maxVol, fadeOutStart)
        musicGain.gain.linearRampToValueAtTime(0, totalDuration)
      }

      musicGain.connect(offline.destination)

      const src = offline.createBufferSource()
      src.buffer = musicBuf
      src.loop = musicClip.loop
      src.connect(musicGain)
      src.start(0, 0, totalDuration)
    }
  }

  if (!hasAnyAudio) return null
  return await offline.startRendering()
}

export async function exportFhdMp4(options: ExportOptions): Promise<Blob> {
  const {
    aspectRatio,
    fps = DEFAULT_FPS,
    videoClips,
    textClips,
    musicClip,
    assets,
    onProgress,
    signal,
  } = options

  if (typeof VideoEncoder === 'undefined') {
    throw new Error(
      '이 브라우저는 WebCodecs VideoEncoder를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.',
    )
  }

  const totalDuration = getVideoTimelineDuration(videoClips)
  if (totalDuration <= 0) {
    throw new Error('내보낼 비디오 클립이 없습니다.')
  }

  const { width, height } = CANVAS_PRESETS[aspectRatio]
  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps))

  onProgress?.(0.02, '오디오 트랙 믹싱 중...')
  const mixedAudio = await renderMixedAudio(
    totalDuration,
    videoClips,
    musicClip,
    assets,
  )

  if (signal?.aborted) throw new DOMException('Export aborted', 'AbortError')

  const hasAudio = mixedAudio !== null && typeof AudioEncoder !== 'undefined'

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: hasAudio
      ? {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: 48000,
        }
      : undefined,
    fastStart: 'in-memory',
  })

  let encoderError: Error | null = null

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err))
    },
  })

  videoEncoder.configure({
    codec: 'avc1.64002a', // H.264 High Profile L4.2 (supports 1080p30)
    width,
    height,
    bitrate: 12_000_000,
    framerate: fps,
  })

  let audioEncoder: AudioEncoder | null = null
  if (hasAudio && mixedAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err))
      },
    })
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 48000,
      bitrate: 192_000,
    })
  }

  // Preload hidden video elements per unique asset used in videoClips
  onProgress?.(0.06, '비디오 소스 준비 중...')
  const videoElements = new Map<string, HTMLVideoElement>()
  const uniqueAssetIds = new Set(videoClips.map((c) => c.assetId))
  for (const assetId of uniqueAssetIds) {
    const asset = assets[assetId]
    if (asset && asset.kind === 'video') {
      videoElements.set(assetId, await createHiddenVideo(asset.url))
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D 컨텍스트를 생성할 수 없습니다.')

  try {
    const frameDurationUs = Math.round(1_000_000 / fps)

    for (let f = 0; f < totalFrames; f++) {
      if (signal?.aborted) {
        throw new DOMException('Export aborted', 'AbortError')
      }
      if (encoderError) throw encoderError

      const time = f / fps
      const activeClip = findActiveVideoClip(videoClips, time)
      const activeTexts = findActiveTextClips(textClips, time)
      let videoEl: HTMLVideoElement | null = null

      if (activeClip) {
        videoEl = videoElements.get(activeClip.assetId) ?? null
        if (videoEl) {
          const sourceTime =
            activeClip.sourceStart + (time - activeClip.timelineStart)
          await seekVideo(videoEl, sourceTime)
        }
      }

      renderFrame({
        ctx,
        width,
        height,
        aspectRatio,
        videoElement: videoEl,
        videoClip: activeClip,
        activeTexts,
        showSafeZone: false,
      })

      const frame = new VideoFrame(canvas, {
        timestamp: f * frameDurationUs,
        duration: frameDurationUs,
      })
      videoEncoder.encode(frame, { keyFrame: f % (fps * 2) === 0 })
      frame.close()

      // Backpressure control so encoder queue doesn't blow memory on 4K sources
      if (videoEncoder.encodeQueueSize > 8) {
        await videoEncoder.flush()
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
        const pct = 0.08 + (f / totalFrames) * 0.8
        onProgress?.(
          pct,
          `FHD ${aspectRatio} 인코딩 중 (${f + 1}/${totalFrames} 프레임)`,
        )
      }
    }

    if (audioEncoder && mixedAudio) {
      onProgress?.(0.9, '오디오 인코딩 중...')
      const chunkSize = 1024
      const left = mixedAudio.getChannelData(0)
      const right =
        mixedAudio.numberOfChannels > 1 ? mixedAudio.getChannelData(1) : left
      const totalSamples = mixedAudio.length

      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (signal?.aborted) {
          throw new DOMException('Export aborted', 'AbortError')
        }
        const frames = Math.min(chunkSize, totalSamples - offset)
        const planar = new Float32Array(frames * 2)
        planar.set(left.subarray(offset, offset + frames), 0)
        planar.set(right.subarray(offset, offset + frames), frames)

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: 48000,
          numberOfFrames: frames,
          numberOfChannels: 2,
          timestamp: Math.round((offset / 48000) * 1_000_000),
          data: planar,
        })
        audioEncoder.encode(audioData)
        audioData.close()
      }
    }

    onProgress?.(0.96, 'MP4 파일 마무리 중...')
    await videoEncoder.flush()
    if (audioEncoder) {
      await audioEncoder.flush()
    }
    muxer.finalize()

    const { buffer } = muxer.target
    onProgress?.(1, '완료!')
    return new Blob([buffer], { type: 'video/mp4' })
  } finally {
    videoEncoder.close()
    audioEncoder?.close()
    for (const v of videoElements.values()) {
      v.src = ''
      v.load()
    }
  }
}
