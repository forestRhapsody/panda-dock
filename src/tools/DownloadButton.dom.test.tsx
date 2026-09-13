// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import DownloadButton from './DownloadButton'
import { defaultFileName } from './file'

/**
 * DownloadButton 的真实副作用是「点一下就把 Data URL 还原成文件并下载」。
 * 断言方式：只用 spy 替换 URL.createObjectURL / revokeObjectURL 与锚点 click（不 mock 业务模块），
 * 让真实的 downloadDataUrl 跑起来，再检查它交给临时 <a> 的 href（blob URL）与 download（文件名），
 * 以及 Blob 的 type / 字节数。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let createObjectURLSpy: ReturnType<typeof vi.fn>
let revokeObjectURLSpy: ReturnType<typeof vi.fn>
let anchorClickSpy: ReturnType<typeof vi.spyOn>

/** 'hi' 的 base64 是 aGk=，用一个真实可解码的短数据验证字节还原 */
const BASE64_OF_HI = 'aGk='

beforeEach(() => {
  createObjectURLSpy = vi.fn(() => 'blob:test-url')
  revokeObjectURLSpy = vi.fn()
  // 只替换这两个静态方法：downloadDataUrl 里没有别的 URL 用法，桩越窄越不容易掩盖真实行为
  vi.stubGlobal('URL', {
    createObjectURL: createObjectURLSpy,
    revokeObjectURL: revokeObjectURLSpy,
  })
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  anchorClickSpy.mockRestore()
  vi.unstubAllGlobals()
})

function render(props: Partial<Parameters<typeof DownloadButton>[0]> = {}) {
  act(() => {
    root.render(
      <DownloadButton
        mime='application/json'
        dataUrl={`data:application/json;base64,${BASE64_OF_HI}`}
        {...props}
      />,
    )
  })
}

const button = () => container.querySelector('button') as HTMLButtonElement

describe('DownloadButton 的渲染', () => {
  it('默认文案取 i18n 的 tool.detect.download，而不是裸 key', () => {
    render()
    expect(button().textContent).toContain(i18n.t('tool.detect.download'))
    expect(button().textContent).not.toContain('tool.detect.download')
  })

  it('label prop 覆盖默认文案', () => {
    render({ label: '下载 JSON' })
    expect(button().textContent).toBe('下载 JSON')
  })

  it('按钮上带下载图标，且文件名按 mime 推导进 aria-label', () => {
    render()
    expect(button().querySelector('svg')).not.toBeNull()
    expect(button().getAttribute('aria-label')).toBe(defaultFileName('application/json'))
    expect(button().getAttribute('aria-label')).toBe('data.json')
  })

  it('className 追加到 pd-btn 之后，未传时保持纯 pd-btn', () => {
    render({ className: 'tw-mt' })
    expect(button().className).toBe('pd-btn tw-mt')

    act(() => root.unmount())
    root = createRoot(container)
    render()
    expect(button().className).toBe('pd-btn')
  })

  it('type=button，不会在表单里误触发提交', () => {
    render()
    expect(button().getAttribute('type')).toBe('button')
  })
})

describe('DownloadButton 点击下载', () => {
  it('点击后创建临时锚点、触发下载并立即清理', () => {
    render({ mime: 'application/json' })

    act(() => button().click())

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    const blob = createObjectURLSpy.mock.calls[0][0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('application/json')

    expect(anchorClickSpy).toHaveBeenCalledTimes(1)
    // 临时锚点已经移除，不污染页面
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test-url')
  })

  it('临时锚点的 href 指向 blob URL、download 使用按 mime 推导的文件名', () => {
    render({ mime: 'image/png', dataUrl: 'data:image/png;base64,aGk=' })

    let capturedHref = ''
    let capturedDownload = ''
    anchorClickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      capturedHref = this.getAttribute('href') ?? ''
      capturedDownload = this.getAttribute('download') ?? ''
    })

    act(() => button().click())

    expect(capturedHref).toBe('blob:test-url')
    expect(capturedDownload).toBe('image.png')
    expect(button().getAttribute('aria-label')).toBe('image.png')
  })

  it('未登记的 mime 文件名降级为 file.bin，Blob 仍沿用 dataUrl 里的 mime', () => {
    render({ mime: 'application/x-unknown', dataUrl: 'data:application/x-unknown;base64,aGk=' })

    act(() => button().click())

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/x-unknown')
    expect(button().getAttribute('aria-label')).toBe('file.bin')
  })

  it('dataUrl 的 mime 优先于 mime prop 决定 Blob 类型（Blob 由 dataUrl 还原）', () => {
    render({ mime: 'text/plain', dataUrl: 'data:image/png;base64,aGk=' })

    act(() => button().click())

    const blob = createObjectURLSpy.mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/png')
    // 文件名仍按 mime prop 推导
    expect(button().getAttribute('aria-label')).toBe('document.txt')
  })
})

describe('DownloadButton 的禁用与空数据', () => {
  it('disabled 时点击不产生任何副作用（原生 disabled 按钮不派发 click）', () => {
    act(() => {
      root.render(
        <DownloadButton
          mime='application/json'
          dataUrl='data:application/json;base64,aGk='
          label='下载'
        />,
      )
    })
    const btn = button()
    btn.disabled = true
    act(() => btn.click())

    expect(createObjectURLSpy).not.toHaveBeenCalled()
    expect(anchorClickSpy).not.toHaveBeenCalled()
    expect(revokeObjectURLSpy).not.toHaveBeenCalled()
  })

  it('dataUrl 为空串时仍会走完下载流程，但产生的是 0 字节文件（上层需避免传入空数据）', () => {
    render({ dataUrl: '' })

    act(() => button().click())

    // atob('') = ''，仍然创建了空 Blob 并走完下载流程
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect((createObjectURLSpy.mock.calls[0][0] as Blob).size).toBe(0)
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1)
  })
})
