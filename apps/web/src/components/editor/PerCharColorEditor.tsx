import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import type { TextClip } from '#/editor/types'

const QUICK_COLORS = [
  '#FFFFFF',
  '#FACC15',
  '#38BDF8',
  '#FB7185',
  '#4ADE80',
  '#FB923C',
  '#C084FC',
  '#000000',
]

interface PerCharColorEditorProps {
  clip: TextClip
  onChange: (patch: Partial<TextClip>) => void
}

/** Converts UTF-16 textarea selection offsets to Array.from(text) code-point indices. */
function utf16ToCodePointRange(
  text: string,
  utf16Start: number,
  utf16End: number,
): { start: number; end: number } {
  let cpIdx = 0
  let u16Idx = 0
  let start = 0
  let end = 0
  let foundStart = false

  for (const ch of text) {
    if (!foundStart && u16Idx >= utf16Start) {
      start = cpIdx
      foundStart = true
    }
    if (u16Idx >= utf16End) {
      end = cpIdx
      return { start, end }
    }
    u16Idx += ch.length
    cpIdx += 1
  }

  if (!foundStart) start = cpIdx
  end = cpIdx
  return { start, end }
}

export function PerCharColorEditor({
  clip,
  onChange,
}: PerCharColorEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  })

  const chars = Array.from(clip.text)
  const cpRange = utf16ToCodePointRange(clip.text, selection.start, selection.end)
  const selectedCount = Math.max(0, cpRange.end - cpRange.start)
  const selectedPreview =
    selectedCount > 0 ? chars.slice(cpRange.start, cpRange.end).join('') : ''

  const syncSelectionFromTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    setSelection({
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    })
  }

  useEffect(() => {
    const onSelectionChange = () => {
      const el = textareaRef.current
      if (!el || document.activeElement !== el) return
      setSelection({
        start: el.selectionStart ?? 0,
        end: el.selectionEnd ?? 0,
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    window.addEventListener('mouseup', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      window.removeEventListener('mouseup', onSelectionChange)
    }
  }, [])

  const handleTextChange = (nextText: string) => {
    const nextChars = Array.from(nextText)
    const pruned: Record<number, string> = {}
    for (const [k, v] of Object.entries(clip.charColors)) {
      const idx = Number(k)
      if (idx < nextChars.length) {
        pruned[idx] = v
      }
    }
    onChange({ text: nextText, charColors: pruned })
    requestAnimationFrame(syncSelectionFromTextarea)
  }

  const applyColorToSelection = (color: string) => {
    const el = textareaRef.current
    const liveStart =
      el && document.activeElement === el
        ? (el.selectionStart ?? selection.start)
        : selection.start
    const liveEnd =
      el && document.activeElement === el
        ? (el.selectionEnd ?? selection.end)
        : selection.end
    const range = utf16ToCodePointRange(clip.text, liveStart, liveEnd)
    const count = Math.max(0, range.end - range.start)

    if (count === 0) {
      onChange({ defaultColor: color })
      return
    }
    const nextColors = { ...clip.charColors }
    for (let idx = range.start; idx < range.end; idx++) {
      nextColors[idx] = color
    }
    onChange({ charColors: nextColors })
  }

  const resetAllCharColors = () => {
    onChange({ charColors: {} })
  }

  const activePickerColor =
    selectedCount > 0
      ? (clip.charColors[cpRange.start] ?? clip.defaultColor)
      : clip.defaultColor

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs text-zinc-300">
            캡션 내용{' '}
            <span className="text-[11px] text-zinc-500 font-normal">
              (일부 드래그 선택 후 색상 변경)
            </span>
          </Label>
          {Object.keys(clip.charColors).length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="h-6 px-1.5 text-[11px] text-zinc-400 hover:text-zinc-100"
              onClick={resetAllCharColors}
            >
              부분색 초기화
            </Button>
          )}
        </div>
        <Textarea
          ref={textareaRef}
          value={clip.text}
          onChange={(e) => handleTextChange(e.target.value)}
          onSelect={syncSelectionFromTextarea}
          onKeyUp={syncSelectionFromTextarea}
          onMouseUp={syncSelectionFromTextarea}
          rows={3}
          placeholder="캡션을 입력하세요..."
          className="bg-zinc-900 border-zinc-700 text-zinc-100 text-sm resize-none"
        />
      </div>

      <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2.5">
        {chars.length > 0 && (
          <div className="rounded bg-zinc-900/90 border border-zinc-800/80 px-2.5 py-1.5 text-sm font-bold leading-snug whitespace-pre-wrap break-words">
            {chars.map((ch, idx) => {
              const isSelected =
                selectedCount > 0 && idx >= cpRange.start && idx < cpRange.end
              const color = clip.charColors[idx] ?? clip.defaultColor
              return (
                <span
                  key={idx}
                  style={{ color }}
                  className={
                    isSelected ? 'bg-sky-500/25 rounded-[2px]' : undefined
                  }
                >
                  {ch}
                </span>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => {
                  // Keep textarea selection intact when clicking palette colors
                  e.preventDefault()
                }}
                onClick={() => applyColorToSelection(c)}
                className="w-5 h-5 rounded-full border border-zinc-600 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                title={
                  selectedCount > 0
                    ? `선택된 ${selectedCount}글자에 적용`
                    : '기본 글자색으로 적용'
                }
              />
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
            <span>직접선택</span>
            <input
              type="color"
              value={activePickerColor}
              onChange={(e) => applyColorToSelection(e.target.value)}
              className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0"
            />
          </label>
        </div>
        <p className="text-[11px] text-zinc-500">
          {selectedCount > 0
            ? `"${selectedPreview.slice(0, 16)}${selectedPreview.length > 16 ? '…' : ''}" (${selectedCount}글자) 선택됨 — 색상을 고르면 바로 적용됩니다.`
            : '위 입력창에서 원하는 글자를 드래그로 선택한 뒤 색상을 고르세요. (선택 없이 고르면 전체 기본 색상이 바뀝니다.)'}
        </p>
      </div>
    </div>
  )
}
