// @vitest-environment happy-dom
import { act, useState } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import JsonTextarea from './JsonTextarea'

/**
 * JsonTextarea 是「可编辑的 JSON 高亮框」：底层 <pre> 渲染彩色 JSON，上层 textarea 文字透明负责编辑。
 * 与 AutoArea 的关系：两者都是「受控 textarea + 自适应高度」，但 JsonTextarea 额外多一层高亮 <pre>
 * 与滚动同步（onScroll/onInput），且 props 结构不同（没有 areaRef / maxHeight 语义一致）。
 * happy-dom 不做排版，scrollHeight 恒为 0，因此高度按受控 scrollHeight 验证公式。
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
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  consoleErrorSpy.mockRestore()
})

const wrapper = () => container.querySelector('.json-editor') as HTMLDivElement
const pre = () => container.querySelector('pre') as HTMLPreElement
const textarea = () => container.querySelector('textarea') as HTMLTextAreaElement

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

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('JsonTextarea 的双层结构', () => {
  it('外层 .json-editor 内同时有高亮 pre 与编辑 textarea', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={() => {}} />)
    })
    expect(wrapper()).not.toBeNull()
    expect(pre().className).toBe('json-editor__hl')
    expect(pre().parentElement).toBe(wrapper())
    expect(textarea().className).toBe('json-editor__input')
    expect(textarea().previousElementSibling).toBe(pre())
  })

  it('高亮层对读屏隐藏（aria-hidden），可访问文本只来自 textarea', () => {
    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })
    expect(pre().getAttribute('aria-hidden')).toBe('true')
    expect(textarea().getAttribute('aria-hidden')).toBeNull()
  })

  it('高亮层是合法 JSON 语法着色的真实 DOM，而不是纯文本', () => {
    act(() => {
      root.render(
        <JsonTextarea value='{"name": "panda", "n": 12, "ok": true}' onChange={() => {}} />,
      )
    })
    const spans = [...pre().querySelectorAll('span')]
    const byClass = (cls: string) =>
      spans.filter((s) => s.className === cls).map((s) => s.textContent)
    expect(byClass('jhl-key')).toContain('"name"')
    expect(byClass('jhl-str')).toContain('"panda"')
    expect(byClass('jhl-num')).toContain('12')
    expect(byClass('jhl-kw')).toContain('true')
    // 高亮层文本与输入一致（末尾补一个换行，避免最后一行被 pre 吞掉）
    expect(pre().textContent).toBe('{"name": "panda", "n": 12, "ok": true}\n')
  })

  it('非法 JSON 也不崩，退化为不着色的原文（编辑器要允许用户随便改）', () => {
    act(() => {
      root.render(<JsonTextarea value='{不是 JSON' onChange={() => {}} />)
    })
    expect(textarea().value).toBe('{不是 JSON')
    expect(pre().textContent).toContain('{不是 JSON')
  })
})

describe('JsonTextarea 的受控值与输入回调', () => {
  it('渲染传入的 value，外部更新后同步显示', () => {
    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })
    expect(textarea().value).toBe('{"a":1}')

    act(() => {
      root.render(<JsonTextarea value='{"b":2}' onChange={() => {}} />)
    })
    expect(textarea().value).toBe('{"b":2}')
    expect(pre().textContent).toBe('{"b":2}\n')
  })

  it('输入时回调新值，且高亮层随受控 value 更新', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={onChange} />)
    })

    act(() => {
      setTextareaValue(textarea(), '{"x": 1}')
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(<JsonTextarea value='{"x": 1}' onChange={onChange} />)
    })
    expect(pre().querySelector('.jhl-num')?.textContent).toBe('1')
  })

  it('默认关闭拼写检查（避免代码被标红）', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={() => {}} />)
    })
    expect(textarea().getAttribute('spellcheck')).toBe('false')
  })

  it('rest 属性可覆盖默认值并透传（placeholder / aria-label / autoFocus）', () => {
    act(() => {
      root.render(
        <JsonTextarea
          value='{}'
          placeholder='在此粘贴 JSON'
          aria-label='JSON 编辑区'
          spellCheck
          onChange={() => {}}
        />,
      )
    })
    const el = textarea()
    expect(el.getAttribute('placeholder')).toBe('在此粘贴 JSON')
    expect(el.getAttribute('aria-label')).toBe('JSON 编辑区')
    expect(el.getAttribute('spellcheck')).toBe('true')
  })

  it('disabled / readOnly 落到属性上', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' disabled readOnly onChange={() => {}} />)
    })
    expect(textarea().disabled).toBe(true)
    expect(textarea().readOnly).toBe(true)
  })
})

describe('JsonTextarea 的自适应高度（happy-dom 下的实际表现）', () => {
  it('happy-dom 不做排版：scrollHeight 为 0，于是只撑到 12px', () => {
    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })
    expect(textarea().scrollHeight).toBe(0)
    expect(textarea().style.height).toBe('12px')
  })

  it('高度 = scrollHeight + 12，未达 maxHeight 时原样撑开', () => {
    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })
    const el = textarea()
    setScrollHeight(el, 88)

    act(() => {
      root.render(<JsonTextarea value='{"a":2}' onChange={() => {}} />)
    })

    expect(el.style.height).toBe('100px')
  })

  it('内容超过 maxHeight 时封顶', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' maxHeight={150} onChange={() => {}} />)
    })
    const el = textarea()
    setScrollHeight(el, 700)

    act(() => {
      root.render(<JsonTextarea value='{"a":1}' maxHeight={150} onChange={() => {}} />)
    })

    expect(el.style.height).toBe('150px')
  })

  it('maxHeight 默认 300', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={() => {}} />)
    })
    const el = textarea()
    setScrollHeight(el, 9000)

    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })

    expect(el.style.height).toBe('300px')
  })

  it('maxHeight 变化时重新计算', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' maxHeight={500} onChange={() => {}} />)
    })
    const el = textarea()
    setScrollHeight(el, 300)

    // value 不变时 React 会跳过重渲染，因此用值变化驱动 effect 重算
    act(() => {
      root.render(<JsonTextarea value='{"a":1}' maxHeight={500} onChange={() => {}} />)
    })
    expect(el.style.height).toBe('312px')

    act(() => {
      root.render(<JsonTextarea value='{"a":1}' maxHeight={120} onChange={() => {}} />)
    })
    expect(el.style.height).toBe('120px')
  })
})

describe('JsonTextarea 的滚动同步', () => {
  it('input 事件后把 textarea 的滚动位置同步给高亮层', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={() => {}} />)
    })
    const el = textarea()
    const hl = pre()
    el.scrollTop = 42
    el.scrollLeft = 7

    act(() => {
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(hl.scrollTop).toBe(42)
    expect(hl.scrollLeft).toBe(7)
  })

  it('scroll 事件同样触发同步', () => {
    act(() => {
      root.render(<JsonTextarea value='{}' onChange={() => {}} />)
    })
    const el = textarea()
    const hl = pre()
    el.scrollTop = 120

    act(() => {
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    expect(hl.scrollTop).toBe(120)
  })
})

describe('JsonTextarea 的空值与超长值', () => {
  it('空值也能渲染，高亮层不产生错误节点', () => {
    act(() => {
      root.render(<JsonTextarea value='' onChange={() => {}} />)
    })
    expect(textarea().value).toBe('')
    expect(pre().querySelectorAll('span')).toHaveLength(0)
  })

  it('超长 JSON 原样写入，不被截断', () => {
    const long = `[${Array.from({ length: 200 }, (_, i) => i).join(',')}]`
    act(() => {
      root.render(<JsonTextarea value={long} onChange={() => {}} />)
    })
    expect(textarea().value).toBe(long)
    expect(textarea().value.length).toBe(long.length)
  })
})

describe('JsonTextarea 的宽度变化重测', () => {
  it('宽度变化后按新折行结果重测；宽度不变则不重复测量', () => {
    const ro = stubResizeObserver()

    act(() => {
      root.render(<JsonTextarea value='{"a":1}' onChange={() => {}} />)
    })
    const el = textarea()
    expect(ro.observed).toEqual([el])

    // maxHeight 默认 300 → 封顶
    setScrollHeight(el, 400)
    ro.resize(520)
    expect(el.style.height).toBe('300px')

    setScrollHeight(el, 100)
    ro.resize(520)
    expect(el.style.height).toBe('300px')

    setScrollHeight(el, 100)
    ro.resize(300)
    expect(el.style.height).toBe('112px')

    vi.unstubAllGlobals()
  })
})

describe('JsonTextarea 的 Tab 缩进（存储工具的 JSON 值编辑）', () => {
  it('Tab 在光标处缩进并同步受控值；高亮层与输入层同源', () => {
    function Harness() {
      const [value, setValue] = useState('{\n  "account": "admin",\n\n}')
      return <JsonTextarea value={value} onChange={(e) => setValue(e.target.value)} />
    }
    act(() => {
      root.render(<Harness />)
    })

    const el = textarea()
    // 光标停在第 3 行（空行）行首：正是「新起一行按 Tab 再打引号」的位置
    const lineStart = el.value.indexOf('\n\n') + 1
    act(() => el.setSelectionRange(lineStart, lineStart))
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      el.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(el.value).toBe('{\n  "account": "admin",\n  \n}')
    expect(el.selectionStart).toBe(lineStart + 2)
    // 两层文本必须一起更新，否则高亮会错位
    expect(pre().textContent).toContain('\n  \n')
  })

  it('Ctrl+M 之后的 Tab 放行给焦点导航（一次性）', () => {
    function Harness() {
      const [value, setValue] = useState('{}')
      return <JsonTextarea value={value} onChange={(e) => setValue(e.target.value)} />
    }
    act(() => {
      root.render(<Harness />)
    })

    const el = textarea()
    act(() => el.setSelectionRange(1, 1))
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    const released = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => {
      el.dispatchEvent(released)
    })

    expect(released.defaultPrevented).toBe(false)
    expect(el.value).toBe('{}')
  })
})
