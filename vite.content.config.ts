import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * Content Script 专用构建：
 * manifest content_scripts 里的脚本不能是 ES Module，这里把 src/content/main.tsx
 * 打成单个 IIFE 文件 dist/content.js；CSS 以 ?inline 内联，由脚本注入 Shadow DOM。
 *
 * 必须安排在页面构建之前执行（先清空 dist，页面构建追加 popup/options 产物）。
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: 'src/content/main.tsx',
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'content.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
})
