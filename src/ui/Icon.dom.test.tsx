// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import Icon from './Icon'
import type { IconName } from './Icon'
import iconSource from './Icon.tsx?raw'

/**
 * §4 第 14 条：Icon 取代 emoji，且新图标必须在 Icon.tsx 注册 SVG path。
 * 这里直接从源码文本里抽取 GLYPHS 的 key 集合（源码没有导出运行时名单），
 * 再逐个渲染断言——注册了新图标却忘了补测试时，本文件会直接失败。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 硬编码的图标名清单，仅作双重校验：与源码 GLYPHS 抽取结果必须完全一致
 * （拼错名字时 `satisfies readonly IconName[]` 会在 tsc 阶段报错）。
 */
const EXPECTED_ICON_NAMES = [
  'toolbox',
  'settings',
  'panel-right',
  'window',
  'code',
  'close',
  'grip',
  'check',
  'copy',
  'qr-code',
  'upload',
  'download',
  'external-link',
  'image',
  'chevron-down',
  'chevron-right',
  'chevron-left',
  'pin',
  'alert',
  'info',
  'refresh',
  'swap',
  'search',
  'maximize',
  'minimize',
  'plus',
  'edit',
  'hash',
] as const satisfies readonly IconName[]

/** 从源码文本抽取 `const GLYPHS: Record<IconName, ReactNode> = { ... }` 里的图标名 */
function extractRegisteredIconNames(source: string): string[] {
  const body = source.match(/const GLYPHS: Record<IconName, ReactNode> = \{([\s\S]*?)\n\}\n/)?.[1]
  if (!body) throw new Error('未能从 Icon.tsx 源码中定位 GLYPHS 对象')
  return [...body.matchAll(/^ {2}'?([A-Za-z][\w-]*)'?:/gm)].map((m) => m[1])
}

/** emoji / 杂项符号 / 变体选择符范围：用来守住「Icon 里不许出现 emoji」 */
const EMOJI_RE = new RegExp(
  // eslint-disable-next-line no-misleading-character-class -- 这里正是要「按字符范围」匹配组合字符，不是误用
  '[' +
    '\\u{1F000}-\\u{1FAFF}' + // 麻将、扑克、各类 emoji、扩展符号
    '\\u{2600}-\\u{27BF}' + // 杂项符号与丁巴特符号（含 ⚠ ✅ 等）
    '\\u{FE0F}\\u{FE0E}' + // 变体选择符
    '\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}' + // 箭头与杂项符号箭头
    '\\u{1F1E6}-\\u{1F1FF}' + // 区域指示符（国旗）
    ']',
  'u',
)

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
})

/** 传入非法名字需要 cast：类型层面不允许，但运行期会拿到降级结果 */
function renderIcon(name: string, props: Record<string, unknown> = {}) {
  act(() => {
    root.render(<Icon name={name as IconName} {...props} />)
  })
  return container.querySelector('svg') as SVGSVGElement
}

describe('Icon 的图标集合注册完整性', () => {
  it('源码 GLYPHS 里注册的图标名与测试清单完全一致（新增图标必须同步）', () => {
    expect(extractRegisteredIconNames(iconSource)).toEqual([...EXPECTED_ICON_NAMES])
  })

  it('每个已注册图标都渲染出非空 SVG 图形内容', () => {
    for (const name of extractRegisteredIconNames(iconSource)) {
      const svg = renderIcon(name)
      // 根节点存在且是真实 SVG 命名空间元素
      expect(svg, `${name} 未渲染出 svg`).toBeTruthy()
      expect(svg.namespaceURI, `${name} 的 namespace 不对`).toBe('http://www.w3.org/2000/svg')
      expect(svg.getAttribute('viewBox'), `${name} 缺少 viewBox`).toBe('0 0 24 24')
      expect(svg.children.length, `${name} 没有任何图形子元素`).toBeGreaterThan(0)

      const html = svg.innerHTML
      // 描边路径的 d 必须非空；实心图标（grip）用 circle，至少要有 r
      const hasDrawable =
        [...svg.querySelectorAll('path')].some((p) => (p.getAttribute('d') ?? '').trim() !== '') ||
        [...svg.querySelectorAll('circle')].some((c) => Number(c.getAttribute('r')) > 0) ||
        svg.querySelector('rect, line, polyline, polygon') !== null
      expect(hasDrawable, `${name} 的图形内容为空`).toBe(true)

      // 图形文本不应为空串的退化 SVG
      expect(html.length, `${name} 的 innerHTML 为空`).toBeGreaterThan(0)
    }
  })

  it('所有图标的渲染结果里没有 emoji 字符（§4 第 14 条）', () => {
    for (const name of extractRegisteredIconNames(iconSource)) {
      const svg = renderIcon(name)
      expect(EMOJI_RE.test(svg.outerHTML), `${name} 的 SVG 里混入了 emoji`).toBe(false)
    }
  })

  it('实心图标 grip 用 currentColor 填充，其余图标是 currentColor 描边', () => {
    const grip = renderIcon('grip')
    expect(grip.getAttribute('fill')).toBe('currentColor')
    expect(grip.getAttribute('stroke')).toBe('none')
    expect(grip.querySelectorAll('circle')).toHaveLength(6)

    for (const name of ['toolbox', 'check', 'hash']) {
      const svg = renderIcon(name)
      expect(svg.getAttribute('fill'), name).toBe('none')
      expect(svg.getAttribute('stroke'), name).toBe('currentColor')
      expect(svg.getAttribute('stroke-linecap'), name).toBe('round')
      expect(svg.getAttribute('stroke-linejoin'), name).toBe('round')
    }
  })
})

describe('Icon 的 size prop 实际作用到宽高', () => {
  it('默认 size=16', () => {
    const svg = renderIcon('check')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
  })

  it('数字形态的 size 原样写进 width/height', () => {
    const svg = renderIcon('download', { size: 32 })
    expect(svg.getAttribute('width')).toBe('32')
    expect(svg.getAttribute('height')).toBe('32')
  })

  it('字符串形态的 size 也原样写进 width/height（而非被当作数字吞掉）', () => {
    const svg = renderIcon('download', { size: '1.5em' })
    expect(svg.getAttribute('width')).toBe('1.5em')
    expect(svg.getAttribute('height')).toBe('1.5em')
  })
})

describe('Icon 的无障碍与透传行为', () => {
  it('未传 title 时作为装饰图 aria-hidden，且不带 role/aria-label', () => {
    const svg = renderIcon('plus')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('role')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBeNull()
  })

  it("传入 title 时改为 role='img' + aria-label，并去掉 aria-hidden", () => {
    const svg = renderIcon('plus', { title: '新增' })
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('新增')
    expect(svg.getAttribute('aria-hidden')).toBeNull()
  })

  it('className 透传到 svg 根节点', () => {
    const svg = renderIcon('search', { className: 'tk-icon tw-search' })
    expect(svg.getAttribute('class')).toBe('tk-icon tw-search')
  })

  it('未传 className 时不产生空 class 属性', () => {
    const svg = renderIcon('search')
    expect(svg.hasAttribute('class')).toBe(false)
  })
})

describe('Icon 对未知图标名的降级', () => {
  it('传入未注册的名字时仍渲染空 svg（不抛错、不退回 emoji 文案）', () => {
    const svg = renderIcon('not-a-real-icon')
    expect(svg).toBeTruthy()
    expect(svg.children).toHaveLength(0)
    expect(svg.textContent).toBe('')
    expect(EMOJI_RE.test(svg.outerHTML)).toBe(false)
  })
})
