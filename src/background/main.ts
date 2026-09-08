import {
  MSG_CLOSE_NATIVE_SIDE_PANEL,
  MSG_COOKIE_CLEAR_ALL,
  MSG_COOKIE_GET_ALL,
  MSG_COOKIE_REMOVE,
  MSG_DETECT_SELECTION,
  MSG_OPEN_NATIVE_SIDE_PANEL,
  MSG_OPEN_OPTIONS,
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
    if (windowId == null || typeof chrome.sidePanel.close !== 'function') {
      sendResponse(false)
      return undefined
    }
    void chrome.sidePanel.close({ windowId }).then(
      () => sendResponse(true),
      () => sendResponse(false),
    )
    return true // 保持消息通道以异步 sendResponse
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
