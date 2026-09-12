// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppLogo from './AppLogo'

/**
 * AppLogo 的 src 有两条真实分支：扩展环境走 chrome.runtime.getURL，
 * 普通浏览器（pnpm dev 预览 / 测试）回退到 /icons/icon32.png（见 utils/env.ts 的降级思路）。
 * 断言两条分支的实际 URL，而不是「渲染成功」。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  delete globalWithChrome.chrome
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  delete globalWithChrome.chrome
  vi.unstubAllGlobals()
})

function renderLogo(props: { size?: number; className?: string } = {}) {
  act(() => {
    root.render(<AppLogo {...props} />)
  })
  const img = container.querySelector('img')
  if (!img) throw new Error('未渲染出 img')
  return img
}

const getURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`)

describe('AppLogo 的图片地址来源', () => {
  it('扩展环境下用 chrome.runtime.getURL 定位 icon32.png', () => {
    getURL.mockClear()
    globalWithChrome.chrome = { runtime: { getURL } }

    const img = renderLogo()

    expect(getURL).toHaveBeenCalledWith('icons/icon32.png')
    expect(img.getAttribute('src')).toBe('chrome-extension://test-id/icons/icon32.png')
  })

  it('没有 chrome 时回退到 /icons/icon32.png', () => {
    const img = renderLogo()
    expect(img.getAttribute('src')).toBe('/icons/icon32.png')
  })

  it('chrome 存在但没有 runtime.getURL 时同样回退，不抛错', () => {
    globalWithChrome.chrome = {}

    const img = renderLogo()
    expect(img.getAttribute('src')).toBe('/icons/icon32.png')
  })
})

describe('AppLogo 的尺寸、类名与无障碍语义', () => {
  it('尺寸同时写进 width/height，默认 18', () => {
    const img = renderLogo()
    expect(img.getAttribute('width')).toBe('18')
    expect(img.getAttribute('height')).toBe('18')
  })

  it('自定义 size 实际生效', () => {
    const img = renderLogo({ size: 22 })
    expect(img.getAttribute('width')).toBe('22')
    expect(img.getAttribute('height')).toBe('22')
  })

  it('className 透传，未传时不产生空 class', () => {
    expect(renderLogo({ className: 'pop-logo' }).getAttribute('class')).toBe('pop-logo')
    expect(renderLogo().hasAttribute('class')).toBe(false)
  })

  it('作为品牌装饰图：alt 为空 + aria-hidden，不产生多余的可访问名', () => {
    const img = renderLogo()
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
    // 空 alt + aria-hidden 表示「装饰图」，读屏会跳过；品牌名由旁边的文字提供
    expect(img.getAttribute('role')).toBeNull()
    expect(img.getAttribute('title')).toBeNull()
  })

  it('图片不可被拖拽（避免拖出幽灵图影响布局）', () => {
    const img = renderLogo()
    // happy-dom 未实现 HTMLImageElement.draggable 这个 IDL 属性（读到 undefined），
    // 但 React 写入的 HTML 属性是真实存在的，断言属性即可。
    expect(img.getAttribute('draggable')).toBe('false')
    expect(img.outerHTML).toContain('draggable="false"')
  })
})
