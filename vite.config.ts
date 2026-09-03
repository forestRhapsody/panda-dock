import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import checker from 'vite-plugin-checker'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vite.dev/config/
// 页面类入口（popup / options）。index.html 仅用于 `pnpm dev` 预览，不进入扩展构建产物。
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tsconfigPaths(),
    checker({
      typescript: true,
      eslint: {
        lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
        useFlatConfig: true,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    // content script 已由 vite.content.config.ts 先行构建并清空 dist，这里只追加页面产物
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: 'popup.html',
        options: 'options.html',
        sidepanel: 'sidepanel.html',
      },
    },
  },
})
