// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/i18n'

import ToolErrorBoundary from './ToolErrorBoundary'

/**
 * T128 验收标准的真实 DOM 行为测试：「子树抛错 → 不白屏 → 显示降级卡片 → 重试恢复 → 换 key 复位」。
 * 必须跑在 DOM 环境（happy-dom）：node 环境下的 SSR（renderToStaticMarkup）不支持错误边界，
 * 实测会直接抛出子组件的异常（见同目录 ToolErrorBoundary.test.tsx 的契约用例）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 渲染期必定抛错的子组件 */
function Boom(): never {
  throw new Error('kaboom')
}

let container: HTMLDivElement
let root: Root
let originalConsoleError: typeof console.error

beforeEach(() => {
  // React 捕获错误后会向控制台打印（组件内 componentDidCatch 也会），测试期间静音以免刷屏
  originalConsoleError = console.error
  console.error = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  console.error = originalConsoleError
})

function retryButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((el) =>
    el.textContent?.includes(i18n.t('common.retry')),
  )
  if (!btn) throw new Error('未找到重试按钮')
  return btn
}

describe('ToolErrorBoundary 真实 DOM 行为', () => {
  it('子树渲染抛错时不再白屏，而是显示降级卡片与错误详情', () => {
    act(() => {
      root.render(
        <ToolErrorBoundary>
          <Boom />
        </ToolErrorBoundary>,
      )
    })
    expect(container.querySelector('.tw-error')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('tool.error.title'))
    expect(container.textContent).toContain('kaboom')
  })

  it('点击重试后重新渲染子树并恢复到正常内容', () => {
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('首次渲染失败')
      return <b>recovered</b>
    }
    act(() => {
      root.render(
        <ToolErrorBoundary>
          <Flaky />
        </ToolErrorBoundary>,
      )
    })
    expect(container.querySelector('.tw-error')).not.toBeNull()

    shouldThrow = false
    act(() => retryButton().click())

    expect(container.querySelector('.tw-error')).toBeNull()
    expect(container.textContent).toContain('recovered')
  })

  it('持续抛错时反复重试不会崩溃 / 不会死循环，仍停留在降级卡片', () => {
    act(() => {
      root.render(
        <ToolErrorBoundary>
          <Boom />
        </ToolErrorBoundary>,
      )
    })
    act(() => retryButton().click())
    act(() => retryButton().click())
    expect(container.querySelector('.tw-error')).not.toBeNull()
    expect(container.textContent).toContain(i18n.t('tool.error.title'))
  })

  it('切换工具（宿主更换 key）后错误状态被清空，恢复正常渲染', () => {
    act(() => {
      root.render(
        <ToolErrorBoundary key='a'>
          <Boom />
        </ToolErrorBoundary>,
      )
    })
    expect(container.querySelector('.tw-error')).not.toBeNull()

    act(() => {
      root.render(
        <ToolErrorBoundary key='b'>
          <b>tool-b</b>
        </ToolErrorBoundary>,
      )
    })
    expect(container.querySelector('.tw-error')).toBeNull()
    expect(container.textContent).toContain('tool-b')
  })

  it('正常子树不插入任何额外包裹节点（保证 tw__body 的 flex 布局不受影响）', () => {
    act(() => {
      root.render(
        <ToolErrorBoundary>
          <b>fine</b>
        </ToolErrorBoundary>,
      )
    })
    expect(container.querySelector('.tw-error')).toBeNull()
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.tagName).toBe('B')
  })

  it('对照组：同样的子树在没有边界时直接抛出且 DOM 为空（即白屏），证明上面捕获确实来自边界', () => {
    let thrown = ''
    try {
      act(() => {
        root.render(<Boom />)
      })
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e)
    }
    expect(thrown).toBe('kaboom')
    expect(container.children).toHaveLength(0)
    expect(container.innerHTML).toBe('')
  })
})
