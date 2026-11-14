import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const isVitest = Boolean(process.env.VITEST)

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    !isVitest && cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    !isVitest && tanstackStart(),
    viteReact(),
  ],
})

export default config
