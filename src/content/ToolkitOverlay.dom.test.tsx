// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import {
  MSG_CLOSE_DRAWER,
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_DETECT_SELECTION,
  MSG_OPEN_DRAWER,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_TOGGLE_DETECT,
  MSG_TOGGLE_DRAWER,
} from '@/utils/messages'
import { HOST_ID } from '@/utils/theme'

import ToolkitOverlay from './ToolkitOverlay'

/**
 * 为什么这样测：
 * - ToolkitOverlay 是悬浮球 + 网页内抽屉 + 划选面板的唯一装配点，它的开合只能由
 *   消息 / 快捷键 / 悬浮球点击三条真实入口驱动，这里全部走真实事件与真实 chrome 消息，
 *   断言的是「抽屉 DOM 是否出现」这种可观察结果，而不是某个函数被调用过。
 * - 抽屉与原生侧边栏互斥（AGENTS §5）靠 MSG_CLOSE_NATIVE_SIDE_PANEL 中转实现，
 *   一旦回归会让两种工具箱同时占屏，所以单独断言。
 * - 设置联动（主题 / 字体缩放 / 可见工具 / 域名黑白名单）必须即时生效，不需要刷新页面。
 * - 按 content script 的真实结构把组件挂进 Shadow DOM 宿主，才能验证主题与字体缩放
 *   落在宿主上而不是宿主网页的 <html>（AGENTS §4 第 3、12 条）。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type StorageChange = { oldValue?: unknown; newValue?: unknown }
type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void
type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (res?: unknown) => void,
) => void

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let syncStore: Record<string, unknown>
let localStore: Record<string, unknown>
let sessionStore: Record<string, unknown>
let changeListeners: ChangeListener[]
let messageListeners: MessageListener[]
let sendMessageMock: ReturnType<typeof vi.fn>

interface StubOptions {
  /** null 表示「有 chrome 但没有 runtime.id」= 非扩展环境（pnpm dev 预览） */
  runtimeId?: string | null
  /** 写进 chrome.storage.sync 的 settings；默认补上 locale=zh 让文案断言稳定 */
  settings?: Record<string, unknown>
  local?: Record<string, unknown>
  session?: Record<string, unknown>
}

function makeArea(name: 'sync' | 'local' | 'session', read: () => Record<string, unknown>) {
  return {
    get: async (key: string) => {
      const store = read()
      return key in store ? { [key]: store[key] } : {}
    },
    set: async (obj: Record<string, unknown>) => {
      const store = read()
      const changes: Record<string, StorageChange> = {}
      for (const [key, value] of Object.entries(obj)) {
        changes[key] = { oldValue: store[key], newValue: value }
        store[key] = value
      }
      // 真实 chrome.storage 写入后会广播 onChanged；这里照做，组件才走实时同步分支
      for (const listener of [...changeListeners]) listener(changes, name)
    },
    remove: async (key: string) => {
      delete read()[key]
    },
  }
}

/** 内存版 chrome 桩：storage 四件套 + runtime.sendMessage / onMessage */
function stubChrome(options: StubOptions = {}) {
  syncStore = { settings: { locale: 'zh', ...(options.settings ?? {}) } }
  localStore = { ...(options.local ?? {}) }
  sessionStore = { ...(options.session ?? {}) }
  changeListeners = []
  messageListeners = []
  sendMessageMock = vi.fn(async () => undefined)

  globalWithChrome.chrome = {
    runtime: {
      ...(options.runtimeId === null ? {} : { id: options.runtimeId ?? 'test-extension-id' }),
      sendMessage: sendMessageMock,
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: {
        addListener: (listener: MessageListener) => {
          messageListeners.push(listener)
        },
        removeListener: (listener: MessageListener) => {
          messageListeners = messageListeners.filter((item) => item !== listener)
        },
      },
    },
    storage: {
      sync: makeArea('sync', () => syncStore),
      local: makeArea('local', () => localStore),
      session: makeArea('session', () => sessionStore),
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

/** happy-dom 的 location 是只读的，切换页面地址要走它自带的 setURL */
function setPageUrl(url: string): void {
  const w = window as unknown as { happyDOM?: { setURL?: (next: string) => void } }
  if (!w.happyDOM?.setURL) throw new Error('happy-dom 未提供 setURL，无法切换页面地址')
  w.happyDOM.setURL(url)
}

let nowValue: number

/** 推进被 mock 的 Date.now，用来跨过源码里的 300ms 节流窗口（不依赖真实等待） */
function advanceTime(ms: number): void {
  nowValue += ms
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

/** 模拟 chrome.storage.onChanged 推送 settings 新值 */
function emitSettings(settings: Record<string, unknown>, areaName = 'sync'): void {
  act(() => {
    for (const listener of [...changeListeners]) {
      listener({ settings: { newValue: settings } }, areaName)
    }
  })
}

/** 模拟 background / 扩展页通过 chrome.runtime.onMessage 下发消息，返回 sendResponse 收到的内容 */
function sendContentMessage(message: unknown): unknown[] {
  const responses: unknown[] = []
  act(() => {
    for (const listener of [...messageListeners]) {
      listener(message, {}, (res) => responses.push(res))
    }
  })
  return responses
}

const sentActions = () =>
  sendMessageMock.mock.calls.map((call) => (call[0] as { action?: string } | undefined)?.action)

let host: HTMLDivElement
let container: HTMLDivElement
let root: Root

const shadowRoot = () => host.shadowRoot as ShadowRoot
const query = <T extends Element>(selector: string) => shadowRoot().querySelector<T>(selector)
const drawerEl = () => query<HTMLElement>('.tek__drawer')
const ballEl = () => query<HTMLElement>('.tek__dock')

/** 还原 content script 的真实结构：带 HOST_ID 的宿主 + open shadow root + 内部挂载点 */
function setupShadowHost(): void {
  host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  container = document.createElement('div')
  shadow.appendChild(container)
  root = createRoot(container)
}

const renderOverlay = () =>
  act(async () => {
    root.render(<ToolkitOverlay />)
  })

/** 打开抽屉后等一帧：ToolsApp / 工具面板挂载时会异步读存储，让这些更新落在 act 内 */
async function openDrawer(): Promise<void> {
  sendContentMessage({ action: MSG_OPEN_DRAWER })
  await flush()
}

/** 轻点悬浮球：源码把「按下又原地松开」判定为点击（位移未过阈值） */
function clickBall(): void {
  const ball = ballEl()
  if (!ball) throw new Error('悬浮球未渲染')
  act(() => {
    ball.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
    )
    ball.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
    )
  })
}

function pressShortcut(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

function clickDrawerClose(): void {
  const button = query<HTMLButtonElement>(`button[aria-label="${i18n.t('drawer.ariaClose')}"]`)
  if (!button) throw new Error('未找到抽屉关闭按钮')
  act(() => {
    button.click()
  })
}

beforeEach(() => {
  nowValue = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => nowValue)
  setPageUrl('https://example.com/page')
  setupShadowHost()
  stubChrome()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete globalWithChrome.chrome
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
  vi.restoreAllMocks()
})

afterAll(async () => {
  // 用例里可能把语言推到 en，收尾恢复默认，避免污染其它文件
  await i18n.changeLanguage('zh')
})

describe('未打开时的渲染', () => {
  it('quickOpen=false 时整层什么都不渲染；推 settings 打开后才出现悬浮球', async () => {
    stubChrome({ settings: { quickOpen: false } })

    await renderOverlay()
    await flush()

    expect(container.children).toHaveLength(0)
    expect(ballEl()).toBeNull()
    expect(drawerEl()).toBeNull()

    emitSettings({ quickOpen: true })

    const ball = ballEl()
    expect(ball).not.toBeNull()
    expect(ball?.getAttribute('aria-label')).toBe(i18n.t('ball.ariaOpen'))
  })

  it('黑名单命中当前域名时不渲染悬浮球；清空名单后立即出现，再拉黑又消失', async () => {
    stubChrome({ settings: { ballBlacklist: ['example.com'] } })

    await renderOverlay()
    await flush()
    expect(ballEl()).toBeNull()

    emitSettings({ ballBlacklist: [] })
    expect(ballEl()).not.toBeNull()

    emitSettings({ ballBlacklist: ['example.com'] })
    expect(ballEl()).toBeNull()
  })

  it('白名单模式：未命中不显示，命中后显示（跟随 settings 即时切换）', async () => {
    stubChrome({ settings: { ballDomainMode: 'whitelist', ballWhitelist: ['other.test'] } })

    await renderOverlay()
    await flush()
    expect(ballEl()).toBeNull()

    emitSettings({ ballWhitelist: ['example.com'] })
    expect(ballEl()).not.toBeNull()
  })
})

describe('抽屉的开合入口', () => {
  it('MSG_OPEN_DRAWER 打开抽屉并渲染工具箱（tablist + 工具面板），关闭按钮能收起', async () => {
    await renderOverlay()
    await flush()
    expect(drawerEl()).toBeNull()

    const responses = sendContentMessage({ action: MSG_OPEN_DRAWER })
    await flush()

    const drawer = drawerEl()
    expect(drawer).not.toBeNull()
    expect(drawer?.getAttribute('role')).toBe('dialog')
    expect(drawer?.getAttribute('aria-label')).toBe(i18n.t('drawer.ariaLabel'))
    expect(responses).toEqual([{ ok: true }])

    // 抽屉里承载的是与原生侧边栏同一套工具箱
    expect(query('.tw')).not.toBeNull()
    const tabs = [...shadowRoot().querySelectorAll('button[role="tab"]')]
    expect(tabs.length).toBeGreaterThan(0)
    expect(query('[data-tool="detect"]')).not.toBeNull()

    clickDrawerClose()
    expect(drawerEl()).toBeNull()
    // 悬浮球仍在，抽屉只是收起来了
    expect(ballEl()).not.toBeNull()
  })

  it('Escape 关闭抽屉，但点击抽屉外不会关闭（没有遮罩层）', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()
    expect(drawerEl()).not.toBeNull()

    // 只加键盘关闭，不加遮罩：点击抽屉外（宿主网页 / 挂载点）不应收起
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      container.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(drawerEl()).not.toBeNull()

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(drawerEl()).toBeNull()
  })

  it('影子根里存在 .tk-modal 内层弹窗时 Escape 不关抽屉，交给内层弹窗', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()
    expect(drawerEl()).not.toBeNull()

    // happy-dom 里直接往影子根塞一个 .tk-modal，构造「内层弹窗还开着」的场景
    const modal = document.createElement('div')
    modal.className = 'tk-modal'
    shadowRoot().appendChild(modal)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(drawerEl()).not.toBeNull()

    // 内层弹窗关掉后，Escape 才轮到抽屉
    modal.remove()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(drawerEl()).toBeNull()
  })

  it('焦点在声明接管 Escape 的内联编辑里时不关抽屉，编辑结束后才轮到抽屉', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()

    // 网页存储双击编辑值时的真实形态：编辑容器带 data-tk-escape，焦点落在其内部
    const editor = document.createElement('div')
    editor.setAttribute('data-tk-escape', '')
    const input = document.createElement('input')
    editor.appendChild(input)
    shadowRoot().appendChild(editor)
    act(() => input.focus())

    const deferred = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.dispatchEvent(deferred)
    })
    // 让行：既不关抽屉，也不 preventDefault（按键留给内层编辑）
    expect(deferred.defaultPrevented).toBe(false)
    expect(drawerEl()).not.toBeNull()

    // 编辑结束（标记随编辑态一起消失）后，Escape 重新归抽屉
    editor.remove()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(drawerEl()).toBeNull()
  })

  it('焦点在未声明接管 Escape 的普通输入里时，Escape 仍关闭抽屉（不过度让行）', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()

    // 只对「有标记 + 有焦点」让行：否则抽屉在任意输入聚焦时都关不掉
    const plain = document.createElement('input')
    shadowRoot().appendChild(plain)
    act(() => plain.focus())

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(drawerEl()).toBeNull()
  })

  it('影子根里存在 .tek-detect-panel 划选面板时 Escape 不关抽屉，也不 preventDefault', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()
    expect(drawerEl()).not.toBeNull()

    // 划选解析面板与抽屉同在影子根里，且自带 Escape 关闭：它更内层，按键必须先让给它，
    // 否则一次 Escape 会把面板和抽屉一起关掉。
    const panel = document.createElement('div')
    panel.className = 'tek-detect-panel'
    shadowRoot().appendChild(panel)

    const blocked = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(blocked)
    })
    expect(drawerEl()).not.toBeNull()
    // 让行时不消费按键：面板自己的 Escape 处理仍然拿得到
    expect(blocked.defaultPrevented).toBe(false)

    // 面板关掉后，Escape 才轮到抽屉
    panel.remove()
    const closing = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(closing)
    })
    expect(closing.defaultPrevented).toBe(true)
    expect(drawerEl()).toBeNull()
  })

  it('Alt+Shift+D 打开 / 关闭抽屉，300ms 内重复触发被节流', async () => {
    await renderOverlay()
    await flush()

    const openEvent = pressShortcut('d')
    expect(openEvent.defaultPrevented).toBe(true)
    await flush()
    expect(drawerEl()).not.toBeNull()

    // 同一时刻再次触发：节流窗口内应被忽略，抽屉保持打开
    pressShortcut('d')
    expect(drawerEl()).not.toBeNull()

    advanceTime(400)
    pressShortcut('d')
    expect(drawerEl()).toBeNull()
  })

  it('点击悬浮球打开抽屉，并请 background 关闭原生侧边栏（互斥）', async () => {
    await renderOverlay()
    await flush()

    clickBall()
    await flush()

    expect(drawerEl()).not.toBeNull()
    expect(sentActions()).toContain(MSG_CLOSE_NATIVE_SIDE_PANEL)
    // 网页内抽屉路径不应去请求原生侧边栏
    expect(sentActions()).not.toContain(MSG_OPEN_NATIVE_SIDE_PANEL)

    advanceTime(400)
    clickBall()
    expect(drawerEl()).toBeNull()
  })
})

describe('ballAction=native 的行为与回退', () => {
  it('原生侧边栏成功打开时不展开网页抽屉，也不提示', async () => {
    stubChrome({ settings: { ballAction: 'native' } })
    sendMessageMock.mockImplementation(async (message: unknown) =>
      (message as { action?: string }).action === MSG_OPEN_NATIVE_SIDE_PANEL ? true : undefined,
    )

    await renderOverlay()
    await flush()
    clickBall()
    await flush()

    expect(sendMessageMock).toHaveBeenCalledWith({
      action: MSG_OPEN_NATIVE_SIDE_PANEL,
      forceOpen: false,
    })
    expect(drawerEl()).toBeNull()
    expect(query('.tek__toast')).toBeNull()
  })

  it('原生侧边栏打开失败时自动回退展开网页抽屉并给出提示', async () => {
    stubChrome({ settings: { ballAction: 'native' } })
    // 默认 sendMessage 返回 undefined，等价于 background 拒绝 / 无响应

    await renderOverlay()
    await flush()
    clickBall()
    await flush()

    expect(sentActions()).toContain(MSG_OPEN_NATIVE_SIDE_PANEL)
    expect(drawerEl()).not.toBeNull()

    const toast = query<HTMLElement>('.tek__toast')
    expect(toast).not.toBeNull()
    expect(toast?.getAttribute('role')).toBe('status')
    expect(toast?.textContent).toBe(i18n.t('toast.nativeSidePanelFallback'))
  })
})

describe('消息驱动的开合状态', () => {
  it('MSG_TOGGLE_DRAWER 反复开合，每次都回 {ok:true}；节流窗口内第二次不改状态', async () => {
    await renderOverlay()
    await flush()

    expect(sendContentMessage({ action: MSG_TOGGLE_DRAWER })).toEqual([{ ok: true }])
    await flush()
    expect(drawerEl()).not.toBeNull()
    // 打开抽屉时同步发出互斥消息，且只发一次
    expect(sentActions().filter((action) => action === MSG_CLOSE_NATIVE_SIDE_PANEL)).toHaveLength(1)

    // 同一时刻的第二次 toggle 被节流：回执照旧，但状态不变
    expect(sendContentMessage({ action: MSG_TOGGLE_DRAWER })).toEqual([{ ok: true }])
    expect(drawerEl()).not.toBeNull()

    advanceTime(400)
    expect(sendContentMessage({ action: MSG_TOGGLE_DRAWER })).toEqual([{ ok: true }])
    expect(drawerEl()).toBeNull()
  })

  it('MSG_OPEN_DRAWER / MSG_CLOSE_DRAWER 只改开合状态（源码未在这条路径做侧边栏互斥）', async () => {
    await renderOverlay()
    await flush()

    expect(sendContentMessage({ action: MSG_OPEN_DRAWER })).toEqual([{ ok: true }])
    await flush()
    expect(drawerEl()).not.toBeNull()
    expect(sentActions()).not.toContain(MSG_CLOSE_NATIVE_SIDE_PANEL)

    expect(sendContentMessage({ action: MSG_CLOSE_DRAWER })).toEqual([{ ok: true }])
    expect(drawerEl()).toBeNull()
  })

  it('未知 action 不改变状态，也不回响应', async () => {
    await renderOverlay()
    await flush()

    const responses = sendContentMessage({ action: 'NOT_A_REAL_ACTION' })

    expect(responses).toHaveLength(0)
    expect(drawerEl()).toBeNull()
    expect(ballEl()).not.toBeNull()
  })
})

describe('设置联动', () => {
  it('主题与字体缩放落到 Shadow 宿主上，且不污染宿主网页的 <html>', async () => {
    stubChrome({ settings: { theme: 'dark', fontScale: 1.25 } })

    await renderOverlay()
    await flush()

    expect(host.dataset.theme).toBe('dark')
    expect(host.style.getPropertyValue('--tk-font-scale')).toBe('1.25')
    // content script 绝不能把令牌写到宿主的 documentElement（AGENTS §4 第 12 条）
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--tk-font-scale')).toBe('')

    emitSettings({ theme: 'light', fontScale: 1.1 })

    expect(host.dataset.theme).toBe('light')
    expect(host.style.getPropertyValue('--tk-font-scale')).toBe('1.1')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('settings.toolEnabled 变化时可见工具列表与激活工具随之更新（无需刷新）', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()

    // 默认激活第一个可见工具 detect
    expect(query('[data-tool="detect"]')).not.toBeNull()
    expect(query('.tw__body--detect')).not.toBeNull()

    emitSettings({ toolEnabled: { detect: false } })
    await flush()

    expect(query('[data-tool="detect"]')).toBeNull()
    expect(query('[data-tool="storage"]')).not.toBeNull()
    // 隐藏当前工具后，激活项自动落到新的第一个可见工具
    expect(query('.tw__body--storage')).not.toBeNull()
  })

  it('settings.toolOrder 变化时选项卡顺序随之更新', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()

    emitSettings({ toolOrder: ['json', 'detect'], toolEnabled: {} })
    await flush()

    const firstTab = shadowRoot().querySelector<HTMLElement>('button[role="tab"]')
    expect(firstTab?.dataset.tool).toBe('json')
    expect(query('.tw__body--json')).not.toBeNull()
  })

  it('locale 变化时界面文案中英即时切换', async () => {
    stubChrome({ settings: { locale: 'zh' } })

    await renderOverlay()
    await flush()
    await openDrawer()

    expect(ballEl()?.getAttribute('aria-label')).toBe('打开工具箱')
    expect(query('[aria-label="关闭抽屉"]')).not.toBeNull()

    emitSettings({ locale: 'en' })
    await flush()

    expect(ballEl()?.getAttribute('aria-label')).toBe('Open toolbox')
    expect(query('[aria-label="Close drawer"]')).not.toBeNull()

    emitSettings({ locale: 'zh' })
    await flush()
    expect(ballEl()?.getAttribute('aria-label')).toBe('打开工具箱')
  })

  it('挂载与开抽屉都不会向 document.head 注入样式（content 样式只允许内联进 Shadow DOM）', async () => {
    const headStyleCount = document.head.querySelectorAll('style').length

    await renderOverlay()
    await flush()
    await openDrawer()

    expect(query('.tek__drawer')).not.toBeNull()
    expect(document.head.querySelectorAll('style')).toHaveLength(headStyleCount)
    expect(document.querySelectorAll('style')).toHaveLength(0)
  })
})

describe('划选解析面板（消息入口）', () => {
  it('MSG_DETECT_SELECTION 带入选中的文本并弹出面板，取消按钮可关闭', async () => {
    await renderOverlay()
    await flush()

    sendContentMessage({ action: MSG_DETECT_SELECTION, text: 'hello' })

    const panel = query<HTMLElement>('.tek-detect-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('role')).toBe('dialog')
    expect(panel?.getAttribute('aria-label')).toBe(i18n.t('tool.detect.title'))
    expect(query<HTMLTextAreaElement>('.tek-detect-panel textarea')?.value).toBe('hello')

    const cancel = query<HTMLButtonElement>(`button[aria-label="${i18n.t('common.cancel')}"]`)
    act(() => {
      cancel?.click()
    })
    expect(query('.tek-detect-panel')).toBeNull()
  })

  it('MSG_TOGGLE_DETECT 空选区时先弹出面板，再按一次收回', async () => {
    await renderOverlay()
    await flush()

    sendContentMessage({ action: MSG_TOGGLE_DETECT })
    expect(query('.tek-detect-panel')).not.toBeNull()
    expect(query<HTMLTextAreaElement>('.tek-detect-panel textarea')?.value).toBe('')

    advanceTime(400)
    sendContentMessage({ action: MSG_TOGGLE_DETECT })
    expect(query('.tek-detect-panel')).toBeNull()
  })
})

describe('卸载清理', () => {
  it('卸载后移除 onMessage / onChanged 监听，再推送消息既不报错也不更新 UI', async () => {
    await renderOverlay()
    await flush()
    await openDrawer()
    expect(messageListeners.length).toBeGreaterThan(0)
    expect(changeListeners.length).toBeGreaterThan(0)

    const staleListeners = [...messageListeners]

    act(() => root.unmount())

    expect(messageListeners).toHaveLength(0)
    expect(changeListeners).toHaveLength(0)

    // 用卸载前拿到的监听器再推一次：不应抛错，也不应把 DOM 又渲染回来
    act(() => {
      for (const listener of staleListeners) listener({ action: MSG_TOGGLE_DRAWER }, {}, () => {})
    })
    expect(container.innerHTML).toBe('')

    // afterEach 会 unmount，这里补一个全新 root 避免对已卸载的 root 重复操作
    root = createRoot(container)
  })
})
