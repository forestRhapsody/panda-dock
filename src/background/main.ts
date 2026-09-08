import {
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
  MSG_TOGGLE_DRAWER,
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

const DETECT_MENU_ID = 'toolkit-detect-selection'

/**
 * 右键菜单「智能解析选中文字」：安装/更新时注册。
 * 选中文字后点击 → 把选中文本与点击位置转给当前页 content script，在网页内弹出悬浮面板。
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const zh = chrome.i18n.getUILanguage().toLowerCase().startsWith('zh')
    chrome.contextMenus.create({
      id: DETECT_MENU_ID,
      title: zh ? '智能解析选中文字' : 'Smart parse selected text',
      contexts: ['selection'],
    })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== DETECT_MENU_ID || !info.selectionText || !tab?.id) return
  // 说明：OnClickData 不提供鼠标坐标，面板位置由 content script 自己记录右键位置。
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
 * Background Service Worker：
 * - content script（悬浮球）请求唤起浏览器原生侧边栏时的中转。
 *   注意：sidePanel.open 需要用户手势，content→SW 的消息会丢失手势，
 *   因此在部分 Chrome 版本上可能被拒绝 —— 失败时 content 会自动回退到网页内抽屉。
 * - content script 请求打开扩展设置页（content script 没有 chrome.tabs，无法直接用
 *   chrome.tabs.create，且 window.open 打开扩展页会被 Chrome 以 ERR_BLOCKED_BY_CLIENT 拦截）
 *   → 改由 background 用 chrome.tabs.create 打开 options.html。
 */
async function closeSidePanel(targetWindowId?: number): Promise<boolean> {
  try {
    const sp = chrome.sidePanel as unknown as {
      close?: (opts: { windowId: number }) => Promise<void>
    }
    if (typeof sp?.close === 'function') {
      let winId = targetWindowId
      if (winId == null) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        winId = tab?.windowId
      }
      if (winId != null) {
        try {
          await sp.close({ windowId: winId })
        } catch {
          // 忽略
        }
      }
    }
    // 广播通知 sidepanel 窗口执行 window.close()
    await chrome.runtime.sendMessage({ action: MSG_CLOSE_NATIVE_SIDE_PANEL })
    return true
  } catch {
    return false
  }
}

async function isSidePanelOpen(): Promise<boolean> {
  try {
    const runtime = chrome.runtime as unknown as {
      getContexts?: (filter: { contextTypes?: string[] }) => Promise<unknown[]>
    }
    if (typeof runtime?.getContexts === 'function') {
      const contexts = await runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
      return Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // 忽略
  }
  return false
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
    void closeSidePanel(windowId).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true // 保持消息通道以异步 sendResponse
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
          sendResponse({
            ok: false,
            error: '无法读取当前页面的 Cookie：当前标签页不是 http(s) 网页',
          })
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
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return true
  }

  if (action === MSG_COOKIE_REMOVE) {
    void (async () => {
      try {
        const { url, name, storeId } = message as { url?: string; name?: string; storeId?: string }
        if (!url || !name) {
          sendResponse({ ok: false, error: '缺少 Cookie url 或 name' })
          return
        }
        const removed = await chrome.cookies.remove({ url, name, storeId })
        if (removed) {
          sendResponse({ ok: true })
        } else {
          sendResponse({ ok: false, error: '删除 Cookie 失败' })
        }
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
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
          sendResponse({ ok: false, error: '无法获取目标网页 URL' })
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
          sendResponse({ ok: false, error: '未提供待保存的 Cookie 数据' })
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
            const err = chrome.runtime.lastError?.message
            throw new Error(
              err || `写入 Cookie [${item.name}] 失败，请检查作用域 Domain 或 Secure 属性`,
            )
          }
        }

        sendResponse({ ok: true, count: list.length })
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return true
  }

  if (action === MSG_COOKIE_CLEAR_ALL) {
    void (async () => {
      try {
        const url = await resolveTargetUrl((message as { url?: string }).url)
        if (!url) {
          sendResponse({ ok: false, error: '无法获取目标网页 URL' })
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
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return true
  }

  if (action !== MSG_OPEN_NATIVE_SIDE_PANEL) {
    return undefined
  }

  const windowId = sender?.tab?.windowId
  if (windowId == null) {
    sendResponse(false)
    return undefined
  }

  void chrome.sidePanel.open({ windowId }).then(
    () => sendResponse(true),
    () => sendResponse(false),
  )
  return true // 保持消息通道以异步 sendResponse
})

/**
 * 监听全局快捷键：根据用户在设置里的预设动作（ballAction: drawer / native）智能分发唤起。
 * 并保持侧边栏与网页内抽屉的严格互斥。
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-toolkit') return

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    let windowId: number | undefined = tab?.windowId
    if (windowId == null) {
      try {
        const win = await chrome.windows.getCurrent()
        windowId = win?.id
      } catch {
        // 忽略
      }
    }

    // 读取当前配置中的 ballAction
    const data = await chrome.storage.sync.get('settings')
    const settings = data?.settings as { ballAction?: 'drawer' | 'native' } | undefined
    const ballAction = settings?.ballAction || 'drawer'

    if (ballAction === 'drawer') {
      // 抽屉模式：
      // 1. 关闭原生侧边栏（保持互斥）
      await closeSidePanel(windowId)

      // 2. 尝试向当前标签页发送 TOGGLE_DRAWER 切换抽屉开合
      let toggled = false
      if (tab?.id != null) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: MSG_TOGGLE_DRAWER })
          toggled = true
        } catch {
          toggled = false
        }
      }

      // 3. 若当前标签页无法注入/响应抽屉（如 chrome://、chrome-extension:// 等特权页），自动降级打开原生侧边栏
      if (!toggled && windowId != null && typeof chrome.sidePanel?.open === 'function') {
        try {
          await chrome.sidePanel.open({ windowId })
        } catch {
          // 忽略
        }
      }
    } else {
      // 原生侧边栏模式：
      // 1. 先关闭当前网页里的抽屉（保持互斥）
      if (tab?.id != null) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: MSG_CLOSE_DRAWER })
        } catch {
          // 忽略
        }
      }

      // 2. 检查侧边栏是否已处于打开状态
      const sidePanelOpen = await isSidePanelOpen()
      if (sidePanelOpen) {
        // 若已打开，快捷键起到 toggle 关闭作用
        await closeSidePanel(windowId)
        return
      }

      // 3. 若未打开，唤起原生侧边栏
      let opened = false
      if (windowId != null && typeof chrome.sidePanel?.open === 'function') {
        try {
          await chrome.sidePanel.open({ windowId })
          opened = true
        } catch {
          opened = false
        }
      }

      // 4. 若唤起原生侧边栏失败（如环境限制），降级切换当前网页的抽屉
      if (!opened && tab?.id != null) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: MSG_TOGGLE_DRAWER })
        } catch {
          // 忽略
        }
      }
    }
  } catch {
    // 忽略异常
  }
})
