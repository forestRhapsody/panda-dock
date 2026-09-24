// @vitest-environment happy-dom
import { act, createRef, useState } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AutoArea from './AutoArea'

/**
 * AutoArea 是「输入 / 解析结果」的共用多行框，核心行为有三块：
 *  1. 受控 value + onChange（原生 setter + input 事件，与 NumberInput 同一套派发方式）；
 *  2. useLayoutEffect 里的自适应高度（height / overflowY 内联样式）；
 *  3. areaRef 透传底层 textarea，供「一键清空后聚焦」使用。
 * happy-dom 不做真实排版，scrollHeight 恒为 0，所以自适应高度用受控的
 * scrollHeight 覆盖来验证计算公式（min(scrollHeight + 12, maxHeight)），
 * 同时保留一个「happy-dom 真实值」的对照用例如实记录默认结果。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // 只读 / 无 onChange 的用例下 React 会打印告警，测试期间静音以免刷屏
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  consoleErrorSpy.mockRestore()
})

const area = () => container.querySelector('textarea') as HTMLTextAreaElement

/** happy-dom 不排版，用受控的 scrollHeight 验证高度公式 */
function setScrollHeight(el: HTMLTextAreaElement, value: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value })
}

/** 假的 ResizeObserver：捕获回调与观察目标，用于断言「宽度变化后重测」 */
function stubResizeObserver() {
  const callbacks: ResizeObserverCallback[] = []
  const observed: Element[] = []
  class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb)
    }
    observe(el: Element) {
      observed.push(el)
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  return {
    observed,
    /** 模拟容器宽度变化 */
    resize(width: number) {
      act(() => {
        callbacks[0]?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)
      })
    },
  }
}

/** 原生 setter 派发 input（React 的 onChange 实际监听的是 input 事件） */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('AutoArea 的受控值渲染与 onChange', () => {
  it('渲染传入的 value，并在外部更新 value 后同步显示', () => {
    act(() => {
      root.render(<AutoArea value='第一行' onChange={() => {}} />)
    })
    expect(area().value).toBe('第一行')

    act(() => {
      root.render(<AutoArea value='第二行' onChange={() => {}} />)
    })
    expect(area().value).toBe('第二行')
  })

  it('输入时以事件形式回调，事件里能同步取到新值', () => {
    const onChange = vi.fn()
    // React 受控组件在事件处理结束后会把 DOM value 写回受控值（见本组最后一个用例），
    // 所以必须在回调内部同步采样 e.target.value/maxLength，而不是事件之后再看 DOM。
    let seenValue = ''
    let seenMaxLength = -1
    act(() => {
      root.render(
        <AutoArea
          value=''
          maxLength={100}
          onChange={(e) => {
            seenValue = e.target.value
            seenMaxLength = e.target.maxLength
            onChange(e)
          }}
        />,
      )
    })

    act(() => {
      setTextareaValue(area(), '用户输入的内容')
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(seenValue).toBe('用户输入的内容')
    // 事件目标是底层 textarea 本身，透传的 maxLength 也能读到
    expect(seenMaxLength).toBe(100)
  })

  it('受控：父级不更新 value 时，input 事件不会改变框内显示', () => {
    act(() => {
      root.render(<AutoArea value='固定值' onChange={() => {}} />)
    })

    act(() => {
      setTextareaValue(area(), '被丢弃的输入')
    })

    expect(area().value).toBe('固定值')
  })
})

describe('AutoArea 的自适应高度（happy-dom 下的实际表现）', () => {
  it('happy-dom 不做排版：scrollHeight 为 0，于是只撑到 12px 且隐藏滚动条', () => {
    act(() => {
      root.render(<AutoArea value='内容' onChange={() => {}} />)
    })
    const el = area()
    expect(el.scrollHeight).toBe(0)
    expect(el.style.height).toBe('12px')
    expect(el.style.overflowY).toBe('hidden')
  })

  it('内容未超上限时高度 = scrollHeight + 12，滚动条隐藏', () => {
    act(() => {
      root.render(<AutoArea value='短内容' onChange={() => {}} />)
    })
    const el = area()
    setScrollHeight(el, 120)

    act(() => {
      root.render(<AutoArea value='短内容更新' onChange={() => {}} />)
    })

    expect(el.style.height).toBe('132px')
    expect(el.style.overflowY).toBe('hidden')
  })

  it('内容超过 maxHeight 时高度封顶，滚动条转为 auto', () => {
    act(() => {
      root.render(<AutoArea value='超长内容' maxHeight={200} onChange={() => {}} />)
    })
    const el = area()
    setScrollHeight(el, 900)

    act(() => {
      root.render(<AutoArea value='超长内容再加一点' maxHeight={200} onChange={() => {}} />)
    })

    expect(el.style.height).toBe('200px')
    expect(el.style.overflowY).toBe('auto')
  })

  it('maxHeight 默认 360', () => {
    act(() => {
      root.render(<AutoArea value='内容' onChange={() => {}} />)
    })
    const el = area()
    setScrollHeight(el, 5000)

    act(() => {
      root.render(<AutoArea value='内容2' onChange={() => {}} />)
    })

    expect(el.style.height).toBe('360px')
    expect(el.style.overflowY).toBe('auto')
  })

  it('maxHeight 变化时重新计算高度', () => {
    act(() => {
      root.render(<AutoArea value='内容' maxHeight={1000} onChange={() => {}} />)
    })
    const el = area()
    setScrollHeight(el, 400)

    // 注意：value / maxHeight 都不变的重复 render 不会触发 useLayoutEffect（React 会跳过相同 props），
    // 因此这里用「值变化」来驱动重算。
    act(() => {
      root.render(<AutoArea value='内容2' maxHeight={1000} onChange={() => {}} />)
    })
    expect(el.style.height).toBe('412px')
    expect(el.style.overflowY).toBe('hidden')

    act(() => {
      root.render(<AutoArea value='内容2' maxHeight={150} onChange={() => {}} />)
    })
    expect(el.style.height).toBe('150px')
    expect(el.style.overflowY).toBe('auto')
  })
})

describe('AutoArea 的 props 透传', () => {
  it('placeholder / rows / maxLength / spellCheck 原样落到 textarea', () => {
    act(() => {
      root.render(
        <AutoArea
          value=''
          onChange={() => {}}
          placeholder='粘贴或输入内容'
          rows={6}
          maxLength={500}
          spellCheck={false}
        />,
      )
    })
    const el = area()
    expect(el.getAttribute('placeholder')).toBe('粘贴或输入内容')
    expect(el.getAttribute('rows')).toBe('6')
    expect(el.getAttribute('maxlength')).toBe('500')
    expect(el.getAttribute('spellcheck')).toBe('false')
  })

  it('disabled 与 readOnly 落到属性上', () => {
    act(() => {
      root.render(<AutoArea value='只读' disabled readOnly onChange={() => {}} />)
    })
    const el = area()
    expect(el.disabled).toBe(true)
    expect(el.readOnly).toBe(true)
  })

  it('className / aria-label 透传', () => {
    act(() => {
      root.render(
        <AutoArea value='' className='tw-area' aria-label='解析结果' onChange={() => {}} />,
      )
    })
    const el = area()
    expect(el.getAttribute('class')).toBe('tw-area')
    expect(el.getAttribute('aria-label')).toBe('解析结果')
  })

  it('maxHeight 与 areaRef 不会作为原生属性泄漏到 DOM 上', () => {
    act(() => {
      root.render(<AutoArea value='' maxHeight={200} onChange={() => {}} />)
    })
    const el = area()
    expect(el.hasAttribute('maxheight')).toBe(false)
    expect(el.hasAttribute('arearef')).toBe(false)
  })
})

describe('AutoArea 的 areaRef 透传', () => {
  it('挂载后 areaRef.current 指向真实 textarea，可直接聚焦 / 清空', () => {
    const ref = createRef<HTMLTextAreaElement | null>()
    act(() => {
      root.render(<AutoArea value='待清空' areaRef={ref} onChange={() => {}} />)
    })

    expect(ref.current).toBe(area())
    act(() => ref.current?.focus())
    expect(document.activeElement).toBe(area())
  })

  it('未传 areaRef 时也能正常工作，且不影响 DOM', () => {
    act(() => {
      root.render(<AutoArea value='x' onChange={() => {}} />)
    })
    expect(area().value).toBe('x')
  })
})

describe('AutoArea 的空值与超长值', () => {
  it('value 为空串时 textarea 显示为空', () => {
    act(() => {
      root.render(<AutoArea value='' onChange={() => {}} />)
    })
    expect(area().value).toBe('')
  })

  it('超长多行值原样写入，不被截断', () => {
    const long = Array.from({ length: 300 }, (_, i) => `第 ${i} 行`).join('\n')
    act(() => {
      root.render(<AutoArea value={long} onChange={() => {}} />)
    })
    const el = area()
    expect(el.value).toBe(long)
    expect(el.value.split('\n')).toHaveLength(300)
  })
})

describe('AutoArea 的 Tab 缩进', () => {
  /** 受控宿主：Tab 缩进必须经由 input 事件同步回 state，而不是只改 DOM */
  function renderEditable(initial: string) {
    function Harness() {
      const [value, setValue] = useState(initial)
      return <AutoArea value={value} onChange={(e) => setValue(e.target.value)} />
    }
    act(() => {
      root.render(<Harness />)
    })
  }

  function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    act(() => {
      area().dispatchEvent(event)
    })
    return event
  }

  it('Tab 在光标处插入缩进并同步受控值，不交出焦点', () => {
    renderEditable('a=1')
    act(() => area().setSelectionRange(3, 3))

    const event = press('Tab')

    expect(event.defaultPrevented).toBe(true)
    expect(area().value).toBe('a=1  ')
    expect(area().selectionStart).toBe(5)
  })

  it('Shift+Tab 反缩进当前行并同步受控值', () => {
    renderEditable('  a=1')
    act(() => area().setSelectionRange(4, 4))

    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)

    expect(area().value).toBe('a=1')
    expect(area().selectionStart).toBe(2)
  })

  it('Escape 之后的 Tab 放行给焦点导航（一次性兜底）', () => {
    renderEditable('a=1')
    press('Escape')

    const event = press('Tab')

    expect(event.defaultPrevented).toBe(false)
    expect(area().value).toBe('a=1')
  })

  it('只读框不拦截 Tab（读结果时仍是原生焦点导航）', () => {
    act(() => {
      root.render(<AutoArea value='结果' readOnly onChange={() => {}} />)
    })

    const event = press('Tab')

    expect(event.defaultPrevented).toBe(false)
    expect(area().value).toBe('结果')
  })

  it('调用方自己的 onKeyDown 先执行；它 preventDefault 后不再缩进', () => {
    const external = vi.fn((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') e.preventDefault()
    })
    act(() => {
      root.render(<AutoArea value='a=1' onChange={() => {}} onKeyDown={external} />)
    })

    const event = press('Tab')

    expect(external).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(area().value).toBe('a=1')
  })

  it('其他按键（含 Ctrl+Tab）不受影响，值不变', () => {
    renderEditable('a=1')

    expect(press('Enter').defaultPrevented).toBe(false)
    expect(press('Tab', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(area().value).toBe('a=1')
  })
})

describe('AutoArea 的宽度变化重测（抽屉↔原生侧边栏 / 拖拽抽屉宽度）', () => {
  it('宽度变化后按新折行结果重测；宽度不变则不重复测量', () => {
    const ro = stubResizeObserver()

    act(() => {
      root.render(<AutoArea value='一段会被重新折行的内容' onChange={() => {}} />)
    })
    const el = area()
    expect(ro.observed).toEqual([el])

    // 变宽 → 行数变少 → 高度随之变化
    setScrollHeight(el, 400)
    ro.resize(520)
    expect(el.style.height).toBe('360px')

    // 宽度没变就不该重测（避免无意义的布局写入）
    setScrollHeight(el, 100)
    ro.resize(520)
    expect(el.style.height).toBe('360px')

    // 再变窄 → 重新测量
    setScrollHeight(el, 100)
    ro.resize(300)
    expect(el.style.height).toBe('112px')

    vi.unstubAllGlobals()
  })
})
