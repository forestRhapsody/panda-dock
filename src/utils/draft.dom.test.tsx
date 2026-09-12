// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setDraftValue, useToolDraft } from './draft'

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
    store[`toolkit.draft.${key}`] = '新值'

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
    expect(store[`toolkit.draft.${key}`]).toBe('新值')
  })

  it('落盘还没完成时重挂载：存储里的旧值不会覆盖内存里的新值', async () => {
    const key = 'debounce.pending'
    // 初始状态：会话存储里是旧值
    store[`toolkit.draft.${key}`] = '旧值'

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
