// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { setDraftValue } from '@/utils/draft'

import { DEFAULT_TOOLS } from './registry'
import type { ToolId } from './registry'
import ToolsApp from './ToolsApp'

/**
 * ToolsApp 是「工具箱页 + 工具组件映射」的唯一来源（AGENTS §3）：
 * 这里只验证它的接线——映射完备性、选项卡顺序/显隐、默认激活项、切换、storage 实时同步与 i18n 取词。
 * 各工具的内部行为由 tools/*.test.tsx 自己覆盖，因此把工具组件替换成带 id 的探针，
 * 避免重型工具（二维码/存储/JSON…）在接线测试里做无关的真实渲染。
 */

// 哈希工具探针支持「按需抛错」，用于验证宿主确实用 key 重建了错误边界
const probeState = vi.hoisted(() => ({ hashShouldThrow: false }))

vi.mock('./Base64Tool', () => ({ default: () => <span data-probe='base64'>base64</span> }))
vi.mock('./DetectTool', () => ({ default: () => <span data-probe='detect'>detect</span> }))
vi.mock('./JsonTool', () => ({ default: () => <span data-probe='json'>json</span> }))
vi.mock('./JwtTool', () => ({ default: () => <span data-probe='jwt'>jwt</span> }))
vi.mock('./QrCodeTool', () => ({ default: () => <span data-probe='qrcode'>qrcode</span> }))
vi.mock('./StorageTool', () => ({ default: () => <span data-probe='storage'>storage</span> }))
vi.mock('./TimestampTool', () => ({ default: () => <span data-probe='timestamp'>timestamp</span> }))
vi.mock('./UrlTool', () => ({ default: () => <span data-probe='url'>url</span> }))
vi.mock('./HashTool', () => ({
  default: () => {
    if (probeState.hashShouldThrow) throw new Error('hash probe boom')
    return <span data-probe='hash'>hash</span>
  },
}))

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

type AreaName = 'sync' | 'session' | 'local'

let stores: Record<AreaName, Record<string, unknown>>
let listeners: ChangeListener[]

/** 内存版 chrome：sync/session 均可用，写入时派发 onChanged（ToolsApp 靠它实时同步配置） */
function stubChrome() {
  stores = { sync: {}, session: {}, local: {} }
  listeners = []
  const makeArea = (name: AreaName) => ({
    get: async (key: string) =>
      key in stores[name] ? { [key]: stores[name][key] } : ({} as Record<string, unknown>),
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      Object.assign(stores[name], obj)
      for (const listener of [...listeners]) listener(changes, name)
    },
    remove: async (key: string) => {
      delete stores[name][key]
    },
  })
  globalWithChrome.chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async () => true,
    },
    storage: {
      sync: makeArea('sync'),
      session: makeArea('session'),
      local: makeArea('local'),
      onChanged: {
        addListener: (listener: ChangeListener) => listeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          listeners = listeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

const ALL_IDS = DEFAULT_TOOLS.map((tool) => tool.id)

/** 全量 enabled（默认全开），用于构造「把 jwt/hash 也打开」等用户配置 */
function enabledMap(overrides: Partial<Record<ToolId, boolean>> = {}): Record<string, boolean> {
  return Object.fromEntries(ALL_IDS.map((id) => [id, overrides[id] ?? true]))
}

function layout(order: ToolId[] = ALL_IDS, overrides: Partial<Record<ToolId, boolean>> = {}) {
  return { toolOrder: order, toolEnabled: enabledMap(overrides) }
}

function emitSettings(settings: unknown, area: string = 'sync') {
  act(() => {
    for (const listener of [...listeners]) listener({ settings: { newValue: settings } }, area)
  })
}

let container: HTMLDivElement
let root: Root
const originalConsoleError = console.error

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

async function render() {
  await act(async () => {
    root.render(<ToolsApp />)
  })
  await flush()
}

function tabIds(): (string | null)[] {
  return [...container.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tool'))
}

function activeTab(): string | null {
  return (
    container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-tool') ?? null
  )
}

function probes(): (string | null)[] {
  return [...container.querySelectorAll('[data-probe]')].map((el) => el.getAttribute('data-probe'))
}

function clickTab(id: ToolId) {
  act(() => {
    container.querySelector<HTMLButtonElement>(`[role="tab"][data-tool="${id}"]`)?.click()
  })
}

/** happy-dom 没有排版：伪造只含水平几何的 DOMRect，用来验证「激活项滚到容器中心」的算法 */
function hRect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 0,
    height: 0,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
}

beforeEach(async () => {
  // 工具抛错时 React 与 ToolErrorBoundary 都会打印错误，测试期间静音
  console.error = () => {}
  probeState.hashShouldThrow = false
  stubChrome()
  // draft.ts 的内存缓存是模块级常驻的：重置激活项，避免上一个用例点击过的 Tab 泄漏到下一个用例
  await setDraftValue<ToolId | null>('activeToolTab', null)
  await i18n.changeLanguage('zh')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  console.error = originalConsoleError
  await i18n.changeLanguage('zh')
})

describe('ToolsApp：TOOL_COMPONENTS 映射完备性', () => {
  it('DEFAULT_TOOLS 中每个 ToolId 都能映射到对应组件并渲染出非空内容', async () => {
    // 一次挂载逐个验证：每次只让一个工具可见，断言 main 里渲染的正是它自己的探针
    for (const id of ALL_IDS) {
      stores.sync.settings = layout(
        ALL_IDS,
        enabledMap(Object.fromEntries(ALL_IDS.map((x) => [x, x === id]))),
      )
      await act(async () => {
        root.render(<ToolsApp key={id} />)
      })
      await flush()

      const probe = container.querySelector(`[data-probe="${id}"]`)
      expect(probe, `ToolId=${id} 未映射到组件`).not.toBeNull()
      // 断言渲染出的是「非空内容」而不是空壳
      expect(probe?.textContent).toBe(id)
      expect(probes()).toEqual([id])
      expect(container.querySelector('main.tw__body')?.className).toContain(`tw__body--${id}`)
    }
  })

  it('默认配置下选项卡包含全部 9 个已注册工具', async () => {
    await render()
    expect(tabIds()).toEqual(ALL_IDS)
  })
})

describe('ToolsApp：选项卡顺序与激活项由用户配置决定', () => {
  it('选项卡严格按 visibleTools(layout) 顺序渲染，尊重用户自定义顺序', async () => {
    const custom: ToolId[] = [
      'timestamp',
      'json',
      'detect',
      'storage',
      'base64',
      'url',
      'qrcode',
      'jwt',
      'hash',
    ]
    stores.sync.settings = layout(custom, {})
    await render()

    expect(tabIds()).toEqual(custom)
    // 默认激活项 = 用户排序后的第一个可见工具，而不是任何写死的 id
    expect(activeTab()).toBe('timestamp')
    expect(probes()).toEqual(['timestamp'])
  })

  it('默认激活项是第一个可见工具：隐藏 detect 后自动顺延到 storage', async () => {
    stores.sync.settings = layout(ALL_IDS, { detect: false })
    await render()

    expect(tabIds()[0]).toBe('storage')
    expect(activeTab()).toBe('storage')
    expect(probes()).toEqual(['storage'])
  })

  it('把默认隐藏的 jwt/hash 打开并排到最前时，激活项随之变化（不写死 base64/detect）', async () => {
    stores.sync.settings = layout(
      ['jwt', 'hash', 'detect', 'storage', 'base64', 'json', 'url', 'timestamp', 'qrcode'],
      {},
    )
    await render()

    expect(tabIds()).toContain('jwt')
    expect(tabIds()).toContain('hash')
    expect(activeTab()).toBe('jwt')
    expect(probes()).toEqual(['jwt'])
  })

  it('被隐藏的工具不出现在选项卡里，其余工具保持相对顺序', async () => {
    stores.sync.settings = layout(ALL_IDS, { url: false, json: false })
    await render()

    expect(tabIds()).toEqual(['detect', 'storage', 'qrcode', 'jwt', 'base64', 'timestamp', 'hash'])
    expect(tabIds()).not.toContain('url')
    expect(tabIds()).not.toContain('json')
  })

  it('全部工具都隐藏时没有选项卡，main 仍渲染兜底工具（源码 active 回退 detect）', async () => {
    stores.sync.settings = layout(
      ALL_IDS,
      enabledMap(Object.fromEntries(ALL_IDS.map((x) => [x, false]))),
    )
    await render()

    expect(tabIds()).toEqual([])
    expect(activeTab()).toBeNull()
    // 源码：tools[0]?.id ?? 'detect' —— 无可选项时回退 detect，不白屏
    expect(probes()).toEqual(['detect'])
  })
})

describe('ToolsApp：点击选项卡切换工具', () => {
  it('点击选项卡后渲染对应组件并更新 aria-selected', async () => {
    await render()
    expect(activeTab()).toBe('detect')

    clickTab('json')
    expect(activeTab()).toBe('json')
    expect(probes()).toEqual(['json'])

    clickTab('qrcode')
    expect(activeTab()).toBe('qrcode')
    expect(probes()).toEqual(['qrcode'])
  })

  it('ToolErrorBoundary 以 key=激活工具 挂载：切走再切回会重建边界、清空错误状态', async () => {
    stores.sync.settings = layout(ALL_IDS, { hash: true })
    await render()

    // 让 hash 探针渲染抛错：错误边界降级，Tab 本身不丢失
    probeState.hashShouldThrow = true
    clickTab('hash')
    expect(container.querySelector('.tw-error')).not.toBeNull()
    expect(activeTab()).toBe('hash')

    // 修好探针后切到 detect：宿主换了 key，detect 是全新边界、正常渲染。
    // 若宿主没传 key，旧边界会一直停留在错误态，这里仍会看到 .tw-error。
    probeState.hashShouldThrow = false
    clickTab('detect')
    expect(probes()).toEqual(['detect'])
    expect(container.querySelector('.tw-error')).toBeNull()

    // 再切回 hash：同样是新边界，正常渲染
    clickTab('hash')
    expect(probes()).toEqual(['hash'])
    expect(container.querySelector('.tw-error')).toBeNull()
  })

  it('切换工具时把激活选项卡滚到容器中心（tab 条溢出时靠它保证激活项可见）', async () => {
    stores.sync.settings = layout(ALL_IDS, { hash: true })
    await render()

    const nav = container.querySelector<HTMLElement>('.tw-nav')
    const target = container.querySelector<HTMLElement>('[role="tab"][data-tool="hash"]')
    if (!nav || !target) throw new Error('未找到选项卡条或目标选项卡')

    const scrollBy = vi.fn()
    nav.scrollBy = scrollBy as unknown as typeof nav.scrollBy
    // 桩出「容器宽 200（中心 100）、目标按钮中心 400」→ 期望滚动 300（浏览器会自行夹在 [0, maxScroll]）
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(hRect(0, 200))
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(hRect(380, 40))

    clickTab('hash')

    expect(scrollBy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' })
  })
})

describe('ToolsApp：chrome.storage.onChanged 实时同步', () => {
  it('推送新的 toolOrder/toolEnabled 后选项卡与激活项即时更新', async () => {
    await render()
    expect(tabIds()[0]).toBe('detect')

    emitSettings(
      layout(['json', 'base64', 'detect', 'storage', 'url', 'timestamp', 'qrcode'], {
        jwt: false,
        hash: false,
      }),
    )

    expect(tabIds()).toEqual(['json', 'base64', 'detect', 'storage', 'url', 'timestamp', 'qrcode'])
    expect(activeTab()).toBe('json')
    expect(probes()).toEqual(['json'])
  })

  it('只响应 sync 区域的 settings 变更，其它区域推送被忽略', async () => {
    await render()

    emitSettings(layout(['json', 'detect']), 'local')
    expect(tabIds()[0]).toBe('detect')

    emitSettings(layout(['json', 'detect']))
    expect(tabIds()[0]).toBe('json')
  })

  it('卸载后移除 onChanged 监听', async () => {
    await render()
    expect(listeners.length).toBeGreaterThan(0)

    act(() => root.unmount())
    expect(listeners).toHaveLength(0)
    // 重新建 root，交给 afterEach 统一卸载
    root = createRoot(container)
  })
})

describe('ToolsApp：选项卡文案走 i18n', () => {
  it('标签文本等于 t(`tool.registry.${id}`)，且界面上不出现裸 key', async () => {
    stores.sync.settings = layout(ALL_IDS, { jwt: true, hash: true })
    await render()

    for (const tab of container.querySelectorAll('[role="tab"]')) {
      const id = tab.getAttribute('data-tool') as ToolId
      expect(tab.textContent).toBe(i18n.t(`tool.registry.${id}`))
    }
    expect(container.textContent).not.toContain('tool.registry.')
  })
})
