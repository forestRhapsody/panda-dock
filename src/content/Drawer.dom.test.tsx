// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import Drawer from './Drawer'

/**
 * 网页内抽屉的可观察行为：
 * - 宽度是可持久化的用户偏好（记忆 / 夹取 / 拖拽 / 键盘都要写回 storage），写错会让抽屉忽宽忽窄甚至超出屏幕；
 * - role=dialog / separator 的 aria 属性是无障碍与自动化定位的唯一契约，必须走 i18n 而不是裸 key。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 与源码一致的存储 key 与宽度约束 */
const WIDTH_KEY = 'toolkit.drawerWidth'
const MIN_WIDTH = 280
const DEFAULT_WIDTH = 400
const HANDLE_EDGE_MARGIN = 80

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let store: Record<string, unknown>
let container: HTMLDivElement
let root: Root
let originalWidth: number
let originalHeight: number
let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture

/** 内存版 chrome.storage：扩展环境下 Drawer 才会读写宽度 */
function stubChrome() {
  store = {}
  const area = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(store, obj)
    },
    remove: async (key: string) => {
      delete store[key]
    },
  }
  const listeners: unknown[] = []
  globalWithChrome.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: '0.0.0-test' }),
    },
    storage: {
      local: area,
      sync: area,
      session: area,
      onChanged: {
        addListener: (listener: unknown) => listeners.push(listener),
        removeListener: (listener: unknown) => {
          const idx = listeners.indexOf(listener)
          if (idx >= 0) listeners.splice(idx, 1)
        },
      },
    },
  }
}

function setViewport(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
}

function maxWidth(vw = window.innerWidth) {
  return Math.max(MIN_WIDTH, vw - HANDLE_EDGE_MARGIN)
}

function drawerEl(): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>('.tek__drawer')
  if (!el) throw new Error('未找到抽屉根节点')
  return el
}

function handleEl(): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>('[role="separator"]')
  if (!el) throw new Error('未找到宽度拖拽手柄')
  return el
}

function closeButton(): HTMLButtonElement {
  const label = i18n.t('drawer.ariaClose')
  const btn = [...container.querySelectorAll('button')].find(
    (el) => el.getAttribute('aria-label') === label,
  )
  if (!btn) throw new Error('未找到关闭按钮')
  return btn
}

function makePointerEvent(
  type: string,
  init: { x: number; y?: number; button?: number },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: init.x,
    clientY: init.y ?? 300,
    button: init.button ?? 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  })
}

function dispatchPointer(
  el: Element,
  type: string,
  init: { x: number; y?: number; button?: number },
) {
  act(() => {
    el.dispatchEvent(makePointerEvent(type, init))
  })
}

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    composed: true,
  })
  act(() => {
    document.dispatchEvent(event)
  })
  return event
}

function pressKey(key: string, shiftKey = false) {
  act(() => {
    handleEl().dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    )
  })
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** 挂载并等到内部 storage 读取落地（否则会冒出 “not wrapped in act” 告警） */
async function mount(onClose: () => void = () => {}) {
  await act(async () => {
    root.render(<Drawer onClose={onClose} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return drawerEl()
}

beforeEach(() => {
  stubChrome()
  originalWidth = window.innerWidth
  originalHeight = window.innerHeight
  setViewport(800, 600)
  originalSetPointerCapture = HTMLElement.prototype.setPointerCapture
  HTMLElement.prototype.setPointerCapture = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture
  setViewport(originalWidth, originalHeight)
  delete globalWithChrome.chrome
})

describe('Drawer 渲染与无障碍', () => {
  it('渲染为 dialog，aria-label 与手柄 aria 属性都走 i18n 而不是裸 key', async () => {
    const drawer = await mount()
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.getAttribute('aria-label')).toBe(i18n.t('drawer.ariaLabel'))
    expect(drawer.getAttribute('aria-label')).not.toBe('drawer.ariaLabel')

    const handle = handleEl()
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('aria-label')).toBe(i18n.t('drawer.ariaResize'))
    expect(handle.getAttribute('aria-label')).not.toBe('drawer.ariaResize')
    expect(handle.getAttribute('aria-valuemin')).toBe(String(MIN_WIDTH))
    expect(handle.getAttribute('aria-valuemax')).toBe(String(maxWidth()))
    expect(handle.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH))
    expect(handle.getAttribute('tabindex')).toBe('0')
  })

  it('抽屉内复用完整工具箱（工具选项卡与头部都在），不是空壳', async () => {
    await mount()
    const drawer = drawerEl()
    expect(drawer.querySelector('.tw-nav')).not.toBeNull()
    expect(drawer.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('app.title'))
    expect(container.textContent).not.toContain('app.title')
  })

  it('默认宽度 400px，且不会溢出视口', async () => {
    const drawer = await mount()
    expect(drawer.style.width).toBe(`${DEFAULT_WIDTH}px`)
    expect(DEFAULT_WIDTH).toBeLessThanOrEqual(maxWidth())
  })

  it('只有抽屉本体、没有遮罩层（关闭由宿主与关闭按钮负责）', async () => {
    await mount()
    expect(container.children).toHaveLength(1)
    expect(container.querySelector('[class*="mask"], [class*="overlay"]')).toBeNull()
  })
})

describe('Drawer 关闭', () => {
  it('点击关闭按钮触发 onClose（一次）', async () => {
    const onClose = vi.fn()
    await mount(onClose)

    act(() => closeButton().click())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape 关闭抽屉（监听只在抽屉开启期间生效）', async () => {
    const onClose = vi.fn()
    await mount(onClose)

    const event = pressEscape()

    expect(onClose).toHaveBeenCalledTimes(1)
    // 关掉后不再让宿主页面继续处理这个按键
    expect(event.defaultPrevented).toBe(true)
  })

  it('抽屉内存在 .tk-modal 内层弹窗时 Escape 不关抽屉，把按键让给内层弹窗', async () => {
    const onClose = vi.fn()
    await mount(onClose)

    // 构造内层弹窗（ConfirmDialog / 裁剪弹窗都用 .tk-modal）
    const modal = document.createElement('div')
    modal.className = 'tk-modal'
    container.appendChild(modal)

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()

    // 弹窗关掉后 Escape 恢复关闭抽屉
    modal.remove()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('TkSelect 下拉展开时 Escape 先关下拉，不关抽屉', async () => {
    const onClose = vi.fn()
    await mount(onClose)

    // TkSelect 下拉是 portal 到抽屉所在 root 的 .tk-select-popup
    const popup = document.createElement('div')
    popup.className = 'tk-select-popup'
    container.appendChild(popup)

    pressEscape()
    expect(onClose).not.toHaveBeenCalled()

    // 下拉收起后 Escape 才轮到抽屉：证明上面的「不关」确实是下拉守卫生效，而不是没监听
    popup.remove()
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Drawer 宽度记忆与夹取', () => {
  it('挂载时读取已记忆的宽度并生效', async () => {
    store[WIDTH_KEY] = 520
    await mount()
    expect(drawerEl().style.width).toBe('520px')
    expect(handleEl().getAttribute('aria-valuenow')).toBe('520')
  })

  it('记忆宽度小于下限时收敛到 280，大于可视上限时收敛到 innerWidth-80', async () => {
    store[WIDTH_KEY] = 10
    await mount()
    expect(drawerEl().style.width).toBe(`${MIN_WIDTH}px`)

    act(() => root.unmount())
    root = createRoot(container)
    store[WIDTH_KEY] = 5000
    await mount()
    expect(drawerEl().style.width).toBe(`${maxWidth()}px`)
  })

  it('窗口变窄时把宽度收敛回可视范围，不会把页面挤没', async () => {
    const drawer = await mount()
    expect(drawer.style.width).toBe('400px')

    setViewport(300, 600)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    // 300 - 80 = 220 < 280，退化为最小宽度
    expect(drawerEl().style.width).toBe(`${MIN_WIDTH}px`)
  })

  it('拖拽手柄向左拖变宽、向右拖变窄，并夹取在上限内', async () => {
    await mount()
    const handle = handleEl()

    dispatchPointer(handle, 'pointerdown', { x: 500 })
    dispatchPointer(handle, 'pointermove', { x: 400 })
    expect(drawerEl().style.width).toBe('500px')
    expect(drawerEl().className).toContain('tek__drawer--resizing')

    // 继续拖到远超上限
    dispatchPointer(handle, 'pointermove', { x: 0 })
    expect(drawerEl().style.width).toBe(`${maxWidth()}px`)

    dispatchPointer(handle, 'pointermove', { x: 700 })
    expect(drawerEl().style.width).toBe(`${MIN_WIDTH}px`)

    dispatchPointer(handle, 'pointerup', { x: 700 })
    expect(drawerEl().className).not.toContain('tek__drawer--resizing')
  })

  it('拖拽结束后把最终宽度写回 storage，供下次打开复用', async () => {
    await mount()
    const handle = handleEl()

    dispatchPointer(handle, 'pointerdown', { x: 500 })
    dispatchPointer(handle, 'pointermove', { x: 450 })
    dispatchPointer(handle, 'pointerup', { x: 450 })
    await flush()

    // 向左拖 50px → 400 + 50 = 450
    expect(drawerEl().style.width).toBe('450px')
    expect(store[WIDTH_KEY]).toBe(450)
  })

  it('同一批次内连续 resize 事件后持久化的是最终宽度（经 ref 读取，不受未提交渲染影响）', async () => {
    await mount()
    const handle = handleEl()

    dispatchPointer(handle, 'pointerdown', { x: 500 })
    // pointermove 与 pointerup 放在同一个 act 批次：React 还没提交 pointermove 的 setState，
    // 若 onResizeEnd 从事件闭包读 width 会拿到 400，持久化就会写回旧值。
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', { x: 420 }))
      handle.dispatchEvent(makePointerEvent('pointerup', { x: 420 }))
    })
    await flush()

    // 向左拖 80px → 400 + (500 - 420) = 480
    expect(drawerEl().style.width).toBe('480px')
    expect(store[WIDTH_KEY]).toBe(480)
  })

  it('非左键按下不启动拖拽（不会误改宽度）', async () => {
    await mount()
    const handle = handleEl()

    dispatchPointer(handle, 'pointerdown', { x: 500, button: 2 })
    dispatchPointer(handle, 'pointermove', { x: 100 })

    expect(drawerEl().style.width).toBe(`${DEFAULT_WIDTH}px`)
    expect(drawerEl().className).not.toContain('tek__drawer--resizing')
  })

  it('未按下时移动手柄不会改变宽度（拖拽状态机不会被悬停触发）', async () => {
    await mount()
    const handle = handleEl()

    dispatchPointer(handle, 'pointermove', { x: 100 })
    expect(drawerEl().style.width).toBe(`${DEFAULT_WIDTH}px`)
  })

  it('方向键每次调整 20px，Shift+方向键调整 60px，并立即持久化', async () => {
    await mount()

    pressKey('ArrowLeft')
    expect(drawerEl().style.width).toBe('420px')
    await flush()
    expect(store[WIDTH_KEY]).toBe(420)

    pressKey('ArrowLeft', true)
    expect(drawerEl().style.width).toBe('480px')
    await flush()
    expect(store[WIDTH_KEY]).toBe(480)

    pressKey('ArrowRight', true)
    expect(drawerEl().style.width).toBe('420px')

    pressKey('ArrowRight')
    expect(drawerEl().style.width).toBe('400px')
  })

  it('方向键连续收缩到下限后停住，不会低于 280', async () => {
    await mount()
    for (let i = 0; i < 10; i++) pressKey('ArrowRight', true)
    expect(drawerEl().style.width).toBe(`${MIN_WIDTH}px`)
  })
})

describe('Drawer 标签页作用域绑定', () => {
  it('扩展环境下在 tabId 响应前不挂载 ToolsApp，响应后挂载带对应 tabId 的工具箱', async () => {
    let resolveMessage: ((res: unknown) => void) | null = null
    const sendMessageMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveMessage = resolve
        }),
    )
    ;(globalWithChrome.chrome as { runtime: { sendMessage: unknown } }).runtime.sendMessage =
      sendMessageMock

    await act(async () => {
      root.render(<Drawer onClose={() => {}} />)
    })

    // 尚未响应 tabId：不挂载 ToolsApp，避免首帧以无前缀 key 脏读全局草稿
    expect(container.querySelector('.tw')).toBeNull()

    // 模拟 background 返回 tabId = 88
    await act(async () => {
      resolveMessage?.({ ok: true, data: 88 })
    })

    // 挂载 ToolsApp
    expect(container.querySelector('.tw')).not.toBeNull()
  })
})
