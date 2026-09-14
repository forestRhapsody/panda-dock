// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { toast } from '@/ui/toast'
import { setDraftValue } from '@/utils/draft'

import DetectTool from './DetectTool'
import { prepareToolHandoff } from './handoff'

/**
 * 智能解析工具：粘贴/点示例 → 真实 detect.ts 判定类型 → 结果视图（字段、长文本块、多结果 Tab）→
 * 「在 XX 工具中打开」的 handoff 接线。这里用真实 detect.ts（已有 detect.test.ts 覆盖纯逻辑），
 * 只 mock 外部的 handoff（会写存储、切 Tab）与 toast，验证组件把什么参数交给了它们。
 */

vi.mock('@/tools/handoff', async (importOriginal) => {
  // 保留 toolForDetectKind（DetectResultView 依赖它决定是否渲染跳转入口），只替换有副作用的手递手
  const actual = await importOriginal<typeof import('@/tools/handoff')>()
  return { ...actual, prepareToolHandoff: vi.fn(async () => ({ ok: true })) }
})

// React 19 的 act 需要该标记
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let listeners: ChangeListener[]

function stubChrome() {
  const store: Record<string, unknown> = {}
  listeners = []
  const area = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(store, obj)
    },
    remove: async (key: string) => {
      delete store[key]
    },
  }
  globalWithChrome.chrome = {
    runtime: { id: 'test-extension' },
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

let container: HTMLDivElement
let root: Root

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function detectInput(): HTMLTextAreaElement {
  const el = container.querySelector<HTMLTextAreaElement>('.tw-area-input')
  if (!el) throw new Error('未找到智能解析输入框')
  return el
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (el) => el.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`未找到按钮：${text}`)
  return btn
}

function chip(label: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('.tw-detect__format-chip')].find(
    (el) => el.textContent?.trim() === label,
  )
  if (!btn) throw new Error(`未找到示例按钮：${label}`)
  return btn
}

function resultFieldValues(): string[] {
  return [...container.querySelectorAll('.tw-detect__field-value')].map(
    (el) => el.textContent ?? '',
  )
}

async function renderTool() {
  await act(async () => {
    root.render(<DetectTool />)
  })
}

/** 放行一轮宏任务：input → useDeferredValue 的低优先级渲染需要它才会落到 DOM */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function type(text: string) {
  await act(async () => setTextareaValue(detectInput(), text))
  await flush()
}

async function clickChip(label: string) {
  await act(async () => chip(label).click())
  await flush()
}

beforeEach(async () => {
  stubChrome()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.mocked(prepareToolHandoff).mockResolvedValue({ ok: true })
  // 草稿的模块级 memoryCache 常驻，先把输入归零
  await setDraftValue('detect.input', '')
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

afterAll(async () => {
  // 语言是全局 i18next 实例上的状态，跑完必须还原成默认中文
  await i18n.changeLanguage('zh')
})

describe('DetectTool 各类型结果视图', () => {
  it('JSON：渲染「解析为：JSON」与解析结果块', async () => {
    await renderTool()
    await type('{"name":"Panda Dock","active":true}')

    expect(container.textContent).toContain('解析为：JSON')
    expect(container.textContent).toContain('Panda Dock')
    expect(container.textContent).toContain('解析结果')
    expect(container.querySelector('.tw-detect__head')).not.toBeNull()
  })

  it('Base64 示例：解码为文本并展示「解码结果」块', async () => {
    await renderTool()
    await clickChip('Base64')

    expect(container.textContent).toContain('解析为：Base64')
    expect(container.textContent).toContain('你好，世界!')
    expect(container.textContent).toContain('解码结果')
  })

  it('Hex 示例：解码为 ASCII 并展示字节数', async () => {
    await renderTool()
    await clickChip('Hex')

    expect(container.textContent).toContain('解析为：Hex')
    expect(container.textContent).toContain('Hello, World!')
    expect(container.textContent).toContain('字节数')
  })

  it('UUID 示例：展示有效性 ✓ 与版本号 v4', async () => {
    await renderTool()
    await clickChip('UUID')

    expect(container.textContent).toContain('解析为：UUID')
    expect(container.textContent).toContain('有效')
    expect(container.textContent).toContain('v4')
  })

  it('时间戳示例：渲染 Unix 秒等字段', async () => {
    await renderTool()
    await clickChip('时间戳')

    expect(container.textContent).toContain('解析为：时间戳')
    expect(container.textContent).toContain('Unix 秒')
    expect(container.textContent).toContain('1710000000')
  })

  it('JWT 示例：渲染算法字段与 header/payload/签名块', async () => {
    await renderTool()
    await clickChip('JWT')

    expect(container.textContent).toContain('解析为：JWT')
    expect(container.textContent).toContain('HS256')
    expect(container.textContent).toContain('头部 (Header)')
    expect(container.textContent).toContain('载荷 (Payload)')
    expect(container.textContent).toContain('签名 (Signature)')
  })

  it('提取网址示例：识别出 3 项，切换结果 Tab 会切换展示的网址', async () => {
    await renderTool()
    await clickChip('提取网址')

    expect(container.textContent).toContain('共 3 项结果')
    const tabs = container.querySelectorAll<HTMLButtonElement>('.tw-detect__tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    // 输入框的高亮背板里也有原文，必须只看结果字段，才能证明展示的是「当前激活项」
    expect(resultFieldValues()).toEqual(['https://github.com/forestRhapsody/panda-dock'])

    await act(async () => tabs[1].click())
    await flush()

    expect(container.querySelectorAll('.tw-detect__tab')[1].getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(resultFieldValues()).toEqual(['https://example.com/docs/api'])
  })
})

describe('DetectTool 空输入 / 未识别 / 清空', () => {
  it('空输入不渲染结果区与状态提示', async () => {
    await renderTool()

    expect(detectInput().value).toBe('')
    expect(container.querySelector('.tw-detect')).toBeNull()
    expect(container.querySelector('.tw-status')).toBeNull()
    // 没有输入时不显示「清空」入口
    expect(
      [...container.querySelectorAll('button')].some((el) => el.textContent?.trim() === '清空'),
    ).toBe(false)
  })

  it('无法识别的文本给出「未识别出可解析的格式」信息提示', async () => {
    await renderTool()
    await type('just some plain words here')

    expect(container.querySelector('.tw-detect')).toBeNull()
    expect(container.querySelector('.tw-status--info')?.textContent).toContain(
      '未识别出可解析的格式',
    )
  })

  it('点击「清空」清掉输入与结果视图', async () => {
    await renderTool()
    await type('{"name":"Panda Dock"}')
    expect(container.querySelector('.tw-detect')).not.toBeNull()

    await act(async () => buttonByText('清空').click())
    await flush()

    expect(detectInput().value).toBe('')
    expect(container.querySelector('.tw-detect')).toBeNull()
    expect(
      [...container.querySelectorAll('button')].some((el) => el.textContent?.trim() === '清空'),
    ).toBe(false)
  })
})

describe('DetectTool「在 XX 工具中打开」', () => {
  it('点击后把当前激活匹配的原文与目标工具 id 交给 prepareToolHandoff', async () => {
    await renderTool()
    await type('{"name":"Panda Dock"}')

    const openButton = container.querySelector<HTMLButtonElement>('.tw-detect__head-action')
    expect(openButton).not.toBeNull()
    await act(async () => openButton?.click())
    await flush()

    expect(vi.mocked(prepareToolHandoff)).toHaveBeenCalledWith(
      'json',
      expect.stringContaining('"name": "Panda Dock"'),
    )
  })

  it('目标工具启用失败时弹出错误 toast', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-id')
    vi.mocked(prepareToolHandoff).mockResolvedValueOnce({ ok: false, reason: 'enable-failed' })

    await renderTool()
    await type('{"name":"Panda Dock"}')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.tw-detect__head-action')?.click(),
    )
    await flush()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('JSON')
  })
})

describe('DetectTool 中英双语', () => {
  it('切到英文后输入标签、解析结果与跳转入口文案都是英文，切回中文恢复', async () => {
    await renderTool()
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(container.textContent).toContain('Paste or type something')

    await type('{"name":"Panda Dock"}')
    expect(container.textContent).toContain('Parsed as')
    expect(container.textContent).toContain('Parsed Result')
    expect(container.textContent).toContain('Open in the JSON tool')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(container.textContent).toContain('解析为')
    expect(container.textContent).toContain('在JSON工具中打开')
  })
})
