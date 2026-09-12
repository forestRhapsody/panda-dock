import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

/**
 * 纯逻辑单元测试配置。
 * - 复用 tsconfig 的 `@/` 别名，测试内的导入写法与源码完全一致；
 * - environment=node：被测模块均为无 React/DOM 依赖的纯函数，因此不引入 jsdom 等额外依赖；
 * - 只收集 `src/**` 下的 `*.test.ts(x)`：这些文件不进扩展产物（构建入口是 html / content / background）。
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
