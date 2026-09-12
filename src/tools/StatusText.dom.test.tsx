// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { StatusText } from './StatusText'
import type { ToolStatusKind } from './StatusText'

/**
 * StatusText 是各工具共用的状态提示行，外观完全由 `.tw-status--{kind}` 决定。
 * 这里断言渲染出的标签、类名拼接规则与子节点行为，并锁定它的**可访问性语义**：
 * 带 `role="status"`（隐式 aria-live=polite），使错误与状态变化能被读屏播报，
 * 不再只靠 CSS 类表达。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const status = () => container.querySelector('p')

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('StatusText：kind 决定类名', () => {
  it.each([
    ['ok', 'tw-status tw-status--ok'],
    ['err', 'tw-status tw-status--err'],
    ['info', 'tw-status tw-status--info'],
  ] satisfies [ToolStatusKind, string][])('kind=%s 渲染出 p 元素与类名 %s', (kind, expected) => {
    act(() => {
      root.render(<StatusText kind={kind}>内容</StatusText>)
    })

    const el = status()
    expect(el?.tagName).toBe('P')
    expect(el?.className).toBe(expected)
    expect(el?.textContent).toBe('内容')
  })

  it('三种 kind 的类名互不相同，样式不会互相覆盖', () => {
    const classNames = (['ok', 'err', 'info'] as ToolStatusKind[]).map((kind) => {
      act(() => {
        root.render(<StatusText kind={kind}>x</StatusText>)
      })
      return status()?.className
    })

    expect(new Set(classNames).size).toBe(3)
  })
})

describe('StatusText：className 拼接', () => {
  it('不传 className 时类名精确为两个，不留下多余空格', () => {
    act(() => {
      root.render(<StatusText kind='ok'>好的</StatusText>)
    })

    expect(status()?.className).toBe('tw-status tw-status--ok')
  })

  it('传入 className 时追加在最后，便于调用方叠加局部样式', () => {
    act(() => {
      root.render(
        <StatusText kind='err' className='tw-kv'>
          失败
        </StatusText>,
      )
    })

    expect(status()?.className).toBe('tw-status tw-status--err tw-kv')
  })

  it('传入空字符串 className 时不会多出一个尾随空格', () => {
    act(() => {
      root.render(
        <StatusText kind='info' className=''>
          提示
        </StatusText>,
      )
    })

    expect(status()?.className).toBe('tw-status tw-status--info')
  })
})

describe('StatusText：children 与空文本', () => {
  it('children 支持 ReactNode，嵌套元素被原样渲染', () => {
    act(() => {
      root.render(
        <StatusText kind='ok'>
          <b>已完成</b> · 12ms
        </StatusText>,
      )
    })

    expect(status()?.querySelector('b')?.textContent).toBe('已完成')
    expect(status()?.textContent).toBe('已完成 · 12ms')
  })

  it('children 为空字符串时仍渲染状态行，但文本为空', () => {
    act(() => {
      root.render(<StatusText kind='info'>{''}</StatusText>)
    })

    const el = status()
    expect(el).not.toBeNull()
    expect(el?.className).toBe('tw-status tw-status--info')
    expect(el?.textContent).toBe('')
    expect(el?.children).toHaveLength(0)
  })

  it('带 role="status"，错误与状态变化能被读屏播报（回归）', () => {
    act(() => {
      root.render(<StatusText kind='err'>出错了</StatusText>)
    })

    const el = status()
    expect(el?.getAttribute('role')).toBe('status')
    // role="status" 已隐含 aria-live="polite"，无需再写显式属性，故如实断言它为空
    expect(el?.getAttribute('aria-live')).toBeNull()
  })
})
