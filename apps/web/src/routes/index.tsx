import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Film } from 'lucide-react'
import { buttonVariants } from '#/components/ui/button'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="dark min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-5 shadow-2xl">
        <div className="mx-auto w-12 h-12 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <Film className="w-6 h-6 text-sky-400" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">MyOpenCut</h1>
          <p className="text-sm text-zinc-400">
            2.7K/4K 30fps 소스 편집 · 글자별 색상 캡션 · 자동 페이드 음악 ·
            FHD 16:9 / 9:16 내보내기 · 프레임 썸네일 생성
          </p>
        </div>
        <Link
          to="/editor"
          className={buttonVariants({
            size: 'lg',
            className: 'w-full bg-sky-500 hover:bg-sky-600 text-white',
          })}
        >
          에디터 열기
          <ArrowRight className="w-4 h-4 ml-2" />
        </Link>
      </div>
    </div>
  )
}
