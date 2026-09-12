// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Tooltip from './Tooltip'

/**
 * Tooltip 是 AGENTS §4 第 14 条指定的「替代原生 title」通用组件，
 * 被 TkSelect / CopyButton / 工具栏大量复用。它有几个容易被改坏的公共契约：
 *  - 不额外包裹子元素（透传渲染，保证 flex 布局与 trigger 的 ref 不被破坏）；
 *  - 悬停/聚焦延迟显示、离开/失焦/按下/Escape 隐藏；
 *  - children 原有事件与 ref 必须继续生效；
 *  - disabled 或空内容时完全退回渲染 children，不挂载气泡。
 *
 * ⚠️ happy-dom 下的两个实测限制（不是源码 bug）：
 *  1. React 的 onMouseLeave 进/离合成在 happy-dom 里不触发——mouseover 能触发
 *     onMouseEnter，但同一节点上的 mouseout/mouseleave 不会派发 Tooltip 注入的
 *     onMouseLeave（用原生 addEventListener 对照确认过事件确实到达了节点）。
 *     因此「隐藏」路径直接调用 Tooltip cloneElement 注入到子元素上的处理函数
 *     （即真实运行时会执行的那个函数），并从 React 的 `__reactProps` 取到它。
 *  2. 把 mouseover 包进 act() 会让 onMouseEnter 完全不被调用，所以显示路径的
 *     事件必须在 act 之外派发，随后用一次空 act 冲刷更新。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type InjectedHandlers = {
  onMouseEnter?: (e: unknown) => void
  onMouseLeave?: (e: unknown) => void
  onFocus?: (e: unknown) => void
  onBlur?: (e: unknown) => void
  onPointerDown?: (e: unknown) => void
}

let container: HTMLDivElement
let root: Root
let restoreSpies: Array<() => void> = []

/** 造一个 DOMRect：happy-dom 里所有元素 rect 都是 0×0，而 0×0 在真实环境里是「退化测量」信号 */
function makeRect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect
}

function setViewport(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
}

beforeEach(() => {
  // Tooltip 的显示由 setTimeout(delayDuration) 触发：用假定时器精确驱动「延迟」，不真实等待
  vi.useFakeTimers()
  setViewport(1024, 768)
  // 统一桩出可测量的几何：触发元素在 (300,400) 处 120×20，气泡 80×26。
  // 定位逻辑已把 0×0 视为「本次无法定位」（见源码注释），不桩 rect 的话所有用例都测不到气泡；
  // 不桩 offsetWidth/Height 的话气泡尺寸会是 0，位置断言只能得到由零尺寸推出来的魔数。
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  rectSpy.mockReturnValue(makeRect(300, 400, 120, 20))
  const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
  widthSpy.mockReturnValue(80)
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
  heightSpy.mockReturnValue(26)
  restoreSpies = [
    () => rectSpy.mockRestore(),
    () => widthSpy.mockRestore(),
    () => heightSpy.mockRestore(),
  ]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  for (const restore of restoreSpies) restore()
  restoreSpies = []
  vi.useRealTimers()
  // 注意：这里不能调 vi.restoreAllMocks()——它会重置假定时器的内部 mock，
  // 让后续用例的 advanceTimersByTime 静默失效（已踩过一次）。上面只精确恢复自己装的那个 spy。
})

function button(): HTMLButtonElement {
  const el = container.querySelector('button')
  if (!el) throw new Error('未找到触发按钮')
  return el as HTMLButtonElement
}

function tooltip(): HTMLElement | null {
  return document.body.querySelector('[role="tooltip"]')
}

/** 取 Tooltip 通过 cloneElement 注入到子元素上的事件处理器（真实运行时执行的就是它） */
function injected(el: Element): InjectedHandlers {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps'))
  if (!key) throw new Error('该节点上没有 React props')
  return (el as unknown as Record<string, InjectedHandlers>)[key]
}

/** 悬停进入：mouseover 必须在 act 之外派发（见文件头说明） */
function hoverIn(el: Element) {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  act(() => {})
}

/** 收起气泡：调用注入的 onMouseLeave */
function hoverOut(el: Element) {
  act(() => {
    injected(el).onMouseLeave?.({})
  })
}

/** 推进超过默认 150ms 延迟，让气泡真正挂载 */
function waitDelay(ms = 200) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** 渲染一个默认的「按钮 + 提示」组合 */
function renderTooltip(content: string, extra: Partial<Record<string, unknown>> = {}) {
  act(() => {
    root.render(
      <Tooltip content={content} {...extra}>
        <button>目标</button>
      </Tooltip>,
    )
  })
}

describe('Tooltip 气泡', () => {
  it('hover 需要等过 delayDuration 才显示，离开后立即隐藏', () => {
    renderTooltip('这是提示')

    hoverIn(button())

    // 延迟未到之前不应渲染气泡（防手滑扫过时闪屏）
    expect(tooltip()).toBeNull()

    waitDelay()
    expect(tooltip()).not.toBeNull()
    expect(tooltip()?.textContent).toBe('这是提示')
    expect(tooltip()?.className).toContain('tk-tooltip')

    hoverOut(button())
    expect(tooltip()).toBeNull()
  })

  it('focus 显示、blur 隐藏', () => {
    renderTooltip('聚焦提示')

    act(() => button().focus())
    waitDelay()
    expect(tooltip()).not.toBeNull()
    expect(tooltip()?.textContent).toBe('聚焦提示')

    act(() => button().blur())
    expect(tooltip()).toBeNull()
  })

  it('显示时给 children 注入 aria-describedby 指向 role=tooltip 的气泡，隐藏时移除', () => {
    renderTooltip('无障碍提示')

    expect(button().getAttribute('aria-describedby')).toBeNull()

    hoverIn(button())
    waitDelay()

    const describedBy = button().getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(tooltip()?.id).toBe(describedBy)
    expect(tooltip()?.getAttribute('role')).toBe('tooltip')
    // 触发元素桩在 (300,400) 120×20：默认 side=top 且上方空间充足 → 不翻转，水平按中心对齐
    // （气泡高度 26、间距 6 为默认值；宽度在 happy-dom 下取不到 offsetWidth，回落到 80 的估算）
    expect(tooltip()?.dataset.side).toBe('top')
    expect(tooltip()?.style.top).toBe('368px')
    expect(tooltip()?.style.left).toBe('320px')

    hoverOut(button())
    expect(tooltip()).toBeNull()
    expect(button().getAttribute('aria-describedby')).toBeNull()
  })

  it('上方空间不足时向下翻转', () => {
    // 触发元素贴近视口顶部：top=5、bottom=25，上方放不下 26+6 的气泡
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      makeRect(300, 5, 120, 20),
    )
    renderTooltip('翻转提示')

    hoverIn(button())
    waitDelay()

    expect(tooltip()?.dataset.side).toBe('bottom')
    // 25(bottom) + 6(间距)
    expect(tooltip()?.style.top).toBe('31px')
  })

  it('触发元素是 0×0 退化矩形时不显示气泡（回归：曾贴到屏幕最左侧）', () => {
    // 真实环境里「节点已脱离文档 / 布局未就绪」时 getBoundingClientRect 会全 0；
    // 旧实现按它算中心对齐会得到负数、再被夹到 8px，表现为气泡贴在屏幕最左缘。
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(makeRect(0, 0, 0, 0))
    renderTooltip('不该出现')

    hoverIn(button())
    waitDelay()

    expect(tooltip()).toBeNull()
  })

  it('children 不被额外包裹：容器首个子元素仍是原 button，气泡 portal 到 body', () => {
    act(() => {
      root.render(
        <Tooltip content='提示'>
          <button className='my-btn'>目标</button>
        </Tooltip>,
      )
    })

    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
    expect(container.firstElementChild?.className).toBe('my-btn')
    expect(container.querySelector('.tk-tooltip')).toBeNull()

    hoverIn(button())
    waitDelay()

    // 气泡挂在 body 上（happy-dom 里 trigger 根节点是 document），不进入容器
    expect(container.querySelector('.tk-tooltip')).toBeNull()
    expect(document.body.lastElementChild?.className).toContain('tk-tooltip')
  })

  it('保留 children 原有事件处理器（onMouseEnter / onClick 都被调用）', () => {
    const onChildMouseEnter = vi.fn()
    const onClick = vi.fn()
    act(() => {
      root.render(
        <Tooltip content='提示'>
          <button onMouseEnter={onChildMouseEnter} onClick={onClick}>
            目标
          </button>
        </Tooltip>,
      )
    })

    hoverIn(button())
    waitDelay()
    expect(onChildMouseEnter).toHaveBeenCalledTimes(1)
    expect(tooltip()).not.toBeNull()

    act(() => {
      button().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('指针按下（onPointerDown）立即收起气泡，并继续调用 children 自己的 onPointerDown', () => {
    const onChildPointerDown = vi.fn()
    act(() => {
      root.render(
        <Tooltip content='提示'>
          <button onPointerDown={onChildPointerDown}>目标</button>
        </Tooltip>,
      )
    })

    hoverIn(button())
    waitDelay()
    expect(tooltip()).not.toBeNull()

    act(() => {
      button().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(tooltip()).toBeNull()
    expect(onChildPointerDown).toHaveBeenCalledTimes(1)
  })

  it('Escape 收起气泡', () => {
    renderTooltip('提示')

    hoverIn(button())
    waitDelay()
    expect(tooltip()).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(tooltip()).toBeNull()
  })

  it('disabled 时不显示，且不注入 aria-describedby', () => {
    renderTooltip('提示', { disabled: true })

    hoverIn(button())
    waitDelay()
    expect(tooltip()).toBeNull()
    expect(button().getAttribute('aria-describedby')).toBeNull()
    // 透传渲染：容器里只有原 button
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
  })

  it('content 为空字符串 / null 时透传渲染 children，不挂载气泡', () => {
    for (const content of ['', null] as const) {
      act(() => {
        root.render(
          <Tooltip content={content}>
            <button>目标</button>
          </Tooltip>,
        )
      })

      hoverIn(button())
      waitDelay()
      expect(tooltip()).toBeNull()
      expect(container.querySelector('button')?.textContent).toBe('目标')
    }
  })

  it('children 不是合法元素时用 span 兜底包裹，仍能显示气泡', () => {
    act(() => {
      root.render(<Tooltip content='纯文本提示'>纯文本</Tooltip>)
    })

    const span = container.querySelector('span')
    expect(span?.textContent).toBe('纯文本')

    hoverIn(span as HTMLElement)
    waitDelay()
    expect(tooltip()?.textContent).toBe('纯文本提示')
  })

  it('卸载后监听器与定时器都被清理：再次派发事件不报错也不再渲染气泡', () => {
    renderTooltip('提示')

    // 先挂一个待触发的定时器，再立刻卸载，验证卸载时定时器被清掉
    hoverIn(button())
    act(() => root.unmount())
    expect(tooltip()).toBeNull()

    // 卸载时若 keydown/scroll/resize 监听器没清干净，下面的派发会碰到已卸载的 setState
    expect(() => {
      waitDelay()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('resize'))
    }).not.toThrow()
    expect(tooltip()).toBeNull()

    // 重新挂载一个 root 供 afterEach 卸载，避免对已卸载的 root 二次 unmount
    root = createRoot(container)
  })
})
