import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ERROR_CODES,
  MSG_CLOSE_DRAWER,
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_COOKIE_CLEAR_ALL,
  MSG_COOKIE_GET_ALL,
  MSG_COOKIE_REMOVE,
  MSG_COOKIE_SET,
  MSG_DETECT_SELECTION,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_OPEN_OPTIONS,
  MSG_OPEN_SHORTCUTS,
  MSG_TOGGLE_DETECT,
  MSG_TOGGLE_DRAWER,
} from '@/utils/messages'
import type { ErrorCode } from '@/utils/messages'

/**
 * background/main.ts 是副作用模块：import 的瞬间就会注册 onInstalled / onMessage / onCommand /
 * onConnect 等监听器，并把设置快照、侧边栏存活态写进模块级变量。
 * 因此每个用例都必须 vi.resetModules() + 重建 chrome 桩 + 动态 import('./main')，
 * 才能拿到「本次注册」的监听器与干净的模块状态；静态 import 只会执行一次。
 *
 * 测试断言的是跨端协议：
 * - 失败响应只允许是 { ok:false, code }（code 必须来自 ERROR_CODES），绝不能出现任何语言的文案；
 * - chrome.sidePanel.open 在快捷键路径必须同步首帧调用（用户手势令牌一旦 await 就失效）。
 */

/** 匹配任意 CJK 字符：用来守住「background 不产出文案」 */
const CJK = /[\u4e00-\u9fff]/

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

type Fn = ReturnType<typeof vi.fn>
type MessageHandler = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => unknown

interface FakePort {
  name: string
  postMessage: Fn
  onMessage: { addListener: Fn }
  onDisconnect: { addListener: Fn }
}

interface FakeRuntime {
  id: string
  getURL: Fn
  lastError?: { message?: string }
  onInstalled: { addListener: Fn }
  onMessage: { addListener: Fn }
  onConnect: { addListener: Fn }
  sendMessage: Fn
}

interface StubOptions {
  /** chrome.storage.sync.get('settings') 的返回值；省略表示读到空对象 */
  settings?: unknown
  /** 是否提供 storage.session.setAccessLevel（默认提供） */
  withSetAccessLevel?: boolean
  /** 让 setAccessLevel 返回被拒绝的 Promise，验证 .catch 兜底不产生 unhandled rejection */
  setAccessLevelRejects?: boolean
}

interface BackgroundHarness {
  chrome: object
  runtime: FakeRuntime
  messageListeners: MessageHandler[]
  installedListeners: Array<() => void>
  menuClickedListeners: Array<(info: unknown, tab: unknown) => void>
  commandListeners: Array<(command: string, tab: unknown) => void>
  connectListeners: Array<(port: FakePort) => void>
  storageChangedListeners: Array<(changes: unknown, areaName: string) => void>
  focusChangedListeners: Array<(windowId: number) => void>
  tabActivatedListeners: Array<(info: { windowId?: number }) => void>
  getURL: Fn
  tabsCreate: Fn
  tabsQuery: Fn
  tabsSendMessage: Fn
  cookiesGetAll: Fn
  cookiesRemove: Fn
  cookiesSet: Fn
  contextMenusCreate: Fn
  contextMenusRemoveAll: Fn
  i18nGetMessage: Fn
  sidePanelOpen: Fn
  sidePanelClose: Fn
  runtimeSendMessage: Fn
  sessionSetAccessLevel?: Fn
}

function createHarness(options: StubOptions): BackgroundHarness {
  const messageListeners: MessageHandler[] = []
  const installedListeners: Array<() => void> = []
  const menuClickedListeners: Array<(info: unknown, tab: unknown) => void> = []
  const commandListeners: Array<(command: string, tab: unknown) => void> = []
  const connectListeners: Array<(port: FakePort) => void> = []
  const storageChangedListeners: Array<(changes: unknown, areaName: string) => void> = []
  const focusChangedListeners: Array<(windowId: number) => void> = []
  const tabActivatedListeners: Array<(info: { windowId?: number }) => void> = []

  const getURL = vi.fn((path: string) => `chrome-extension://fake-id/${path}`)
  const runtimeSendMessage = vi.fn(async (): Promise<unknown> => undefined)
  const tabsCreate = vi.fn(async (): Promise<unknown> => ({ id: 1 }))
  const tabsQuery = vi.fn(async (): Promise<unknown> => [])
  const tabsSendMessage = vi.fn(async (): Promise<unknown> => undefined)
  const cookiesGetAll = vi.fn(async (): Promise<unknown> => [])
  const cookiesRemove = vi.fn(async (): Promise<unknown> => ({}))
  const cookiesSet = vi.fn(async (): Promise<unknown> => ({}))
  const contextMenusCreate = vi.fn()
  const contextMenusRemoveAll = vi.fn((callback?: () => void) => callback?.())
  const i18nGetMessage = vi.fn((key: string) => `MENU:${key}`)
  const sidePanelOpen = vi.fn(async (): Promise<unknown> => undefined)
  const sidePanelClose = vi.fn(async (): Promise<unknown> => undefined)
  const syncGet = vi.fn(
    async (key: string): Promise<unknown> =>
      options.settings === undefined ? {} : { [key]: options.settings },
  )

  const sessionSetAccessLevel =
    options.withSetAccessLevel === false
      ? undefined
      : vi.fn(async (): Promise<void> => {
          if (options.setAccessLevelRejects) throw new Error('session access denied')
        })

  const runtime: FakeRuntime = {
    id: 'fake-id',
    getURL,
    lastError: undefined,
    onInstalled: {
      addListener: vi.fn((listener: () => void) => {
        installedListeners.push(listener)
      }),
    },
    onMessage: {
      addListener: vi.fn((listener: MessageHandler) => {
        messageListeners.push(listener)
      }),
    },
    onConnect: {
      addListener: vi.fn((listener: (port: FakePort) => void) => {
        connectListeners.push(listener)
      }),
    },
    sendMessage: runtimeSendMessage,
  }

  const chrome = {
    runtime,
    storage: {
      sync: { get: syncGet },
      session: sessionSetAccessLevel ? { setAccessLevel: sessionSetAccessLevel } : {},
      onChanged: {
        addListener: vi.fn((listener: (changes: unknown, areaName: string) => void) => {
          storageChangedListeners.push(listener)
        }),
      },
    },
    contextMenus: {
      removeAll: contextMenusRemoveAll,
      create: contextMenusCreate,
      onClicked: {
        addListener: vi.fn((listener: (info: unknown, tab: unknown) => void) => {
          menuClickedListeners.push(listener)
        }),
      },
    },
    tabs: {
      query: tabsQuery,
      sendMessage: tabsSendMessage,
      create: tabsCreate,
      onActivated: {
        addListener: vi.fn((listener: (info: { windowId?: number }) => void) => {
          tabActivatedListeners.push(listener)
        }),
      },
    },
    windows: {
      getCurrent: vi.fn(async (): Promise<unknown> => ({ id: 1 })),
      onFocusChanged: {
        addListener: vi.fn((listener: (windowId: number) => void) => {
          focusChangedListeners.push(listener)
        }),
      },
    },
    commands: {
      getAll: vi.fn(async (): Promise<unknown> => []),
      onCommand: {
        addListener: vi.fn((listener: (command: string, tab: unknown) => void) => {
          commandListeners.push(listener)
        }),
      },
    },
    cookies: {
      getAll: cookiesGetAll,
      remove: cookiesRemove,
      set: cookiesSet,
    },
    sidePanel: {
      open: sidePanelOpen,
      close: sidePanelClose,
    },
    i18n: {
      getMessage: i18nGetMessage,
    },
  }

  return {
    chrome,
    runtime,
    messageListeners,
    installedListeners,
    menuClickedListeners,
    commandListeners,
    connectListeners,
    storageChangedListeners,
    focusChangedListeners,
    tabActivatedListeners,
    getURL,
    tabsCreate,
    tabsQuery,
    tabsSendMessage,
    cookiesGetAll,
    cookiesRemove,
    cookiesSet,
    contextMenusCreate,
    contextMenusRemoveAll,
    i18nGetMessage,
    sidePanelOpen,
    sidePanelClose,
    runtimeSendMessage,
    sessionSetAccessLevel,
  }
}

/** 本次用例的 harness：boot() 之后可用；dispatch / runCommand 等辅助函数都读它 */
let harness: BackgroundHarness

function installChromeStub(options: StubOptions = {}): BackgroundHarness {
  harness = createHarness(options)
  globalWithChrome.chrome = harness.chrome
  return harness
}

/** 刷新微任务队列：让 storage.sync.get(...).then(...) 等异步快照落到模块级变量上 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 动态 import 副作用模块，并等首帧异步初始化完成 */
async function boot(options: StubOptions = {}): Promise<BackgroundHarness> {
  const h = installChromeStub(options)
  await import('./main')
  await flush()
  return h
}

/**
 * 调用 onMessage 监听器并把 sendResponse 包成 Promise。
 * 注意：handler 可能既同步 sendResponse 又返回 undefined（此时立即以该响应收敛）。
 */
function dispatch(message: unknown, sender: unknown = {}): Promise<unknown> {
  const listener = harness.messageListeners[0]
  if (!listener) throw new Error('main.ts 未注册 runtime.onMessage 监听器')
  return new Promise((resolve) => {
    const returned = listener(message, sender, resolve)
    if (returned === undefined) resolve(undefined)
  })
}

function runCommand(command: string, tab: unknown): void {
  const listener = harness.commandListeners[0]
  if (!listener) throw new Error('main.ts 未注册 commands.onCommand 监听器')
  listener(command, tab)
}

function fireInstalled(): void {
  const listener = harness.installedListeners[0]
  if (!listener) throw new Error('main.ts 未注册 runtime.onInstalled 监听器')
  listener()
}

function fireMenuClick(info: unknown, tab: unknown): void {
  const listener = harness.menuClickedListeners[0]
  if (!listener) throw new Error('main.ts 未注册 contextMenus.onClicked 监听器')
  listener(info, tab)
}

function fireConnect(port: FakePort): void {
  const listener = harness.connectListeners[0]
  if (!listener) throw new Error('main.ts 未注册 runtime.onConnect 监听器')
  listener(port)
}

function fireStorageChanged(changes: unknown, areaName: string): void {
  const listener = harness.storageChangedListeners[0]
  if (!listener) throw new Error('main.ts 未注册 storage.onChanged 监听器')
  listener(changes, areaName)
}

function fireTabActivated(info: { windowId?: number }): void {
  const listener = harness.tabActivatedListeners[0]
  if (!listener) throw new Error('main.ts 未注册 tabs.onActivated 监听器')
  listener(info)
}

/** 造一个最小可用的 Port：记录监听器，便于测试手动触发消息 / 断开 */
function createPort(name: string) {
  let messageListener: ((message: unknown) => void) | undefined
  let disconnectListener: (() => void) | undefined
  const port: FakePort = {
    name,
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => {
        messageListener = listener
      }),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListener = listener
      }),
    },
  }
  return {
    port,
    emitMessage: (message: unknown) => messageListener?.(message),
    disconnect: () => disconnectListener?.(),
  }
}

/** 断言失败响应精确等于 { ok:false, code }（可选 detail），且 code 合法、响应内不含任何中文 */
function expectErrorResponse(response: unknown, code: ErrorCode, detail?: string): void {
  expect(response).toEqual(detail === undefined ? { ok: false, code } : { ok: false, code, detail })
  expect(ERROR_CODES).toContain((response as { code: ErrorCode }).code)
  expect(JSON.stringify(response)).not.toMatch(CJK)
}

function firstSetDetails(index = 0): Record<string, unknown> {
  const call = harness.cookiesSet.mock.calls[index]
  expect(call).toBeDefined()
  return (call?.[0] ?? {}) as Record<string, unknown>
}

beforeEach(() => {
  // 副作用模块必须在每个用例里重新求值，否则拿不到本次注册的监听器
  vi.resetModules()
})

afterEach(() => {
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
})

describe('打开扩展页面（MSG_OPEN_OPTIONS / MSG_OPEN_SHORTCUTS）', () => {
  // getURL 拼出的扩展页地址必须原样交给 tabs.create，否则会打开 404 页
  it('MSG_OPEN_OPTIONS 用 runtime.getURL 打开 options.html，成功后回 true', async () => {
    const h = await boot()
    await expect(dispatch({ action: MSG_OPEN_OPTIONS })).resolves.toBe(true)
    expect(h.getURL).toHaveBeenCalledWith('options.html')
    expect(h.tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://fake-id/options.html' })
  })

  it('MSG_OPEN_OPTIONS 在 tabs.create 失败时回 false，不抛错', async () => {
    const h = await boot()
    h.tabsCreate.mockRejectedValueOnce(new Error('no window'))
    await expect(dispatch({ action: MSG_OPEN_OPTIONS })).resolves.toBe(false)
  })

  it('MSG_OPEN_SHORTCUTS 打开 chrome://extensions/shortcuts 且不走 getURL', async () => {
    const h = await boot()
    await expect(dispatch({ action: MSG_OPEN_SHORTCUTS })).resolves.toBe(true)
    expect(h.tabsCreate).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' })
    expect(h.getURL).not.toHaveBeenCalled()
  })

  it('MSG_OPEN_SHORTCUTS 在 tabs.create 失败时回 false', async () => {
    await boot()
    harness.tabsCreate.mockRejectedValueOnce(new Error('no window'))
    await expect(dispatch({ action: MSG_OPEN_SHORTCUTS })).resolves.toBe(false)
  })

  it('未知 action 返回 undefined 且不响应、不产生副作用', async () => {
    const h = await boot()
    await expect(dispatch({ action: 'UNKNOWN_ACTION' })).resolves.toBeUndefined()
    expect(h.tabsCreate).not.toHaveBeenCalled()
  })
})

describe('MSG_COOKIE_GET_ALL', () => {
  it('显式 http(s) url 直接使用（不查活动标签页），并逐字段映射 cookie', async () => {
    const h = await boot()
    h.cookiesGetAll.mockResolvedValueOnce([
      {
        name: 'sid',
        value: 'abc',
        domain: '.example.com',
        path: '/app',
        hostOnly: false,
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: false,
        expirationDate: 1700000000,
        storeId: '0',
      },
    ])

    const response = await dispatch({
      action: MSG_COOKIE_GET_ALL,
      url: 'https://example.com/path?q=1',
    })

    expect(response).toEqual({
      ok: true,
      data: {
        url: 'https://example.com/path?q=1',
        origin: 'https://example.com',
        cookies: [
          {
            name: 'sid',
            value: 'abc',
            domain: '.example.com',
            path: '/app',
            hostOnly: false,
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            session: false,
            expirationDate: 1700000000,
            storeId: '0',
          },
        ],
        totalCount: 1,
      },
    })
    expect(h.tabsQuery).not.toHaveBeenCalled()
    expect(h.cookiesGetAll).toHaveBeenCalledWith({ url: 'https://example.com/path?q=1' })
  })

  it('无 url 且无活动标签页时回 ERR_COOKIE_NO_PAGE_URL（精确错误码，无文案）', async () => {
    await boot()
    const response = await dispatch({ action: MSG_COOKIE_GET_ALL })
    expectErrorResponse(response, 'ERR_COOKIE_NO_PAGE_URL')
    expect(harness.cookiesGetAll).not.toHaveBeenCalled()
  })

  it('活动标签页不是 http(s)（chrome:// 特权页）时同样视为没有可用页面', async () => {
    const h = await boot()
    h.tabsQuery.mockResolvedValueOnce([{ id: 1, url: 'chrome://extensions' }])
    const response = await dispatch({ action: MSG_COOKIE_GET_ALL })
    expectErrorResponse(response, 'ERR_COOKIE_NO_PAGE_URL')
  })

  it('tabs.query 自身抛错也被吞掉，返回 ERR_COOKIE_NO_PAGE_URL 而非 ERR_UNEXPECTED', async () => {
    const h = await boot()
    h.tabsQuery.mockRejectedValueOnce(new Error('tabs boom'))
    const response = await dispatch({ action: MSG_COOKIE_GET_ALL })
    expectErrorResponse(response, 'ERR_COOKIE_NO_PAGE_URL')
  })

  it('cookies.getAll 抛 Error 时回 ERR_UNEXPECTED + 原始 message', async () => {
    const h = await boot()
    h.cookiesGetAll.mockRejectedValueOnce(new Error('cookies boom'))
    const response = await dispatch({ action: MSG_COOKIE_GET_ALL, url: 'https://example.com/' })
    expectErrorResponse(response, 'ERR_UNEXPECTED', 'cookies boom')
  })

  it('cookies.getAll 抛非 Error 时用 String(e) 作为 detail', async () => {
    const h = await boot()
    h.cookiesGetAll.mockRejectedValueOnce('plain failure')
    const response = await dispatch({ action: MSG_COOKIE_GET_ALL, url: 'https://example.com/' })
    expectErrorResponse(response, 'ERR_UNEXPECTED', 'plain failure')
  })
})

describe('MSG_COOKIE_REMOVE', () => {
  it('缺 url 或 name 时回 ERR_COOKIE_MISSING_PARAM，且不调用 cookies.remove', async () => {
    const h = await boot()
    expectErrorResponse(await dispatch({ action: MSG_COOKIE_REMOVE }), 'ERR_COOKIE_MISSING_PARAM')
    expectErrorResponse(
      await dispatch({ action: MSG_COOKIE_REMOVE, name: 'sid' }),
      'ERR_COOKIE_MISSING_PARAM',
    )
    expectErrorResponse(
      await dispatch({ action: MSG_COOKIE_REMOVE, url: 'https://example.com/' }),
      'ERR_COOKIE_MISSING_PARAM',
    )
    expect(h.cookiesRemove).not.toHaveBeenCalled()
  })

  it('cookies.remove 返回 falsy 时回 ERR_COOKIE_REMOVE_FAILED', async () => {
    const h = await boot()
    h.cookiesRemove.mockResolvedValueOnce(null)
    const response = await dispatch({
      action: MSG_COOKIE_REMOVE,
      url: 'https://example.com/',
      name: 'sid',
    })
    expectErrorResponse(response, 'ERR_COOKIE_REMOVE_FAILED')
  })

  it('删除成功回 {ok:true}，并把 storeId 原样透传', async () => {
    const h = await boot()
    h.cookiesRemove.mockResolvedValueOnce({ name: 'sid' })
    const response = await dispatch({
      action: MSG_COOKIE_REMOVE,
      url: 'https://example.com/app',
      name: 'sid',
      storeId: '1',
    })
    expect(response).toEqual({ ok: true })
    expect(h.cookiesRemove).toHaveBeenCalledWith({
      url: 'https://example.com/app',
      name: 'sid',
      storeId: '1',
    })
  })

  it('cookies.remove 抛错时回 ERR_UNEXPECTED + 原始 message', async () => {
    const h = await boot()
    h.cookiesRemove.mockRejectedValueOnce(new Error('remove boom'))
    const response = await dispatch({
      action: MSG_COOKIE_REMOVE,
      url: 'https://example.com/',
      name: 'sid',
    })
    expectErrorResponse(response, 'ERR_UNEXPECTED', 'remove boom')
  })
})

describe('MSG_COOKIE_SET', () => {
  it('既无 cookies 也无 cookie 时回 ERR_COOKIE_EMPTY_PAYLOAD', async () => {
    const h = await boot()
    const response = await dispatch({ action: MSG_COOKIE_SET, url: 'https://example.com/' })
    expectErrorResponse(response, 'ERR_COOKIE_EMPTY_PAYLOAD')
    expect(h.cookiesSet).not.toHaveBeenCalled()
  })

  it('无法确定目标 url 时回 ERR_NO_TARGET_URL', async () => {
    await boot()
    const response = await dispatch({
      action: MSG_COOKIE_SET,
      cookie: { name: 'a', value: '1' },
    })
    expectErrorResponse(response, 'ERR_NO_TARGET_URL')
  })

  // getCookieUrl 的拼接规则直接决定写入落到哪个域/路径，错一条就会写到别的 cookie 上
  it('单条 cookie：url 拼接、path 默认、布尔化、NaN 的 expirationDate 不写入', async () => {
    const h = await boot()
    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'http://example.com/page',
      cookie: {
        name: 'a',
        value: '1',
        domain: '.example.com',
        path: 'sub',
        expirationDate: Number.NaN,
      },
    })

    expect(response).toEqual({ ok: true, count: 1 })
    expect(h.cookiesSet).toHaveBeenCalledTimes(1)

    const details = firstSetDetails()
    expect(details).toEqual({
      url: 'http://example.com/sub',
      name: 'a',
      value: '1',
      path: 'sub',
      secure: false,
      httpOnly: false,
      domain: '.example.com',
    })
    // NaN 的过期时间若被写进 SetDetails，Chrome 会把整条写入判定为非法
    expect(details).not.toHaveProperty('expirationDate')
    expect(details).not.toHaveProperty('sameSite')
    expect(details.storeId).toBeUndefined()
  })

  it('value 缺省时补空串，httpOnly / secure 用 Boolean 归一', async () => {
    await boot()
    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'http://example.com/',
      cookie: { name: 'b', httpOnly: 1, secure: 'yes' },
    })
    const details = firstSetDetails()
    expect(details.value).toBe('')
    expect(details.httpOnly).toBe(true)
    expect(details.secure).toBe(true)
  })

  it('合法的 expirationDate 与 sameSite 原样透传', async () => {
    await boot()
    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookie: { name: 'c', value: '3', sameSite: 'lax', expirationDate: 1700000000 },
    })
    const details = firstSetDetails()
    expect(details.sameSite).toBe('lax')
    expect(details.expirationDate).toBe(1700000000)
  })

  it('domain 缺省时用目标 url 的主机名，secure 决定协议', async () => {
    await boot()
    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://sub.example.com/p',
      cookie: { name: 'd' },
    })
    expect(firstSetDetails()).toEqual({
      url: 'https://sub.example.com/',
      name: 'd',
      value: '',
      path: '/',
      secure: false,
      httpOnly: false,
    })

    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'http://example.com/',
      cookie: { name: 'e', secure: true },
    })
    const details = firstSetDetails(1)
    expect(details.url).toBe('https://example.com/')
    expect(details.secure).toBe(true)
    expect(details).not.toHaveProperty('domain')
  })

  it('path 不以 / 开头时补全，且 SetDetails.path 保留原值', async () => {
    await boot()
    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'http://example.com/',
      cookie: { name: 'f', value: '1', path: 'a/b' },
    })
    const details = firstSetDetails()
    expect(details.url).toBe('http://example.com/a/b')
    expect(details.path).toBe('a/b')
  })

  it('sameSite === no_restriction 时强制 secure:true', async () => {
    await boot()
    await dispatch({
      action: MSG_COOKIE_SET,
      url: 'http://example.com/',
      cookie: { name: 'g', value: '1', secure: false, sameSite: 'no_restriction' },
    })
    const details = firstSetDetails()
    expect(details.sameSite).toBe('no_restriction')
    expect(details.secure).toBe(true)
  })

  it('数组载荷：逐条写入并回 {ok:true,count:list.length}', async () => {
    const h = await boot()
    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookies: [
        { name: 'x', value: '1' },
        { name: 'y', value: '2' },
      ],
    })
    expect(response).toEqual({ ok: true, count: 2 })
    expect(h.cookiesSet).toHaveBeenCalledTimes(2)
    expect(firstSetDetails(0).name).toBe('x')
    expect(firstSetDetails(1).name).toBe('y')
  })

  it('带 oldCookie 时先移除旧 cookie（url/name/storeId 都来自旧 cookie）', async () => {
    const h = await boot()
    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/p',
      cookie: { name: 'new', value: 'n' },
      oldCookie: { name: 'old', domain: '.example.com', path: '/x', secure: true, storeId: '5' },
    })

    expect(response).toEqual({ ok: true, count: 1 })
    expect(h.cookiesRemove).toHaveBeenCalledWith({
      url: 'https://example.com/x',
      name: 'old',
      storeId: '5',
    })
    // 必须先删后写，否则同域同名写入会被浏览器判定为覆盖失败
    const removeOrder = h.cookiesRemove.mock.invocationCallOrder[0]!
    const setOrder = h.cookiesSet.mock.invocationCallOrder[0]!
    expect(removeOrder).toBeLessThan(setOrder)
  })

  it('cookies.set 返回 null 时回 ERR_COOKIE_SET_FAILED，detail 取 lastError.message', async () => {
    const h = await boot()
    h.cookiesSet.mockResolvedValueOnce(null)
    h.runtime.lastError = { message: 'Failed to set cookie' }

    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookie: { name: 'a', value: '1' },
    })
    expectErrorResponse(response, 'ERR_COOKIE_SET_FAILED', 'Failed to set cookie')
  })

  it('数组载荷中任一条失败即中断，不再写后续条目', async () => {
    const h = await boot()
    h.cookiesSet
      .mockResolvedValueOnce({ name: 'a' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ name: 'c' })

    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookies: [
        { name: 'a', value: '1' },
        { name: 'b', value: '2' },
        { name: 'c', value: '3' },
      ],
    })

    expectErrorResponse(response, 'ERR_COOKIE_SET_FAILED')
    expect(h.cookiesSet).toHaveBeenCalledTimes(2)
  })

  it('cookies.set 抛错时回 ERR_UNEXPECTED + 原始 message', async () => {
    const h = await boot()
    h.cookiesSet.mockRejectedValueOnce(new Error('set boom'))
    const response = await dispatch({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookie: { name: 'a', value: '1' },
    })
    expectErrorResponse(response, 'ERR_UNEXPECTED', 'set boom')
  })
})

describe('MSG_COOKIE_CLEAR_ALL', () => {
  it('无 url 时回 ERR_NO_TARGET_URL', async () => {
    const h = await boot()
    const response = await dispatch({ action: MSG_COOKIE_CLEAR_ALL })
    expectErrorResponse(response, 'ERR_NO_TARGET_URL')
    expect(h.cookiesRemove).not.toHaveBeenCalled()
  })

  it('成功时对每个 cookie 按 getCookieUrl 生成 url 删除，并回 {ok:true}', async () => {
    const h = await boot()
    h.cookiesGetAll.mockResolvedValueOnce([
      { name: 'a', value: '1', domain: '.example.com', path: '/', secure: false, storeId: '0' },
      { name: 'b', value: '2', domain: 'example.com', path: '/sub', secure: true, storeId: '1' },
    ])

    const response = await dispatch({
      action: MSG_COOKIE_CLEAR_ALL,
      url: 'https://example.com/page',
    })

    expect(response).toEqual({ ok: true })
    expect(h.cookiesGetAll).toHaveBeenCalledWith({ url: 'https://example.com/page' })
    expect(h.cookiesRemove).toHaveBeenNthCalledWith(1, {
      url: 'https://example.com/',
      name: 'a',
      storeId: '0',
    })
    expect(h.cookiesRemove).toHaveBeenNthCalledWith(2, {
      url: 'https://example.com/sub',
      name: 'b',
      storeId: '1',
    })
  })

  it('cookies.getAll 抛错时回 ERR_UNEXPECTED + 原始 message', async () => {
    const h = await boot()
    h.cookiesGetAll.mockRejectedValueOnce(new Error('clear boom'))
    const response = await dispatch({
      action: MSG_COOKIE_CLEAR_ALL,
      url: 'https://example.com/',
    })
    expectErrorResponse(response, 'ERR_UNEXPECTED', 'clear boom')
  })
})

describe('MSG_OPEN_NATIVE_SIDE_PANEL', () => {
  it('无 windowId（无 sender.tab、也无 focus 事件）时同步回 false 且不调 open', async () => {
    const h = await boot()
    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL })).resolves.toBe(false)
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('open 成功回 true，且该窗口被记为已打开（再次调用走 toggle 而不是重复 open）', async () => {
    const h = await boot()
    const sender = { tab: { windowId: 5 } }

    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 5 })

    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(1)
  })

  it('open 失败回 false，且不记为已打开（下次仍会尝试 open）', async () => {
    const h = await boot()
    h.sidePanelOpen.mockRejectedValueOnce(new Error('gesture token expired'))
    const sender = { tab: { windowId: 5 } }

    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)).resolves.toBe(false)
    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(2)
  })

  it('已打开且未指定 forceOpen 时执行关闭（Toggle）并回 true', async () => {
    const h = await boot()
    const sender = { tab: { windowId: 5 } }
    await dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)

    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)).resolves.toBe(true)
    expect(h.sidePanelClose).toHaveBeenCalledWith({ windowId: 5 })
  })

  it('已打开且 forceOpen:true 时不再关闭，直接回 true', async () => {
    const h = await boot()
    const sender = { tab: { windowId: 5 } }
    await dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, sender)

    await expect(
      dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL, forceOpen: true }, sender),
    ).resolves.toBe(true)
    expect(h.sidePanelClose).not.toHaveBeenCalled()
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(1)
  })

  it('sender 无 tab 时用 tabs.onActivated 推断出的最近活跃窗口', async () => {
    const h = await boot()
    fireTabActivated({ windowId: 9 })
    await expect(dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL })).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 9 })
  })
})

describe('MSG_CLOSE_NATIVE_SIDE_PANEL', () => {
  it('用 sender.tab.windowId 定位并调用 sidePanel.close，回 true', async () => {
    const h = await boot()
    const response = await dispatch(
      { action: MSG_CLOSE_NATIVE_SIDE_PANEL },
      { tab: { windowId: 7 } },
    )
    expect(response).toBe(true)
    expect(h.sidePanelClose).toHaveBeenCalledWith({ windowId: 7 })
    expect(h.runtimeSendMessage).toHaveBeenCalledWith({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
  })

  it('无任何连接、也无窗口线索时仍回布尔值且不抛错', async () => {
    const h = await boot()
    await expect(dispatch({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })).resolves.toBe(false)
    expect(h.sidePanelClose).not.toHaveBeenCalled()
  })

  it('存在 Port 连接时 port.postMessage 会收到关闭消息', async () => {
    await boot()
    const { port, emitMessage } = createPort('toolkit-sidepanel')
    fireConnect(port)
    emitMessage({ windowId: 7 })

    const response = await dispatch(
      { action: MSG_CLOSE_NATIVE_SIDE_PANEL },
      { tab: { windowId: 7 } },
    )
    expect(response).toBe(true)
    expect(port.postMessage).toHaveBeenCalledWith({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
  })
})

describe('onConnect：toolkit-sidepanel 长连接', () => {
  it('收到带 windowId 的消息后该窗口视为已打开（后续不 forceOpen 走 toggle 关闭）', async () => {
    const h = await boot()
    const { port, emitMessage } = createPort('toolkit-sidepanel')
    fireConnect(port)
    emitMessage({ windowId: 5 })

    await expect(
      dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, { tab: { windowId: 5 } }),
    ).resolves.toBe(true)
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
    expect(h.sidePanelClose).toHaveBeenCalledWith({ windowId: 5 })
  })

  it('onDisconnect 后恢复未打开状态（再次请求会真正 open）', async () => {
    const h = await boot()
    const { port, emitMessage, disconnect } = createPort('toolkit-sidepanel')
    fireConnect(port)
    emitMessage({ windowId: 5 })
    disconnect()

    await expect(
      dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, { tab: { windowId: 5 } }),
    ).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 5 })
  })

  it('非 toolkit-sidepanel 的 Port 被忽略，不注册消息监听也不影响打开判定', async () => {
    const h = await boot()
    const { port } = createPort('some-other-panel')
    fireConnect(port)

    expect(port.onMessage.addListener).not.toHaveBeenCalled()
    expect(port.onDisconnect.addListener).not.toHaveBeenCalled()

    // 若该 Port 被错误计入存活态，这里会走 toggle 而不是 open
    await expect(
      dispatch({ action: MSG_OPEN_NATIVE_SIDE_PANEL }, { tab: { windowId: 1 } }),
    ).resolves.toBe(true)
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 1 })
  })
})

describe('快捷键 toggle-detect', () => {
  it('向当前标签页发送 MSG_TOGGLE_DETECT', async () => {
    const h = await boot()
    runCommand('toggle-detect', { id: 3, windowId: 1 })
    await flush()
    expect(h.tabsSendMessage).toHaveBeenCalledWith(3, { action: MSG_TOGGLE_DETECT })
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('tabId 为 null 时什么都不发送', async () => {
    const h = await boot()
    runCommand('toggle-detect', { windowId: 1 })
    await flush()
    expect(h.tabsSendMessage).not.toHaveBeenCalled()
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('发送失败且浏览器支持 sidePanel.open 时降级打开原生侧边栏', async () => {
    const h = await boot()
    h.tabsSendMessage.mockRejectedValueOnce(new Error('receiving end does not exist'))

    runCommand('toggle-detect', { id: 3, windowId: 1 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(3, { action: MSG_TOGGLE_DETECT })
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 1 })
  })
})

describe('快捷键 toggle-toolkit：drawer 模式', () => {
  it('向当前标签页发送 MSG_TOGGLE_DRAWER', async () => {
    const h = await boot({ settings: { ballAction: 'drawer' } })
    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(4, { action: MSG_TOGGLE_DRAWER })
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('没有 tabId 但有 windowId 时直接打开原生侧边栏', async () => {
    const h = await boot({ settings: { ballAction: 'drawer' } })
    runCommand('toggle-toolkit', { windowId: 2 })
    await flush()

    expect(h.tabsSendMessage).not.toHaveBeenCalled()
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 2 })
  })

  it('向标签页发送失败时降级打开原生侧边栏', async () => {
    const h = await boot({ settings: { ballAction: 'drawer' } })
    h.tabsSendMessage.mockRejectedValueOnce(new Error('receiving end does not exist'))

    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()

    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 2 })
  })

  it('storage.onChanged 的 areaName 不是 sync 时不改变动作（仍走抽屉）', async () => {
    const h = await boot()
    fireStorageChanged({ settings: { newValue: { ballAction: 'native' } } }, 'local')

    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(4, { action: MSG_TOGGLE_DRAWER })
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('storage.onChanged 推送非法 ballAction 时保持默认抽屉模式', async () => {
    const h = await boot()
    fireStorageChanged({ settings: { newValue: { ballAction: 'bogus' } } }, 'sync')

    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(4, { action: MSG_TOGGLE_DRAWER })
    expect(h.sidePanelOpen).not.toHaveBeenCalled()
  })

  it('侧边栏已打开时只作「收起」，不再弹出网页抽屉（回归）', async () => {
    // 先用 native 模式打开侧边栏一次，让 background 记住「该窗口侧边栏已开」
    const h = await boot({ settings: { ballAction: 'native' } })
    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 2 })

    // 用户把动作切回默认的 drawer 模式
    fireStorageChanged({ settings: { newValue: { ballAction: 'drawer' } } }, 'sync')
    h.tabsSendMessage.mockClear()
    h.sidePanelClose.mockClear()

    runCommand('toggle-toolkit', { id: 4, windowId: 2 })
    await flush()

    // 回归：以前会「先关侧边栏、再发 TOGGLE_DRAWER」，表现为关掉侧边栏后网页抽屉弹出来
    expect(h.sidePanelClose).toHaveBeenCalledWith({ windowId: 2 })
    expect(h.tabsSendMessage).not.toHaveBeenCalledWith(4, { action: MSG_TOGGLE_DRAWER })
    // 没有重复 open
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(1)
  })
})

describe('快捷键 toggle-toolkit：native 模式', () => {
  it('在首个同步帧内调用 sidePanel.open（保住用户手势令牌）', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })

    runCommand('toggle-toolkit', { id: 9, windowId: 3 })

    // 关键：此刻尚未 await，open 就必须已经被调用；任何前置 await 都会让手势令牌失效
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(1)
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 3 })
  })

  it('open 成功后向标签页发送 MSG_CLOSE_DRAWER（与网页抽屉互斥）', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })
    runCommand('toggle-toolkit', { id: 9, windowId: 3 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(9, { action: MSG_CLOSE_DRAWER })
  })

  it('storage.sync.get 的初始值决定模式（native 不走抽屉）', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })
    runCommand('toggle-toolkit', { id: 9, windowId: 3 })
    expect(h.tabsSendMessage).not.toHaveBeenCalledWith(9, { action: MSG_TOGGLE_DRAWER })
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 3 })
  })

  it('storage.onChanged 推送 native 后同样走原生侧边栏（首帧同步调用）', async () => {
    const h = await boot()
    fireStorageChanged({ settings: { newValue: { ballAction: 'native' } } }, 'sync')

    runCommand('toggle-toolkit', { id: 5, windowId: 4 })
    expect(h.sidePanelOpen).toHaveBeenCalledWith({ windowId: 4 })
  })

  it('open 失败时降级向标签页发送 MSG_TOGGLE_DRAWER', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.sidePanelOpen.mockRejectedValueOnce(new Error('not allowed'))

    runCommand('toggle-toolkit', { id: 9, windowId: 3 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(9, { action: MSG_TOGGLE_DRAWER })
  })

  it('已打开时再次按下快捷键执行收回，而不是重复 open', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })
    runCommand('toggle-toolkit', { id: 9, windowId: 3 })
    await flush()

    runCommand('toggle-toolkit', { id: 9, windowId: 3 })

    expect(h.sidePanelClose).toHaveBeenCalledWith({ windowId: 3 })
    expect(h.sidePanelOpen).toHaveBeenCalledTimes(1)
  })

  it('没有 windowId 时退化为用 tabId 打开，并在成功后关闭抽屉', async () => {
    const h = await boot({ settings: { ballAction: 'native' } })
    runCommand('toggle-toolkit', { id: 6 })
    await flush()

    expect(h.sidePanelOpen).toHaveBeenCalledWith({ tabId: 6 })
    expect(h.tabsSendMessage).toHaveBeenCalledWith(6, { action: MSG_CLOSE_DRAWER })
  })
})

describe('storage.session.setAccessLevel', () => {
  it('模块加载时以 TRUSTED_AND_UNTRUSTED_CONTEXTS 调用', async () => {
    const h = await boot()
    expect(h.sessionSetAccessLevel).toHaveBeenCalledWith({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    })
  })

  it('浏览器不支持该方法时加载不抛错（监听器照常注册）', async () => {
    const h = await boot({ withSetAccessLevel: false })
    expect(h.sessionSetAccessLevel).toBeUndefined()
    expect(h.messageListeners).toHaveLength(1)
    expect(h.commandListeners).toHaveLength(1)
  })

  it('setAccessLevel 被拒绝时不产生 unhandled rejection，加载照常完成', async () => {
    const h = await boot({ setAccessLevelRejects: true })
    await flush()
    expect(h.sessionSetAccessLevel).toHaveBeenCalledTimes(1)
    expect(h.messageListeners).toHaveLength(1)
  })
})

describe('右键菜单（contextMenus）', () => {
  it('onInstalled 时先 removeAll 再 create，id/title/contexts 均正确', async () => {
    const h = await boot()
    fireInstalled()

    expect(h.contextMenusRemoveAll).toHaveBeenCalledWith(expect.any(Function))
    expect(h.i18nGetMessage).toHaveBeenCalledWith('contextMenuDetectSelection')
    const title = h.i18nGetMessage.mock.results[0]?.value
    expect(h.contextMenusCreate).toHaveBeenCalledWith({
      id: 'toolkit-detect-selection',
      title,
      contexts: ['selection', 'editable'],
    })
    const removeOrder = h.contextMenusRemoveAll.mock.invocationCallOrder[0]!
    const createOrder = h.contextMenusCreate.mock.invocationCallOrder[0]!
    expect(removeOrder).toBeLessThan(createOrder)
  })

  it('onClicked：menuItemId 不匹配时不发送消息', async () => {
    const h = await boot()
    fireMenuClick({ menuItemId: 'other-menu', selectionText: 'hi' }, { id: 1 })
    await flush()
    expect(h.tabsSendMessage).not.toHaveBeenCalled()
  })

  it('onClicked：tab.id 缺失时不发送消息', async () => {
    const h = await boot()
    fireMenuClick({ menuItemId: 'toolkit-detect-selection', selectionText: 'hi' }, {})
    fireMenuClick({ menuItemId: 'toolkit-detect-selection', selectionText: 'hi' }, undefined)
    await flush()
    expect(h.tabsSendMessage).not.toHaveBeenCalled()
  })

  it('onClicked：匹配时向标签页发送 MSG_DETECT_SELECTION 与选中文本', async () => {
    const h = await boot()
    fireMenuClick(
      { menuItemId: 'toolkit-detect-selection', selectionText: 'hello world' },
      { id: 11 },
    )
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: MSG_DETECT_SELECTION,
      text: 'hello world',
    })
  })

  it('onClicked：sendMessage 失败被静默吞掉（不产生 unhandled rejection）', async () => {
    const h = await boot()
    h.tabsSendMessage.mockRejectedValueOnce(new Error('receiving end does not exist'))

    fireMenuClick({ menuItemId: 'toolkit-detect-selection', selectionText: 'hi' }, { id: 11 })
    await flush()

    expect(h.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: MSG_DETECT_SELECTION,
      text: 'hi',
    })
  })
})
