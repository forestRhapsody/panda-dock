// @vitest-environment happy-dom
import { act, useState } from 'react'
import type { RefObject } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useEmptyError } from './useEmptyError'

/**
 * useEmptyError 是 §4 条 15 的统一空输入交互实现：triggerEmpty = 红框 + 聚焦。
 * hook 必须放在真实组件里才有效果，所以这里用一个 Probe 复刻源码注释中的标准用法，
 * 再断言 DOM 上真的能看到的类名、焦点与状态收敛。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 按源码注释的用法复刻：空输入点按钮 → 红框 + 聚焦；改内容或点清除 → 复原 */
function Probe() {
  const [value, setValue] = useState('')
  const { emptyErr, areaRef, triggerEmpty, clearEmpty } = useEmptyError<HTMLInputElement>()

  return (
    <div>
      <input
        ref={areaRef}
        data-testid='area'
        value={value}
        className={emptyErr ? 'tw-area tw-area--empty-err' : 'tw-area'}
        onChange={(event) => {
          if (emptyErr) clearEmpty()
          setValue(event.target.value)
        }}
      />
      <button
        type='button'
        data-testid='submit'
        onClick={() => {
          if (!value.trim()) {
            triggerEmpty()
            return
          }
        }}
      >
        submit
      </button>
      <button type='button' data-testid='clear' onClick={clearEmpty}>
        clear
      </button>
      <span data-testid='flag'>{emptyErr ? 'err' : 'ok'}</span>
      <span data-testid='ref-tag'>{areaRef.current?.tagName ?? 'none'}</span>
    </div>
  )
}

let container: HTMLDivElement
let root: Root

const $ = <T extends HTMLElement>(testId: string): T => {
  const el = container.querySelector<T>(`[data-testid="${testId}"]`)
  if (!el) throw new Error(`未找到 [data-testid="${testId}"]`)
  return el
}
const flag = () => $('flag').textContent

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useEmptyError：触发空输入错误', () => {
  it('输入为空时点按钮：emptyErr 变 true、输入框挂上错误类名并获得焦点', () => {
    act(() => {
      root.render(<Probe />)
    })
    const area = $<HTMLInputElement>('area')
    expect(flag()).toBe('ok')
    expect(area.className).toBe('tw-area')

    act(() => $<HTMLButtonElement>('submit').click())

    expect(flag()).toBe('err')
    expect(area.className).toBe('tw-area tw-area--empty-err')
    // triggerEmpty 的核心副作用就是聚焦，用户可以直接开始输入
    expect(document.activeElement).toBe(area)
  })

  it('clearEmpty() 后回到 false 并摘掉错误类名', () => {
    act(() => {
      root.render(<Probe />)
    })
    const area = $<HTMLInputElement>('area')

    act(() => $<HTMLButtonElement>('submit').click())
    expect(flag()).toBe('err')

    act(() => $<HTMLButtonElement>('clear').click())
    expect(flag()).toBe('ok')
    expect(area.className).toBe('tw-area')
  })

  it('触发 → 清除 → 再触发 → 再清除，状态收敛且可重复', () => {
    act(() => {
      root.render(<Probe />)
    })

    act(() => $<HTMLButtonElement>('submit').click())
    expect(flag()).toBe('err')

    // 重复触发保持 error，不翻转
    act(() => $<HTMLButtonElement>('submit').click())
    expect(flag()).toBe('err')

    act(() => $<HTMLButtonElement>('clear').click())
    expect(flag()).toBe('ok')

    // 重复清除同样不翻转
    act(() => $<HTMLButtonElement>('clear').click())
    expect(flag()).toBe('ok')

    act(() => $<HTMLButtonElement>('submit').click())
    expect(flag()).toBe('err')

    act(() => $<HTMLButtonElement>('clear').click())
    expect(flag()).toBe('ok')
  })
})

describe('useEmptyError：areaRef', () => {
  it('areaRef 在挂载后指向真实的输入框节点', () => {
    act(() => {
      root.render(<Probe />)
    })

    const area = $<HTMLInputElement>('area')
    // Probe 里 ref-tag 初次渲染时 ref 还没挂上，触发一次状态更新后才读得到节点
    expect($('ref-tag').textContent).toBe('none')

    act(() => $<HTMLButtonElement>('submit').click())
    expect($('ref-tag').textContent).toBe('INPUT')
    expect(area.tagName).toBe('INPUT')
  })

  it('hook 交出的 ref 对象 current 就是同一个真实 DOM 节点', () => {
    const holder: { ref: RefObject<HTMLInputElement | null> | null } = { ref: null }

    function RefProbe() {
      const { areaRef } = useEmptyError<HTMLInputElement>()
      holder.ref = areaRef
      return <input ref={areaRef} data-testid='area' />
    }

    act(() => {
      root.render(<RefProbe />)
    })

    const area = $<HTMLInputElement>('area')
    expect(holder.ref).not.toBeNull()
    expect(holder.ref?.current).toBe(area)
  })

  it('ref 未挂载时 triggerEmpty 不抛错，并且 emptyErr 仍然置为 true', () => {
    // 故意不把 areaRef 绑到任何节点：模拟输入框已被条件渲染移除的瞬间
    function DetachedProbe() {
      const { emptyErr, triggerEmpty } = useEmptyError<HTMLInputElement>()
      return (
        <button type='button' data-testid='detached' onClick={triggerEmpty}>
          {emptyErr ? 'err' : 'ok'}
        </button>
      )
    }

    act(() => {
      root.render(<DetachedProbe />)
    })
    const button = $<HTMLButtonElement>('detached')
    expect(button.textContent).toBe('ok')

    act(() => button.click())

    // 没有可聚焦的节点也不崩，状态照常切换（源码用的是 areaRef.current?.focus()）
    expect(button.textContent).toBe('err')
    expect(document.activeElement).not.toBe(button)
  })
})
