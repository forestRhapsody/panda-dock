// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import NumberInput from './NumberInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set
  nativeInputValueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('NumberInput', () => {
  it('初始渲染 value', () => {
    act(() => {
      root.render(<NumberInput value={60} onChange={() => {}} />)
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('60')
  })

  it('允许用户把内容全部删空成 ""，并不立即触发 onChange', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<NumberInput value={60} onChange={onChange} />)
    })
    const input = container.querySelector('input') as HTMLInputElement

    act(() => {
      setInputValue(input, '')
    })

    // 输入框显示为空，允许用户从空开始填
    expect(input.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('从空输入 0 时，正确触发 onChange(0)', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<NumberInput value={60} onChange={onChange} />)
    })
    const input = container.querySelector('input') as HTMLInputElement

    act(() => {
      setInputValue(input, '')
    })
    expect(input.value).toBe('')

    act(() => {
      setInputValue(input, '0')
    })
    expect(input.value).toBe('0')
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('输入合法数字实时触发 onChange，并受 min/max 限制', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<NumberInput value={60} min={0} max={800} onChange={onChange} />)
    })
    const input = container.querySelector('input') as HTMLInputElement

    act(() => {
      setInputValue(input, '150')
    })
    expect(onChange).toHaveBeenCalledWith(150)

    act(() => {
      setInputValue(input, '9999')
    })
    expect(onChange).toHaveBeenCalledWith(800)
  })

  it('输入框留空失焦时，恢复为当前有效值', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<NumberInput value={60} onChange={onChange} />)
    })
    const input = container.querySelector('input') as HTMLInputElement

    act(() => {
      setInputValue(input, '')
    })
    expect(input.value).toBe('')

    act(() => {
      input.focus()
      input.blur()
    })
    expect(input.value).toBe('60')
    expect(onChange).toHaveBeenCalledWith(60)
  })

  it('外部主动修改 value 时同步更新显示', () => {
    act(() => {
      root.render(<NumberInput value={60} onChange={() => {}} />)
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('60')

    act(() => {
      root.render(<NumberInput value={100} onChange={() => {}} />)
    })
    expect(input.value).toBe('100')
  })
})
