import * as ort from 'onnxruntime-web'

const MODEL_URLS = [
  'https://huggingface.co/Politrees/UVR_resources/resolve/main/models/MDXNet/Kim_Vocal_2.onnx',
  'https://hf-mirror.com/Politrees/UVR_resources/resolve/main/models/MDXNet/Kim_Vocal_2.onnx',
]
const MODEL_URL = MODEL_URLS[0]
const MODEL_CACHE_NAME = 'myopencut-ai-models-v1'

const SAMPLE_RATE = 44100
const N_FFT = 7680 // 15 * 512
const HOP = 1024
const DIM_F = 3072
const DIM_T = 256

let cachedSession: ort.InferenceSession | null = null

// Precompute Hann window (periodic, matching torch.hann_window)
const HANN = new Float32Array(N_FFT)
for (let i = 0; i < N_FFT; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT))
}

/**
 * In-place Radix-2 Cooley-Tukey FFT for power-of-2 size N=512.
 */
function fft512(re: Float64Array, im: Float64Array, inverse: boolean) {
  const N = 512
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]
      re[i] = re[j]
      re[j] = tmp
      tmp = im[i]
      im[i] = im[j]
      im[j] = tmp
    }
  }

  const sign = inverse ? 1 : -1
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j]
        const uIm = im[i + j]
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + half] = uRe - vRe
        im[i + j + half] = uIm - vIm
        const nextRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextRe
      }
    }
  }
}

// Precompute twiddle factors for 15 x 512 = 7680 mixed-radix FFT
const TW_15_512_RE = new Float64Array(N_FFT)
const TW_15_512_IM = new Float64Array(N_FFT)
const TW_15_512_INV_RE = new Float64Array(N_FFT)
const TW_15_512_INV_IM = new Float64Array(N_FFT)
for (let k1 = 0; k1 < 15; k1++) {
  for (let n2 = 0; n2 < 512; n2++) {
    const ang = (-2 * Math.PI * k1 * n2) / N_FFT
    TW_15_512_RE[k1 * 512 + n2] = Math.cos(ang)
    TW_15_512_IM[k1 * 512 + n2] = Math.sin(ang)
    TW_15_512_INV_RE[k1 * 512 + n2] = Math.cos(-ang)
    TW_15_512_INV_IM[k1 * 512 + n2] = Math.sin(-ang)
  }
}

const DFT15_RE = new Float64Array(15 * 15)
const DFT15_IM = new Float64Array(15 * 15)
for (let k = 0; k < 15; k++) {
  for (let n = 0; n < 15; n++) {
    const ang = (-2 * Math.PI * k * n) / 15
    DFT15_RE[k * 15 + n] = Math.cos(ang)
    DFT15_IM[k * 15 + n] = Math.sin(ang)
  }
}

/**
 * Fast exact 7680-point FFT (15 x 512 Cooley-Tukey decomposition).
 */
function fft7680(
  inRe: Float64Array,
  inIm: Float64Array,
  outRe: Float64Array,
  outIm: Float64Array,
  inverse: boolean,
) {
  const colsRe = Array.from({ length: 15 }, () => new Float64Array(512))
  const colsIm = Array.from({ length: 15 }, () => new Float64Array(512))

  // Step 1: 512 DFTs of size 15 -> 15 columns of size 512
  for (let n2 = 0; n2 < 512; n2++) {
    for (let k1 = 0; k1 < 15; k1++) {
      let sumRe = 0
      let sumIm = 0
      for (let n1 = 0; n1 < 15; n1++) {
        const idx = n1 * 512 + n2
        const xRe = inRe[idx]
        const xIm = inIm[idx]
        const wRe = DFT15_RE[k1 * 15 + n1]
        const wIm = inverse
          ? -DFT15_IM[k1 * 15 + n1]
          : DFT15_IM[k1 * 15 + n1]
        sumRe += xRe * wRe - xIm * wIm
        sumIm += xRe * wIm + xIm * wRe
      }
      const twIdx = k1 * 512 + n2
      const twRe = inverse ? TW_15_512_INV_RE[twIdx] : TW_15_512_RE[twIdx]
      const twIm = inverse ? TW_15_512_INV_IM[twIdx] : TW_15_512_IM[twIdx]
      colsRe[k1][n2] = sumRe * twRe - sumIm * twIm
      colsIm[k1][n2] = sumRe * twIm + sumIm * twRe
    }
  }

  // Step 2: 15 FFTs of size 512
  for (let k1 = 0; k1 < 15; k1++) {
    fft512(colsRe[k1], colsIm[k1], inverse)
    for (let k2 = 0; k2 < 512; k2++) {
      const k = k2 * 15 + k1
      outRe[k] = inverse ? colsRe[k1][k2] / N_FFT : colsRe[k1][k2]
      outIm[k] = inverse ? colsIm[k1][k2] / N_FFT : colsIm[k1][k2]
    }
  }
}

async function fetchModelWithCache(
  onProgress?: (pct: number, msg: string) => void,
): Promise<ArrayBuffer> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME)
      const cached = await cache.match(MODEL_URL)
      if (cached) {
        onProgress?.(0.25, '캐시된 AI 모델 불러오는 중...')
        return await cached.arrayBuffer()
      }
    } catch {
      // Ignore Cache API errors
    }
  }

  onProgress?.(0.03, 'AI 모델 다운로드 중 (최초 1회 약 64MB)...')
  let resp: Response | null = null
  let lastError = ''
  for (const candidateUrl of MODEL_URLS) {
    try {
      const r = await fetch(candidateUrl, { mode: 'cors' })
      if (r.ok) {
        resp = r
        break
      }
      lastError = `HTTP ${r.status}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  if (!resp) {
    throw new Error(
      `AI 모델(Kim_Vocal_2.onnx) 다운로드 실패: ${lastError}. 네트워크/방화벽을 확인하거나 아래 '모델 파일(.onnx) 직접 불러오기'를 이용해 주세요.`,
    )
  }

  const total = Number(resp.headers.get('content-length')) || 66_759_214
  const reader = resp.body?.getReader()
  if (!reader) {
    return await resp.arrayBuffer()
  }

  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      const pct = Math.min(0.3, (received / total) * 0.3)
      onProgress?.(
        pct,
        `AI 모델 다운로드 중 (${Math.round((received / 1024 / 1024) * 10) / 10} / ${Math.round((total / 1024 / 1024) * 10) / 10} MB)...`,
      )
    }
  }

  const full = new Uint8Array(received)
  let offset = 0
  for (const ch of chunks) {
    full.set(ch, offset)
    offset += ch.byteLength
  }

  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(MODEL_CACHE_NAME)
      await cache.put(MODEL_URL, new Response(full.buffer))
    } catch {
      // Ignore cache write errors
    }
  }

  return full.buffer
}

export async function cacheLocalOnnxModel(file: File): Promise<void> {
  const buf = await file.arrayBuffer()
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(MODEL_CACHE_NAME)
    await cache.put(MODEL_URL, new Response(buf))
  }
  cachedSession = null
}

async function getOrCreateSession(
  onProgress?: (pct: number, msg: string) => void,
): Promise<ort.InferenceSession> {
  if (cachedSession) return cachedSession
  const modelBuffer = await fetchModelWithCache(onProgress)
  onProgress?.(0.35, 'AI 모델 초기화 중 (WebGPU / WASM)...')

  try {
    cachedSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['webgpu', 'wasm'],
    })
  } catch {
    try {
      cachedSession = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
      })
    } catch {
      ort.env.wasm.wasmPaths =
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/'
      cachedSession = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
      })
    }
  }
  return cachedSession
}

function encodeWavStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): Blob {
  const numFrames = left.length
  const dataSize = numFrames * 4 // 2ch * 16-bit
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 2, true) // Stereo
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let pos = 44
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(pos, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    view.setInt16(pos + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    pos += 4
  }

  return new Blob([buf], { type: 'audio/wav' })
}

export interface AiMixOptions {
  /** 0..1: preserves sudden transient impacts like barbell drops & plate clanks */
  transientPreserve?: number
  /** 0..1: subtle dry residual blend for natural room ambience */
  ambienceBlend?: number
}

interface SeparatedStems {
  vocalL: Float32Array
  vocalR: Float32Array
  residL: Float32Array
  residR: Float32Array
  sampleRate: number
}

const separatedStemCache = new Map<string, SeparatedStems>()

/**
 * Computes a smooth transient gate over the residual (orig - vocal) so sudden
 * high-energy impacts (barbell drops, weight clanks) punch through while steady
 * background music stays attenuated.
 */
function renderStemMix(
  stems: SeparatedStems,
  options: AiMixOptions = {},
): string {
  const transientPreserve = Math.max(
    0,
    Math.min(1, options.transientPreserve ?? 0.75),
  )
  const ambienceBlend = Math.max(0, Math.min(1, options.ambienceBlend ?? 0))

  const { vocalL, vocalR, residL, residR, sampleRate } = stems
  const len = vocalL.length

  if (transientPreserve <= 0 && ambienceBlend <= 0) {
    return URL.createObjectURL(encodeWavStereo(vocalL, vocalR, sampleRate))
  }

  // 10ms blocks for fast transient detection
  const blockSize = Math.max(1, Math.round(sampleRate * 0.01))
  const numBlocks = Math.ceil(len / blockSize)
  const blockRms = new Float32Array(numBlocks)

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize
    const end = Math.min(len, start + blockSize)
    let sumSq = 0
    for (let i = start; i < end; i++) {
      const l = residL[i]
      const r = residR[i]
      sumSq += 0.5 * (l * l + r * r)
    }
    blockRms[b] = Math.sqrt(sumSq / Math.max(1, end - start))
  }

  // Estimate local steady background music floor using ±1.0s (100 blocks each side)
  // 35th percentile tracks steady music while ignoring brief barbell drops.
  const winHalf = 100
  const blockGate = new Float32Array(numBlocks)
  const scratch: number[] = []
  const thresh = 3.2 - transientPreserve * 1.4 // 1.8 .. 3.2

  if (transientPreserve > 0) {
    for (let b = 0; b < numBlocks; b++) {
      const lo = Math.max(0, b - winHalf)
      const hi = Math.min(numBlocks - 1, b + winHalf)
      scratch.length = 0
      // Sample every 2nd block for speed (~100 items per window)
      for (let k = lo; k <= hi; k += 2) {
        scratch.push(blockRms[k])
      }
      scratch.sort((a, c) => a - c)
      const floor = Math.max(
        0.004,
        scratch[Math.floor(scratch.length * 0.35)] ?? 0.004,
      )
      const ratio = blockRms[b] / floor
      if (ratio > thresh) {
        blockGate[b] = Math.min(1, (ratio - thresh) / (thresh * 0.7))
      }
    }

    // Lookahead 1 block (10ms) + fast attack + smooth 280ms release
    for (let b = 0; b < numBlocks - 1; b++) {
      if (blockGate[b + 1] > blockGate[b]) {
        blockGate[b] = Math.max(blockGate[b], blockGate[b + 1] * 0.75)
      }
    }
    let env = 0
    for (let b = 0; b < numBlocks; b++) {
      const target = blockGate[b]
      if (target >= env) {
        env = target // instant attack
      } else {
        env = env * 0.89 + target * 0.11 // ~250-300ms smooth release
      }
      blockGate[b] = env
    }
  }

  const mixedL = new Float32Array(len)
  const mixedR = new Float32Array(len)

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize
    const end = Math.min(len, start + blockSize)
    const gCurr = blockGate[b]
    const gNext = b + 1 < numBlocks ? blockGate[b + 1] : gCurr
    const span = Math.max(1, end - start)

    for (let i = start; i < end; i++) {
      const t = (i - start) / span
      const gate = gCurr + (gNext - gCurr) * t
      const residGain = Math.min(1, ambienceBlend + gate * transientPreserve)
      mixedL[i] = Math.max(-1, Math.min(1, vocalL[i] + residL[i] * residGain))
      mixedR[i] = Math.max(-1, Math.min(1, vocalR[i] + residR[i] * residGain))
    }
  }

  return URL.createObjectURL(encodeWavStereo(mixedL, mixedR, sampleRate))
}

/**
 * Re-mixes cached AI stems instantaneously (<50ms) when the user adjusts
 * barbell/transient preservation or ambience blend sliders.
 */
export function remixAiSeparatedAudio(
  assetUrl: string,
  options: AiMixOptions,
): string | null {
  const stems = separatedStemCache.get(assetUrl)
  if (!stems) return null
  return renderStemMix(stems, options)
}

/**
 * Separates recorded background music from speech/foreground sounds using
 * browser-side Kim_Vocal_2 MDX-Net ONNX model, returning a clean WAV Blob URL.
 * Preserves sudden transient impacts (like barbell drops) by default.
 */
export async function separateSpeechWithAi(
  assetUrl: string,
  onProgress?: (pct: number, msg: string) => void,
  options?: AiMixOptions,
): Promise<string> {
  const cached = separatedStemCache.get(assetUrl)
  if (cached) {
    onProgress?.(1, '캐시된 AI 분리 결과 적용 완료!')
    return renderStemMix(cached, options)
  }

  onProgress?.(0.01, '클립 오디오 디코딩 중...')
  const resp = await fetch(assetUrl)
  const rawBuf = await resp.arrayBuffer()
  const decodeCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE)
  const decoded = await decodeCtx.decodeAudioData(rawBuf)

  // Resample to 44.1kHz Stereo
  const targetLen = Math.ceil(decoded.duration * SAMPLE_RATE)
  const resampleCtx = new OfflineAudioContext(2, targetLen, SAMPLE_RATE)
  const srcNode = resampleCtx.createBufferSource()
  srcNode.buffer = decoded
  srcNode.connect(resampleCtx.destination)
  srcNode.start(0)
  const resampled = await resampleCtx.startRendering()

  const leftIn = resampled.getChannelData(0)
  const rightIn =
    resampled.numberOfChannels > 1 ? resampled.getChannelData(1) : leftIn

  const session = await getOrCreateSession(onProgress)

  onProgress?.(0.4, '스펙트로그램 변환 중 (STFT)...')
  const pad = N_FFT / 2
  const paddedLen = leftIn.length + pad * 2
  const numFrames = Math.ceil((paddedLen - N_FFT) / HOP) + 1
  const nBins = N_FFT / 2 + 1 // 3841

  const stftLRe = new Float32Array(numFrames * nBins)
  const stftLIm = new Float32Array(numFrames * nBins)
  const stftRRe = new Float32Array(numFrames * nBins)
  const stftRIm = new Float32Array(numFrames * nBins)

  const winRe = new Float64Array(N_FFT)
  const winIm = new Float64Array(N_FFT)
  const outRe = new Float64Array(N_FFT)
  const outIm = new Float64Array(N_FFT)

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP - pad
    // Left
    winIm.fill(0)
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      winRe[i] =
        idx >= 0 && idx < leftIn.length ? leftIn[idx] * HANN[i] : 0
    }
    fft7680(winRe, winIm, outRe, outIm, false)
    const base = f * nBins
    for (let k = 0; k < nBins; k++) {
      stftLRe[base + k] = outRe[k]
      stftLIm[base + k] = outIm[k]
    }

    // Right
    winIm.fill(0)
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      winRe[i] =
        idx >= 0 && idx < rightIn.length ? rightIn[idx] * HANN[i] : 0
    }
    fft7680(winRe, winIm, outRe, outIm, false)
    for (let k = 0; k < nBins; k++) {
      stftRRe[base + k] = outRe[k]
      stftRIm[base + k] = outIm[k]
    }
  }

  // Run MDX-Net inference in chunks of DIM_T = 256 frames
  const outStftLRe = new Float32Array(numFrames * nBins)
  const outStftLIm = new Float32Array(numFrames * nBins)
  const outStftRRe = new Float32Array(numFrames * nBins)
  const outStftRIm = new Float32Array(numFrames * nBins)

  const numChunks = Math.ceil(numFrames / DIM_T)
  const inputPlaneSize = DIM_F * DIM_T
  const inputData = new Float32Array(4 * inputPlaneSize)

  for (let c = 0; c < numChunks; c++) {
    const frameOffset = c * DIM_T
    inputData.fill(0)

    for (let t = 0; t < DIM_T; t++) {
      const f = frameOffset + t
      if (f >= numFrames) break
      const srcBase = f * nBins
      for (let freq = 0; freq < DIM_F; freq++) {
        const dstIdx = freq * DIM_T + t
        inputData[0 * inputPlaneSize + dstIdx] = stftLRe[srcBase + freq]
        inputData[1 * inputPlaneSize + dstIdx] = stftLIm[srcBase + freq]
        inputData[2 * inputPlaneSize + dstIdx] = stftRRe[srcBase + freq]
        inputData[3 * inputPlaneSize + dstIdx] = stftRIm[srcBase + freq]
      }
    }

    const tensor = new ort.Tensor('float32', inputData, [1, 4, DIM_F, DIM_T])
    const results = await session.run({ [session.inputNames[0]]: tensor })
    const outTensor = results[session.outputNames[0]].data as Float32Array

    for (let t = 0; t < DIM_T; t++) {
      const f = frameOffset + t
      if (f >= numFrames) break
      const dstBase = f * nBins
      for (let freq = 0; freq < DIM_F; freq++) {
        const srcIdx = freq * DIM_T + t
        outStftLRe[dstBase + freq] = outTensor[0 * inputPlaneSize + srcIdx]
        outStftLIm[dstBase + freq] = outTensor[1 * inputPlaneSize + srcIdx]
        outStftRRe[dstBase + freq] = outTensor[2 * inputPlaneSize + srcIdx]
        outStftRIm[dstBase + freq] = outTensor[3 * inputPlaneSize + srcIdx]
      }
    }

    onProgress?.(
      0.45 + ((c + 1) / numChunks) * 0.45,
      `AI 배경음악 분리 중 (${c + 1}/${numChunks} 청크)...`,
    )
  }

  // Inverse STFT with overlap-add
  onProgress?.(0.92, '음성 오디오 복원 중 (ISTFT)...')
  const leftOut = new Float64Array(leftIn.length)
  const rightOut = new Float64Array(rightIn.length)
  const normSum = new Float64Array(leftIn.length)

  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP - pad
    const base = f * nBins

    // Reconstruct conjugate symmetry for Left
    winRe.fill(0)
    winIm.fill(0)
    for (let k = 0; k < nBins; k++) {
      winRe[k] = outStftLRe[base + k]
      winIm[k] = outStftLIm[base + k]
      if (k > 0 && k < N_FFT / 2) {
        winRe[N_FFT - k] = outStftLRe[base + k]
        winIm[N_FFT - k] = -outStftLIm[base + k]
      }
    }
    fft7680(winRe, winIm, outRe, outIm, true)
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      if (idx >= 0 && idx < leftOut.length) {
        leftOut[idx] += outRe[i] * HANN[i]
        normSum[idx] += HANN[i] * HANN[i]
      }
    }

    // Reconstruct conjugate symmetry for Right
    winRe.fill(0)
    winIm.fill(0)
    for (let k = 0; k < nBins; k++) {
      winRe[k] = outStftRRe[base + k]
      winIm[k] = outStftRIm[base + k]
      if (k > 0 && k < N_FFT / 2) {
        winRe[N_FFT - k] = outStftRRe[base + k]
        winIm[N_FFT - k] = -outStftRIm[base + k]
      }
    }
    fft7680(winRe, winIm, outRe, outIm, true)
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i
      if (idx >= 0 && idx < rightOut.length) {
        rightOut[idx] += outRe[i] * HANN[i]
      }
    }
  }

  const finalL = new Float32Array(leftIn.length)
  const finalR = new Float32Array(rightIn.length)
  const residL = new Float32Array(leftIn.length)
  const residR = new Float32Array(rightIn.length)
  for (let i = 0; i < leftIn.length; i++) {
    const d = normSum[i] > 1e-8 ? normSum[i] : 1
    const vL = leftOut[i] / d
    const vR = rightOut[i] / d
    finalL[i] = vL
    finalR[i] = vR
    residL[i] = leftIn[i] - vL
    residR[i] = rightIn[i] - vR
  }

  const stems: SeparatedStems = {
    vocalL: finalL,
    vocalR: finalR,
    residL,
    residR,
    sampleRate: SAMPLE_RATE,
  }
  separatedStemCache.set(assetUrl, stems)

  onProgress?.(0.97, '충격음·바벨 소리 보존 믹싱 중...')
  const resultUrl = renderStemMix(stems, options)
  onProgress?.(1, 'AI 음악 제거 완료!')
  return resultUrl
}
