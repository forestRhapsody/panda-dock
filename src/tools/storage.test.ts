import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import {
  ERROR_CODES,
  isErrorCode,
  MSG_COOKIE_CLEAR_ALL,
  MSG_COOKIE_GET_ALL,
  MSG_COOKIE_REMOVE,
  MSG_COOKIE_SET,
  MSG_STORAGE_CLEAR,
  MSG_STORAGE_READ,
  MSG_STORAGE_REMOVE,
  MSG_STORAGE_SET,
} from '@/utils/messages'

import type { CookieEntry } from './storage'
import {
  bareCookieDomain,
  clearAllCookies,
  clearStorageArea,
  getCookieUrl,
  listCookies,
  listStorage,
  removeCookie,
  removeStorageKey,
  resolveStorageError,
  saveCookies,
  setStorageValue,
  storageErrorDetailKey,
  storageErrorKey,
} from './storage'

/** 跨端错误码的本地化映射回归（T127）：background 只回 code，UI 侧负责翻成当前语言 */
describe('storage 错误码本地化映射', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('每个错误码都有映射，且不与其他码共用同一个 key', () => {
    const keys = ERROR_CODES.map((code) => storageErrorKey(code))
    for (const key of keys) expect(key).toMatch(/^tool\.storage\./)
    expect(new Set(keys).size).toBe(ERROR_CODES.length)
  })

  it('映射到的 key 在 zh / en 语言包中同时存在（防止漏翻译）', () => {
    const lookup = (source: unknown, key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>(
          (acc, part) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
          source,
        )

    // 带详情的模板 key 也必须两套语言都齐，否则 detail 分支会渲染出裸 key
    const extra = ['tool.storage.errorCookieSetFailedDetail', 'tool.storage.errorUnexpectedDetail']
    for (const key of [...ERROR_CODES.map(storageErrorKey), ...extra]) {
      expect(lookup(zh, key), `zh 缺少 ${key}`).toEqual(expect.any(String))
      expect(lookup(en, key), `en 缺少 ${key}`).toEqual(expect.any(String))
    }
  })

  it('英文界面下不出现中文（本次修复的核心缺陷）', async () => {
    await i18n.changeLanguage('en')
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

    for (const code of ERROR_CODES) {
      const text = resolveStorageError({ ok: false, code }, 'tool.storage.errorUnreadable')
      expect(text.length, `${code} 文案为空`).toBeGreaterThan(0)
      expect(text, `${code} 的英文文案含中文`).not.toBe(code)
      expect(cjk.test(text), `${code} 的英文文案含中文：${text}`).toBe(false)
    }
  })

  it('中文界面下给出中文文案', async () => {
    await i18n.changeLanguage('zh')
    const cjk = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/
    for (const code of ERROR_CODES) {
      expect(cjk.test(resolveStorageError({ ok: false, code }, 'x')), `${code} 中文文案异常`).toBe(
        true,
      )
    }
  })

  it('ERR_COOKIE_SET_FAILED 带 detail 时改用详情文案并保留原始报错', async () => {
    await i18n.changeLanguage('en')
    const text = resolveStorageError(
      { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Failed to parse cookie' },
      'tool.storage.errorCookieSave',
    )
    expect(text).toContain('Failed to parse cookie')
    expect(text).not.toContain('{{detail}}')
  })

  it('升级兼容：旧版 background 的 error 句子原样透传', async () => {
    await i18n.changeLanguage('en')
    expect(resolveStorageError({ ok: false, error: 'legacy message' }, 'x')).toBe('legacy message')
  })

  it('未知错误码与空响应回退到调用方兜底文案', async () => {
    await i18n.changeLanguage('en')
    const fallback = i18n.t('tool.storage.errorUnreadable')
    expect(
      resolveStorageError({ ok: false, code: 'NOT_A_CODE' }, 'tool.storage.errorUnreadable'),
    ).toBe(fallback)
    expect(resolveStorageError(undefined, 'tool.storage.errorUnreadable')).toBe(fallback)
    expect(resolveStorageError({ ok: false, error: '' }, 'tool.storage.errorUnreadable')).toBe(
      fallback,
    )
  })

  it('isErrorCode 只认可已注册的错误码', () => {
    expect(isErrorCode('ERR_NO_TARGET_URL')).toBe(true)
    expect(isErrorCode('NOT_A_CODE')).toBe(false)
    expect(isErrorCode(undefined)).toBe(false)
    expect(isErrorCode(123)).toBe(false)
  })
})

describe('resolveStorageError 的边界与升级兼容', () => {
  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('非对象 / 空响应（字符串、数字、布尔、数组、null）一律回退到兜底 key', async () => {
    await i18n.changeLanguage('en')
    const fallback = i18n.t('tool.storage.errorUnreadable')
    for (const res of ['oops', 42, true, [], null, {}]) {
      expect(resolveStorageError(res, 'tool.storage.errorUnreadable'), JSON.stringify(res)).toBe(
        fallback,
      )
    }
  })

  it('合法 code 优先于 error 字段（新版 background 与旧版字段同时存在时以 code 为准）', async () => {
    await i18n.changeLanguage('en')
    const text = resolveStorageError(
      { ok: false, code: 'ERR_NO_TARGET_URL', error: 'legacy message' },
      'tool.storage.errorUnreadable',
    )
    expect(text).toBe(i18n.t('tool.storage.errorNoTargetUrl'))
    expect(text).not.toBe('legacy message')
  })

  it('非法 code 但带 error 句子时仍原样透传（升级过渡期的旧 background）', async () => {
    await i18n.changeLanguage('en')
    expect(resolveStorageError({ ok: false, code: 'NOT_A_CODE', error: 'legacy' }, 'x')).toBe(
      'legacy',
    )
  })

  it('detail 非字符串或为空串时退回该 code 的基础文案', async () => {
    await i18n.changeLanguage('en')
    const base = i18n.t('tool.storage.errorCookieSetFailed')
    expect(
      resolveStorageError(
        { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 123 },
        'tool.storage.errorCookieSave',
      ),
    ).toBe(base)
    expect(
      resolveStorageError(
        { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: '' },
        'tool.storage.errorCookieSave',
      ),
    ).toBe(base)
  })

  it('中文界面下 detail 文案同样是中文模板 + 原始报错', async () => {
    await i18n.changeLanguage('zh')
    const text = resolveStorageError(
      { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Domain 不匹配' },
      'x',
    )
    expect(text).toContain('Domain 不匹配')
    expect(text).not.toContain('{{')
    expect(CJK.test(text)).toBe(true)
  })

  /**
   * 回归：detail 插值曾只对 ERR_COOKIE_SET_FAILED 生效，而 ERR_UNEXPECTED 的模板里却含 `{{detail}}`，
   * 于是「无 detail 的 ERR_UNEXPECTED」会把未替换的占位符直接显示给用户，有 detail 时反而丢掉详情。
   * 现在统一按 ERROR_DETAIL_KEYS 处理：有 detail 走带详情模板，无 detail 回落基础文案。
   */
  it('ERR_UNEXPECTED：有 detail 时插入详情，无 detail 时给出无占位符的基础文案', async () => {
    await i18n.changeLanguage('en')
    const withoutDetail = resolveStorageError(
      { ok: false, code: 'ERR_UNEXPECTED' },
      'tool.storage.errorUnreadable',
    )
    expect(withoutDetail).toBe(i18n.t('tool.storage.errorUnexpected'))
    expect(withoutDetail).not.toContain('{{detail}}')

    const withDetail = resolveStorageError(
      { ok: false, code: 'ERR_UNEXPECTED', detail: 'boom' },
      'tool.storage.errorUnreadable',
    )
    expect(withDetail).toBe(i18n.t('tool.storage.errorUnexpectedDetail', { detail: 'boom' }))
    expect(withDetail).toContain('boom')
    expect(withDetail).not.toContain('{{detail}}')
  })

  it('任何语言下基础错误文案都不含 {{detail}} 占位符，带详情模板都真的插值', async () => {
    for (const lng of ['zh', 'en'] as const) {
      await i18n.changeLanguage(lng)
      for (const code of ERROR_CODES) {
        expect(i18n.t(storageErrorKey(code)), `${lng}:${code} 基础文案含占位符`).not.toContain('{{')
        const detailKey = storageErrorDetailKey(code)
        if (detailKey) {
          expect(i18n.t(detailKey, { detail: 'X' }), `${lng}:${code} 详情模板未插值`).toContain('X')
        }
      }
    }
    await i18n.changeLanguage('zh')
  })

  it('每个错误码的中英文案都不同且各自属于对应语言（防止复制粘贴漏翻）', async () => {
    const texts = new Map<string, string>()
    await i18n.changeLanguage('zh')
    for (const code of ERROR_CODES) {
      const text = resolveStorageError({ ok: false, code }, 'x')
      expect(CJK.test(text), `${code} 中文文案异常：${text}`).toBe(true)
      texts.set(code, text)
    }
    await i18n.changeLanguage('en')
    for (const code of ERROR_CODES) {
      const text = resolveStorageError({ ok: false, code }, 'x')
      expect(CJK.test(text), `${code} 英文文案含中文：${text}`).toBe(false)
      expect(text, `${code} 中英文案相同`).not.toBe(texts.get(code))
    }
  })

  it('isErrorCode 对 null / 布尔 / 对象 / 带空格的近似码都判否', () => {
    expect(isErrorCode(null)).toBe(false)
    expect(isErrorCode(true)).toBe(false)
    expect(isErrorCode({})).toBe(false)
    expect(isErrorCode([])).toBe(false)
    expect(isErrorCode('ERR_NO_TARGET_URL ')).toBe(false)
    expect(isErrorCode('err_no_target_url')).toBe(false)
  })
})

/**
 * node 环境没有 window，但扩展页面上下文的分支判定只读 window.location.protocol，
 * 所以这里用最小 window 桩把 listStorage 等函数逼进「扩展页 ↔ content」桥接路径。
 * 页面上下文（真实 localStorage）的用例见 storage.dom.test.ts。
 */
const g = globalThis as unknown as { chrome?: unknown; window?: unknown }

function installExtensionWindow(): void {
  g.window = {
    location: {
      protocol: 'chrome-extension:',
      href: 'chrome-extension://test/sidepanel.html',
      origin: 'chrome-extension://test',
    },
  }
}

afterEach(() => {
  delete g.chrome
  delete g.window
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/

/** 断言失败结果并取出 error（成功时直接让用例失败） */
function failureError(result: { ok: true } | { ok: false; error: string }): string {
  if (result.ok) throw new Error('期望失败结果，实际返回成功')
  return result.error
}

interface TabStub {
  id?: number
}

interface TabsStubOptions {
  tabs?: TabStub[]
  queryThrows?: boolean
  sendThrows?: boolean
  /** 是否显式给出 content 的响应（缺省等价于 { ok: true }） */
  sendResult?: unknown
}

/** chrome.tabs 桩：记录每次 sendMessage 的载荷，便于断言消息协议 */
function installTabsStub(options: TabsStubOptions = {}) {
  const calls: { tabId: number; message: unknown }[] = []
  const tabs = options.tabs ?? [{ id: 42 }]
  g.chrome = {
    runtime: { id: 'test-ext' },
    tabs: {
      query: async () => {
        if (options.queryThrows) throw new Error('query boom')
        return tabs
      },
      sendMessage: async (tabId: number, message: unknown) => {
        calls.push({ tabId, message })
        if (options.sendThrows) throw new Error('send boom')
        return 'sendResult' in options ? options.sendResult : { ok: true }
      },
    },
  }
  return calls
}

describe('扩展页面 → content script 的存储桥接（chrome.tabs）', () => {
  beforeEach(installExtensionWindow)

  it('listStorage 把请求发给当前活动标签页，并原样返回 content 的快照', async () => {
    const snapshot = {
      ok: true,
      data: {
        origin: 'https://example.com',
        area: 'local',
        entries: [{ key: 'a', size: 1, value: '1', truncated: false }],
        totalCount: 1,
        listTruncated: false,
      },
    }
    const calls = installTabsStub({ sendResult: snapshot })

    await expect(listStorage('session')).resolves.toEqual(snapshot)
    expect(calls).toEqual([{ tabId: 42, message: { action: MSG_STORAGE_READ, area: 'session' } }])
  })

  it('removeStorageKey / setStorageValue / clearStorageArea 的消息载荷形状正确', async () => {
    const calls = installTabsStub()

    await expect(removeStorageKey('local', 'token')).resolves.toEqual({ ok: true })
    await expect(setStorageValue('session', 'k', '')).resolves.toEqual({ ok: true })
    await expect(clearStorageArea('local')).resolves.toEqual({ ok: true })

    expect(calls).toEqual([
      { tabId: 42, message: { action: MSG_STORAGE_REMOVE, area: 'local', key: 'token' } },
      { tabId: 42, message: { action: MSG_STORAGE_SET, area: 'session', key: 'k', value: '' } },
      { tabId: 42, message: { action: MSG_STORAGE_CLEAR, area: 'local' } },
    ])
  })

  it('content 回的失败文案原样带回（页面侧已本地化，不再二次翻译）', async () => {
    installTabsStub({ sendResult: { ok: false, error: '页面拒绝写入' } })
    await expect(setStorageValue('local', 'k', 'v')).resolves.toEqual({
      ok: false,
      error: '页面拒绝写入',
    })
  })

  it('content 无响应（res 为空 / 非对象 / 缺 ok）时按当前语言给出 errorNoResponse', async () => {
    for (const sendResult of [undefined, null, 'oops', 0, {}]) {
      installTabsStub({ sendResult })

      await i18n.changeLanguage('en')
      const enText = failureError(await listStorage('local'))
      expect(enText).toBe(i18n.t('tool.storage.errorNoResponse'))
      expect(CJK.test(enText), `英文文案含中文：${enText}`).toBe(false)

      await i18n.changeLanguage('zh')
      const zhText = failureError(await listStorage('local'))
      expect(zhText).toBe(i18n.t('tool.storage.errorNoResponse'))
      expect(CJK.test(zhText), `中文文案异常：${zhText}`).toBe(true)
    }
  })

  it('无活动标签页给出 errorNoActiveTab；query / sendMessage 抛错才收敛为 errorUnreadable', async () => {
    await i18n.changeLanguage('en')
    const noActiveTab = i18n.t('tool.storage.errorNoActiveTab')
    const unreadable = i18n.t('tool.storage.errorUnreadable')

    // 没有活动标签页 / 有标签页但没有 id（Chrome 在无权限或系统页时会这样）
    installTabsStub({ tabs: [] })
    expect(failureError(await listStorage('local'))).toBe(noActiveTab)
    installTabsStub({ tabs: [{}] })
    expect(failureError(await listStorage('local'))).toBe(noActiveTab)

    // tabs.query 直接抛错
    installTabsStub({ queryThrows: true })
    expect(failureError(await removeStorageKey('local', 'a'))).toBe(unreadable)

    // content 侧没有监听者：sendMessage reject
    installTabsStub({ sendThrows: true })
    expect(failureError(await setStorageValue('local', 'a', '1'))).toBe(unreadable)
    expect(failureError(await clearStorageArea('local'))).toBe(unreadable)

    // 回归：这两条文案必须真的不同，否则「无活动标签页」的专门提示会退化成死文案
    expect(noActiveTab).not.toBe(unreadable)
    expect(CJK.test(unreadable)).toBe(false)
  })

  it('扩展页面上下文里完全没有 chrome 时也不抛错，而是回失败结果', async () => {
    // 不安装任何 chrome 桩：模拟 content/background 均不可用的极端情况
    const res = await listStorage('local')
    expect(res.ok).toBe(false)
    expect(failureError(res)).toBe(i18n.t('tool.storage.errorUnreadable'))
  })
})

/** chrome.runtime 桩：Cookie 相关的请求都走 sendMessage 到 background */
function installRuntimeStub(options: TabsStubOptions = {}) {
  const calls: Record<string, unknown>[] = []
  g.chrome = {
    runtime: {
      id: 'test-ext',
      sendMessage: async (message: Record<string, unknown>) => {
        calls.push(message)
        if (options.sendThrows) throw new Error('runtime boom')
        return 'sendResult' in options ? options.sendResult : { ok: true }
      },
    },
  }
  return calls
}

function makeCookie(overrides: Partial<CookieEntry> = {}): CookieEntry {
  return {
    name: 'sid',
    value: 'v',
    domain: 'example.com',
    path: '/',
    hostOnly: true,
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
    session: true,
    size: 10,
    ...overrides,
  }
}

describe('bareCookieDomain / getCookieUrl', () => {
  it('bareCookieDomain 只去掉一个 RFC 6265 前导点', () => {
    expect(bareCookieDomain('.example.com')).toBe('example.com')
    expect(bareCookieDomain('example.com')).toBe('example.com')
    expect(bareCookieDomain('')).toBe('')
    // 理论上不会出现，但去掉一个点后其余原样保留（不递归去点）
    expect(bareCookieDomain('..example.com')).toBe('.example.com')
    expect(bareCookieDomain('.')).toBe('')
  })

  it('getCookieUrl 拼接协议 + 域 + 路径，并把非 / 开头的 path 补成绝对路径', () => {
    expect(getCookieUrl({ domain: '.example.com', path: '/', secure: false })).toBe(
      'http://example.com/',
    )
    expect(getCookieUrl({ domain: 'example.com', path: 'api/v1', secure: false })).toBe(
      'http://example.com/api/v1',
    )
    expect(getCookieUrl({ domain: 'example.com', path: '', secure: false })).toBe(
      'http://example.com/',
    )
  })

  it('secure Cookie 永远用 https；非 secure 由 fallbackUrl 推断协议', () => {
    expect(getCookieUrl({ domain: 'example.com', path: '/', secure: true }, 'http://x/')).toBe(
      'https://example.com/',
    )
    expect(
      getCookieUrl({ domain: 'example.com', path: '/', secure: false }, 'https://x/page'),
    ).toBe('https://example.com/')
    expect(getCookieUrl({ domain: 'example.com', path: '/', secure: false }, 'http://x/page')).toBe(
      'http://example.com/',
    )
  })

  it('domain 为空时回退到 fallbackUrl 的 hostname（host-only Cookie 常见）', () => {
    // 注意用的是 URL.hostname（不含端口），与 background 侧 chrome.cookies 的 url 语义一致
    expect(getCookieUrl({ domain: '', path: '/', secure: false }, 'https://a.b.c:8443/page')).toBe(
      'https://a.b.c/',
    )
  })

  it('非法 / 缺失 fallbackUrl 时不抛错，退化成空域的 URL', () => {
    expect(getCookieUrl({ domain: '', path: '/', secure: false }, 'not a url')).toBe('http:///')
    expect(getCookieUrl({ domain: '', path: '/', secure: false })).toBe('http:///')
  })
})

describe('listCookies', () => {
  beforeEach(installExtensionWindow)

  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('非扩展环境（pnpm dev / 单测）返回 mock 快照，结构完整且时间在未来', async () => {
    const res = await listCookies()
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('mock 应成功')
    expect(res.data.url).toBe('https://example.com')
    expect(res.data.origin).toBe('https://example.com')
    expect(res.data.cookies).toHaveLength(2)
    expect(res.data.totalCount).toBe(2)
    expect(res.data.cookies.map((c) => c.name)).toEqual(['session_id', 'theme_pref'])
    expect(res.data.cookies[0]).toMatchObject({
      domain: '.example.com',
      hostOnly: false,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      session: false,
    })
    expect(res.data.cookies[1]).toMatchObject({
      domain: 'example.com',
      hostOnly: true,
      secure: false,
      session: true,
    })
    expect(res.data.cookies[1].expirationDate).toBeUndefined()
    // mock 的过期时间必须是未来时间（写死过去时间戳会让人误判 Cookie 已过期）
    expect(res.data.cookies[0].expirationDate ?? 0).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('非扩展环境即使传了 pageUrl 也仍走 mock（isExtension 判定优先）', async () => {
    const res = await listCookies('https://other.test/page')
    if (!res.ok) throw new Error('mock 应成功')
    expect(res.data.origin).toBe('https://example.com')
  })

  it('扩展环境成功时把 cookies 映射成新对象并按 UTF-8 重算 size、重算 totalCount', async () => {
    const raw = makeCookie({
      name: '会话',
      value: 'abc',
      domain: '.example.com',
      secure: true,
      hostOnly: false,
      size: 1,
    })
    const calls = installRuntimeStub({
      sendResult: {
        ok: true,
        data: { url: 'https://example.com/p', origin: 'https://example.com', cookies: [raw] },
      },
    })

    const res = await listCookies('https://example.com/p')
    if (!res.ok) throw new Error('应成功')
    expect(res.data.url).toBe('https://example.com/p')
    expect(res.data.origin).toBe('https://example.com')
    expect(res.data.totalCount).toBe(1)
    // '会话' = 6 字节 + 'abc' = 3 字节
    expect(res.data.cookies[0].size).toBe(new TextEncoder().encode('会话abc').length)
    expect(res.data.cookies[0].size).toBe(9)
    // 返回的是新对象，不就地改写 background 的响应
    expect(res.data.cookies[0]).not.toBe(raw)
    expect(raw.size).toBe(1)
    expect(calls).toEqual([{ action: MSG_COOKIE_GET_ALL, url: 'https://example.com/p' }])
  })

  it('同名但不同 domain/path 的 Cookie 全部保留且顺序不变', async () => {
    const a = makeCookie({ name: 'sid', path: '/', domain: 'a.test' })
    const b = makeCookie({ name: 'sid', path: '/api', domain: 'b.test' })
    installRuntimeStub({
      sendResult: {
        ok: true,
        data: { url: 'https://a.test/', origin: 'https://a.test', cookies: [a, b] },
      },
    })

    const res = await listCookies('https://a.test/')
    if (!res.ok) throw new Error('应成功')
    expect(res.data.cookies).toHaveLength(2)
    expect(res.data.totalCount).toBe(2)
    expect(res.data.cookies.map((c) => [c.name, c.domain, c.path])).toEqual([
      ['sid', 'a.test', '/'],
      ['sid', 'b.test', '/api'],
    ])
  })

  it('响应缺少 cookies 字段时给出空列表而不是报错', async () => {
    installRuntimeStub({
      sendResult: { ok: true, data: { url: 'https://x.test/', origin: 'https://x.test' } },
    })
    const res = await listCookies('https://x.test/')
    if (!res.ok) throw new Error('应成功')
    expect(res.data.cookies).toEqual([])
    expect(res.data.totalCount).toBe(0)
  })

  it('扩展页未传 pageUrl 时把 url 交给 background 决定（载荷 url 为 undefined）', async () => {
    const calls = installRuntimeStub({
      sendResult: {
        ok: true,
        data: { url: 'https://x.test/', origin: 'https://x.test', cookies: [] },
      },
    })
    await listCookies()
    expect(calls[0].url).toBeUndefined()
    expect(calls[0].action).toBe(MSG_COOKIE_GET_ALL)
  })

  it('background 失败时按 code 本地化，旧版 error 句子透传，空响应回退兜底', async () => {
    await i18n.changeLanguage('en')
    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_COOKIE_NO_PAGE_URL' } })
    const enText = failureError(await listCookies())
    expect(enText).toBe(i18n.t('tool.storage.errorCookieNoPageUrl'))
    expect(CJK.test(enText)).toBe(false)

    await i18n.changeLanguage('zh')
    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_COOKIE_NO_PAGE_URL' } })
    const zhText = failureError(await listCookies())
    expect(zhText).toBe(i18n.t('tool.storage.errorCookieNoPageUrl'))
    expect(CJK.test(zhText)).toBe(true)

    installRuntimeStub({ sendResult: { ok: false, error: 'legacy list' } })
    expect(failureError(await listCookies())).toBe('legacy list')

    installRuntimeStub({ sendResult: null })
    expect(failureError(await listCookies())).toBe(i18n.t('tool.storage.errorUnreadable'))
  })

  it('sendMessage 抛错时把异常信息作为 error 返回', async () => {
    installRuntimeStub({ sendThrows: true })
    expect(failureError(await listCookies('https://x.test/'))).toBe('runtime boom')
  })

  it('background 回 ok 但缺 data 时收敛为失败结果而不是抛错', async () => {
    installRuntimeStub({ sendResult: { ok: true } })
    const res = await listCookies('https://x.test/')
    expect(res.ok).toBe(false)
    expect(failureError(res)).toContain('url')
  })
})

describe('removeCookie / clearAllCookies', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('非扩展环境直接成功，且完全不触碰 chrome', async () => {
    await expect(removeCookie(makeCookie(), 'https://example.com/')).resolves.toEqual({ ok: true })
    await expect(clearAllCookies('https://example.com/')).resolves.toEqual({ ok: true })
  })

  it('removeCookie 用 getCookieUrl 拼出的 url + name + storeId 定位目标', async () => {
    const calls = installRuntimeStub()
    const cookie = makeCookie({
      name: 'sid',
      domain: '.example.com',
      path: '/api',
      secure: true,
      storeId: '0',
    })

    await expect(removeCookie(cookie, 'https://example.com/page')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([
      { action: MSG_COOKIE_REMOVE, url: 'https://example.com/api', name: 'sid', storeId: '0' },
    ])
  })

  it('domain 为空的 host-only Cookie 用 pageUrl 推断 url，且 storeId 键始终存在', async () => {
    const calls = installRuntimeStub()
    await removeCookie(makeCookie({ domain: '', path: '/' }), 'https://a.b.test/page?q=1')

    expect(calls[0].url).toBe('https://a.b.test/')
    expect('storeId' in calls[0]).toBe(true)
    expect(calls[0].storeId).toBeUndefined()
  })

  it('clearAllCookies 只发 url，不带其他参数', async () => {
    const calls = installRuntimeStub()
    await expect(clearAllCookies('https://example.com/page')).resolves.toEqual({ ok: true })
    expect(calls).toEqual([{ action: MSG_COOKIE_CLEAR_ALL, url: 'https://example.com/page' }])
  })

  it('失败响应按 language 映射 code，旧版 error 句子透传，空响应用各自兜底 key', async () => {
    await i18n.changeLanguage('en')
    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_COOKIE_REMOVE_FAILED' } })
    const removeEn = failureError(await removeCookie(makeCookie(), 'https://example.com/'))
    expect(removeEn).toBe(i18n.t('tool.storage.errorCookieDelete'))
    expect(CJK.test(removeEn)).toBe(false)

    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_NO_TARGET_URL' } })
    const clearEn = failureError(await clearAllCookies('https://example.com/'))
    expect(clearEn).toBe(i18n.t('tool.storage.errorNoTargetUrl'))

    await i18n.changeLanguage('zh')
    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_COOKIE_REMOVE_FAILED' } })
    const removeZh = failureError(await removeCookie(makeCookie(), 'https://example.com/'))
    expect(removeZh).toBe(i18n.t('tool.storage.errorCookieDelete'))
    expect(CJK.test(removeZh)).toBe(true)

    // 空响应（res 为 null）→ resolveStorageError 用调用方给的兜底 key
    installRuntimeStub({ sendResult: null })
    expect(failureError(await removeCookie(makeCookie(), 'https://example.com/'))).toBe(
      i18n.t('tool.storage.errorCookieDelete'),
    )
    expect(failureError(await clearAllCookies('https://example.com/'))).toBe(
      i18n.t('tool.storage.errorCookieClear'),
    )

    installRuntimeStub({ sendResult: { ok: false, error: 'legacy delete' } })
    expect(failureError(await removeCookie(makeCookie(), 'https://example.com/'))).toBe(
      'legacy delete',
    )
  })

  it('sendMessage 抛错时两个函数都返回异常信息', async () => {
    installRuntimeStub({ sendThrows: true })
    expect(failureError(await removeCookie(makeCookie(), 'https://example.com/'))).toBe(
      'runtime boom',
    )
    expect(failureError(await clearAllCookies('https://example.com/'))).toBe('runtime boom')
  })
})

describe('saveCookies', () => {
  afterAll(async () => {
    await i18n.changeLanguage('zh')
  })

  it('非扩展环境直接成功（含空数组），不写任何存储', async () => {
    await expect(saveCookies([])).resolves.toEqual({ ok: true })
    await expect(saveCookies({ name: 'a', value: '1' })).resolves.toEqual({ ok: true })
  })

  it('单条被包成数组；数组原样透传；pageUrl 缺省时 url 为 undefined', async () => {
    const calls = installRuntimeStub()
    const one = { name: 'a', value: '1' }
    await expect(saveCookies(one, 'https://example.com/')).resolves.toEqual({ ok: true })
    expect(calls[0]).toEqual({
      action: MSG_COOKIE_SET,
      url: 'https://example.com/',
      cookies: [one],
      oldCookie: undefined,
    })
    // oldCookie 键始终存在（background 用 undefined 判断是否为编辑）
    expect('oldCookie' in calls[0]).toBe(true)

    const many = [
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ]
    await saveCookies(many)
    // 数组原样透传（不再多包一层）
    expect(calls[1].cookies).toEqual(many)
    expect(calls[1].url).toBeUndefined()
  })

  it('编辑场景只回传定位旧 Cookie 所需的字段（不带 value/size/过期时间）', async () => {
    const calls = installRuntimeStub()
    const old = makeCookie({
      name: 'sid',
      value: 'old-secret',
      domain: '.example.com',
      path: '/api',
      secure: true,
      storeId: '1',
      size: 99,
      expirationDate: 1893456000,
    })

    await saveCookies({ name: 'sid', value: 'new' }, 'https://example.com/api', old)

    expect(calls[0].oldCookie).toEqual({
      name: 'sid',
      domain: '.example.com',
      path: '/api',
      secure: true,
      storeId: '1',
    })
    expect(Object.keys(calls[0].oldCookie as object).sort()).toEqual([
      'domain',
      'name',
      'path',
      'secure',
      'storeId',
    ])
    // 旧值绝不能顺手回传，避免 background 误用
    expect(calls[0].oldCookie).not.toHaveProperty('value')
  })

  it('ERR_COOKIE_SET_FAILED 带 detail 时展示详情文案（中英各一套）', async () => {
    await i18n.changeLanguage('zh')
    installRuntimeStub({
      sendResult: { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Domain 不匹配' },
    })
    const zhText = failureError(await saveCookies({ name: 'a', value: '1' }))
    expect(zhText).toContain('Domain 不匹配')
    expect(zhText).not.toContain('{{')
    expect(CJK.test(zhText)).toBe(true)

    await i18n.changeLanguage('en')
    installRuntimeStub({
      sendResult: { ok: false, code: 'ERR_COOKIE_SET_FAILED', detail: 'Domain mismatch' },
    })
    const enText = failureError(await saveCookies({ name: 'a', value: '1' }))
    expect(enText).toContain('Domain mismatch')
    expect(enText).not.toContain('{{')
    expect(CJK.test(enText)).toBe(false)
  })

  it('无 detail 的失败 / 旧版 error 句子 / 空响应分别走基础文案与兜底', async () => {
    installRuntimeStub({ sendResult: { ok: false, code: 'ERR_COOKIE_SET_FAILED' } })
    expect(failureError(await saveCookies({ name: 'a', value: '1' }))).toBe(
      i18n.t('tool.storage.errorCookieSetFailed'),
    )

    installRuntimeStub({ sendResult: { ok: false, error: 'legacy save' } })
    expect(failureError(await saveCookies({ name: 'a', value: '1' }))).toBe('legacy save')

    installRuntimeStub({ sendResult: null })
    expect(failureError(await saveCookies({ name: 'a', value: '1' }))).toBe(
      i18n.t('tool.storage.errorCookieSave'),
    )

    installRuntimeStub({ sendThrows: true })
    expect(failureError(await saveCookies({ name: 'a', value: '1' }))).toBe('runtime boom')
  })
})
