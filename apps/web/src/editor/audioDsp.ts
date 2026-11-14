import { useEffect, useRef } from 'react'

export interface MusicRemovalNodes {
  update: (enabled: boolean, strength: number) => void
  disconnect: () => void
}

/**
 * Builds a real-time / offline Web Audio DSP chain that attenuates recorded stereo
 * background music while keeping center-panned speech and foreground sounds:
 * 1. Mid-Side center extraction: keeps Mid = (L+R)/2, attenuates Side = (L-R)/2 by `strength`.
 * 2. Bass roll-off (highpass): attenuates kick/bass frequencies (80Hz -> 220Hz).
 * 3. Speech presence boost (peaking @ 2.2kHz) + high-frequency cymbal/bleed tame (highshelf @ 6.5kHz).
 */
export function createMusicRemovalChain(
  ctx: BaseAudioContext,
  input: AudioNode,
  output: AudioNode,
  initialEnabled: boolean,
  initialStrength: number,
): MusicRemovalNodes {
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)

  // Mid = 0.5*L + 0.5*R
  const midL = ctx.createGain()
  const midR = ctx.createGain()
  midL.gain.value = 0.5
  midR.gain.value = 0.5
  const midSum = ctx.createGain()

  // Side = 0.5*L - 0.5*R
  const sideL = ctx.createGain()
  const sideR = ctx.createGain()
  sideL.gain.value = 0.5
  sideR.gain.value = -0.5
  const sideSum = ctx.createGain()

  // Side attenuation gain: 1 when disabled, (1 - strength) when enabled
  const sideAtten = ctx.createGain()
  const sideInvert = ctx.createGain()
  sideInvert.gain.value = -1

  // Connect splitter -> mid/side
  input.connect(splitter)
  splitter.connect(midL, 0)
  splitter.connect(midR, 1)
  midL.connect(midSum)
  midR.connect(midSum)

  splitter.connect(sideL, 0)
  splitter.connect(sideR, 1)
  sideL.connect(sideSum)
  sideR.connect(sideSum)
  sideSum.connect(sideAtten)

  // Reconstruct L = Mid + sideAtten, R = Mid - sideAtten
  midSum.connect(merger, 0, 0)
  sideAtten.connect(merger, 0, 0)

  midSum.connect(merger, 0, 1)
  sideAtten.connect(sideInvert)
  sideInvert.connect(merger, 0, 1)

  // Spectral shaping (24dB/oct bass cut + speech focus + high-frequency music cut)
  const highpass1 = ctx.createBiquadFilter()
  highpass1.type = 'highpass'
  highpass1.Q.value = 0.707

  const highpass2 = ctx.createBiquadFilter()
  highpass2.type = 'highpass'
  highpass2.Q.value = 0.707

  const presence = ctx.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 1800
  presence.Q.value = 0.9

  const highshelf = ctx.createBiquadFilter()
  highshelf.type = 'highshelf'
  highshelf.frequency.value = 3800

  merger.connect(highpass1)
  highpass1.connect(highpass2)
  highpass2.connect(presence)
  presence.connect(highshelf)
  highshelf.connect(output)

  const update = (enabled: boolean, strength: number) => {
    const s = enabled ? Math.max(0, Math.min(1, strength)) : 0
    sideAtten.gain.value = 1 - s
    const hpFreq = enabled ? 90 + s * 190 : 20 // up to 280Hz at 100%
    highpass1.frequency.value = hpFreq
    highpass2.frequency.value = hpFreq
    presence.gain.value = enabled ? s * 4.5 : 0
    highshelf.gain.value = enabled ? -s * 12.0 : 0
  }

  update(initialEnabled, initialStrength)

  return {
    update,
    disconnect: () => {
      try {
        input.disconnect(splitter)
        highshelf.disconnect(output)
      } catch {
        // Ignore already disconnected nodes
      }
    },
  }
}

/**
 * Connects an HTMLVideoElement to a persistent Web Audio DSP graph for live preview.
 */
export function useVideoAudioDsp(params: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isPlaying: boolean
  enabled: boolean
  strength: number
  volume: number
  muted: boolean
}) {
  const { videoRef, isPlaying, enabled, strength, volume, muted } = params
  const ctxRef = useRef<AudioContext | null>(null)
  const dspRef = useRef<MusicRemovalNodes | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const wiredVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !enabled) return

    if (wiredVideoRef.current !== video) {
      try {
        const ctx = new AudioContext()
        const source = ctx.createMediaElementSource(video)
        const masterGain = ctx.createGain()
        const dsp = createMusicRemovalChain(ctx, source, masterGain, true, strength)
        masterGain.connect(ctx.destination)

        ctxRef.current = ctx
        dspRef.current = dsp
        gainRef.current = masterGain
        wiredVideoRef.current = video
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {})
        }
      } catch {
        // Fallback: native video audio remains active if AudioContext fails
      }
    }
  }, [videoRef, enabled])

  useEffect(() => {
    if (
      enabled &&
      isPlaying &&
      ctxRef.current &&
      ctxRef.current.state === 'suspended'
    ) {
      void ctxRef.current.resume().catch(() => {})
    }
  }, [enabled, isPlaying])

  useEffect(() => {
    dspRef.current?.update(enabled, strength)
    if (gainRef.current) {
      gainRef.current.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume))
    }
  }, [enabled, strength, volume, muted])

  useEffect(() => {
    return () => {
      dspRef.current?.disconnect()
      void ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
      dspRef.current = null
      gainRef.current = null
      wiredVideoRef.current = null
    }
  }, [])
}
