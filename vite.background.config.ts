import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Background Service Worker 专用构建：
 * 打成单个 IIFE 文件 dist/background.js（MV3 service worker 默认不支持 ES Module 语法）。
 * 必须在 content script 构建之后、页面构建之前执行（不清空 dist）。
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: 'src/background/main.ts',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'background.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
