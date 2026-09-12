// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { DEFAULT_TOOLS } from '@/tools/registry'

/**
 * 四个入口 `main.tsx` 的 bootstrap 契约。
 * 入口在模块顶层直接 `createRoot(#root).render(<StrictMode>…)`，因此必须：
 * - 挂到 html 里真实存在的 `#root`（id 写错就白屏，构建/类型检查都发现不了）；
 * - 同一模块只执行一次挂载副作用（重复 import 不应产生第二个 root）；
 * - `src/main.tsx` 是 `pnpm dev` 预览入口，在没有 chrome 的普通浏览器里不能崩。
 *
 * 做法：`vi.resetModules()` + 动态 import，让每个入口在自己的模块图里跑一遍；
 * 同时把 `react-dom/client` 的 createRoot 换成计数代理，直接观测「挂了几次」。
 * React 19 的 act 从同一份新模块图里取，保证与入口用的是同一个 React 实例。
 */

const holder = vi.hoisted(() => ({
  count: 0,
  roots: [] as { unmount: () => void }[],
  createRoot: null as null | ((container: Element | DocumentFragment) => { unmount: () => void }),
}))

vi.mock('react-dom/client', () => ({
  createRoot: (container: Element | DocumentFragment) => {
    holder.count += 1
    if (!holder.createRoot) throw new Error('测试未注入真实 createRoot')
    const root = holder.createRoot(container)
    holder.roots.push(root)
    return root
  },
}))

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/* eslint-disable @typescript-eslint/no-explicit-any */
let chromeStub: any

/** 入口会真实挂载页面组件，这里给一份覆盖各 hook 读取路径的最小 chrome 桩 */
function stubChrome() {
  const makeArea = () => ({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
  })
  chromeStub = {
    runtime: {
      id: 'test-extension-id',
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        disconnect: vi.fn(),
      })),
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async () => true),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: {
      sync: makeArea(),
      session: makeArea(),
      local: makeArea(),
      onChanged: {
        addListener: () => {},
        removeListener: () => {},
      },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    windows: { getCurrent: (cb: (win: { id: number }) => void) => cb({ id: 42 }) },
    commands: { getAll: vi.fn(async () => []) },
  }
  globalWithChrome.chrome = chromeStub
}

type EntryModule = () => Promise<unknown>

/** 在全新模块图里挂载入口；返回该图的 React（后续断言可在 act 里驱动） */
async function mountEntry(entry: EntryModule, options: { chrome?: boolean } = {}) {
  vi.resetModules()
  holder.count = 0
  holder.roots = []
  document.body.innerHTML = '<div id="root"></div>'
  if (options.chrome ?? true) stubChrome()
  else delete globalWithChrome.chrome

  const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client')
  holder.createRoot = actual.createRoot as typeof holder.createRoot
  const react = await import('react')

  await react.act(async () => {
    await entry()
  })
  await react.act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

  return react
}

const rootEl = () => document.getElementById('root') as HTMLDivElement

beforeEach(() => {
  holder.count = 0
  holder.roots = []
})

afterEach(async () => {
  try {
    const react = await import('react')
    for (const root of holder.roots.splice(0)) {
      await react.act(async () => {
        root.unmount()
      })
    }
  } catch {
    // 清理失败不掩盖用例本身的断言结果
  }
  document.body.innerHTML = ''
  delete globalWithChrome.chrome
})

describe('入口 bootstrap：挂载到 #root', () => {
  it('src/popup/main.tsx 把 Popup 渲染进 #root', async () => {
    await mountEntry(() => import('@/popup/main'))

    expect(holder.count).toBe(1)
    expect(rootEl().querySelector('.pop')).not.toBeNull()
    expect(rootEl().children).toHaveLength(1)
  })

  it('src/options/main.tsx 把 OptionsPage 渲染进 #root', async () => {
    await mountEntry(() => import('@/options/main'))

    expect(holder.count).toBe(1)
    expect(rootEl().querySelector('.opt')).not.toBeNull()
    expect(rootEl().children).toHaveLength(1)
  })

  it('src/sidepanel/main.tsx 把 SidePanelPage（工具箱）渲染进 #root', async () => {
    await mountEntry(() => import('@/sidepanel/main'))

    expect(holder.count).toBe(1)
    expect(rootEl().querySelector('.sp')).not.toBeNull()
    const tabIds = [...rootEl().querySelectorAll('[role="tab"]')].map((el) =>
      el.getAttribute('data-tool'),
    )
    expect(tabIds).toEqual(
      DEFAULT_TOOLS.filter((tool) => tool.id !== 'jwt' && tool.id !== 'hash').map(
        (tool) => tool.id,
      ),
    )
  })

  it('重复 import 同一入口只执行一次挂载副作用', async () => {
    await mountEntry(() => import('@/popup/main'))
    expect(holder.count).toBe(1)

    // ESM 模块缓存：第二次 import 不会重新执行入口顶层的 createRoot
    await import('@/popup/main')

    expect(holder.count).toBe(1)
    expect(document.querySelectorAll('.pop')).toHaveLength(1)
  })

  it('缺少 #root 时入口安全跳过挂载：不抛错、不创建 root，并打印可读提示', async () => {
    vi.resetModules()
    document.body.innerHTML = ''
    stubChrome()
    holder.count = 0
    holder.roots = []
    const actual = await vi.importActual<typeof import('react-dom/client')>('react-dom/client')
    holder.createRoot = actual.createRoot as typeof holder.createRoot
    const react = await import('react')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await react.act(async () => {
      await import('@/options/main')
    })

    // 回归：源码曾用 `getElementById('root')!` 非空断言，缺节点时抛裸 TypeError；现在应安全跳过
    expect(holder.count).toBe(0)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('#root'))
    errorSpy.mockRestore()
  })
})

describe('入口 bootstrap：dev 预览入口不依赖 chrome', () => {
  it('src/main.tsx 在没有 chrome 的环境里也能渲染预览页', async () => {
    await mountEntry(() => import('@/main'), { chrome: false })

    expect(holder.count).toBe(1)
    expect(rootEl().querySelector('.pv')).not.toBeNull()
    expect(rootEl().querySelector('.pv__hero')).not.toBeNull()
    // 预览页会调 useLocale()：无 chrome 时按 navigator.language 解析，因此中英都可能命中
    const titles = [zh.preview.title, en.preview.title]
    expect(titles.some((title) => rootEl().textContent?.includes(title))).toBe(true)
    expect(rootEl().textContent).not.toContain('preview.')
    // 页面组件各处都用 isExtension()/typeof chrome 守卫，入口本身不应偷偷依赖 chrome
    expect(typeof globalWithChrome.chrome).toBe('undefined')
  })
})
