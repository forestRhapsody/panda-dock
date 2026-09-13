import {
  errorResponse,
  MSG_CLOSE_DRAWER,
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_COOKIE_CLEAR_ALL,
  MSG_COOKIE_GET_ALL,
  MSG_COOKIE_REMOVE,
  MSG_COOKIE_SET,
  MSG_DETECT_SELECTION,
  MSG_GET_TAB_ID,
  MSG_GET_WINDOW_ID,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_OPEN_OPTIONS,
  MSG_OPEN_SHORTCUTS,
  MSG_TOGGLE_DETECT,
  MSG_TOGGLE_DRAWER,
  PORT_SIDEPANEL,
} from '@/utils/messages'

function getCookieUrl(
  cookie: { domain: string; path: string; secure: boolean },
  fallbackUrl?: string,
): string {
  let domain = cookie.domain
  if (domain.startsWith('.')) domain = domain.slice(1)
  if (!domain && fallbackUrl) {
    try {
      domain = new URL(fallbackUrl).hostname
    } catch {
      // 忽略
    }
  }
  const protocol = cookie.secure ? 'https:' : fallbackUrl?.startsWith('https:') ? 'https:' : 'http:'
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`
  return `${protocol}//${domain}${path}`
}

async function resolveTargetUrl(explicitUrl?: string): Promise<string | null> {
  if (explicitUrl && /^https?:/.test(explicitUrl)) return explicitUrl
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url && /^https?:/.test(tab.url)) return tab.url
  } catch {
    // 忽略
  }
  return null
}

const DETECT_MENU_ID = 'panda-detect-selection'

// 开放 chrome.storage.session 访问级别，允许 Content Script（网页内抽屉）读写会话草稿
const sessionArea = chrome.storage?.session as unknown as
  | { setAccessLevel?: (opts: { accessLevel: string }) => Promise<void> }
  | undefined
if (typeof sessionArea?.setAccessLevel === 'function') {
  void sessionArea.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {})
}

/**
 * 右键菜单「智能解析选中文字」：安装/更新时注册。
 * 选中文字后点击 → 把选中文本与点击位置转给当前页 content script，在网页内弹出悬浮面板。
 * 标题走 chrome.i18n（文案在 public/_locales/{zh_CN,en}/messages.json），
 * 不再手写「按浏览器语言二选一」的分支——那需要维护两套字符串，且随语言增加会失控。
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: DETECT_MENU_ID,
      title: chrome.i18n.getMessage('contextMenuDetectSelection'),
      contexts: ['selection', 'editable'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== DETECT_MENU_ID || !tab?.id) return
  // 说明：OnClickData 不提供鼠标坐标，面板位置与可编辑选区兜底由 content script 自己记录。
  void chrome.tabs
    .sendMessage(tab.id, {
      action: MSG_DETECT_SELECTION,
      text: info.selectionText,
    })
    .catch(() => {
      // 目标页未注入 content script（非 http(s) 页 / 扩展安装前已打开的页面）：静默忽略
    })
})

/**
 * 侧边栏长连接与开闭状态内存表（支持纯同步即时查询与关闭通知）
 */
const sidePanelPorts = new Map<number, chrome.runtime.Port>() // windowId -> port
const activeSidePanelPorts = new Set<chrome.runtime.Port>()
const openSidePanelWindows = new Set<number>()

/**
 * 用户当前配置的悬浮球/快捷键动作（内存快照，保证快捷键在同步首帧内零延迟获取）
 */
let cachedBallAction: 'drawer' | 'native' = 'drawer'

/** 最近活跃的 windowId 缓存 */
let lastActiveWindowId: number | undefined
if (typeof chrome !== 'undefined') {
  chrome.windows?.onFocusChanged?.addListener((winId) => {
    if (typeof winId === 'number' && winId > 0) {
      lastActiveWindowId = winId
    }
  })
  chrome.tabs?.onActivated?.addListener((activeInfo) => {
    if (typeof activeInfo?.windowId === 'number') {
      lastActiveWindowId = activeInfo.windowId
    }
  })
}

// 初始化加载 ballAction 并在 storage.onChanged 中即时同步
void chrome.storage?.sync
  ?.get('settings')
  .then((data) => {
    const settings = data?.settings as { ballAction?: 'drawer' | 'native' } | undefined
    if (settings?.ballAction === 'drawer' || settings?.ballAction === 'native') {
      cachedBallAction = settings.ballAction
    }
  })
  .catch(() => {})

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings?.newValue) {
    const s = changes.settings.newValue as { ballAction?: 'drawer' | 'native' }
    if (s.ballAction === 'drawer' || s.ballAction === 'native') {
      cachedBallAction = s.ballAction
    }
  }
})

// 监听侧边栏长连接，建立窗口级侧边栏存活态追踪
chrome.runtime?.onConnect?.addListener((port) => {
  if (port.name !== PORT_SIDEPANEL) return
  activeSidePanelPorts.add(port)
  let boundWindowId: number | undefined

  port.onMessage.addListener((msg: unknown) => {
    const winId = (msg as { windowId?: number })?.windowId
    if (typeof winId === 'number') {
      boundWindowId = winId
      openSidePanelWindows.add(winId)
      sidePanelPorts.set(winId, port)
    }
  })

  port.onDisconnect.addListener(() => {
    activeSidePanelPorts.delete(port)
    if (boundWindowId != null) {
      openSidePanelWindows.delete(boundWindowId)
      sidePanelPorts.delete(boundWindowId)
    }
  })
})

// 监听标签页关闭，自动清理该标签页作用域内的全部会话草稿，释放 storage.session 配额
chrome.tabs?.onRemoved?.addListener(async (closedTabId) => {
  try {
    const prefix = `panda.draft.t${closedTabId}.`
    const sessionArea = chrome.storage?.session
    if (!sessionArea?.get || !sessionArea?.remove) return
    const all = await sessionArea.get(null)
    const keysToRemove = Object.keys(all).filter((k) => k.startsWith(prefix))
    if (keysToRemove.length > 0) {
      await sessionArea.remove(keysToRemove)
    }
  } catch {
    // 忽略异常
  }
})

// 监听窗口关闭，自动清理该窗口作用域内的全部会话草稿，释放 storage.session 配额
chrome.windows?.onRemoved?.addListener(async (closedWindowId) => {
  try {
    const prefix = `panda.draft.w${closedWindowId}.`
    const sessionArea = chrome.storage?.session
    if (!sessionArea?.get || !sessionArea?.remove) return
    const all = await sessionArea.get(null)
    const keysToRemove = Object.keys(all).filter((k) => k.startsWith(prefix))
    if (keysToRemove.length > 0) {
      await sessionArea.remove(keysToRemove)
    }
  } catch {
    // 忽略异常
  }
})

function isSidePanelOpen(targetWindowId?: number): boolean {
  if (targetWindowId != null && openSidePanelWindows.has(targetWindowId)) {
    return true
  }
  return activeSidePanelPorts.size > 0
}

function closeSidePanel(targetWindowId?: number): boolean {
  let closed = false
  // 1. 若有特定窗口的长连接，优先通知该窗口侧边栏关闭
  if (targetWindowId != null && sidePanelPorts.has(targetWindowId)) {
    try {
      sidePanelPorts.get(targetWindowId)?.postMessage({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
      closed = true
    } catch {
      // 忽略
    }
    openSidePanelWindows.delete(targetWindowId)
    sidePanelPorts.delete(targetWindowId)
  }

  // 2. 同时通知所有已连接的侧边栏窗口关闭
  for (const port of activeSidePanelPorts) {
    try {
      port.postMessage({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
      closed = true
    } catch {
      // 忽略
    }
  }

  // 3. 广播运行时消息兜底
  void chrome.runtime?.sendMessage?.({ action: MSG_CLOSE_NATIVE_SIDE_PANEL }).catch(() => {})

  // 4. 调用原生 API chrome.sidePanel.close（若浏览器版本支持）
  const sp = chrome.sidePanel as unknown as
    | {
        close?: (opts: { windowId: number }) => Promise<void>
      }
    | undefined
  if (typeof sp?.close === 'function') {
    const winId = targetWindowId ?? lastActiveWindowId
    if (winId != null) {
      void sp.close({ windowId: winId }).catch(() => {})
      closed = true
    }
  }

  if (targetWindowId != null) {
    openSidePanelWindows.delete(targetWindowId)
  }
  if (activeSidePanelPorts.size === 0) {
    openSidePanelWindows.clear()
  }
  return closed
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = (message as { action?: string } | undefined)?.action

  if (action === MSG_OPEN_OPTIONS) {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true // 保持消息通道以异步 sendResponse
  }

  // 关闭原生侧边栏（content 开抽屉前先把侧边栏关掉，保证两种工具箱不同时显示）
  if (action === MSG_CLOSE_NATIVE_SIDE_PANEL) {
    const windowId = sender?.tab?.windowId
    const ok = closeSidePanel(windowId)
    sendResponse(ok)
    return undefined
  }

  if (action === MSG_OPEN_SHORTCUTS) {
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true
  }

  if (action === MSG_COOKIE_GET_ALL) {
    void (async () => {
      try {
        const url = await resolveTargetUrl((message as { url?: string }).url)
        if (!url) {
          sendResponse(errorResponse('ERR_COOKIE_NO_PAGE_URL'))
          return
        }
        const cookies = await chrome.cookies.getAll({ url })
        const origin = new URL(url).origin
        sendResponse({
          ok: true,
          data: {
            url,
            origin,
            cookies: cookies.map((c) => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              hostOnly: c.hostOnly,
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              session: c.session,
              expirationDate: c.expirationDate,
              storeId: c.storeId,
            })),
            totalCount: cookies.length,
          },
        })
      } catch (e) {
        sendResponse(errorResponse('ERR_UNEXPECTED', e instanceof Error ? e.message : String(e)))
      }
    })()
    return true
  }

  if (action === MSG_COOKIE_REMOVE) {
    void (async () => {
      try {
        const { url, name, storeId } = message as { url?: string; name?: string; storeId?: string }
        if (!url || !name) {
          sendResponse(errorResponse('ERR_COOKIE_MISSING_PARAM'))
          return
        }
        const removed = await chrome.cookies.remove({ url, name, storeId })
        if (removed) {
          sendResponse({ ok: true })
        } else {
          sendResponse(errorResponse('ERR_COOKIE_REMOVE_FAILED'))
        }
      } catch (e) {
        sendResponse(errorResponse('ERR_UNEXPECTED', e instanceof Error ? e.message : String(e)))
      }
    })()
    return true
  }

  if (action === MSG_COOKIE_SET) {
    void (async () => {
      try {
        const payload = message as {
          url?: string
          cookie?: {
            name: string
            value: string
            domain?: string
            path?: string
            secure?: boolean
            httpOnly?: boolean
            sameSite?: 'no_restriction' | 'lax' | 'strict' | 'unspecified'
            expirationDate?: number
            storeId?: string
          }
          cookies?: Array<{
            name: string
            value: string
            domain?: string
            path?: string
            secure?: boolean
            httpOnly?: boolean
            sameSite?: 'no_restriction' | 'lax' | 'strict' | 'unspecified'
            expirationDate?: number
            storeId?: string
          }>
          oldCookie?: {
            name: string
            domain: string
            path: string
            secure: boolean
            storeId?: string
          }
        }

        const targetUrl = await resolveTargetUrl(payload.url)
        if (!targetUrl) {
          sendResponse(errorResponse('ERR_NO_TARGET_URL'))
          return
        }

        // 若是编辑且提供了 oldCookie，先移除旧 Cookie 以实现替换
        if (payload.oldCookie) {
          const oldUrl = getCookieUrl(payload.oldCookie, targetUrl)
          await chrome.cookies.remove({
            url: oldUrl,
            name: payload.oldCookie.name,
            storeId: payload.oldCookie.storeId,
          })
        }

        const list = Array.isArray(payload.cookies)
          ? payload.cookies
          : payload.cookie
            ? [payload.cookie]
            : []

        if (list.length === 0) {
          sendResponse(errorResponse('ERR_COOKIE_EMPTY_PAYLOAD'))
          return
        }

        for (const item of list) {
          const cookieUrl = getCookieUrl(
            {
              domain: item.domain || new URL(targetUrl).hostname,
              path: item.path || '/',
              secure: Boolean(item.secure),
            },
            targetUrl,
          )

          const setDetails: chrome.cookies.SetDetails = {
            url: cookieUrl,
            name: item.name,
            value: item.value ?? '',
            path: item.path || '/',
            secure: Boolean(item.secure),
            httpOnly: Boolean(item.httpOnly),
            storeId: item.storeId,
          }

          if (item.domain) {
            setDetails.domain = item.domain
          }
          if (item.expirationDate != null && !Number.isNaN(item.expirationDate)) {
            setDetails.expirationDate = item.expirationDate
          }
          if (item.sameSite) {
            setDetails.sameSite = item.sameSite
          }
          if (setDetails.sameSite === 'no_restriction') {
            setDetails.secure = true
          }

          const result = await chrome.cookies.set(setDetails)
          if (!result) {
            // 只回错误码：文案由 UI 侧按当前语言生成（Chrome 原生报错作为 detail 透传）
            sendResponse(errorResponse('ERR_COOKIE_SET_FAILED', chrome.runtime.lastError?.message))
            return
          }
        }

        sendResponse({ ok: true, count: list.length })
      } catch (e) {
        sendResponse(errorResponse('ERR_UNEXPECTED', e instanceof Error ? e.message : String(e)))
      }
    })()
    return true
  }

  if (action === MSG_COOKIE_CLEAR_ALL) {
    void (async () => {
      try {
        const url = await resolveTargetUrl((message as { url?: string }).url)
        if (!url) {
          sendResponse(errorResponse('ERR_NO_TARGET_URL'))
          return
        }
        const cookies = await chrome.cookies.getAll({ url })
        await Promise.all(
          cookies.map((c) =>
            chrome.cookies.remove({
              url: getCookieUrl(c, url),
              name: c.name,
              storeId: c.storeId,
            }),
          ),
        )
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse(errorResponse('ERR_UNEXPECTED', e instanceof Error ? e.message : String(e)))
      }
    })()
    return true
  }

  if (action === MSG_GET_TAB_ID) {
    const tabId = sender?.tab?.id ?? null
    sendResponse({ ok: true, data: tabId })
    return true
  }

  if (action === MSG_GET_WINDOW_ID) {
    const windowId = sender?.tab?.windowId ?? lastActiveWindowId ?? null
    sendResponse({ ok: true, data: windowId })
    return true
  }

  if (action !== MSG_OPEN_NATIVE_SIDE_PANEL) {
    return undefined
  }

  const windowId = sender?.tab?.windowId ?? lastActiveWindowId
  if (windowId == null) {
    sendResponse(false)
    return undefined
  }

  const forceOpen = Boolean((message as { forceOpen?: boolean })?.forceOpen)

  // 若当前窗口原生侧边栏已开：未指定 forceOpen 时执行收回（Toggle），指定 forceOpen 时保持打开
  if (isSidePanelOpen(windowId)) {
    if (!forceOpen) {
      closeSidePanel(windowId)
    }
    sendResponse(true)
    return undefined
  }

  void chrome.sidePanel.open({ windowId }).then(
    () => {
      openSidePanelWindows.add(windowId)
      sendResponse(true)
    },
    () => sendResponse(false),
  )
  return true // 保持消息通道以异步 sendResponse
})

/**
 * 监听全局快捷键：根据用户在设置里的预设动作（ballAction: drawer / native）智能分发唤起。
 * 并保持侧边栏与网页内抽屉的严格互斥。
 * 支持再次按下快捷键收回（Toggle）。
 */
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-detect') {
    const tabId = tab?.id
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { action: MSG_TOGGLE_DETECT }).catch(() => {
        // 当前页若无法注入 content script（如 chrome:// 特权页），降级尝试在原生侧边栏打开
        const windowId = tab?.windowId ?? lastActiveWindowId
        if (windowId != null && typeof chrome.sidePanel?.open === 'function') {
          void chrome.sidePanel.open({ windowId }).then(
            () => openSidePanelWindows.add(windowId),
            () => {},
          )
        }
      })
    }
    return
  }

  if (command !== 'toggle-dock') return

  const windowId = tab?.windowId ?? lastActiveWindowId
  const tabId = tab?.id

  if (cachedBallAction === 'drawer') {
    // 1. 原生侧边栏已开：本次按键**只作「收起」**，与 native 模式的 toggle 语义对齐。
    //    否则用户按一次快捷键会看到「侧边栏关了、网页抽屉却弹出来」——直觉上这是「换了个形态」而不是「收起」。
    //    代价：想从侧边栏切到网页抽屉需要按两次（先收起、再打开），这是刻意选择的确定性。
    if (isSidePanelOpen(windowId)) {
      closeSidePanel(windowId)
      return
    }

    // 2. 侧边栏未开：尝试向当前标签页发送 TOGGLE_DRAWER 切换抽屉开合
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, { action: MSG_TOGGLE_DRAWER }).catch(() => {
        // 当前标签页无法注入/响应抽屉（如 chrome://、chrome-extension:// 等特权页），自动降级打开原生侧边栏
        if (windowId != null && typeof chrome.sidePanel?.open === 'function') {
          void chrome.sidePanel.open({ windowId }).then(
            () => openSidePanelWindows.add(windowId),
            () => {},
          )
        }
      })
    } else if (windowId != null && typeof chrome.sidePanel?.open === 'function') {
      void chrome.sidePanel.open({ windowId }).then(
        () => openSidePanelWindows.add(windowId),
        () => {},
      )
    }
    return
  }

  // 原生侧边栏模式：
  // 1. 检查侧边栏是否已处于打开状态（纯内存同步判断，0 耗时）
  if (isSidePanelOpen(windowId)) {
    // 若已打开，再次按下快捷键起到收回（Toggle 关闭）作用
    closeSidePanel(windowId)
    return
  }

  // 2. 若未打开，在首帧立即同步调用 chrome.sidePanel.open，100% 保留快捷键的用户手势令牌！
  const openTarget = windowId != null ? { windowId } : tabId != null ? { tabId } : null
  if (openTarget && typeof chrome.sidePanel?.open === 'function') {
    void chrome.sidePanel
      .open(openTarget)
      .then(() => {
        if (windowId != null) openSidePanelWindows.add(windowId)
        // 唤起侧边栏后，确保当前网页内的抽屉关闭（保持互斥）
        if (tabId != null) {
          void chrome.tabs.sendMessage(tabId, { action: MSG_CLOSE_DRAWER }).catch(() => {})
        }
      })
      .catch((err) => {
        console.warn('[PandaDock] Failed to open native sidePanel:', err)
        // 若唤起原生侧边栏失败（如某些环境限制），降级切换当前网页的抽屉
        if (tabId != null) {
          void chrome.tabs.sendMessage(tabId, { action: MSG_TOGGLE_DRAWER }).catch(() => {})
        }
      })
  } else if (tabId != null) {
    // 浏览器环境不支持 sidePanel.open，降级切换当前网页抽屉
    void chrome.tabs.sendMessage(tabId, { action: MSG_TOGGLE_DRAWER }).catch(() => {})
  }
})
