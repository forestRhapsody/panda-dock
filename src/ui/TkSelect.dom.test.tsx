// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TkSelect from './TkSelect'

/**
 * TkSelect 是全项目替代原生 <select> 的唯一通用下拉（AGENTS §4 第 14 条），
 * 它的键盘导航、点击外部关闭、portal 挂载点、disabled 行为都是被大量调用方
 * （Options / 工具栏 / content 抽屉）依赖的公共契约，所以按真实 DOM 逐条验证，
 * 而不是只断言「渲染出来了」。
 *
 * 运行时前提：happy-dom 里 getBoundingClientRect() 恒为 0，
 * 因此本文件只断言「展开/收起 + 结构 + 回调」，不断言像素级定位（见交付报告）。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  // 下拉经 portal 渲染到 body（tooltip 同理），必须清掉，避免跨用例串扰
  document.body.innerHTML = ''
})

/** 触发器：源码用 button.tk-select 承载 combobox 角色 */
function trigger(): HTMLButtonElement {
  const el = container.querySelector('button.tk-select')
  if (!el) throw new Error('未找到 TkSelect 触发器')
  return el as HTMLButtonElement
}

/** 下拉面板被 portal 到 document.body（happy-dom 里 trigger 的根节点是 document） */
function popup(): HTMLElement | null {
  return document.body.querySelector('.tk-select-popup')
}

function items(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('.tk-select-item')]
}

function labelTexts(): (string | null)[] {
  return [...document.body.querySelectorAll('.tk-select-item__label')].map((n) => n.textContent)
}

/** 当前值文本（.tk-select__value） */
function shownValue(): string {
  return container.querySelector('.tk-select__value')?.textContent ?? ''
}

/**
 * 统一派发事件。
 * 注意：普通 Event 即使 type 写 'keydown' 也不带 key 属性，键盘必须用 KeyboardEvent，
 * 否则源码的 e.key 为 undefined，会静默走不到任何分支。
 */
function fire(el: Element, type: string, init: KeyboardEventInit = {}): Event {
  const event: Event =
    type === 'keydown' || type === 'keyup'
      ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })
      : new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  act(() => {
    el.dispatchEvent(event)
  })
  return event
}

/** 打开下拉（点击触发器） */
function open(btn: HTMLButtonElement = trigger()) {
  fire(btn, 'click')
}

describe('TkSelect 自定义下拉', () => {
  it('初始按 value 显示对应 label，而不是 value 本身', () => {
    act(() => {
      root.render(
        <TkSelect value='b' onChange={() => {}}>
          <option value='a'>甲方案</option>
          <option value='b'>乙方案</option>
        </TkSelect>,
      )
    })

    expect(shownValue()).toBe('乙方案')
    expect(shownValue()).not.toBe('b')
    expect(trigger().getAttribute('role')).toBe('combobox')
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().getAttribute('aria-label')).toBe('乙方案')
    expect(popup()).toBeNull()
  })

  it('点击触发器展开选项列表，aria-expanded 变 true，面板 portal 到 body 而非容器内', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()

    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().className).toContain('tk-select--open')
    const panel = popup()
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('role')).toBe('listbox')
    // portal 到 body：容器里不应出现面板，否则会被父级 overflow 裁剪
    expect(container.querySelector('.tk-select-popup')).toBeNull()
    expect(items()).toHaveLength(2)
    expect(labelTexts()).toEqual(['甲', '乙'])
    for (const item of items()) expect(item.getAttribute('role')).toBe('option')
  })

  it('实测校正后弹层可见，且左右都被夹在视口内（回归）', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()

    const panel = popup()
    expect(panel).not.toBeNull()
    // 校正完成前会先 visibility:hidden（避免初始 left:0 在屏幕最左侧闪一帧），
    // 布局 effect 跑完后必须已经可见，否则等于「下拉打不开」
    expect(panel?.style.visibility).toBe('')
    // 回归：右对齐分支曾用 innerWidth 估算，视口宽度跳变时会把弹层推到左边界之外；
    // 现在用实测宽度做左右双向夹取，left 必须落在 [8, innerWidth - width - 8]
    const left = Number.parseFloat(panel?.style.left ?? 'NaN')
    expect(Number.isNaN(left)).toBe(false)
    expect(left).toBeGreaterThanOrEqual(8)
    // 夹取后统一用 left 定位，不再同时挂着 right（避免两套坐标互相打架）
    expect(panel?.style.right).toBe('')
  })

  it('再次点击触发器收起面板', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    open()
    expect(popup()).not.toBeNull()

    open()
    expect(popup()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().className).not.toContain('tk-select--open')
  })

  it('点击选项触发 onChange 并传入 { target: { value } }，随后收起并显示新 label', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()
    // 源码用 onPointerDown（并 preventDefault 防止抢占焦点），不是 onClick
    fire(items()[1], 'pointerdown')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'b' } })
    expect(popup()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    // 父级把新 value 传回来后显示新 label
    act(() => {
      root.render(
        <TkSelect value='b' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })
    expect(shownValue()).toBe('乙')
  })

  it('选中项带 --selected 类并显示 check 图标，焦点项带 --focused 类', () => {
    act(() => {
      root.render(
        <TkSelect value='b' onChange={() => {}}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()

    const [first, second] = items()
    expect(second.className).toContain('tk-select-item--selected')
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(first.getAttribute('aria-selected')).toBe('false')
    // 选中项左侧渲染 check 图标，未选中项只有空占位
    expect(second.querySelector('.tk-select-item__check svg')).not.toBeNull()
    expect(first.querySelector('.tk-select-item__check svg')).toBeNull()
    // 打开时焦点落在当前选中项
    expect(second.className).toContain('tk-select-item--focused')
  })

  it('同一 value 再次选择仍会触发一次 onChange（源码未做去重）', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()
    fire(items()[0], 'pointerdown')
    open()
    fire(items()[0], 'pointerdown')

    // 如实断言现状：重复选同一项不会短路，调用方需自行处理幂等
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenNthCalledWith(1, { target: { value: 'a' } })
    expect(onChange).toHaveBeenNthCalledWith(2, { target: { value: 'a' } })
  })

  it('点击组件外部（外部节点派发 pointerdown）关闭面板；点触发器/面板自身不关闭', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    // 面板内部的 pointerdown 不应被当成「点外部」
    open()
    fire(popup() as HTMLElement, 'pointerdown')
    expect(popup()).not.toBeNull()

    // 触发器自身同理
    fire(trigger(), 'pointerdown')
    expect(popup()).not.toBeNull()

    // 真正的外部节点：清源用 composedPath()，因此事件必须在 DOM 树里冒泡到 document
    const outside = document.createElement('button')
    outside.textContent = '外部'
    document.body.appendChild(outside)
    fire(outside, 'pointerdown')
    outside.remove()

    expect(popup()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('disabled 时点击不展开，也不派发 pointerdown 选中回调', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange} disabled>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    expect(trigger().disabled).toBe(true)
    open()
    expect(popup()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    // 键盘路径同样被 disabled 拦截
    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    fire(trigger(), 'keydown', { key: 'Enter' })
    expect(popup()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('键盘 ArrowDown 展开，再次 ArrowDown 移动焦点，Enter 选中并关闭', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
          <option value='c'>丙</option>
        </TkSelect>,
      )
    })

    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    expect(popup()).not.toBeNull()
    expect(items()[0].className).toContain('tk-select-item--focused')

    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    expect(items()[1].className).toContain('tk-select-item--focused')

    fire(trigger(), 'keydown', { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'b' } })
    expect(popup()).toBeNull()
  })

  it('键盘 ArrowDown 跳过 disabled 选项', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
          <option value='b' disabled>
            乙（禁用）
          </option>
          <option value='c'>丙</option>
        </TkSelect>,
      )
    })

    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    expect(items()[0].className).toContain('tk-select-item--focused')

    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    // 落在 b 上会被 do/while 跳过，直接到 c
    expect(items()[1].className).not.toContain('tk-select-item--focused')
    expect(items()[2].className).toContain('tk-select-item--focused')
  })

  it('禁用选项不可选中：pointerdown 不触发 onChange，且带 --disabled 与 aria-disabled', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b' disabled>
            乙（禁用）
          </option>
        </TkSelect>,
      )
    })

    open()
    const disabledItem = items()[1]
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true')
    expect(disabledItem.className).toContain('tk-select-item--disabled')

    fire(disabledItem, 'pointerdown')
    expect(onChange).not.toHaveBeenCalled()
    expect(popup()).not.toBeNull()
  })

  it('键盘 ArrowUp 在首项处夹紧（不会越界成 -1）', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    fire(trigger(), 'keydown', { key: 'ArrowUp' })
    expect(items()[0].className).toContain('tk-select-item--focused')
    fire(trigger(), 'keydown', { key: 'ArrowUp' })
    expect(items()[0].className).toContain('tk-select-item--focused')
  })

  it('Escape 关闭面板，不触发 onChange', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    open()
    expect(popup()).not.toBeNull()

    fire(trigger(), 'keydown', { key: 'Escape' })
    expect(popup()).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Tab 关闭面板', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}}>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    open()
    fire(trigger(), 'keydown', { key: 'Tab' })
    expect(popup()).toBeNull()
  })

  it('Space 在收起态展开、展开态选中当前焦点项', () => {
    const onChange = vi.fn()
    act(() => {
      root.render(
        <TkSelect value='a' onChange={onChange}>
          <option value='a'>甲</option>
          <option value='b'>乙</option>
        </TkSelect>,
      )
    })

    fire(trigger(), 'keydown', { key: ' ' })
    expect(popup()).not.toBeNull()

    fire(trigger(), 'keydown', { key: 'ArrowDown' })
    fire(trigger(), 'keydown', { key: ' ' })
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'b' } })
    expect(popup()).toBeNull()
  })

  it('选项为空时仍可渲染面板，但不出现任何 option，回车不会触发 onChange', () => {
    const onChange = vi.fn()
    act(() => {
      // 显式传 children={null}（TkSelectProps 里 children 是必填），模拟无任何 option
      root.render(<TkSelect value='a' onChange={onChange} children={null} />)
    })

    expect(trigger().disabled).toBe(false)
    open()
    expect(popup()).not.toBeNull()
    expect(items()).toHaveLength(0)

    // 无选项时 Enter / Space 的分支直接落空：面板保持打开、也不触发 onChange
    // （如实记录现状，见交付报告「源码疑点」）
    fire(trigger(), 'keydown', { key: 'Enter' })
    expect(popup()).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    fire(trigger(), 'keydown', { key: 'Escape' })
    expect(popup()).toBeNull()
  })

  it('受控 value 与任何选项都不匹配时显示占位符 —（不显示错误 label）', () => {
    act(() => {
      root.render(
        <TkSelect value='missing' onChange={() => {}}>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    expect(container.querySelector('.tk-select__placeholder')?.textContent).toBe('—')
    expect(shownValue()).toBe('—')
    // aria-label 回退到空 label 而不是 value
    expect(trigger().getAttribute('aria-label')).toBe('')
  })

  it('variant="sm" 与 id / className 透传到触发器，chevron 尺寸随 variant 变化', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}} variant='sm' id='pick' className='extra'>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    const btn = trigger()
    expect(btn.className).toContain('tk-select--sm')
    expect(btn.className).toContain('extra')
    expect(btn.id).toBe('pick')
    expect(btn.querySelector('.tk-select__arrow svg')?.getAttribute('width')).toBe('12')

    open()
    expect(popup()?.className).toContain('tk-select-popup--sm')
  })

  it('aria-label 透传到 combobox 与 listbox', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}} aria-label='选择方案'>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    expect(trigger().getAttribute('aria-label')).toBe('选择方案')
    open()
    expect(popup()?.getAttribute('aria-label')).toBe('选择方案')
  })

  it('title 存在时由 Tooltip 包裹触发器，不额外插入包裹节点破坏布局', () => {
    act(() => {
      root.render(
        <TkSelect value='a' onChange={() => {}} title='选择方案'>
          <option value='a'>甲</option>
        </TkSelect>,
      )
    })

    // Tooltip 只 cloneElement 触发器，容器首个子元素仍是同一个 button
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
    expect(container.firstElementChild?.className).toContain('tk-select')
  })

  it('文案没有渲染成裸 i18n key（触发值与选项标签均不含 tk. / tool. 前缀 key）', () => {
    act(() => {
      root.render(
        <TkSelect value='zh-CN' onChange={() => {}} title='界面语言'>
          <option value='zh-CN'>简体中文</option>
          <option value='en'>English</option>
        </TkSelect>,
      )
    })

    open()

    const rendered = [shownValue(), ...labelTexts(), ...items().map((i) => i.dataset.tksItem ?? '')]
    expect(rendered.join('|')).toContain('简体中文')
    for (const text of rendered) {
      expect(text ?? '').not.toMatch(/^(tk|tool|common|settings)\./)
    }
    // 中文标签里必须真的含 CJK，防「key 被当成文案渲染」
    expect(shownValue()).toMatch(/[\u4e00-\u9fa5]/)
  })
})
