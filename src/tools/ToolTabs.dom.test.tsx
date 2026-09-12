// @vitest-environment happy-dom
import { act, useState } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { DEFAULT_TOOLS } from '@/tools/registry'

import ToolTabs from './ToolTabs'

/**
 * ToolTabs 是各工具内部子切换的唯一实现，承担两件事：
 *  1. 无障碍结构（role=tablist / role=tab / aria-selected）——手写一套会漂移；
 *  2. 激活项滚动进视野（scrollIntoView）。
 * 另外守住 §4 第 11 条：label 必须是已翻译文案，不能把裸 i18n key 渲染出来。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type TabId = 'a' | 'b' | 'c'
type TabsProps = Parameters<typeof ToolTabs<TabId>>[0]

let container: HTMLDivElement
let root: Root
let scrollIntoViewSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  // happy-dom 的 scrollIntoView 是空实现，替换为 spy 以便断言「切到哪一项就滚到哪一项」
  scrollIntoViewSpy = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as Element['scrollIntoView']
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  await i18n.changeLanguage('zh')
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

const nav = () => container.querySelector('[role="tablist"]') as HTMLDivElement
const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

/** 受控包装：点击后真的会切换激活项，用来验证 aria/类名的跟随行为 */
function renderTabs(props: Partial<TabsProps> = {}) {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState<TabId>('a')
    return (
      <ToolTabs<TabId>
        value={value}
        items={[
          { id: 'a', label: '选项 A' },
          { id: 'b', label: '选项 B' },
          { id: 'c', label: '选项 C' },
        ]}
        onChange={(id) => {
          onChange(id)
          setValue(id)
        }}
        {...props}
      />
    )
  }
  act(() => root.render(<Host />))
  return onChange
}

describe('ToolTabs 按 items 渲染选项卡', () => {
  it('渲染 tablist 与等量的 tab，文本与顺序和 items 一致', () => {
    renderTabs()
    expect(nav()).not.toBeNull()
    expect(tabs().map((t) => t.textContent)).toEqual(['选项 A', '选项 B', '选项 C'])
    expect(tabs().every((t) => t.getAttribute('type') === 'button')).toBe(true)
  })

  it('默认类名为 tw-tabs / tw-tabs__btn，className 追加在基础类之后', () => {
    renderTabs({ className: 'tw-tabs--sub' })
    expect(nav().className).toBe('tw-tabs tw-tabs--sub')
    expect(tabs()[0].className).toContain('tw-tabs__btn')
  })

  it('未传 className 时不产生多余空格或空类', () => {
    renderTabs()
    expect(nav().className).toBe('tw-tabs')
  })

  it('aria-label 透传到 tablist 容器', () => {
    renderTabs({ 'aria-label': 'Base64 模式' })
    expect(nav().getAttribute('aria-label')).toBe('Base64 模式')

    act(() => root.unmount())
    root = createRoot(container)
    renderTabs()
    expect(nav().hasAttribute('aria-label')).toBe(false)
  })
})

describe('ToolTabs 的激活态', () => {
  it('只有 value 对应的项 aria-selected=true，其余为 false', () => {
    renderTabs()
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
  })

  it('激活项带 tw-tabs__btn--on，其余不带', () => {
    renderTabs()
    expect(tabs()[0].classList.contains('tw-tabs__btn--on')).toBe(true)
    expect(tabs()[1].classList.contains('tw-tabs__btn--on')).toBe(false)
    expect(tabs()[2].classList.contains('tw-tabs__btn--on')).toBe(false)
  })

  it('value 由外部改变时（非点击）激活态跟着走', () => {
    renderTabs({ value: 'c' })
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true'])
    expect(tabs()[2].classList.contains('tw-tabs__btn--on')).toBe(true)
  })
})

describe('ToolTabs 的点击切换', () => {
  it('点击未激活项回调其 id，并把激活态移过去', () => {
    const onChange = renderTabs()

    act(() => tabs()[1].click())

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('b')
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs()[1].classList.contains('tw-tabs__btn--on')).toBe(true)
  })

  it('点击当前激活项仍会回调同一个 id（幂等，不做静默忽略）', () => {
    const onChange = renderTabs()

    act(() => tabs()[0].click())

    expect(onChange).toHaveBeenCalledWith('a')
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('激活项切换时调用 scrollIntoView 使其滚入视野', () => {
    renderTabs()
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1)
    expect(scrollIntoViewSpy).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })

    act(() => tabs()[2].click())
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2)
  })
})

describe('ToolTabs 的空 items', () => {
  it('items 为空时渲染空 tablist，不抛错也不产生 tab', () => {
    act(() => {
      root.render(<ToolTabs<TabId> items={[]} value='a' onChange={() => {}} />)
    })
    expect(nav()).not.toBeNull()
    expect(nav().children).toHaveLength(0)
    expect(tabs()).toHaveLength(0)
  })
})

describe('ToolTabs 的文案必须已本地化（§4 第 11 条）', () => {
  it('中文下渲染真实工具名，而不是裸 key', async () => {
    await i18n.changeLanguage('zh')
    const items = DEFAULT_TOOLS.map((tool) => ({
      id: tool.id,
      label: i18n.t(`tool.registry.${tool.id}`),
    }))
    act(() => {
      root.render(<ToolTabs items={items} value='base64' onChange={() => {}} />)
    })

    const texts = tabs().map((t) => t.textContent ?? '')
    expect(texts).toHaveLength(DEFAULT_TOOLS.length)
    expect(texts).toContain(i18n.t('tool.registry.base64'))
    // 裸 key 的形态是 "tool.registry.base64"：渲染文本里不允许出现
    for (const text of texts) {
      expect(text).not.toMatch(/^[\w-]+(\.[\w-]+)+$/)
      expect(text).not.toContain('tool.registry.')
    }
  })

  it('英文下同样渲染真实文案，且与中文不同（证明真的走了 i18n）', async () => {
    await i18n.changeLanguage('en')
    const items = DEFAULT_TOOLS.map((tool) => ({
      id: tool.id,
      label: i18n.t(`tool.registry.${tool.id}`),
    }))
    act(() => {
      root.render(<ToolTabs items={items} value='json' onChange={() => {}} />)
    })

    expect(tabs()[0].textContent).toBe(i18n.t('tool.registry.detect'))
    expect(i18n.t('tool.registry.detect')).not.toBe('智能解析')
  })
})
