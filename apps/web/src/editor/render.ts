import {
  DEFAULT_TRANSITION_DURATION,
  type AspectRatio,
  type NineGridPosition,
  type TextClip,
  type ThumbnailOptions,
  type VideoClip,
} from './types'

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  aspectRatio: AspectRatio
  videoElement: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null
  videoClip: VideoClip | null
  activeTexts: TextClip[]
  cleanPlates?: Map<string, HTMLCanvasElement>
  currentTime?: number
  showSafeZone?: boolean
}

export function getSafeZoneRect(
  width: number,
  height: number,
  aspectRatio: AspectRatio,
) {
  if (aspectRatio === '9:16') {
    // Shorts / Reels / TikTok safe zone
    const left = width * 0.08
    const right = width * 0.14 // extra room on right for Shorts icons
    const top = height * 0.12
    const bottom = height * 0.2
    return {
      x: left,
      y: top,
      w: width - left - right,
      h: height - top - bottom,
    }
  }
  const marginX = width * 0.08
  const marginY = height * 0.08
  return {
    x: marginX,
    y: marginY,
    w: width - marginX * 2,
    h: height - marginY * 2,
  }
}

export function getNaverSafeZoneRect(
  width: number,
  height: number,
  aspectRatio: AspectRatio,
) {
  const safe = getSafeZoneRect(width, height, aspectRatio)
  const cx = width / 2
  const cy = height / 2
  const halfSize = Math.max(
    0,
    Math.min(
      cx - safe.x,
      safe.x + safe.w - cx,
      cy - safe.y,
      safe.y + safe.h - cy,
    ),
  )
  const size = halfSize * 2
  return {
    x: cx - halfSize,
    y: cy - halfSize,
    w: size,
    h: size,
  }
}

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
  clip: VideoClip,
) {
  const srcW =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const srcH =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height

  if (!srcW || !srcH) return

  const baseScale =
    clip.fitMode === 'cover'
      ? Math.max(width / srcW, height / srcH)
      : Math.min(width / srcW, height / srcH)

  const finalScale = baseScale * (clip.scale || 1)
  const drawW = srcW * finalScale
  const drawH = srcH * finalScale

  const maxShiftX =
    drawW > width ? (drawW - width) / 2 : width * 0.25
  const maxShiftY =
    drawH > height ? (drawH - height) / 2 : height * 0.25

  const drawX = (width - drawW) / 2 + clip.offsetX * maxShiftX
  const drawY = (height - drawH) / 2 + clip.offsetY * maxShiftY

  ctx.drawImage(source, drawX, drawY, drawW, drawH)
}

function getSafeGridCenter(
  pos: NineGridPosition,
  safe: { x: number; y: number; w: number; h: number },
  blockW: number,
  blockH: number,
): { cx: number; cy: number } {
  const [vKey, hKey] = pos.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right' | undefined,
  ]
  const vAlign: 'top' | 'middle' | 'bottom' = pos === 'center' ? 'middle' : vKey
  const hAlign: 'left' | 'center' | 'right' =
    pos === 'center' ? 'center' : (hKey ?? 'center')

  const halfW = Math.min(safe.w / 2, blockW / 2)
  const halfH = Math.min(safe.h / 2, blockH / 2)

  const cx =
    hAlign === 'left'
      ? safe.x + halfW
      : hAlign === 'right'
        ? safe.x + safe.w - halfW
        : safe.x + safe.w / 2

  const cy =
    vAlign === 'top'
      ? safe.y + halfH
      : vAlign === 'bottom'
        ? safe.y + safe.h - halfH
        : safe.y + safe.h / 2

  return { cx, cy }
}

export function drawTextClip(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: TextClip,
  currentTime?: number,
) {
  if (!clip.text) return
  const unitScale = Math.min(width, height) / 1080
  const fontSize = Math.max(12, clip.fontSize * unitScale)
  const lineHeight = fontSize * 1.25

  ctx.save()
  ctx.font = `${clip.fontWeight} ${fontSize}px "Inter Variable", "Noto Sans KR", sans-serif`
  ctx.textBaseline = 'middle'

  const lines = clip.text.split('\n')
  const totalHeight = lines.length * lineHeight
  const safe = getSafeZoneRect(
    width,
    height,
    height > width ? '9:16' : '16:9',
  )
  const padY = clip.backgroundColor ? fontSize * 0.28 : 0

  // Measure each line first so 9-grid and background box stay exact
  const lineWidths = lines.map((line) => {
    let w = 0
    for (const ch of line) {
      w += ctx.measureText(ch).width
    }
    return w
  })
  const maxLineWidth = Math.max(0, ...lineWidths)

  const halfBlockH = totalHeight / 2 + padY
  const minCenterY = safe.y + halfBlockH
  const maxCenterY = safe.y + safe.h - halfBlockH
  let anchorY =
    minCenterY <= maxCenterY
      ? Math.max(minCenterY, Math.min(maxCenterY, clip.y * height))
      : safe.y + safe.h / 2

  let anchorX = clip.x * width

  const transition = clip.transition ?? 'none'
  if (
    (transition === 'shrink' || transition === 'grow') &&
    currentTime !== undefined
  ) {
    const dur = Math.max(0.05, clip.transitionDuration ?? DEFAULT_TRANSITION_DURATION)
    const elapsed = Math.max(0, currentTime - clip.timelineStart)
    const progress = Math.min(1, elapsed / dur)
    const eased = 1 - Math.pow(1 - progress, 3)
    const animScale =
      transition === 'shrink' ? 2.4 - 1.4 * eased : 0.25 + 0.75 * eased

    if (clip.transitionEndBehavior === 'fade-out' && elapsed > dur) {
      const fadeDur = 0.3
      const fadeProgress = Math.min(1, (elapsed - dur) / fadeDur)
      const alpha = 1 - fadeProgress
      if (alpha <= 0.005) {
        ctx.restore()
        return
      }
      ctx.globalAlpha = alpha
    }

    let centerX = anchorX
    if (clip.align === 'left') centerX = anchorX + maxLineWidth / 2
    if (clip.align === 'right') centerX = anchorX - maxLineWidth / 2

    if (clip.transitionStartPos || clip.transitionEndPos) {
      const startCenter = getSafeGridCenter(
        clip.transitionStartPos ?? 'center',
        safe,
        maxLineWidth,
        totalHeight + padY * 2,
      )
      const endCenter = getSafeGridCenter(
        clip.transitionEndPos ?? 'center',
        safe,
        maxLineWidth,
        totalHeight + padY * 2,
      )
      centerX = startCenter.cx + (endCenter.cx - startCenter.cx) * eased
      anchorY = startCenter.cy + (endCenter.cy - startCenter.cy) * eased
      anchorX =
        clip.align === 'left'
          ? centerX - maxLineWidth / 2
          : clip.align === 'right'
            ? centerX + maxLineWidth / 2
            : centerX
    }

    ctx.translate(centerX, anchorY)
    ctx.scale(animScale, animScale)
    ctx.translate(-centerX, -anchorY)
  }

  const startY = anchorY - totalHeight / 2 + lineHeight / 2

  if (clip.backgroundColor) {
    const bgPadX = fontSize * 0.45
    const bgPadY = fontSize * 0.28
    let boxX = anchorX - maxLineWidth / 2 - bgPadX
    if (clip.align === 'left') boxX = anchorX - bgPadX
    if (clip.align === 'right') boxX = anchorX - maxLineWidth - bgPadX
    const boxY = anchorY - totalHeight / 2 - bgPadY
    ctx.fillStyle = clip.backgroundColor
    ctx.beginPath()
    ctx.roundRect(
      boxX,
      boxY,
      maxLineWidth + bgPadX * 2,
      totalHeight + bgPadY * 2,
      fontSize * 0.22,
    )
    ctx.fill()
  }

  let globalCharIndex = 0
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    const lineW = lineWidths[lineIdx]
    const y = startY + lineIdx * lineHeight

    let cursorX = anchorX - lineW / 2
    if (clip.align === 'left') cursorX = anchorX
    if (clip.align === 'right') cursorX = anchorX - lineW

    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      const chW = ctx.measureText(ch).width
      const color = clip.charColors[globalCharIndex] ?? clip.defaultColor

      if (clip.strokeWidth > 0) {
        ctx.lineJoin = 'round'
        ctx.miterLimit = 2
        ctx.lineWidth = clip.strokeWidth * unitScale * 2
        ctx.strokeStyle = clip.strokeColor || '#000000'
        ctx.strokeText(ch, cursorX, y)
      }

      ctx.fillStyle = color
      ctx.fillText(ch, cursorX, y)

      cursorX += chW
      globalCharIndex++
    }
    // Account for '\n' character index
    globalCharIndex++
  }

  ctx.restore()
}

let maskScratchCanvas: HTMLCanvasElement | null = null
let maskAlphaCanvas: HTMLCanvasElement | null = null

function getScratchCanvas(
  kind: 'patch' | 'alpha',
  w: number,
  h: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (kind === 'patch') {
    if (!maskScratchCanvas) maskScratchCanvas = document.createElement('canvas')
    if (maskScratchCanvas.width !== w || maskScratchCanvas.height !== h) {
      maskScratchCanvas.width = w
      maskScratchCanvas.height = h
    }
    return maskScratchCanvas
  }
  if (!maskAlphaCanvas) maskAlphaCanvas = document.createElement('canvas')
  if (maskAlphaCanvas.width !== w || maskAlphaCanvas.height !== h) {
    maskAlphaCanvas.width = w
    maskAlphaCanvas.height = h
  }
  return maskAlphaCanvas
}

/**
 * Renders freehand object-removal masks (clean-plate background replacement or blur)
 * onto the target 2D canvas. Works identically on live preview overlay and export canvas.
 */
export function drawVideoMasks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  videoElement: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null,
  clip: VideoClip,
  cleanPlates?: Map<string, HTMLCanvasElement>,
) {
  const masks = clip.masks
  if (!masks || masks.length === 0) return
  const unitScale = Math.min(width, height) / 1080

  for (const mask of masks) {
    if (mask.points.length < 3) continue
    const feather = Math.max(0, (mask.featherPx ?? 14) * unitScale)

    if (mask.mode === 'blur') {
      if (!videoElement) continue
      const blurRadius = Math.max(2, (mask.blurPx ?? 24) * unitScale)
      const patchCanvas = getScratchCanvas('patch', width, height)
      const alphaCanvas = getScratchCanvas('alpha', width, height)
      if (!patchCanvas || !alphaCanvas) continue
      const pCtx = patchCanvas.getContext('2d')
      const aCtx = alphaCanvas.getContext('2d')
      if (!pCtx || !aCtx) continue

      aCtx.clearRect(0, 0, width, height)
      aCtx.save()
      if (feather > 0) aCtx.filter = `blur(${feather}px)`
      aCtx.fillStyle = '#ffffff'
      aCtx.beginPath()
      aCtx.moveTo(mask.points[0].x * width, mask.points[0].y * height)
      for (let i = 1; i < mask.points.length; i++) {
        aCtx.lineTo(mask.points[i].x * width, mask.points[i].y * height)
      }
      aCtx.closePath()
      aCtx.fill()
      aCtx.restore()

      pCtx.clearRect(0, 0, width, height)
      pCtx.save()
      pCtx.filter = `blur(${blurRadius}px)`
      drawVideoFrame(pCtx, width, height, videoElement, clip)
      pCtx.filter = 'none'
      pCtx.globalCompositeOperation = 'destination-in'
      pCtx.drawImage(alphaCanvas, 0, 0)
      pCtx.restore()

      ctx.drawImage(patchCanvas, 0, 0)
      continue
    }

    // clean-plate mode
    const key = `${clip.assetId}:${(mask.refSourceTime ?? clip.sourceStart).toFixed(2)}`
    const plate = cleanPlates?.get(key)
    if (!plate) continue

    const patchCanvas = getScratchCanvas('patch', width, height)
    const alphaCanvas = getScratchCanvas('alpha', width, height)
    if (!patchCanvas || !alphaCanvas) continue
    const pCtx = patchCanvas.getContext('2d')
    const aCtx = alphaCanvas.getContext('2d')
    if (!pCtx || !aCtx) continue

    aCtx.clearRect(0, 0, width, height)
    aCtx.save()
    if (feather > 0) aCtx.filter = `blur(${feather}px)`
    aCtx.fillStyle = '#ffffff'
    aCtx.beginPath()
    aCtx.moveTo(mask.points[0].x * width, mask.points[0].y * height)
    for (let i = 1; i < mask.points.length; i++) {
      aCtx.lineTo(mask.points[i].x * width, mask.points[i].y * height)
    }
    aCtx.closePath()
    aCtx.fill()
    aCtx.restore()

    pCtx.clearRect(0, 0, width, height)
    pCtx.save()
    drawVideoFrame(pCtx, width, height, plate, clip)
    pCtx.globalCompositeOperation = 'destination-in'
    pCtx.drawImage(alphaCanvas, 0, 0)
    pCtx.restore()

    ctx.drawImage(patchCanvas, 0, 0)
  }
}

export function drawSafeZoneGuide(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  aspectRatio: AspectRatio,
) {
  const safe = getSafeZoneRect(width, height, aspectRatio)
  const lw = Math.max(3, Math.min(width, height) * 0.004)
  ctx.save()
  ctx.setLineDash([14, 8])
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.lineWidth = lw + 2
  ctx.strokeRect(safe.x, safe.y, safe.w, safe.h)

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)'
  ctx.lineWidth = lw
  ctx.strokeRect(safe.x, safe.y, safe.w, safe.h)

  // Naver safe zone: centered square within existing safe zone (green dashed)
  const naver = getNaverSafeZoneRect(width, height, aspectRatio)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.lineWidth = lw + 2
  ctx.strokeRect(naver.x, naver.y, naver.w, naver.h)

  ctx.strokeStyle = 'rgba(74, 222, 128, 0.95)'
  ctx.lineWidth = lw
  ctx.strokeRect(naver.x, naver.y, naver.w, naver.h)
  ctx.restore()
}

export function renderFrame(params: RenderFrameParams) {
  const {
    ctx,
    width,
    height,
    aspectRatio,
    videoElement,
    videoClip,
    activeTexts,
    cleanPlates,
    currentTime,
    showSafeZone,
  } = params

  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  if (videoElement && videoClip) {
    drawVideoFrame(ctx, width, height, videoElement, videoClip)
    drawVideoMasks(ctx, width, height, videoElement, videoClip, cleanPlates)
  }

  for (const textClip of activeTexts) {
    drawTextClip(ctx, width, height, textClip, currentTime)
  }

  if (showSafeZone) {
    drawSafeZoneGuide(ctx, width, height, aspectRatio)
  }

  ctx.restore()
}

function getGridAnchor(
  pos: NineGridPosition,
  safe: { x: number; y: number; w: number; h: number },
): {
  x: number
  y: number
  hAlign: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
} {
  const [vKey, hKey] = pos.split('-') as [
    'top' | 'middle' | 'bottom',
    'left' | 'center' | 'right' | undefined,
  ]
  // 'center' splits into ['center', undefined]
  const resolvedV: 'top' | 'middle' | 'bottom' =
    pos === 'center' ? 'middle' : vKey
  const resolvedH: 'left' | 'center' | 'right' =
    pos === 'center' ? 'center' : (hKey ?? 'center')

  const x =
    resolvedH === 'left'
      ? safe.x
      : resolvedH === 'right'
        ? safe.x + safe.w
        : safe.x + safe.w / 2

  const y =
    resolvedV === 'top'
      ? safe.y
      : resolvedV === 'bottom'
        ? safe.y + safe.h
        : safe.y + safe.h / 2

  return { x, y, hAlign: resolvedH, vAlign: resolvedV }
}

export function renderThumbnailFrame(params: {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  aspectRatio: AspectRatio
  videoElement: HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null
  videoClip: VideoClip | null
  activeTexts: TextClip[]
  currentTime?: number
  options: ThumbnailOptions
  showSafeZone?: boolean
}) {
  const {
    ctx,
    width,
    height,
    aspectRatio,
    videoElement,
    videoClip,
    activeTexts,
    currentTime,
    options,
    showSafeZone,
  } = params

  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  if (videoElement && videoClip) {
    if (options.grayscaleEnabled) {
      ctx.save()
      ctx.filter = 'grayscale(100%)'
      drawVideoFrame(ctx, width, height, videoElement, videoClip)
      ctx.restore()
    } else {
      drawVideoFrame(ctx, width, height, videoElement, videoClip)
    }
  }

  // Optional Dim (default 20% when checked) — applied only to background video, NOT captions
  if (options.dimEnabled && options.dimPercent > 0) {
    const alpha = Math.max(0, Math.min(0.95, options.dimPercent / 100))
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`
    ctx.fillRect(0, 0, width, height)
  }

  // If NOT replacing text, keep original active timeline captions bright above dim
  if (!options.overrideTextEnabled) {
    for (const textClip of activeTexts) {
      drawTextClip(ctx, width, height, textClip, currentTime)
    }
  }

  // Replacement overlay text
  if (options.overrideTextEnabled && options.overrideText.trim().length > 0) {
    const safe = getSafeZoneRect(width, height, aspectRatio)
    const lines = options.overrideText.split('\n')
    const unitScale = Math.min(width, height) / 1080

    let fontSize: number
    let anchorX: number
    let anchorY: number
    let hAlign: 'left' | 'center' | 'right' = 'center'
    let vAlign: 'top' | 'middle' | 'bottom' = 'middle'

    if (options.placementMode === 'safe-fill') {
      // Binary search largest fontSize that fits inside safe zone
      let low = 24
      let high = Math.floor(Math.min(safe.w, safe.h) * 0.9)
      let best = low

      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        ctx.font = `800 ${mid}px "Inter Variable", "Noto Sans KR", sans-serif`
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width))
        const totalH = lines.length * mid * 1.18
        if (maxW <= safe.w * 0.96 && totalH <= safe.h * 0.94) {
          best = mid
          low = mid + 2
        } else {
          high = mid - 2
        }
      }

      fontSize = best
      anchorX = safe.x + safe.w / 2
      anchorY = safe.y + safe.h / 2
      hAlign = 'center'
      vAlign = 'middle'
    } else {
      fontSize = Math.max(24, options.gridFontSize * unitScale)
      const anchor = getGridAnchor(options.gridPosition, safe)
      anchorX = anchor.x
      anchorY = anchor.y
      hAlign = anchor.hAlign
      vAlign = anchor.vAlign
    }

    const lineHeight = fontSize * 1.18
    const totalHeight = lines.length * lineHeight
    let startY = anchorY - totalHeight / 2 + lineHeight / 2
    if (vAlign === 'top') startY = anchorY + lineHeight / 2
    if (vAlign === 'bottom') startY = anchorY - totalHeight + lineHeight / 2

    ctx.font = `800 ${fontSize}px "Inter Variable", "Noto Sans KR", sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = Math.max(4, fontSize * 0.1)
    ctx.strokeStyle = options.overrideStrokeColor || '#000000'

    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = fontSize * 0.18
    ctx.shadowOffsetY = fontSize * 0.05

    const defaultColor = options.overrideTextColor || '#FFFFFF'
    const charColors = options.overrideCharColors ?? {}
    let globalCharIndex = 0
    for (let i = 0; i < lines.length; i++) {
      const lineChars = Array.from(lines[i])
      const lineW = lineChars.reduce(
        (acc, ch) => acc + ctx.measureText(ch).width,
        0,
      )
      const y = startY + i * lineHeight
      let cursorX = anchorX - lineW / 2
      if (hAlign === 'left') cursorX = anchorX
      if (hAlign === 'right') cursorX = anchorX - lineW

      for (const ch of lineChars) {
        const chW = ctx.measureText(ch).width
        ctx.strokeText(ch, cursorX, y)
        ctx.fillStyle = charColors[globalCharIndex] ?? defaultColor
        ctx.fillText(ch, cursorX, y)
        cursorX += chW
        globalCharIndex += 1
      }
      globalCharIndex += 1 // '\n'
    }
  }

  if (showSafeZone) {
    drawSafeZoneGuide(ctx, width, height, aspectRatio)
  }

  ctx.restore()
}
