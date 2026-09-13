// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getDraftValue,
  getScopedDraftKey,
  setDraftValue,
  TabScopeContext,
  useToolDraft,
} from './draft'

/**
 * T134 手递手的关键保证：从外部（智能解析的「在 XX 工具中打开」）写入的草稿，
 * 目标工具必须真的能读到——**包括同一会话内先前已经用过该工具**的情况，
 * 此时 draft.ts 的模块级 memoryCache 里还留着旧值。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let store: Record<string, unknown>
let listeners: ChangeListener[]

/** 内存版 chrome.storage 桩：写入时派发 onChanged，用于验证实时同步 */
function stubChrome() {
  store = {}
  listeners = []
  const area = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      Object.assign(store, obj)
      for (const listener of listeners) listener(changes, 'session')
    },
    remove: async (key: string) => {
      delete store[key]
    },
  }
  globalWithChrome.chrome = {
    storage: {
      session: area,
      sync: area,
      local: area,
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

function Probe({ draftKey }: { draftKey: string }) {
  const [value] = useToolDraft<string>(draftKey, '(empty)')
  return <span data-testid='value'>{value}</span>
}

/** 可写草稿的探针：点击按钮写入指定值，用于验证防抖窗口内的卸载 / 重挂载行为 */
function EditableProbe({ draftKey, next }: { draftKey: string; next: string }) {
  const [value, setValue] = useToolDraft<string>(draftKey, '(empty)')
  return (
    <button type='button' data-testid='setValue' onClick={() => setValue(next)}>
      {value}
    </button>
  )
}

let container: HTMLDivElement
let root: Root

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const text = () => container.textContent

function clickSetValue() {
  act(() => {
    container.querySelector<HTMLButtonElement>('[data-testid="setValue"]')?.click()
  })
}

beforeEach(() => {
  stubChrome()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
})

describe('外部写入草稿（T134 手递手）', () => {
  it('已挂载的工具能实时收到外部写入的值', async () => {
    await act(async () => {
      root.render(<Probe draftKey='handoff.live' />)
    })
    expect(text()).toBe('(empty)')

    await act(async () => {
      await setDraftValue('handoff.live', '来自智能解析')
    })
    expect(text()).toBe('来自智能解析')
  })

  it('同一会话内先前用过该工具时，仍能读到外部写入的新值（不被内存缓存遮蔽）', async () => {
    const key = 'handoff.stale'

    // 模拟「用户之前用过这个工具」：内存缓存留下旧值
    await act(async () => {
      root.render(<Probe draftKey={key} />)
    })
    await act(async () => {
      await setDraftValue(key, '旧值')
    })
    expect(text()).toBe('旧值')

    // 卸载（切 Tab / 关抽屉），缓存里仍是旧值
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    // 只写会话存储、不碰缓存——模拟任何绕过 setDraftValue 的写入路径
    store[`panda.draft.${key}`] = '新值'

    await act(async () => {
      root.render(<Probe draftKey={key} />)
    })
    await flush()

    // 挂载后必须收敛到存储里的新值，而不是停在缓存旧值
    expect(text()).toBe('新值')
  })

  it('写入同时更新内存缓存：重挂载的首帧即为新值，不闪旧值', async () => {
    const key = 'handoff.nostale'

    await act(async () => {
      root.render(<Probe draftKey={key} />)
    })
    await act(async () => {
      await setDraftValue(key, '旧值')
    })
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)

    await act(async () => {
      await setDraftValue(key, '新值')
    })
    await act(async () => {
      root.render(<Probe draftKey={key} />)
    })

    // 不 flush，直接看首帧
    expect(text()).toBe('新值')
  })
})

describe('防抖写入 × 卸载 / 重挂载（切走工具的场景）', () => {
  it('防抖窗口内卸载：改动会立即落盘，不只留在内存缓存里', async () => {
    const key = 'debounce.flush'
    await act(async () => {
      root.render(<EditableProbe draftKey={key} next='新值' />)
    })
    clickSetValue()
    expect(text()).toBe('新值')

    // 200ms 防抖还没到就切走工具（卸载）
    await act(async () => {
      root.unmount()
    })

    // 清理里必须补写这次改动：否则会话存储仍是旧值，其它页面与下次挂载都读不到
    expect(store[`panda.draft.${key}`]).toBe('新值')
  })

  it('落盘还没完成时重挂载：存储里的旧值不会覆盖内存里的新值', async () => {
    const key = 'debounce.pending'
    // 初始状态：会话存储里是旧值
    store[`panda.draft.${key}`] = '旧值'

    // 让写入挂起，模拟「flush 已发出但还没写完」
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const chromeStub = globalWithChrome.chrome as {
      storage: { session: { set: (obj: Record<string, unknown>) => Promise<void> } }
    }
    const realSet = chromeStub.storage.session.set
    chromeStub.storage.session.set = async (obj) => {
      await gate
      await realSet(obj)
    }

    await act(async () => {
      root.render(<EditableProbe draftKey={key} next='新值' />)
    })
    clickSetValue()

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await act(async () => {
      root.render(<Probe draftKey={key} />)
    })
    await flush()

    // 存储仍是旧值（写入还挂着），但内存里的新值必须赢
    expect(text()).toBe('新值')

    release?.()
    await flush()
  })
})

describe('标签页作用域隔离（TabScopeContext）', () => {
  it('getScopedDraftKey 正确拼接或回退无前缀 key', () => {
    expect(getScopedDraftKey('test', 101)).toBe('panda.draft.t101.test')
    expect(getScopedDraftKey('test', null)).toBe('panda.draft.test')
    expect(getScopedDraftKey('test', undefined)).toBe('panda.draft.test')
    expect(getScopedDraftKey('test', 0)).toBe('panda.draft.test')
    expect(getScopedDraftKey('test', -1)).toBe('panda.draft.test')
  })

  it('不同 tabId 的探针草稿互相隔离，互不干扰', async () => {
    function MultiTabHarness() {
      return (
        <div>
          <TabScopeContext.Provider value={101}>
            <div data-testid='tab-101'>
              <EditableProbe draftKey='doc' next='标签页101专属内容' />
            </div>
          </TabScopeContext.Provider>
          <TabScopeContext.Provider value={102}>
            <div data-testid='tab-102'>
              <Probe draftKey='doc' />
            </div>
          </TabScopeContext.Provider>
        </div>
      )
    }

    await act(async () => {
      root.render(<MultiTabHarness />)
    })

    const tab101Btn = container.querySelector('[data-testid="tab-101"] button') as HTMLButtonElement
    const tab102Text = () =>
      container.querySelector('[data-testid="tab-102"] [data-testid="value"]')?.textContent

    expect(tab101Btn.textContent).toBe('(empty)')
    expect(tab102Text()).toBe('(empty)')

    // 标签页 101 点击改值
    act(() => tab101Btn.click())
    expect(tab101Btn.textContent).toBe('标签页101专属内容')
    // 标签页 102 保持独立，完全不受影响
    expect(tab102Text()).toBe('(empty)')

    // 等防抖 200ms 落盘
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)))

    // 验证存储里写入的是带前缀的 t101
    expect(store['panda.draft.t101.doc']).toBe('标签页101专属内容')
    expect(store['panda.draft.t102.doc']).toBeUndefined()
    expect(tab102Text()).toBe('(empty)')
  })

  it('同 tabId 的组件（抽屉与侧边栏）实时共享草稿', async () => {
    function SameTabHarness() {
      return (
        <TabScopeContext.Provider value={201}>
          <div data-testid='drawer'>
            <EditableProbe draftKey='shared' next='抽屉写入' />
          </div>
          <div data-testid='sidepanel'>
            <Probe draftKey='shared' />
          </div>
        </TabScopeContext.Provider>
      )
    }

    await act(async () => {
      root.render(<SameTabHarness />)
    })

    const drawerBtn = container.querySelector('[data-testid="drawer"] button') as HTMLButtonElement
    const sidepanelText = () =>
      container.querySelector('[data-testid="sidepanel"] [data-testid="value"]')?.textContent

    expect(sidepanelText()).toBe('(empty)')

    act(() => drawerBtn.click())
    // 200ms 防抖落盘并触发同 session 区域通知
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)))

    expect(sidepanelText()).toBe('抽屉写入')
  })

  it('getDraftValue 与 setDraftValue 携带 tabId 定向存取', async () => {
    await setDraftValue('testKey', 'hello-t301', 301)
    expect(store['panda.draft.t301.testKey']).toBe('hello-t301')
    const val = await getDraftValue('testKey', 301)
    expect(val).toBe('hello-t301')

    const otherVal = await getDraftValue('testKey', 302)
    expect(otherVal).toBeNull()
  })

  it('全局工作区（null）与标签页专属工作区（tabId）互相隔离不串扰', async () => {
    function MixedHarness() {
      return (
        <div>
          {/* 原生侧边栏使用的全局工作区 */}
          <TabScopeContext.Provider value={null}>
            <div data-testid='global-sidepanel'>
              <EditableProbe draftKey='note' next='全局侧栏备忘' />
            </div>
          </TabScopeContext.Provider>
          {/* 某网页抽屉使用的标签页沙箱 */}
          <TabScopeContext.Provider value={303}>
            <div data-testid='tab-drawer'>
              <Probe draftKey='note' />
            </div>
          </TabScopeContext.Provider>
        </div>
      )
    }

    await act(async () => {
      root.render(<MixedHarness />)
    })

    const globalBtn = container.querySelector(
      '[data-testid="global-sidepanel"] button',
    ) as HTMLButtonElement
    const tabDrawerText = () =>
      container.querySelector('[data-testid="tab-drawer"] [data-testid="value"]')?.textContent

    expect(globalBtn.textContent).toBe('(empty)')
    expect(tabDrawerText()).toBe('(empty)')

    // 全局侧栏写入
    act(() => globalBtn.click())
    expect(globalBtn.textContent).toBe('全局侧栏备忘')
    // 网页抽屉不受影响
    expect(tabDrawerText()).toBe('(empty)')

    // 200ms 防抖落盘
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)))

    // 全局写入 panda.draft.note，标签页无此键
    expect(store['panda.draft.note']).toBe('全局侧栏备忘')
    expect(store['panda.draft.t303.note']).toBeUndefined()
  })
})
