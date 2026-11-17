import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Sparkles, X } from 'lucide-react'
import { Button } from '#/components/ui/button'

export interface GuideStep {
  target: string
  title: string
  description: string
  tips?: string[]
}

export const EDITOR_GUIDE_STEPS: GuideStep[] = [
  {
    target: 'header-save',
    title: '1. 프로젝트 저장 & 불러오기',
    description:
      '새 프로젝트 시작 시 지정한 작업 폴더에 프로젝트 파일(.kremble.json)을 저장합니다. 저장 버튼은 같은 파일을 바로 덮어쓰며, 5분마다 자동으로 작업 폴더에 저장됩니다.',
    tips: ['저장: 현재 프로젝트 파일 덮어쓰기', '다른 이름으로 저장: 새 파일 생성'],
  },
  {
    target: 'aspect-ratio',
    title: '2. 화면 비율 전환 (16:9 / 9:16)',
    description:
      '유튜브 가로(1920×1080)와 쇼츠/릴스 세로(1080×1920)를 클릭 한 번으로 전환합니다. 미리보기와 내보내기 모두 선택한 비율에 맞춰 렌더링됩니다.',
  },
  {
    target: 'media-panel',
    title: '3. 미디어 & 배경 음악 패널',
    description:
      '로컬 비디오와 배경 음악(MP3/WAV)을 추가합니다. 첫 비디오를 타임라인에 올리면 전체화면 텍스트·하단 캡션·상단 캡션(각 10초)이 기본 생성됩니다.',
    tips: ['서버 업로드 없이 브라우저에서 즉시 처리 (서버 비용 $0)'],
  },
  {
    target: 'preview-stage',
    title: '4. 실시간 미리보기 & 세이프존',
    description:
      '영상을 드래그해 위치(Pan X/Y)를 옮기고, 세이프존·중앙선 가이드로 자막과 피사체 위치를 맞출 수 있습니다. 전체화면(`) 미리보기도 지원합니다.',
  },
  {
    target: 'timeline',
    title: '5. 멀티 트랙 타임라인 & 마그네틱 스냅',
    description:
      '클립 양 끝을 드래그해 길이를 조절하고, 빈 공간을 드래그해 여러 클립을 박스로 다중 선택할 수 있습니다. 왼쪽 트랙 체크박스로 보이기/음소거를 토글하고 오른쪽에서 데시벨(dB)을 확인하세요.',
    tips: [
      'Q / W: 왼쪽·오른쪽 자르기 · Ctrl+K: 분리 · Ctrl+C/V & Alt+드래그: 복사',
      '캡션·비디오 클립은 다른 클립 경계와 트랜지션 종료 지점에 자석처럼 붙습니다',
    ],
  },
  {
    target: 'inspector',
    title: '6. 속성 인스펙터 & 다중 일괄 수정',
    description:
      '선택한 비디오·캡션·전체화면 텍스트·음악의 세부 속성을 조절합니다. 여러 클립을 선택하면 일괄 수정 화면(볼륨·글자 크기·정렬 등)으로 바뀝니다.',
    tips: ['전체화면 텍스트: 축소/확대 트랜지션, 세이프존 9분할 시작/끝 위치, 페이드아웃 지원'],
  },
  {
    target: 'export-actions',
    title: '7. 썸네일 생성 & FHD MP4 내보내기',
    description:
      '현재 프레임으로 딤(20%)·부분 색상 텍스트 썸네일을 만들거나, FHD 30fps MP4로 고속 인코딩해 작업 폴더에 바로 저장합니다.',
  },
]

interface VisualGuideOverlayProps {
  open: boolean
  onClose: () => void
  onStartNewProject?: () => void
}

export function VisualGuideOverlay({
  open,
  onClose,
  onStartNewProject,
}: VisualGuideOverlayProps) {
  const [stepIdx, setStepIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) return
    setStepIdx(0)
  }, [open])

  const step = EDITOR_GUIDE_STEPS[stepIdx]

  useEffect(() => {
    if (!open || !step) return
    const updateRect = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-guide="${step.target}"]`,
      )
      setRect(el ? el.getBoundingClientRect() : null)
    }
    updateRect()
    window.addEventListener('resize', updateRect)
    return () => window.removeEventListener('resize', updateRect)
  }, [open, step])

  if (!open || !step) return null

  const pad = 6
  const box = rect
    ? {
        left: Math.max(8, rect.left - pad),
        top: Math.max(8, rect.top - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null

  // Position tooltip card cleanly near the highlighted region without going offscreen
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800
  const cardW = 360
  let cardLeft = Math.max(16, (winW - cardW) / 2)
  let cardTop = Math.max(16, (winH - 220) / 2)

  if (box) {
    cardLeft = Math.max(16, Math.min(winW - cardW - 16, box.left))
    if (box.top + box.height + 230 < winH) {
      cardTop = box.top + box.height + 14
    } else if (box.top - 230 > 12) {
      cardTop = Math.max(16, box.top - 220)
    } else {
      cardTop = Math.max(16, (winH - 220) / 2)
    }
  }

  const isLast = stepIdx === EDITOR_GUIDE_STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50">
      {/* Dark backdrop */}
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />

      {/* Spotlight highlight box */}
      {box && (
        <div
          className="pointer-events-none absolute rounded-lg border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45),0_0_20px_rgba(56,189,248,0.5)] transition-all duration-200"
          style={{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        />
      )}

      {/* Floating Guide Card */}
      <div
        className="absolute z-10 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl text-zinc-100 space-y-3"
        style={{
          left: `${cardLeft}px`,
          top: `${cardTop}px`,
          width: `${cardW}px`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
            <Sparkles className="w-3 h-3" />
            사용 가이드 ({stepIdx + 1} / {EDITOR_GUIDE_STEPS.length})
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100"
            title="가이드 닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-white">{step.title}</h4>
          <p className="text-xs leading-relaxed text-zinc-300">
            {step.description}
          </p>
          {step.tips && step.tips.length > 0 && (
            <ul className="space-y-0.5 pt-1 text-[11px] text-sky-300/90">
              {step.tips.map((tip) => (
                <li key={tip}>• {tip}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="text-zinc-300"
          >
            <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
            이전
          </Button>
          <div className="flex items-center gap-1.5">
            {isLast && onStartNewProject && (
              <Button
                type="button"
                size="xs"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => {
                  onClose()
                  onStartNewProject()
                }}
              >
                새 프로젝트 시작
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              className="bg-sky-500 hover:bg-sky-600 text-white"
              onClick={() => {
                if (isLast) onClose()
                else setStepIdx((i) => i + 1)
              }}
            >
              {isLast ? '완료' : '다음'}
              {!isLast && <ChevronRight className="w-3.5 h-3.5 ml-0.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
