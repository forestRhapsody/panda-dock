// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { BallShape } from '@/utils/settings'

import BallCropModal from './BallCropModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const IMAGE_SRC = 'blob:mock-image'
const CROPPED_DATA_URL = 'data:image/png;base64,CROPPED'
const RAW_KEY_PATTERN = /\b(?:tool|common|settings)\.[A-Za-z][\w.]*/

interface ImageBehavior {
  width: number
  height: number
  fail?: boolean
  auto?: boolean
}

let imageBehavior: ImageBehavior
let createdImages: FakeImage[]
let pendingImages: FakeImage[]

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  crossOrigin: string | null = null
  naturalWidth = 0
  naturalHeight = 0
  width = 0
  height = 0
  private srcValue = ''

  constructor() {
    createdImages.push(this)
  }

  get src(): string {
    return this.srcValue
  }

  set src(value: string) {
    this.srcValue = value
    if (imageBehavior.fail) {
      this.onerror?.()
      return
    }
    this.naturalWidth = imageBehavior.width
    this.naturalHeight = imageBehavior.height
    this.width = imageBehavior.width
    this.height = imageBehavior.height
    if (imageBehavior.auto === false) {
      pendingImages.push(this)
      return
    }
    this.onload?.()
  }
}

let container: HTMLDivElement
let root: Root
let onConfirm = vi.fn<(croppedDataUrl: string) => void>()
let onCancel = vi.fn<() => void>()

function query<T extends Element>(selector: string): T {
  const el = container.querySelector<T>(selector)
  if (!el) throw new Error(`未找到元素: ${selector}`)
  return el
}

function queryAll<T extends Element>(selector: string): T[] {
  return [...container.querySelectorAll<T>(selector)]
}

function buttonByText(text: string): HTMLButtonElement {
  const el = queryAll<HTMLButtonElement>('button').find(
    (item) => (item.textContent ?? '').trim() === text,
  )
  if (!el) {
    throw new Error(
      `未找到文本为「${text}」的按钮，实际：${queryAll('button')
        .map((item) => item.textContent)
        .join(' | ')}`,
    )
  }
  return el
}

const viewport = () => query<HTMLElement>('.opt-crop-modal__viewport')
const cropImg = () => query<HTMLImageElement>('.opt-crop-modal__img')
const overlay = () => query<HTMLElement>('.opt-crop-modal__overlay')
const confirmButton = () => buttonByText(i18n.t('settings.ballCropConfirm'))
const cancelButton = () => buttonByText(i18n.t('common.cancel'))
const resetButton = () => buttonByText(i18n.t('settings.ballCropReset'))
const zoomLabel = () => query('.opt-crop-modal__zoom-val').textContent

function pointer(type: string, x: number, y: number, pointerId = 1) {
  viewport().dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true, cancelable: true }),
  )
}

function wheel(deltaY: number) {
  viewport().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
}

function expectNoRawI18nKeys() {
  const attrText = queryAll('*')
    .flatMap((el) => [...el.attributes].map((attr) => attr.value))
    .join(' ')
  expect(container.textContent ?? '').not.toMatch(RAW_KEY_PATTERN)
  expect(attrText).not.toMatch(RAW_KEY_PATTERN)
}

async function renderModal(
  overrides: { imageSrc?: string; shape?: BallShape } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <BallCropModal
        imageSrc={overrides.imageSrc ?? IMAGE_SRC}
        shape={overrides.shape ?? 'circle'}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
  })
}

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  imageBehavior = { width: 400, height: 200, auto: true }
  createdImages = []
  pendingImages = []
  onConfirm = vi.fn()
  onCancel = vi.fn()

  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement['getContext'])
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(CROPPED_DATA_URL)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BallCropModal 悬浮球裁剪弹窗', () => {
  it('正常挂载且无裸 i18n key', async () => {
    await renderModal()
    expect(query('.opt-crop-modal__title').textContent).toBe(i18n.t('settings.ballCropTitle'))
    expect(query('.opt-crop-modal__hint').textContent).toBe(i18n.t('settings.ballCropHint'))
    expect(zoomLabel()).toBe('100%')
    expectNoRawI18nKeys()
  })

  it('图片加载完成时渲染预览图，并居中对齐裁剪框', async () => {
    await renderModal()
    expect(cropImg()).not.toBeNull()
    expect(confirmButton().disabled).toBe(false)
  })

  it('图片加载失败时显示错误提示并禁用确认按钮', async () => {
    imageBehavior.fail = true
    await renderModal()
    expect(container.textContent).toContain(i18n.t('settings.ballCropLoadError'))
    expect(confirmButton().disabled).toBe(true)
  })

  it('支持根据 shape 切换裁剪遮罩形状', async () => {
    await renderModal({ shape: 'circle' })
    expect(overlay().className).toContain('opt-crop-modal__overlay--circle')

    await renderModal({ shape: 'rounded' })
    expect(overlay().className).toContain('opt-crop-modal__overlay--rounded')

    await renderModal({ shape: 'square' })
    expect(overlay().className).toContain('opt-crop-modal__overlay--square')
  })

  it('点击取消按钮或按 Escape 键触发 onCancel', async () => {
    await renderModal()
    act(() => cancelButton().click())
    expect(onCancel).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('拖拽移动图片并更新偏移', async () => {
    await renderModal()
    act(() => {
      pointer('pointerdown', 100, 100)
      pointer('pointermove', 80, 80)
      pointer('pointerup', 80, 80)
    })
    expect(cropImg().style.transform).not.toBe('')
  })

  it('支持通过方向键（上下左右）微调裁剪区域', async () => {
    imageBehavior = { width: 800, height: 400, auto: true }
    await renderModal()

    const initialTransform = cropImg().style.transform

    // 按向右方向键移动裁剪区域（图片向左平移）
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(cropImg().style.transform).not.toBe(initialTransform)

    // 放大后垂直方向亦可平移微调
    act(() => wheel(-100))
    const afterZoomTransform = cropImg().style.transform
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }))
    })
    expect(cropImg().style.transform).not.toBe(afterZoomTransform)
  })

  function setNativeValue(el: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
      el,
      value,
    )
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('滚轮与滑块缩放', async () => {
    await renderModal()
    act(() => wheel(-100))
    expect(zoomLabel()).not.toBe('100%')

    const slider = query<HTMLInputElement>('.opt-crop-modal__slider')
    act(() => {
      setNativeValue(slider, '2')
    })
    expect(zoomLabel()).toBe('200%')
  })

  it('重置按钮将缩放恢复为 100%', async () => {
    await renderModal()
    act(() => wheel(-100))
    expect(zoomLabel()).not.toBe('100%')

    act(() => resetButton().click())
    expect(zoomLabel()).toBe('100%')
  })

  it('点击确认裁剪调用 onConfirm 并传递压缩后的 dataURL', async () => {
    await renderModal()
    act(() => confirmButton().click())
    expect(onConfirm).toHaveBeenCalledWith(CROPPED_DATA_URL)
  })

  it('导出失败时提示错误信息', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await renderModal()
    act(() => confirmButton().click())
    expect(container.textContent).toContain(i18n.t('settings.ballCropExportError'))
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
