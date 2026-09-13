// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import ConfirmDialog from './ConfirmDialog'

/**
 * ConfirmDialog 是项目里替代 window.confirm / window.alert 的唯一确认弹窗
 * （AGENTS §4 第 14 条、§8「不静默毁数据」），content script 的 Shadow DOM 里
 * 原生 confirm 会被 Chrome 禁用，所以这个组件的确认/取消/Escape/遮罩行为
 * 以及「危险操作默认聚焦取消」的防手滑设计都是硬要求。
 *
 * 用例统一在 zh 语言下跑文案断言，并在 afterAll 恢复 zh。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

function dialog(): HTMLElement | null {
  return container.querySelector('.pd-modal')
}

function card(): HTMLElement {
  const el = container.querySelector('.pd-modal__card')
  if (!el) throw new Error('未找到弹窗卡片')
  return el as HTMLElement
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')] as HTMLButtonElement[]
}

function buttonByText(text: string): HTMLButtonElement {
  const el = buttons().find((b) => b.textContent === text)
  if (!el) throw new Error(`未找到文案为「${text}」的按钮`)
  return el
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

describe('ConfirmDialog 确认弹窗', () => {
  it('渲染标题、描述与确认/取消按钮，带 alertdialog 无障碍语义', () => {
    act(() => {
      root.render(
        <ConfirmDialog title='删除 Cookie' message='该操作不可撤销' onConfirm={() => {}} />,
      )
    })

    expect(dialog()).not.toBeNull()
    expect(dialog()?.className).toContain('pd-modal')
    expect(dialog()?.getAttribute('role')).toBe('alertdialog')
    expect(dialog()?.getAttribute('aria-modal')).toBe('true')
    expect(dialog()?.getAttribute('aria-label')).toBe('删除 Cookie')
    expect(container.querySelector('.pd-modal__title')?.textContent).toBe('删除 Cookie')
    expect(container.querySelector('.pd-modal__msg')?.textContent).toBe('该操作不可撤销')

    // 未传按钮文案时走 i18n key（common.confirm / common.cancel）
    expect(buttonByText(i18n.t('common.cancel'))).toBeTruthy()
    expect(buttonByText(i18n.t('common.confirm'))).toBeTruthy()
    // 文案不能是裸 key
    expect(container.textContent).not.toContain('common.')
  })

  it('传入自定义确认/取消文案时按传入值渲染', () => {
    act(() => {
      root.render(
        <ConfirmDialog
          title='清空全部'
          message='确认清空？'
          confirmLabel='全部清空'
          cancelLabel='再想想'
          onConfirm={() => {}}
        />,
      )
    })

    expect(buttonByText('全部清空')).toBeTruthy()
    expect(buttonByText('再想想')).toBeTruthy()
    // 自定义文案生效后，默认的 i18n 按钮文案不应再作为按钮出现
    expect(buttons().map((b) => b.textContent)).not.toContain(i18n.t('common.confirm'))
    expect(buttons().map((b) => b.textContent)).not.toContain(i18n.t('common.cancel'))
  })

  it('英文语言下按钮文案切到英文，不出现中文', async () => {
    await i18n.changeLanguage('en')
    act(() => {
      root.render(<ConfirmDialog title='Delete' message='Sure?' onConfirm={() => {}} />)
    })

    expect(buttonByText('Confirm')).toBeTruthy()
    expect(buttonByText('Cancel')).toBeTruthy()
    expect(container.textContent).not.toMatch(/[\u4e00-\u9fa5]/)
  })

  it('点击确认按钮只调用 onConfirm 一次，不触发 onCancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog
          title='保存'
          message='确认保存？'
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )
    })

    click(buttonByText(i18n.t('common.confirm')))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('点击取消按钮调用 onCancel，不触发 onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog
          title='保存'
          message='确认保存？'
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )
    })

    click(buttonByText(i18n.t('common.cancel')))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('未传 onCancel 时取消按钮回退为 onConfirm（handleDismiss 兜底）', () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(<ConfirmDialog title='提示' message='仅有一个回调' onConfirm={onConfirm} />)
    })

    click(buttonByText(i18n.t('common.cancel')))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Escape 关闭：有 onCancel 调 onCancel，没有则调 onConfirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog
          title='保存'
          message='确认保存？'
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )
    })

    pressEscape()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Escape 在没有 onCancel 时回退到 onConfirm', () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(<ConfirmDialog title='提示' message='仅确认' onConfirm={onConfirm} />)
    })

    pressEscape()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('默认点击遮罩背景不关闭（防误触），也不触发任何回调', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog title='删除' message='不可撤销' onConfirm={onConfirm} onCancel={onCancel} />,
      )
    })

    click(dialog() as HTMLElement)
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('closeOnBackdrop 为 true 时点击遮罩才关闭', () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog
          title='删除'
          message='不可撤销'
          closeOnBackdrop
          onConfirm={() => {}}
          onCancel={onCancel}
        />,
      )
    })

    click(dialog() as HTMLElement)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点击卡片内容不会冒泡到遮罩而误关弹窗', () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog
          title='删除'
          message='不可撤销'
          closeOnBackdrop
          onConfirm={() => {}}
          onCancel={onCancel}
        />,
      )
    })

    click(card())
    click(container.querySelector('.pd-modal__msg') as HTMLElement)

    // 卡片上的 stopPropagation 必须兜住冒泡（否则点文字就把弹窗关了）
    expect(onCancel).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
  })

  it('danger 模式给确认按钮加 pd-btn--danger 类，常规模式为 pd-btn--primary', () => {
    act(() => {
      root.render(<ConfirmDialog title='删除' message='不可撤销' danger onConfirm={() => {}} />)
    })
    expect(buttonByText(i18n.t('common.confirm')).className).toContain('pd-btn--danger')

    act(() => {
      root.render(<ConfirmDialog title='保存' message='保存？' onConfirm={() => {}} />)
    })
    expect(buttonByText(i18n.t('common.confirm')).className).toContain('pd-btn--primary')
    expect(buttonByText(i18n.t('common.confirm')).className).not.toContain('pd-btn--danger')
  })

  it('危险操作打开后焦点落在取消按钮（防手滑按回车），常规操作聚焦确认按钮', () => {
    act(() => {
      root.render(<ConfirmDialog title='删除' message='不可撤销' danger onConfirm={() => {}} />)
    })
    expect(document.activeElement).toBe(buttonByText(i18n.t('common.cancel')))

    act(() => {
      root.render(<ConfirmDialog title='保存' message='保存？' onConfirm={() => {}} />)
    })
    expect(document.activeElement).toBe(buttonByText(i18n.t('common.confirm')))
  })

  it('hideCancel 纯提示模式：只有一个按钮，即使 danger 也聚焦确认按钮', () => {
    const onConfirm = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog title='操作成功' message='已完成' hideCancel danger onConfirm={onConfirm} />,
      )
    })

    expect(buttons()).toHaveLength(1)
    expect(buttons()[0].textContent).toBe(i18n.t('common.confirm'))
    expect(document.activeElement).toBe(buttons()[0])

    click(buttons()[0])
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('open=false 时不渲染任何节点（由调用方条件渲染；卸载后监听器同步清理）', () => {
    const onCancel = vi.fn()
    act(() => {
      root.render(
        <ConfirmDialog title='删除' message='不可撤销' onConfirm={() => {}} onCancel={onCancel} />,
      )
    })
    expect(dialog()).not.toBeNull()

    act(() => {
      root.render(null)
    })

    expect(container.children).toHaveLength(0)
    expect(container.innerHTML).toBe('')
    expect(dialog()).toBeNull()

    // 卸载后 Escape 监听器必须被移除，不能再触发回调
    pressEscape()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
