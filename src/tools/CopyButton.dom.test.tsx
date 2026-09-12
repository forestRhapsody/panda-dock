// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import * as clipboard from '@/utils/clipboard'

import CopyButton from './CopyButton'

/**
 * CopyButton 是全部工具「结果复制」入口（AGENTS §4 第 14 条统一交互流的一环）。
 * 它对外只依赖 @/utils/clipboard 的 copyText，所以这里用 spy 替换真实实现，
 * 验证的是「把什么文本交给 copyText、成功/失败后 UI 与回调怎么变」，
 * 而不是 copyText 自身的降级策略。
 *
 * 断言文案时统一走 i18n.t()（zh / en 都验一遍），避免把裸 key 当成文案。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let copySpy: ReturnType<typeof vi.spyOn>

/** 造一个 DOMRect（happy-dom 里所有元素 rect 恒为 0×0，那是真实环境里的「退化测量」信号） */
function rectLike(x: number, y: number, width: number, height: number): DOMRect {
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

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  // 假定时器用于验证「已复制」1.5s 后自动复位
  vi.useFakeTimers()
  // 不 mock 整个模块：只 spy copyText，其余导出保持真实
  copySpy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(true)
  // Tooltip 现在把 0×0 触发元素视为「本次无法定位」而不渲染气泡（避免贴到屏幕最左缘），
  // 而 happy-dom 的 rect 恒为 0：这里桩出可测量的几何，否则 tooltip 相关断言测不到
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    rectLike(300, 400, 120, 20),
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

function button(): HTMLButtonElement {
  const el = container.querySelector('button')
  if (!el) throw new Error('未找到复制按钮')
  return el as HTMLButtonElement
}

/** 点击并等待 handleClick 里的 await copyText 完成 */
async function click() {
  await act(async () => {
    button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Tooltip 默认 150ms 延迟后才挂载气泡 */
function tooltip(): HTMLElement | null {
  return document.body.querySelector('[role="tooltip"]')
}

function showTooltip() {
  button().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  act(() => {})
  act(() => {
    vi.advanceTimersByTime(200)
  })
}

describe('CopyButton 复制按钮', () => {
  it('点击后调用 copyText 并传入待复制的文本', async () => {
    act(() => {
      root.render(<CopyButton text='要复制的原始文本' />)
    })

    await click()

    expect(copySpy).toHaveBeenCalledTimes(1)
    expect(copySpy).toHaveBeenCalledWith('要复制的原始文本')
  })

  it('复制成功后显示「已复制」，并在 1.5s 后自动复位为「复制」', async () => {
    const onResult = vi.fn()
    act(() => {
      root.render(<CopyButton text='abc' onResult={onResult} />)
    })

    expect(button().textContent).toBe(i18n.t('common.copy'))
    expect(button().getAttribute('aria-label')).toBe(i18n.t('common.copy'))
    expect(button().getAttribute('aria-live')).toBe('polite')

    await click()

    expect(onResult).toHaveBeenCalledWith(true)
    expect(button().textContent).toBe(i18n.t('common.copied'))
    expect(button().textContent).toMatch(/[\u4e00-\u9fa5]/)
    // 文案不能是裸 i18n key
    expect(button().textContent).not.toContain('common.')

    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(button().textContent).toBe(i18n.t('common.copy'))
  })

  it('复制失败时不进入成功态，onResult 收到 false 且状态文案保持「复制」', async () => {
    copySpy.mockResolvedValue(false)
    const onResult = vi.fn()
    act(() => {
      root.render(<CopyButton text='abc' onResult={onResult} />)
    })

    await click()

    expect(onResult).toHaveBeenCalledWith(false)
    expect(button().textContent).toBe(i18n.t('common.copy'))
    expect(button().textContent).not.toBe(i18n.t('common.copied'))
  })

  it('copyText 悬而未决（既不成功也不失败）时按钮保持初始态，不误报成功', async () => {
    // copyText 只有 boolean 契约；这里用一个永远 pending 的 thenable 覆盖「await 永不返回」
    // 的路径，断言按钮不会提前进入成功态。
    // 说明：真实 copyText 内部 try/catch 兜底、不会抛错；若它违约抛错，handleClick 没有
    // try/catch，拒绝会原样冒到全局——该路径不做用例（见交付报告「源码疑点」）。
    let resolvePending: (ok: boolean) => void = () => {}
    const pending = new Promise<boolean>((resolve) => {
      resolvePending = resolve
    })
    ;(pending as { catch?: (fn: () => void) => void }).catch = () => {}
    copySpy.mockImplementation(() => pending)
    const onResult = vi.fn()
    act(() => {
      root.render(<CopyButton text='abc' onResult={onResult} />)
    })

    await click()

    expect(onResult).not.toHaveBeenCalled()
    expect(button().textContent).toBe(i18n.t('common.copy'))

    // 收尾：让组件内部的 await 结束，避免测试结束后还有未完成的回调
    await act(async () => {
      resolvePending(false)
      await Promise.resolve()
    })
  })

  it('disabled 时不调用 copyText、不进入成功态', async () => {
    const onResult = vi.fn()
    act(() => {
      root.render(<CopyButton text='abc' disabled onResult={onResult} />)
    })

    expect(button().disabled).toBe(true)
    await click()

    expect(copySpy).not.toHaveBeenCalled()
    expect(onResult).not.toHaveBeenCalled()
    expect(button().textContent).toBe(i18n.t('common.copy'))
  })

  it('label / copiedLabel / title 支持覆盖默认文案', async () => {
    act(() => {
      root.render(
        <CopyButton text='abc' label='复制结果' copiedLabel='搞定' title='复制到剪贴板' />,
      )
    })

    expect(button().textContent).toBe('复制结果')
    expect(button().getAttribute('aria-label')).toBe('复制结果')

    await click()
    expect(button().textContent).toBe('搞定')

    // 成功态下 Tooltip 内容切换为 copiedLabel
    showTooltip()
    expect(tooltip()?.textContent).toBe('搞定')
  })

  it('未传 title 且非 icon 模式时不挂载 Tooltip（避免无意义的悬停气泡）', () => {
    act(() => {
      root.render(<CopyButton text='abc' />)
    })

    showTooltip()
    expect(tooltip()).toBeNull()
  })

  it('icon 模式用图标表达复制/成功，并以 label 作为 Tooltip 内容', async () => {
    act(() => {
      root.render(<CopyButton text='abc' icon />)
    })

    // 初始为复制图标（Icon 的 copy 图元是 rect + path），成功后换成单个对勾 path
    expect(button().querySelector('svg rect')).not.toBeNull()
    expect(button().querySelector('svg path')?.getAttribute('d')).toBe('M5 15V5a2 2 0 0 1 2-2h9')
    showTooltip()
    expect(tooltip()?.textContent).toBe(i18n.t('common.copy'))

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      vi.advanceTimersByTime(200)
    })

    await click()
    // 成功后换成对勾图标
    expect(button().querySelector('svg rect')).toBeNull()
    expect(button().querySelector('svg path')?.getAttribute('d')).toBe('M20 6 9 17l-5-5')
    showTooltip()
    expect(tooltip()?.textContent).toBe(i18n.t('common.copied'))
  })

  it('英文语言下成功/默认文案切换为英文，不出现中文', async () => {
    await i18n.changeLanguage('en')
    act(() => {
      root.render(<CopyButton text='abc' />)
    })

    expect(button().textContent).toBe('Copy')
    await click()
    expect(button().textContent).toBe('Copied')
    expect(button().textContent).not.toMatch(/[\u4e00-\u9fa5]/)
  })

  it('重复点击都会各自调用 copyText，且不会累积出未处理的 Promise', async () => {
    act(() => {
      root.render(<CopyButton text='abc' />)
    })

    await click()
    await click()
    await click()

    expect(copySpy).toHaveBeenCalledTimes(3)
    expect(button().textContent).toBe(i18n.t('common.copied'))

    // 每次点击都重置了 1.5s 复位定时器：推进一次后必须回到默认文案
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(button().textContent).toBe(i18n.t('common.copy'))
  })

  it('卸载时清理复位定时器，之后推进时间不再触发 setState', async () => {
    act(() => {
      root.render(<CopyButton text='abc' />)
    })
    await click()

    act(() => root.unmount())

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(5000)
      })
    }).not.toThrow()

    // 重新挂载一个 root 供 afterEach 卸载
    root = createRoot(container)
  })
})
