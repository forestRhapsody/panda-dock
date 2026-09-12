// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { copyText } from '@/utils/clipboard'

import SelectionDetectPanel from './SelectionDetectPanel'
import type { SelectionDetectPanelProps } from './SelectionDetectPanel'

/**
 * 划选解析悬浮面板的关键契约：
 * - 定位是它的核心价值（贴着选区下方 / 空间不足翻转 / 夹在视口内），算错就会飘到屏幕外；
 * - 关闭路径有三条（按钮 / Escape / 点面板外），钉住后「点外部」必须失效，否则用户没法复制面板内容；
 * - 「在 XX 工具中打开」交出去的是**当前激活匹配的原文**（T134），交错了目标工具就会拿到别的内容。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 复制与 handoff 都是跨模块副作用，单独 mock 掉才能只断言「面板交给了它们什么」
vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('@/tools/handoff', () => ({
  toolForDetectKind: (kind: string) => (kind === 'json' || kind === 'url' ? kind : null),
}))

const copyTextMock = vi.mocked(copyText)

/** 面板内的宽度/高度测量在 happy-dom 下恒为 0，源码回退到 480x300 */
const FALLBACK_W = 480
const FALLBACK_H = 300
const PAD = 10
const GAP = 8

let container: HTMLDivElement
let root: Root
let originalWidth: number
let originalHeight: number

function setViewport(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
}

function panelEl(): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>('.tek-detect-panel')
  if (!el) throw new Error('未找到解析面板')
  return el
}

function buttonsByLabel(label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (el) => el.getAttribute('aria-label') === label,
  )
}

function buttonByLabel(label: string): HTMLButtonElement {
  const btn = buttonsByLabel(label)[0]
  if (!btn) throw new Error(`未找到 aria-label=${label} 的按钮`)
  return btn
}

/** 纯文字按钮（如「清空」）没有 aria-label，只能按文案定位 */
function buttonByText(text: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((el) => el.textContent === text)
  if (!btn) throw new Error(`未找到文案为 ${text} 的按钮`)
  return btn
}

function textarea(): HTMLTextAreaElement {
  const el = container.querySelector('textarea')
  if (!el) throw new Error('未找到输入框')
  return el
}

function renderPanel(props: SelectionDetectPanelProps) {
  act(() => {
    root.render(<SelectionDetectPanel {...props} />)
  })
  return panelEl()
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
  })
}

/** 模拟点击面板外部（面板挂在 Shadow DOM 里，宿主事件会冒泡到 document） */
function pointerDownOutside() {
  act(() => {
    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerId: 1 }),
    )
  })
}

/**
 * resize/scroll 的重定位走 requestAnimationFrame 节流；happy-dom 的 rAF 是宏任务，
 * 所以必须再等一帧才能观察到定位结果。链式等待保证排在源码回调之后（FIFO）。
 */
async function flushReflow() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

/** 触发一次窗口 resize 并等节流后的重定位落地 */
async function fireResize() {
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
  await flushReflow()
}

/** 触发一次页面滚动（源码在捕获阶段监听，scroll 事件本身不冒泡）并等重定位落地 */
async function fireScroll() {
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
  await flushReflow()
}

/** 模拟左键按住标题栏从 (fromX, fromY) 拖到 (toX, toY) */
function dragPanel(fromX: number, fromY: number, toX: number, toY: number) {
  const head = container.querySelector<HTMLElement>('.tek-detect-panel__head')
  if (!head) throw new Error('未找到面板标题栏')
  const fire = (type: string, clientX: number, clientY: number) => {
    act(() => {
      head.dispatchEvent(
        new PointerEvent(type, {
          button: 0,
          buttons: 1,
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX,
          clientY,
        }),
      )
    })
  }
  fire('pointerdown', fromX, fromY)
  fire('pointermove', toX, toY)
  fire('pointerup', toX, toY)
}

/** happy-dom 不排版，offsetWidth/Height 恒为 0；用受控几何让 clampPos 走与真实布局一致的分支 */
function patchPanelSize(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => width })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height })
}

beforeEach(() => {
  originalWidth = window.innerWidth
  originalHeight = window.innerHeight
  setViewport(1024, 768)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setViewport(originalWidth, originalHeight)
  vi.clearAllMocks()
})

afterAll(async () => {
  // 语言是全局单例，双语用例跑完必须还原，避免影响同进程里的其他文件
  await i18n.changeLanguage('zh')
})

describe('SelectionDetectPanel 结果渲染', () => {
  it('传入可解析文本时渲染识别徽标与格式化结果块，标签走 i18n', () => {
    renderPanel({ text: '{"a":1}', onClose: () => {} })

    expect(container.querySelector('.tw-status--ok')?.textContent).toContain(
      i18n.t('tool.detect.detected', { kind: 'JSON' }),
    )
    expect(container.querySelector('.tw-status--ok')?.textContent).toContain('JSON')

    const block = container.querySelector('.tw-detect__block')
    expect(block).not.toBeNull()
    expect(block?.textContent).toContain(i18n.t('tool.detect.row.parsed'))
    expect(block?.textContent).not.toContain('tool.detect.row.parsed')
    // 格式化后的 JSON 真的渲染出来了（而不是只有标签）
    expect(block?.textContent).toContain('"a"')
  })

  it('输入框保留选中文本原文，便于用户直接改', () => {
    renderPanel({ text: '1780000000', onClose: () => {} })
    expect(textarea().value).toBe('1780000000')
    // 时间戳解析出秒/毫秒等短字段
    expect(container.querySelectorAll('.tw-detect__field').length).toBeGreaterThan(0)
  })

  it('多个可解析结果时渲染结果 Tab 与总数徽标，切换 Tab 后字段跟着切换', () => {
    renderPanel({ text: 'https://a.com https://b.com', onClose: () => {} })

    expect(container.querySelector('.tw-detect__total-badge')?.textContent).toBe(
      i18n.t('tool.detect.totalMatches', { count: 2 }),
    )

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.tw-detect__tab')]
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[1].getAttribute('aria-selected')).toBe('false')
    expect(container.querySelector('.tw-detect__field-value')?.textContent).toBe('https://a.com/')

    act(() => tabs[1].click())

    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(container.querySelector('.tw-detect__field-value')?.textContent).toBe('https://b.com/')
  })

  it('非空但识别不出格式时给出「未识别」提示，而不是静默空白', () => {
    renderPanel({ text: 'hello world', onClose: () => {} })
    expect(container.querySelector('.tw-detect__block')).toBeNull()
    const info = container.querySelector('.tw-status--info')
    expect(info?.textContent).toBe(i18n.t('tool.detect.none'))
  })

  it('空文本不渲染结果区，并自动聚焦输入框方便直接粘贴', () => {
    renderPanel({ text: '', position: 'top-right', onClose: () => {} })
    expect(container.querySelector('.tw-status')).toBeNull()
    expect(document.activeElement).toBe(textarea())
  })

  it('标题与 aria-label 走 i18n，不是裸 key', () => {
    const panel = renderPanel({ text: '123', onClose: () => {} })
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-label')).toBe(i18n.t('tool.detect.title'))
    expect(panel.getAttribute('aria-label')).not.toBe('tool.detect.title')
    expect(container.textContent).toContain(i18n.t('tool.detect.title'))
    expect(container.textContent).not.toContain('tool.detect.title')
  })
})

describe('SelectionDetectPanel 复制与清空', () => {
  it('点击编辑器复制按钮把当前输入交给剪贴板，并短暂显示「已复制」', async () => {
    renderPanel({ text: '{"a":1}', onClose: () => {} })

    const editorCopy = container.querySelector<HTMLButtonElement>(
      '.tek-detect__editor-actions button',
    )
    expect(editorCopy).not.toBeNull()
    expect(editorCopy!.textContent).toBe(i18n.t('common.copy'))

    await act(async () => {
      editorCopy!.click()
    })

    expect(copyTextMock).toHaveBeenCalledWith('{"a":1}')
    // 复制成功后按钮被 Tooltip 重新包裹，DOM 节点会换新，必须重新查询
    const afterCopy = container.querySelector<HTMLButtonElement>(
      '.tek-detect__editor-actions button',
    )
    expect(afterCopy?.textContent).toBe(i18n.t('common.copied'))
  })

  it('点击清空按钮清空输入、隐藏结果并禁用自身', () => {
    renderPanel({ text: 'hello world', onClose: () => {} })
    const clear = buttonByText(i18n.t('common.clear'))

    expect(clear.disabled).toBe(false)
    act(() => clear.click())

    expect(textarea().value).toBe('')
    expect(container.querySelector('.tw-status')).toBeNull()
    expect(buttonByText(i18n.t('common.clear')).disabled).toBe(true)
  })
})

describe('SelectionDetectPanel 关闭与钉住', () => {
  it('点击关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    renderPanel({ text: '123', onClose })

    act(() => buttonByLabel(i18n.t('common.cancel')).click())

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape 触发 onClose', () => {
    const onClose = vi.fn()
    renderPanel({ text: '123', onClose })

    pressEscape()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Alt+Shift+S 快捷键收回面板', () => {
    const onClose = vi.fn()
    renderPanel({ text: '123', onClose })

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'S',
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击面板外部关闭；钉住后点击外部不再关闭，且图钉 aria-pressed 同步', () => {
    const onClose = vi.fn()
    renderPanel({ text: '123', onClose })

    const pin = buttonByLabel(i18n.t('tool.detect.pin'))
    expect(pin.getAttribute('aria-pressed')).toBe('false')

    act(() => pin.click())

    const unpin = buttonByLabel(i18n.t('tool.detect.unpin'))
    expect(unpin.getAttribute('aria-pressed')).toBe('true')

    pointerDownOutside()
    expect(onClose).not.toHaveBeenCalled()

    // 取消钉住后又会被外部点击关掉
    act(() => unpin.click())
    pointerDownOutside()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('未钉住时点击面板内部不会误关（不会被冒泡的 pointerdown 关掉）', () => {
    const onClose = vi.fn()
    const panel = renderPanel({ text: '123', onClose })

    act(() => {
      panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('SelectionDetectPanel 定位', () => {
  it('top-right：贴在视口右上角（右边距 24px、顶边距 24px）', () => {
    const panel = renderPanel({ text: '', position: 'top-right', onClose: () => {} })
    expect(panel.style.left).toBe(`${1024 - FALLBACK_W - 24}px`)
    expect(panel.style.top).toBe('24px')
    expect(panel.style.opacity).toBe('1')
  })

  it('selection：下方空间充足时出现在选区正下方（GAP=8px）并按选区中心水平居中', () => {
    const targetRect = { left: 400, top: 100, right: 500, bottom: 120, width: 100, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })

    // 水平中心 450 → 450 - 480/2 = 210
    expect(panel.style.left).toBe('210px')
    expect(panel.style.top).toBe(`${120 + GAP}px`)
  })

  it('selection：下方空间不足但上方充足时翻转到选区上方', () => {
    const targetRect = { left: 400, top: 600, right: 500, bottom: 620, width: 100, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })

    // 620 下方只剩 138px，翻到上方：600 - 300 - 8 = 292
    expect(panel.style.top).toBe(`${600 - FALLBACK_H - GAP}px`)
    expect(panel.style.left).toBe('210px')
  })

  it('selection：上下都放不下时取空间更大的一侧并夹进视口', () => {
    setViewport(1024, 400)
    const targetRect = { left: 400, top: 250, right: 500, bottom: 270, width: 100, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })

    // spaceBelow=112 < spaceAbove=232 → 取上方，但上方也为负 → 夹到 PAD
    expect(panel.style.top).toBe(`${PAD}px`)
  })

  it('selection：没有选区矩形时退化为右键坐标作为锚点', () => {
    const panel = renderPanel({ text: 'hello world', x: 500, y: 700, onClose: () => {} })

    expect(panel.style.left).toBe(`${500 - FALLBACK_W / 2}px`)
    expect(panel.style.top).toBe(`${700 - FALLBACK_H - GAP}px`)
  })

  it('selection：选区贴近左边缘时面板被夹在视口内，不出现负坐标', () => {
    const targetRect = { left: 10, top: 100, right: 30, bottom: 120, width: 20, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })

    expect(panel.style.left).toBe(`${PAD}px`)
  })

  it('窗口 resize 后按锚点重新定位，不再停留在挂载时的旧位置（回归）', async () => {
    const targetRect = { left: 400, top: 100, right: 500, bottom: 120, width: 100, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })
    // 挂载时选区下方空间充足：120 + GAP
    expect(panel.style.top).toBe(`${120 + GAP}px`)

    // 视口变矮到 200 后上下都放不下面板，按锚点重算会夹到顶部 PAD
    setViewport(1024, 200)
    await fireResize()

    expect(panel.style.top).toBe(`${PAD}px`)
  })

  it('页面滚动时同样按锚点重新定位（回归）', async () => {
    const panel = renderPanel({ text: '', position: 'top-right', onClose: () => {} })
    expect(panel.style.left).toBe(`${1024 - FALLBACK_W - 24}px`)

    // happy-dom 既无排版也无真实滚动位移，选区矩形不会随滚动平移，
    // 无法直接构造「锚点移动」；这里改视口宽度，让「有没有重算」产生可观测差异，
    // 从而只断言 scroll 路径确实触发了重定位这条确定的分支。
    setViewport(800, 768)
    await fireScroll()

    expect(panel.style.left).toBe(`${800 - FALLBACK_W - 24}px`)
  })

  it('拖动过之后 resize 只把面板夹回视口内，不覆盖用户摆放的位置（回归）', async () => {
    const targetRect = { left: 400, top: 100, right: 500, bottom: 120, width: 100, height: 20 }
    const panel = renderPanel({ text: 'hello world', targetRect, onClose: () => {} })
    // 初始按锚点定位：选区中心 450 - 480/2
    expect(panel.style.left).toBe('210px')

    // happy-dom 不排版，offsetWidth/Height 恒为 0；补上受控几何，让 clampPos 用 480x300
    patchPanelSize(panel, FALLBACK_W, FALLBACK_H)
    dragPanel(300, 200, 700, 400)
    // 拖到 (700,400)：扣掉按下偏移 (90,72) 后为 610/328，再夹到 left = 1024-480-10
    expect(panel.style.left).toBe('534px')
    expect(panel.style.top).toBe('328px')

    // 视口不变时 resize：若按锚点重算会跳回 210/128，但用户拖动过，只做夹取（位置不变）
    await fireResize()
    expect(panel.style.left).toBe('534px')
    expect(panel.style.top).toBe('328px')

    // 视口缩小到 900 宽后原位置出界：夹取到 900-480-10 = 410，而不是回到锚点的 210
    setViewport(900, 768)
    await fireResize()
    expect(panel.style.left).toBe('410px')
    expect(panel.style.top).toBe('328px')
  })
})

describe('SelectionDetectPanel 与宿主的手递手', () => {
  it('点击「在 XX 工具中打开」把当前激活匹配的原文交给 onOpenInTool', () => {
    const onOpenInTool = vi.fn()
    renderPanel({
      text: 'https://a.com https://b.com',
      onOpenInTool,
      onClose: () => {},
    })

    const action = container.querySelector<HTMLButtonElement>('.tw-detect__head-action')
    expect(action).not.toBeNull()
    expect(action?.textContent).toContain(i18n.t('tool.registry.url'))

    act(() => action!.click())
    expect(onOpenInTool).toHaveBeenLastCalledWith('url', 'https://a.com/')

    // 切到第 2 个结果后，交出去的是第 2 条的原文，而不是第一条
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.tw-detect__tab')]
    act(() => tabs[1].click())
    act(() => action!.click())
    expect(onOpenInTool).toHaveBeenLastCalledWith('url', 'https://b.com/')
  })

  it('点击「在侧边栏中打开」把当前（可编辑后的）输入交给 onOpenInSidePanel', () => {
    const onOpenInSidePanel = vi.fn()
    renderPanel({ text: 'hello world', onOpenInSidePanel, onClose: () => {} })

    const btn = buttonByLabel(i18n.t('tool.detect.openInSidePanel'))
    act(() => btn.click())

    expect(onOpenInSidePanel).toHaveBeenCalledWith('hello world')
  })
})

describe('SelectionDetectPanel 拖拽守卫', () => {
  it('右键（button !== 0）按下不会开始拖动，也不捕获指针（回归）', () => {
    renderPanel({ text: 'hello', onClose: () => {} })
    const panel = panelEl()
    const head = container.querySelector<HTMLElement>('.tek-detect-panel__head') as HTMLElement
    const before = { left: panel.style.left, top: panel.style.top }
    const capture = vi.fn()
    head.setPointerCapture = capture

    act(() => {
      head.dispatchEvent(
        new PointerEvent('pointerdown', {
          button: 2,
          buttons: 2,
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      )
    })
    act(() => {
      head.dispatchEvent(
        new PointerEvent('pointermove', {
          button: 2,
          buttons: 2,
          bubbles: true,
          composed: true,
          pointerId: 1,
          clientX: 400,
          clientY: 400,
        }),
      )
    })

    // 回归：与 FloatingBall / Drawer 一致，只响应左键；右键不应移动整卡
    expect(capture).not.toHaveBeenCalled()
    expect(panel.style.left).toBe(before.left)
    expect(panel.style.top).toBe(before.top)
  })
})

describe('SelectionDetectPanel 中英双语', () => {
  it('切换英文后标题、结果标签与空状态都用 en 语言包，不出现裸 key', async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })

    renderPanel({ text: '{"a":1}', onClose: () => {} })

    expect(panelEl().getAttribute('aria-label')).toBe('Smart Parse')
    expect(container.textContent).toContain('Parsed as')
    expect(container.textContent).toContain('Parsed Result')
    expect(container.textContent).not.toContain('tool.detect.')
    expect(buttonByLabel('Cancel')).not.toBeNull()

    act(() => root.unmount())
    root = createRoot(container)
    renderPanel({ text: 'hello world', position: 'top-right', onClose: () => {} })
    expect(container.querySelector('.tw-status--info')?.textContent).toBe(
      'No parsable format detected',
    )

    // 立刻还原语言，避免依赖用例执行顺序
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
  })
})
