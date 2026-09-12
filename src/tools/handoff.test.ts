import { afterEach, describe, expect, it } from 'vitest'

import { setDraftValue } from '@/utils/draft'

import { prepareToolHandoff, toolForDetectKind } from './handoff'
import { DEFAULT_JSON_DRAFT, JSON_DRAFT_KEY } from './JsonTool'

/**
 * T134 的手递手契约。
 * 这里刻意用一个内存版 chrome.storage 桩：既能断言「写了什么 key」，也能断言
 * 「工具被禁用时是否自动启用」——这两点出错都会让入口点了没反应或跳到别的 Tab。
 */
type Store = Record<string, Record<string, unknown>>

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

function stubChrome(initial: Store = {}) {
  const store: Store = { session: {}, sync: {}, local: {}, ...initial }

  const area = (name: string) => ({
    get: async (key: string) => (key in store[name] ? { [key]: store[name][key] } : {}),
    set: async (obj: Record<string, unknown>) => {
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
})

describe('prepareToolHandoff', () => {
  it('url：写入解析输入、把 Tab 拉回解析页、并激活网址工具', async () => {
    const store = stubChrome()
    await prepareToolHandoff('url', 'https://example.com/a?b=1')

    expect(store.session['toolkit.draft.url.parse.input']).toBe('https://example.com/a?b=1')
    expect(store.session['toolkit.draft.url.tab']).toBe('parse')
    expect(store.session['toolkit.draft.activeToolTab']).toBe('url')
  })

  it('json：写进对象草稿，保留用户已有的缩进/排序偏好并清空上次输出', async () => {
    const store = stubChrome({
      session: {
        [`toolkit.draft.${JSON_DRAFT_KEY}`]: {
          ...DEFAULT_JSON_DRAFT,
          indent: 4,
          sortKeys: true,
          output: '上次的输出',
          lastAction: 'format',
        },
      },
    })

    await prepareToolHandoff('json', '{"a":1}')

    expect(store.session[`toolkit.draft.${JSON_DRAFT_KEY}`]).toEqual({
      ...DEFAULT_JSON_DRAFT,
      indent: 4,
      sortKeys: true,
      input: '{"a":1}',
      output: '',
      lastAction: null,
    })
    expect(store.session['toolkit.draft.activeToolTab']).toBe('json')
  })

  it('无论有无历史草稿，写出的 JSON 草稿字段始终完整（不写出残缺对象）', async () => {
    const store = stubChrome()
    // draft.ts 的 memoryCache 是模块级常驻的（这是它的设计目的），
    // 故显式写入一份默认值来模拟「没有可保留的用户偏好」，避免依赖用例执行顺序
    await setDraftValue(JSON_DRAFT_KEY, DEFAULT_JSON_DRAFT)

    await prepareToolHandoff('json', '{"b":2}')

    const draft = store.session[`toolkit.draft.${JSON_DRAFT_KEY}`] as Record<string, unknown>
    expect(Object.keys(draft).sort()).toEqual(Object.keys(DEFAULT_JSON_DRAFT).sort())
    expect(draft.input).toBe('{"b":2}')
    expect(draft.output).toBe('')
  })

  it('detect：划选面板的「在侧边栏中打开」仍能把文本带回检测工具（防回归）', async () => {
    const store = stubChrome()
    await prepareToolHandoff('detect', 'SGVsbG8=')

    expect(store.session['toolkit.draft.detect.input']).toBe('SGVsbG8=')
    expect(store.session['toolkit.draft.activeToolTab']).toBe('detect')
  })

  it('目标工具被禁用时自动启用，否则切过去会落到别的 Tab', async () => {
    const store = stubChrome({
      sync: {
        settings: { toolEnabled: { json: false, url: true }, theme: 'dark' },
      },
    })

    await prepareToolHandoff('json', '{}')
    expect(store.sync.settings).toEqual({
      toolEnabled: { json: true, url: true },
      theme: 'dark',
    })

    const before = JSON.stringify(store.sync.settings)
    await prepareToolHandoff('url', '[1]')
    expect(JSON.stringify(store.sync.settings)).toBe(before)
  })

  it('没有映射的工具不做任何写入', async () => {
    const store = stubChrome()
    await prepareToolHandoff('hash', 'abc')
    expect(store.session).toEqual({})
  })
})
