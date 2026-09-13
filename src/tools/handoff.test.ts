import { afterEach, describe, expect, it, vi } from 'vitest'

import { setDraftValue } from '@/utils/draft'

import { prepareToolHandoff, toolForDetectKind } from './handoff'
import { DEFAULT_JSON_DRAFT, JSON_DRAFT_KEY } from './JsonTool'
import type { ToolId } from './registry'

/**
 * T134 的手递手契约。
 * 这里刻意用一个内存版 chrome.storage 桩：既能断言「写了什么 key」，也能断言
 * 「工具被禁用时是否自动启用」——这两点出错都会让入口点了没反应或跳到别的 Tab。
 */
type Store = Record<string, Record<string, unknown>>

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(
  initial: Store = {},
  options: { failSyncSet?: boolean; failSyncGet?: boolean; syncWriteLog?: string[] } = {},
) {
  const store: Store = { session: {}, sync: {}, local: {}, ...initial }

  const area = (name: string) => ({
    get: async (key: string) => {
      if (name === 'sync' && options.failSyncGet) {
        // 模拟读取被拒绝：env.storageGet 会吃掉异常并返回 null，调用方必须能继续
        throw new Error('sync get denied')
      }
      return key in store[name] ? { [key]: store[name][key] } : {}
    },
    set: async (obj: Record<string, unknown>) => {
      if (name === 'sync' && options.failSyncSet) {
        // 模拟 chrome.storage.sync 配额写满：静默失败（reject 被 env.storageSet 吃掉并返回 false）
        throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded')
      }
      if (name === 'sync') options.syncWriteLog?.push(JSON.stringify(obj))
      Object.assign(store[name], obj)
    },
    remove: async (key: string) => {
      delete store[name][key]
    },
  })

  globalWithChrome.chrome = {
    storage: {
      session: area('session'),
      sync: area('sync'),
      local: area('local'),
      onChanged: { addListener() {}, removeListener() {} },
    },
  }
  return store
}

afterEach(() => {
  delete globalWithChrome.chrome
})

describe('toolForDetectKind：只有确有额外能力的类型才给入口', () => {
  it('json / url 映射到对应工具', () => {
    expect(toolForDetectKind('json')).toBe('json')
    expect(toolForDetectKind('url')).toBe('url')
  })

  it('展示已对齐或无对应能力的类型不映射（T134 收窄后的范围）', () => {
    expect(toolForDetectKind('timestamp')).toBeNull()
    expect(toolForDetectKind('jwt')).toBeNull()
    expect(toolForDetectKind('base64')).toBeNull()
    expect(toolForDetectKind('hex')).toBeNull()
    expect(toolForDetectKind('uuid')).toBeNull()
    expect(toolForDetectKind('dataurl')).toBeNull()
  })

  it('映射是纯函数：同一 kind 重复调用结果稳定', () => {
    for (const kind of ['json', 'url', 'timestamp', 'hex'] as const) {
      expect(toolForDetectKind(kind)).toBe(toolForDetectKind(kind))
    }
  })
})

describe('prepareToolHandoff', () => {
  it('url：写入解析输入、把 Tab 拉回解析页、并激活网址工具', async () => {
    const store = stubChrome()
    await prepareToolHandoff('url', 'https://example.com/a?b=1')

    expect(store.session['panda.draft.url.parse.input']).toBe('https://example.com/a?b=1')
    expect(store.session['panda.draft.url.tab']).toBe('parse')
    expect(store.session['panda.draft.activeToolTab']).toBe('url')
  })

  it('json：写进对象草稿，保留缩进/排序偏好，并顺手算好格式化结果', async () => {
    const seed = {
      ...DEFAULT_JSON_DRAFT,
      indent: 4,
      sortKeys: true,
      output: '上次的输出',
      lastAction: 'format',
    }
    const store = stubChrome({ session: { [`panda.draft.${JSON_DRAFT_KEY}`]: seed } })
    // 显式同步内存缓存，避免本用例的结果受其它用例写入顺序影响（draft.ts 的缓存是模块级常驻的）
    await setDraftValue(JSON_DRAFT_KEY, seed)

    await prepareToolHandoff('json', '{"a":1}')

    expect(store.session[`panda.draft.${JSON_DRAFT_KEY}`]).toEqual({
      ...DEFAULT_JSON_DRAFT,
      indent: 4,
      sortKeys: true,
      input: '{"a":1}',
      // 自动执行「格式化」：用用户存的 indent=4 算好结果，打开就能看到，不用再点一次
      output: '{\n    "a": 1\n}',
      lastAction: 'format',
    })
    expect(store.session['panda.draft.activeToolTab']).toBe('json')
  })

  it('无论有无历史草稿，写出的 JSON 草稿字段始终完整（不写出残缺对象）', async () => {
    const store = stubChrome()
    // draft.ts 的 memoryCache 是模块级常驻的（这是它的设计目的），
    // 故显式写入一份默认值来模拟「没有可保留的用户偏好」，避免依赖用例执行顺序
    await setDraftValue(JSON_DRAFT_KEY, DEFAULT_JSON_DRAFT)

    await prepareToolHandoff('json', '{"b":2}')

    const draft = store.session[`panda.draft.${JSON_DRAFT_KEY}`] as Record<string, unknown>
    expect(Object.keys(draft).sort()).toEqual(Object.keys(DEFAULT_JSON_DRAFT).sort())
    expect(draft.input).toBe('{"b":2}')
    // 默认偏好（indent 2、不排序、非单行）下就是常规展开格式化
    expect(draft.output).toBe('{\n  "b": 2\n}')
    expect(draft.lastAction).toBe('format')
  })

  it('json：用户勾了「单行结果」时按单行算，并记录 lastAction=minify', async () => {
    const store = stubChrome()
    await setDraftValue(JSON_DRAFT_KEY, { ...DEFAULT_JSON_DRAFT, minify: true })

    await prepareToolHandoff('json', '{\n  "b": 2,\n  "a": 1\n}')

    const draft = store.session[`panda.draft.${JSON_DRAFT_KEY}`] as Record<string, unknown>
    // 与工具里那颗按钮同一套偏好：minify 决定单行还是展开（排序偏好为 false，故保持原键序）
    expect(draft.output).toBe('{"b":2,"a":1}')
    expect(draft.lastAction).toBe('minify')
  })

  it('json：文本不是合法 JSON 时不写入来路不明的结果（output 空、lastAction 空）', async () => {
    const store = stubChrome()
    await setDraftValue(JSON_DRAFT_KEY, DEFAULT_JSON_DRAFT)

    await prepareToolHandoff('json', 'not-json-at-all')

    const draft = store.session[`panda.draft.${JSON_DRAFT_KEY}`] as Record<string, unknown>
    expect(draft.input).toBe('not-json-at-all')
    expect(draft.output).toBe('')
    expect(draft.lastAction).toBeNull()
  })

  it('detect：划选面板的「在侧边栏中打开」仍能把文本带回检测工具（防回归）', async () => {
    const store = stubChrome()
    await prepareToolHandoff('detect', 'SGVsbG8=')

    expect(store.session['panda.draft.detect.input']).toBe('SGVsbG8=')
    expect(store.session['panda.draft.activeToolTab']).toBe('detect')
  })

  it('目标工具被禁用时自动启用，否则切过去会落到别的 Tab', async () => {
    const store = stubChrome({
      sync: {
        settings: { toolEnabled: { json: false, url: true }, theme: 'dark' },
      },
    })

    await expect(prepareToolHandoff('json', '{}')).resolves.toEqual({ ok: true })

    const saved = store.sync.settings as {
      theme?: string
      toolEnabled: Record<string, boolean>
    }
    expect(saved.toolEnabled.json).toBe(true)
    expect(saved.toolEnabled.url).toBe(true)
    // 写入经过 normalizeSettings：残缺数据被补齐成完整 Settings，而不是原样写回
    expect(Object.keys(saved.toolEnabled)).toHaveLength(9)
    expect(saved.theme).toBe('dark')

    const before = JSON.stringify(store.sync.settings)
    await prepareToolHandoff('url', '[1]')
    // url 本来就已启用，不应产生多余的设置写入
    expect(JSON.stringify(store.sync.settings)).toBe(before)
  })

  it('未接入跳转的工具返回 unsupported 且不做任何写入', async () => {
    const store = stubChrome()
    await expect(prepareToolHandoff('hash', 'abc')).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    })
    expect(store.session).toEqual({})
  })

  it('启用写入失败时返回 enable-failed，且**不写**任何草稿与激活项（顺序保证）', async () => {
    const store = stubChrome(
      { sync: { settings: { toolEnabled: { json: false } } } },
      { failSyncSet: true },
    )

    await expect(prepareToolHandoff('json', '{"a":1}')).resolves.toEqual({
      ok: false,
      reason: 'enable-failed',
    })

    // 关键：没有半途写入，否则 activeToolTab 会指向不可见的工具，用户静默落到别的 Tab
    expect(store.session).toEqual({})
  })
})

describe('prepareToolHandoff：边界、幂等与降级', () => {
  it('未支持/未知工具在完全没有 chrome 时也直接返回 unsupported（先判白名单，不读设置）', async () => {
    delete globalWithChrome.chrome
    const unsupported = { ok: false, reason: 'unsupported' }

    await expect(prepareToolHandoff('hash', 'abc')).resolves.toEqual(unsupported)
    await expect(prepareToolHandoff('not-a-tool' as unknown as ToolId, 'abc')).resolves.toEqual(
      unsupported,
    )

    const result = await prepareToolHandoff('hash', 'abc')
    expect(Object.keys(result).sort()).toEqual(['ok', 'reason'])
  })

  it('成功结果形状恰好是 { ok:true }（不带多余字段）', async () => {
    stubChrome()
    const result = await prepareToolHandoff('url', 'https://x.test')
    expect(result).toEqual({ ok: true })
    expect(Object.keys(result)).toEqual(['ok'])
  })

  it('url：空串与两侧空白原样写入（不 trim），且 tab 一律拉回解析页', async () => {
    const store = stubChrome({ session: { 'panda.draft.url.tab': 'codec' } })

    await expect(prepareToolHandoff('url', '')).resolves.toEqual({ ok: true })
    expect(store.session['panda.draft.url.parse.input']).toBe('')
    expect(store.session['panda.draft.url.tab']).toBe('parse')

    await prepareToolHandoff('url', '  https://example.com  ')
    expect(store.session['panda.draft.url.parse.input']).toBe('  https://example.com  ')
  })

  it('detect：空输入也写入，且不会误写 url / json 的草稿', async () => {
    const store = stubChrome()

    await expect(prepareToolHandoff('detect', '')).resolves.toEqual({ ok: true })
    expect(store.session['panda.draft.detect.input']).toBe('')
    expect(store.session['panda.draft.activeToolTab']).toBe('detect')
    expect(store.session['panda.draft.url.parse.input']).toBeUndefined()
    expect(store.session['panda.draft.url.tab']).toBeUndefined()
    expect(store.session[`panda.draft.${JSON_DRAFT_KEY}`]).toBeUndefined()
  })

  it('三种受支持的工具都会把 activeToolTab 指向自己', async () => {
    const store = stubChrome()
    for (const tool of ['detect', 'json', 'url'] as const) {
      await prepareToolHandoff(tool, 'x')
      expect(store.session['panda.draft.activeToolTab'], tool).toBe(tool)
    }
  })

  it('url 幂等：同一个输入连续 handoff 两次，会话状态完全一致', async () => {
    const store = stubChrome()
    await prepareToolHandoff('url', 'https://a.test')
    const first = JSON.stringify(store.session)

    await prepareToolHandoff('url', 'https://a.test')
    expect(JSON.stringify(store.session)).toBe(first)
  })

  it('自动启用是幂等的：第二次 handoff 不再重复写 settings，但草稿照常更新', async () => {
    const syncWriteLog: string[] = []
    const store = stubChrome(
      { sync: { settings: { toolEnabled: { detect: false, json: true, url: true } } } },
      { syncWriteLog },
    )

    await prepareToolHandoff('detect', 'v1')
    expect(syncWriteLog).toHaveLength(1)
    expect(
      (store.sync.settings as { toolEnabled: Record<string, boolean> }).toolEnabled.detect,
    ).toBe(true)

    await prepareToolHandoff('detect', 'v2')
    // 第二次已经是启用状态，不能再写一遍（sync 有写入频率配额）
    expect(syncWriteLog).toHaveLength(1)
    expect(store.session['panda.draft.detect.input']).toBe('v2')
    expect(store.session['panda.draft.activeToolTab']).toBe('detect')
  })

  it('url 被禁用时先自动启用，再把草稿、tab 与激活项写全', async () => {
    const syncWriteLog: string[] = []
    const store = stubChrome(
      { sync: { settings: { toolEnabled: { url: false } } } },
      { syncWriteLog },
    )

    await expect(prepareToolHandoff('url', 'https://x.test')).resolves.toEqual({ ok: true })
    expect(syncWriteLog).toHaveLength(1)
    expect((store.sync.settings as { toolEnabled: Record<string, boolean> }).toolEnabled.url).toBe(
      true,
    )
    expect(store.session['panda.draft.url.parse.input']).toBe('https://x.test')
    expect(store.session['panda.draft.url.tab']).toBe('parse')
    expect(store.session['panda.draft.activeToolTab']).toBe('url')
  })

  it('设置里没有 toolEnabled（或根本没有 settings）时不产生 sync 写入', async () => {
    const withSettingsLog: string[] = []
    const store = stubChrome(
      { sync: { settings: { theme: 'dark' } } },
      {
        syncWriteLog: withSettingsLog,
      },
    )
    await prepareToolHandoff('json', '{}')
    expect(withSettingsLog).toEqual([])
    expect(store.sync.settings).toEqual({ theme: 'dark' })

    const emptyLog: string[] = []
    stubChrome({}, { syncWriteLog: emptyLog })
    await prepareToolHandoff('detect', 'x')
    expect(emptyLog).toEqual([])
  })

  it('工具已启用或未登记在 toolEnabled 里时都不写 settings', async () => {
    const syncWriteLog: string[] = []
    stubChrome({ sync: { settings: { toolEnabled: { json: true } } } }, { syncWriteLog })

    await prepareToolHandoff('json', '{}')
    // detect 未登记：不能等同于「被禁用」，否则每次 handoff 都会多写一次 sync
    await prepareToolHandoff('detect', 'x')
    expect(syncWriteLog).toEqual([])
  })

  it('读取 settings 失败时降级继续：草稿照写、返回成功、且不会盲目写回设置', async () => {
    const syncWriteLog: string[] = []
    const store = stubChrome({}, { failSyncGet: true, syncWriteLog })

    await expect(prepareToolHandoff('url', 'https://x.test')).resolves.toEqual({ ok: true })
    expect(store.session['panda.draft.url.parse.input']).toBe('https://x.test')
    expect(syncWriteLog).toEqual([])
  })

  it('json 历史草稿残缺时用默认值补齐缺失字段，同时保留存量偏好', async () => {
    // 少写 splitRatio，模拟旧版本/被裁剪过的草稿
    const partial = {
      input: '',
      output: '',
      indent: 8,
      sortKeys: true,
      minify: false,
      lastAction: null,
    }
    await setDraftValue(JSON_DRAFT_KEY, partial)
    const store = stubChrome()

    await prepareToolHandoff('json', '{"a":1}')

    const draft = store.session[`panda.draft.${JSON_DRAFT_KEY}`] as Record<string, unknown>
    // 回归：先铺 DEFAULT_JSON_DRAFT 再铺存量，缺失字段被补齐（不会再写出结构不完整的对象）
    expect(Object.keys(draft).sort()).toEqual(Object.keys(DEFAULT_JSON_DRAFT).sort())
    expect(draft.splitRatio).toBe(DEFAULT_JSON_DRAFT.splitRatio)
    expect(draft).toMatchObject({
      indent: 8,
      sortKeys: true,
      input: '{"a":1}',
      // 存量偏好（indent 8 + 排序）被用于自动格式化
      output: '{\n        "a": 1\n}',
      lastAction: 'format',
    })
  })

  it('json 历史草稿里的 splitRatio 等偏好被完整保留', async () => {
    const seed = { ...DEFAULT_JSON_DRAFT, splitRatio: 70, output: '上次结果', lastAction: 'minify' }
    await setDraftValue(JSON_DRAFT_KEY, seed)
    const store = stubChrome()

    await prepareToolHandoff('json', '{"b":2}')

    expect(store.session[`panda.draft.${JSON_DRAFT_KEY}`]).toEqual({
      ...DEFAULT_JSON_DRAFT,
      splitRatio: 70,
      input: '{"b":2}',
      // 存量 splitRatio=70 保留；输出按同一份偏好（indent 2、非单行）自动算好
      output: '{\n  "b": 2\n}',
      lastAction: 'format',
    })
  })

  it('内存缓存与存储都没有 json 草稿时，用 DEFAULT_JSON_DRAFT 兜底成完整对象', async () => {
    // draft.ts 的 memoryCache 是模块级常驻的，本文件前面的用例已经写过 JSON 草稿；
    // 只有拿到全新模块实例才能验证「首次使用」这条分支，且不依赖用例执行顺序。
    vi.resetModules()
    const fresh = await import('./handoff')
    const store = stubChrome()

    await expect(fresh.prepareToolHandoff('json', '{"c":3}')).resolves.toEqual({ ok: true })
    expect(store.session[`panda.draft.${JSON_DRAFT_KEY}`]).toEqual({
      ...DEFAULT_JSON_DRAFT,
      input: '{"c":3}',
      output: '{\n  "c": 3\n}',
      lastAction: 'format',
    })
  })
})
