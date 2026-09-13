// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFontScale } from './fontScale'
/**
 * 字体缩放和主题共用「content script 只写 Shadow DOM 宿主」的规则：
 * 一旦写错落点，`--pd-font-scale` 会泄漏到宿主网页的 <html>，影响别人页面。
 * 另外非扩展（pnpm dev 预览）必须完全不碰 CSS 变量与存储。
 */

// React 19 的 act 需要该标记
import { HOST_ID } from './theme'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let changeListeners: ChangeListener[]
let getMock: ReturnType<typeof vi.fn>

/** 内存版 chrome 桩；get 可注入，便于验证「有没有真的读存储」 */
function stubChrome(
  options: {
    runtimeId?: string | null
    get?: (key: string) => Promise<Record<string, unknown>>
  } = {},
) {
  changeListeners = []
  getMock = vi.fn(options.get ?? (async () => ({})))
  const area = { get: getMock, set: async () => {}, remove: async () => {} }
  globalWithChrome.chrome = {
    runtime: options.runtimeId === null ? {} : { id: options.runtimeId ?? 'test-extension-id' },
    storage: {
      sync: area,
      local: area,
      session: area,
      onChanged: {
        addListener: (listener: ChangeListener) => {
          changeListeners.push(listener)
        },
        removeListener: (listener: ChangeListener) => {
          changeListeners = changeListeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

function createHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  return host
}

const scaleOn = (el: HTMLElement) => el.style.getPropertyValue('--pd-font-scale')
const rootScale = () => scaleOn(document.documentElement)

function Probe() {
  useFontScale()
  return <span data-testid='mounted'>mounted</span>
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const render = () => act(async () => root.render(<Probe />))

const emitChange = (newValue: unknown, areaName = 'sync') => {
  act(() => {
    for (const listener of [...changeListeners]) listener({ settings: { newValue } }, areaName)
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.getElementById(HOST_ID)?.remove()
  document.documentElement.removeAttribute('style')
  delete globalWithChrome.chrome
})

describe('useFontScale 的落点', () => {
  it('非扩展环境（有 chrome 但无 chrome.runtime.id）：不读存储也不写任何 CSS 变量', async () => {
    stubChrome({ runtimeId: null })
    const host = createHost()

    await render()
    await flush()

    expect(getMock).not.toHaveBeenCalled()
    expect(rootScale()).toBe('')
    expect(scaleOn(host)).toBe('')
    expect(changeListeners).toHaveLength(0)
  })

  it('chrome 完全缺失（pnpm dev 预览）：不抛错且不写 CSS 变量', async () => {
    await render()
    await flush()

    expect(container.textContent).toBe('mounted')
    expect(rootScale()).toBe('')
  })

  it('扩展环境且无宿主：把 fontScale 写到 documentElement', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1.25 } }) })

    await render()
    await flush()

    expect(rootScale()).toBe('1.25')
  })

  it('扩展环境且存在宿主（content script）：只写宿主，不动 documentElement', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1.1 } }) })
    const host = createHost()

    await render()
    await flush()

    expect(scaleOn(host)).toBe('1.1')
    expect(rootScale()).toBe('')
  })

  it('storageGet 返回 null（无 settings）时回退 1', async () => {
    stubChrome({ get: async () => ({}) })

    await render()
    await flush()

    expect(rootScale()).toBe('1')
  })
})

describe('useFontScale 的实时更新与清理', () => {
  it('onChanged 推送新值即时更新', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1 } }) })

    await render()
    await flush()
    expect(rootScale()).toBe('1')

    emitChange({ fontScale: 1.1 })
    expect(rootScale()).toBe('1.1')

    emitChange({ fontScale: 1.25 })
    expect(rootScale()).toBe('1.25')
  })

  it('onChanged 只响应 sync 区域且必须有 settings 变更', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1 } }) })

    await render()
    await flush()

    emitChange({ fontScale: 1.25 }, 'local')
    expect(rootScale()).toBe('1')

    act(() => {
      for (const listener of [...changeListeners]) listener({}, 'sync')
    })
    expect(rootScale()).toBe('1')

    emitChange({ fontScale: 1.25 })
    expect(rootScale()).toBe('1.25')
  })

  it('卸载后移除 onChanged 监听', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1 } }) })

    await render()
    await flush()
    expect(changeListeners).toHaveLength(1)

    act(() => root.unmount())
    expect(changeListeners).toHaveLength(0)

    root = createRoot(container)
  })

  it('卸载后才 resolve 的 storageGet 不再写入（alive 标记生效）', async () => {
    let resolveGet: (value: Record<string, unknown>) => void = () => {}
    const pending = new Promise<Record<string, unknown>>((resolve) => {
      resolveGet = resolve
    })
    stubChrome({ get: () => pending })

    await render()
    // 读取还没回来就卸载（切 Tab / 关抽屉）
    act(() => root.unmount())
    expect(changeListeners).toHaveLength(0)

    await act(async () => {
      resolveGet({ settings: { fontScale: 1.25 } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(rootScale()).toBe('')

    root = createRoot(container)
  })

  it('fontScale 为字符串 / 非法类型时，如实反映当前实现的行为', async () => {
    stubChrome({ get: async () => ({ settings: { fontScale: 1 } }) })

    await render()
    await flush()

    // 字符串被 String() 原样使用（设置层 normalizeSettings 才会做合法值归一化）
    emitChange({ fontScale: '1.5' })
    expect(rootScale()).toBe('1.5')

    // 越界数字不会在这里被夹紧
    emitChange({ fontScale: 2 })
    expect(rootScale()).toBe('2')

    // 0 是 falsy 但 ?? 只挡 null/undefined，因此会写成 '0'
    emitChange({ fontScale: 0 })
    expect(rootScale()).toBe('0')

    // null / undefined 回退到 1
    emitChange({ fontScale: null })
    expect(rootScale()).toBe('1')

    emitChange(null)
    expect(rootScale()).toBe('1')
  })
})
