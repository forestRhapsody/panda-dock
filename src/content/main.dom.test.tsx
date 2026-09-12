// @vitest-environment happy-dom
import { act } from 'react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOST_ID } from '@/utils/theme'

/**
 * 为什么这样测：
 * main.tsx 是 content script 的副作用入口（没有导出，import 即挂载），所以只能用
 * `vi.resetModules()` + 动态 import 来模拟「被注入一次」。
 * 这里要守住两条最容易回归的硬约定：
 * 1. 样式必须在构建期内联、写进 Shadow DOM 的 <style>，绝不能出现在宿主页 document.head
 *    （否则会污染被注入的网页 —— AGENTS §4 第 3 条）；
 * 2. 重复注入（模块缓存命中 / HOST_ID 已存在）不能挂第二棵树或再装一次存储桥。
 */

// 必须在动态 import 之前用 vi.hoisted 建共享 mock：resetModules 之后拿到的仍是同一个函数
const storageMock = vi.hoisted(() => ({ installStorageBridge: vi.fn() }))
const rootRegistry = vi.hoisted(() => ({ roots: [] as { unmount: () => void }[] }))

vi.mock('@/tools/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/storage')>()
  return { ...actual, installStorageBridge: storageMock.installStorageBridge }
})

// main.tsx 自己 createRoot 且不暴露 root，测试里要能在 afterEach 卸载它：
// 否则残留的树会在后续用例（chrome 已被清掉）里触发 unmount 副作用而报错。
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      rootRegistry.roots.push(root)
      return root
    },
  }
})

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

/** 扩展环境最小桩：isExtension 只认 chrome.runtime.id；storage 桩保证存储桥与设置读取不炸 */
function stubChrome(): void {
  const area = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
  }
  globalWithChrome.chrome = {
    runtime: {
      id: 'test-extension-id',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async () => undefined,
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      sync: area,
      local: area,
      session: area,
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  }
}

/** happy-dom 的 readyState 是原型上的 getter，这里在实例上覆写来模拟「文档仍在加载」 */
function setReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { value: state, configurable: true })
}

function resetReadyState(): void {
  delete (document as unknown as Record<string, unknown>).readyState
}

const hostCount = () => [...document.body.children].filter((el) => el.id === HOST_ID).length

function removeHosts(): void {
  for (const el of [...document.body.children]) {
    if (el.id === HOST_ID) el.remove()
  }
}

/** import 即挂载：用 act 包住，让 main.tsx 里同步的 createRoot().render() 走正常提交路径 */
async function importMain(): Promise<void> {
  await act(async () => {
    await import('./main')
  })
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.resetModules()
  storageMock.installStorageBridge.mockClear()
  delete globalWithChrome.chrome
  setReadyState('complete')
  rootRegistry.roots.length = 0
  removeHosts()
})

afterEach(() => {
  // 先卸载 main 挂上的树（此时 chrome 桩还在），再清环境，避免 unmount 副作用读到 undefined chrome
  act(() => {
    for (const root of rootRegistry.roots.splice(0)) root.unmount()
  })
  resetReadyState()
  delete globalWithChrome.chrome
  removeHosts()
  vi.restoreAllMocks()
})

describe('content 入口的挂载行为', () => {
  it('无 chrome（pnpm dev / 测试环境）也能挂载：创建宿主、内联样式到 Shadow DOM、调用 installStorageBridge', async () => {
    await importMain()

    const host = document.getElementById(HOST_ID)
    expect(host).not.toBeNull()
    const shadow = host?.shadowRoot
    expect(shadow).not.toBeNull()

    // 样式只进 Shadow DOM：<style> 是 shadow root 的第一个子节点，宿主页 head 里不应有任何注入
    const style = shadow?.querySelector('style')
    expect(style).not.toBeNull()
    expect(style?.parentNode).toBe(shadow)
    expect(shadow?.children[0]).toBe(style)
    // 注：Vitest 默认不处理 CSS，四个 ?inline 导入在这里都是空串，因此无法断言具体样式内容；
    // 能断言也必须断言的是「样式落在 Shadow DOM 内、没进 document」
    expect(document.head.querySelector('style')).toBeNull()
    expect(document.documentElement.querySelector('style')).toBeNull()
    expect(document.querySelectorAll('style')).toHaveLength(0)

    // React 树挂到源码约定的挂载点（shadow 内第二个 div）上；无 chrome 时直接渲染悬浮球
    expect(shadow?.querySelector('.tek__dock')).not.toBeNull()

    expect(storageMock.installStorageBridge).toHaveBeenCalledTimes(1)
  })

  it('扩展环境（有 chrome.runtime.id）同样挂载，并在读完设置后渲染悬浮球', async () => {
    stubChrome()

    await importMain()
    await flush()

    const host = document.getElementById(HOST_ID)
    expect(host).not.toBeNull()
    expect(host?.shadowRoot?.querySelector('.tek__dock')).not.toBeNull()
    expect(storageMock.installStorageBridge).toHaveBeenCalledTimes(1)
  })

  it('readyState=loading 时先等 DOMContentLoaded，事件触发后才挂载', async () => {
    setReadyState('loading')

    await importMain()

    expect(document.getElementById(HOST_ID)).toBeNull()
    expect(storageMock.installStorageBridge).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new Event('DOMContentLoaded'))
    })

    expect(document.getElementById(HOST_ID)).not.toBeNull()
    expect(storageMock.installStorageBridge).toHaveBeenCalledTimes(1)
  })

  it('同一个模块重复 import（模块缓存命中）不会重复挂载', async () => {
    await importMain()
    const first = document.getElementById(HOST_ID)
    expect(first).not.toBeNull()

    await importMain()

    expect(document.getElementById(HOST_ID)).toBe(first)
    expect(hostCount()).toBe(1)
    expect(storageMock.installStorageBridge).toHaveBeenCalledTimes(1)
  })

  it('页面里已存在 HOST_ID 宿主时直接跳过，不建 Shadow DOM 也不装存储桥（防止重复注入）', async () => {
    const existing = document.createElement('div')
    existing.id = HOST_ID
    document.body.appendChild(existing)

    await importMain()

    expect(hostCount()).toBe(1)
    expect(existing.shadowRoot).toBeNull()
    expect(storageMock.installStorageBridge).not.toHaveBeenCalled()
  })
})
