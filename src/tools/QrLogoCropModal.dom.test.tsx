// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import type { QrLogoShape } from './qrcode'
/**
 * QrLogoCropModal 的组件级测试。
 *
 * happy-dom 没有真实的 Image 解码与 Canvas 2D 上下文，所以这里用两个最小替身把
 * 「图片加载完成」和「导出」变得可预期：
 *  - FakeImage：可控地触发 onload / onerror 并伪造 naturalWidth / naturalHeight；
 *  - getContext / toDataURL：记录导出用的 canvas 与 drawImage 参数，避免真实绘制。
 *
 * 组件本身没有 open 属性，由父级条件渲染决定是否挂载，因此不存在「open=false」分支
 * （详见交付报告）。
 */

// React 19 的 act 需要该标记
import QrLogoCropModal from './QrLogoCropModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEWPORT_SIZE = 260
const CROP_SIZE = 200
const CROP_OFFSET = (VIEWPORT_SIZE - CROP_SIZE) / 2
const EXPORT_SIZE = 600
const IMAGE_SRC = 'blob:mock-source'
const IMAGE_SRC_2 = 'blob:mock-source-2'
const CROPPED_DATA_URL = 'data:image/png;base64,CROPPED'
const RAW_KEY_PATTERN = /\b(?:tool|common|settings)\.[A-Za-z][\w.]*/

interface ImageBehavior {
  width: number
  height: number
  /** true 时触发 onerror，模拟图片加载失败 */
  fail?: boolean
  /** false 时把 onload 挂起，由用例手动放行 */
  auto?: boolean
}

interface FakeCtx {
  imageSmoothingEnabled: boolean
  imageSmoothingQuality: string
  drawImage: ReturnType<typeof vi.fn>
}

let imageBehavior: ImageBehavior
let createdImages: FakeImage[]
let pendingImages: FakeImage[]
let ctx: FakeCtx
let exportedCanvases: HTMLCanvasElement[]

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

/** 放行被 auto=false 挂起的图片加载 */
function firePendingLoad() {
  const images = pendingImages
  pendingImages = []
  for (const image of images) image.onload?.()
}

let container: HTMLDivElement
let root: Root
let onConfirm = vi.fn<(croppedDataUrl: string, selectedShape: QrLogoShape) => void>()
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

/** 用原生 setter 派发事件，绕过 React 对受控输入 value 的劫持 */
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

const viewport = () => query<HTMLElement>('.tw-crop-modal__viewport')
const cropImg = () => query<HTMLImageElement>('.tw-crop-modal__img')
const overlay = () => query<HTMLElement>('.tw-crop-modal__overlay')
const confirmButton = () => buttonByText(i18n.t('tool.qrcode.cropConfirm'))
const zoomLabel = () => query('.tw-crop-modal__zoom-val').textContent

/** 解析 img 的内联 transform，避免依赖 happy-dom 的字符串格式 */
function imagePosition(): { x: number; y: number } | null {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(cropImg().style.transform)
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null
}

function pointer(type: string, x: number, y: number, pointerId = 1) {
  viewport().dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true, cancelable: true }),
  )
}

function wheel(deltaY: number) {
  viewport().dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
}

/** 打开某个 PdSelect 并点选指定文案的选项（下拉经 portal 渲染到 document.body） */
function chooseOption(trigger: HTMLButtonElement, optionLabel: string) {
  act(() => trigger.click())
  const items = [...document.querySelectorAll<HTMLElement>('[data-pds-item]')]
  const item = items.find((el) => (el.textContent ?? '').trim() === optionLabel)
  if (!item) {
    throw new Error(
      `未找到选项「${optionLabel}」，实际：${items.map((el) => el.textContent).join(' | ')}`,
    )
  }
  act(() => {
    item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
}

/** 断言界面上没有漏翻的裸 i18n key（文本与属性都查） */
function expectNoRawI18nKeys() {
  const attrText = queryAll('*')
    .flatMap((el) => [...el.attributes].map((attr) => attr.value))
    .join(' ')
  expect(container.textContent ?? '').not.toMatch(RAW_KEY_PATTERN)
  expect(attrText).not.toMatch(RAW_KEY_PATTERN)
}

async function renderModal(
  overrides: { imageSrc?: string; initialShape?: QrLogoShape } = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <QrLogoCropModal
        imageSrc={overrides.imageSrc ?? IMAGE_SRC}
        initialShape={overrides.initialShape}
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
  ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: vi.fn() }
  exportedCanvases = []
  onConfirm = vi.fn<(croppedDataUrl: string, selectedShape: QrLogoShape) => void>()
  onCancel = vi.fn<() => void>()

  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement['getContext'],
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    exportedCanvases.push(this)
    return CROPPED_DATA_URL
  } as unknown as HTMLCanvasElement['toDataURL'])

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

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

describe('QrLogoCropModal：初始渲染', () => {
  it('图片加载前：弹窗结构齐全、确认按钮禁用、不渲染预览图', async () => {
    imageBehavior = { width: 400, height: 200, auto: false }
    await renderModal()

    const dialog = query<HTMLElement>('.pd-modal')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe(i18n.t('tool.qrcode.cropTitle'))
    expect(query('.tw-crop-modal__title').textContent).toBe(i18n.t('tool.qrcode.cropTitle'))
    expect(query('.tw-crop-modal__hint').textContent).toBe(i18n.t('tool.qrcode.cropHint'))

    expect(viewport().style.width).toBe(`${VIEWPORT_SIZE}px`)
    expect(viewport().style.height).toBe(`${VIEWPORT_SIZE}px`)
    expect(overlay().style.width).toBe(`${CROP_SIZE}px`)
    expect(overlay().style.height).toBe(`${CROP_SIZE}px`)
    expect(overlay().style.top).toBe(`${CROP_OFFSET}px`)
    expect(overlay().style.left).toBe(`${CROP_OFFSET}px`)
    expect(overlay().className).toContain('tw-crop-modal__overlay--rounded')
    expect(zoomLabel()).toBe('100%')

    expect(confirmButton().disabled).toBe(true)
    expect(container.querySelector('.tw-crop-modal__img')).toBeNull()
    expect(container.querySelector('.tw-crop-modal__viewport p')).toBeNull()
    expectNoRawI18nKeys()
  })

  it('图片加载完成后：按短边铺满裁剪框并在两轴居中，确认按钮可用', async () => {
    await renderModal()

    const img = cropImg()
    expect(img.src).toBe(IMAGE_SRC)
    expect(img.style.width).toBe('400px')
    expect(img.style.height).toBe('200px')
    // 400x200 的图以短边贴满 200：横向溢出的 200px 均分到两侧 → 30 - 100 = -70
    expect(imagePosition()).toEqual({ x: -70, y: CROP_OFFSET })
    expect(confirmButton().disabled).toBe(false)

    // 挂起 → 手动放行的路径同样成立
    act(() => root.unmount())
    root = createRoot(container)
    imageBehavior = { width: 100, height: 100, auto: false }
    await renderModal()
    expect(container.querySelector('.tw-crop-modal__img')).toBeNull()
    await act(async () => firePendingLoad())
    expect(cropImg().style.width).toBe('200px')
    expect(imagePosition()).toEqual({ x: CROP_OFFSET, y: CROP_OFFSET })
  })

  it('加载失败：展示错误文案并禁用确认', async () => {
    imageBehavior = { width: 400, height: 200, fail: true }
    await renderModal()

    expect(query('.tw-crop-modal__viewport p').textContent).toBe(
      i18n.t('tool.qrcode.cropLoadError'),
    )
    expect(container.querySelector('.tw-crop-modal__img')).toBeNull()
    expect(confirmButton().disabled).toBe(true)
    expectNoRawI18nKeys()
  })

  it('imageSrc 变化时重新加载并重置视图', async () => {
    await renderModal()
    expect(cropImg().src).toBe(IMAGE_SRC)

    await renderModal({ imageSrc: IMAGE_SRC_2 })

    expect(cropImg().src).toBe(IMAGE_SRC_2)
    expect(createdImages).toHaveLength(2)
    expect(imagePosition()).toEqual({ x: -70, y: CROP_OFFSET })
  })
})

describe('QrLogoCropModal：拖拽与缩放', () => {
  it('拖拽按位移移动图片，松开后继续移动无效', async () => {
    await renderModal()

    act(() => {
      pointer('pointerdown', 100, 100)
      pointer('pointermove', 150, 120)
    })

    // dx=+50 → -70 + 50 = -20；y 方向的图片刚好等于裁剪框高度，被夹在 30
    expect(imagePosition()).toEqual({ x: -20, y: CROP_OFFSET })

    act(() => {
      pointer('pointerup', 150, 120)
      pointer('pointermove', 240, 180)
    })

    expect(imagePosition()).toEqual({ x: -20, y: CROP_OFFSET })
  })

  it('拖拽越界被夹紧，裁剪框内始终不露白', async () => {
    await renderModal()

    act(() => {
      pointer('pointerdown', 0, 0)
      pointer('pointermove', 1000, 1000)
    })
    expect(imagePosition()).toEqual({ x: CROP_OFFSET, y: CROP_OFFSET })

    act(() => {
      pointer('pointerdown', 0, 0)
      pointer('pointermove', -1000, -1000)
    })
    expect(imagePosition()).toEqual({ x: CROP_OFFSET + CROP_SIZE - 400, y: CROP_OFFSET })
  })

  it('滚轮向上放大、向下缩小，缩放区间被限制在 100%~300%', async () => {
    await renderModal()

    await act(async () => wheel(-100))
    expect(zoomLabel()).toBe('108%')

    // 每次滚轮都要单独提交一次渲染，否则同一批事件会读到同一个旧 zoom
    for (let i = 0; i < 30; i++) {
      await act(async () => wheel(-100))
    }
    expect(zoomLabel()).toBe('300%')

    for (let i = 0; i < 30; i++) {
      await act(async () => wheel(100))
    }
    expect(zoomLabel()).toBe('100%')
  })

  it('滚轮监听以非 passive 注册，preventDefault 真的生效（回归）', async () => {
    // React 的 onWheel 是 passive 注册：preventDefault 无效且会打印
    // "Unable to preventDefault inside passive event listener invocation"，背后页面会跟着滚
    const addSpy = vi.spyOn(HTMLDivElement.prototype, 'addEventListener')
    await renderModal()

    const wheelCalls = addSpy.mock.calls.filter(([type]) => type === 'wheel')
    expect(wheelCalls.length).toBeGreaterThan(0)
    expect(
      wheelCalls.some(
        ([, , options]) => (options as AddEventListenerOptions | undefined)?.passive === false,
      ),
    ).toBe(true)

    const evt = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
    await act(async () => {
      viewport().dispatchEvent(evt)
    })

    expect(zoomLabel()).toBe('108%')
    expect(evt.defaultPrevented).toBe(true)
  })

  it('滑块缩放，并在缩小时把越界偏移重新夹紧', async () => {
    await renderModal()

    const slider = query<HTMLInputElement>('.tw-crop-modal__slider')
    act(() => setNativeValue(slider, '2'))
    expect(zoomLabel()).toBe('200%')

    // 放大后图片两个方向都大于裁剪框，可以拖到更远的边界
    act(() => {
      pointer('pointerdown', 0, 0)
      pointer('pointermove', -1000, -1000)
    })
    expect(imagePosition()).toEqual({
      x: CROP_OFFSET + CROP_SIZE - 800,
      y: CROP_OFFSET + CROP_SIZE - 400,
    })

    // 缩回 100% 时原来的越界偏移必须立刻被夹回合法范围
    act(() => setNativeValue(slider, '1'))
    expect(zoomLabel()).toBe('100%')
    expect(imagePosition()).toEqual({ x: CROP_OFFSET + CROP_SIZE - 400, y: CROP_OFFSET })
  })

  it('重置恢复居中与 100%', async () => {
    await renderModal()

    act(() => {
      wheel(-100)
      pointer('pointerdown', 0, 0)
      pointer('pointermove', -60, -40)
      pointer('pointerup', 0, 0)
    })
    expect(zoomLabel()).not.toBe('100%')
    expect(imagePosition()).not.toEqual({ x: -70, y: CROP_OFFSET })

    act(() => buttonByText(i18n.t('tool.qrcode.cropReset')).click())

    expect(zoomLabel()).toBe('100%')
    expect(imagePosition()).toEqual({ x: -70, y: CROP_OFFSET })
  })
})

describe('QrLogoCropModal：确认导出', () => {
  it('确认时按裁剪框参数绘制到 600x600 画布并回传 DataURL 与形状', async () => {
    await renderModal()

    act(() => confirmButton().click())

    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    // 400x200、1x、居中偏移 (-70, 30) 时裁剪框对应的原图区域是 x=100 y=0 的 200x200
    expect(ctx.drawImage).toHaveBeenCalledWith(
      createdImages[0],
      100,
      0,
      CROP_SIZE,
      CROP_SIZE,
      0,
      0,
      EXPORT_SIZE,
      EXPORT_SIZE,
    )
    expect(exportedCanvases).toHaveLength(1)
    expect(exportedCanvases[0].width).toBe(EXPORT_SIZE)
    expect(exportedCanvases[0].height).toBe(EXPORT_SIZE)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(CROPPED_DATA_URL, 'rounded')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('拖拽后确认导出的是移动后的裁剪区域', async () => {
    await renderModal()

    act(() => {
      pointer('pointerdown', 0, 0)
      pointer('pointermove', 50, 0)
    })
    expect(imagePosition()).toEqual({ x: -20, y: CROP_OFFSET })

    act(() => confirmButton().click())

    // offset.x=-20 → cropX=(30+20)/1=50
    expect(ctx.drawImage).toHaveBeenCalledWith(
      createdImages[0],
      50,
      0,
      CROP_SIZE,
      CROP_SIZE,
      0,
      0,
      EXPORT_SIZE,
      EXPORT_SIZE,
    )
    expect(onConfirm).toHaveBeenCalledWith(CROPPED_DATA_URL, 'rounded')
  })

  it('形状选择同时作用于裁剪框外观与导出结果', async () => {
    await renderModal({ initialShape: 'square' })
    expect(overlay().className).toContain('tw-crop-modal__overlay--square')

    chooseOption(query<HTMLButtonElement>('#tw-crop-shape'), i18n.t('tool.qrcode.logoShapeCircle'))
    expect(overlay().className).toContain('tw-crop-modal__overlay--circle')

    act(() => confirmButton().click())
    expect(onConfirm).toHaveBeenCalledWith(CROPPED_DATA_URL, 'circle')
  })

  it('放大后确认导出的裁剪区域随之缩小', async () => {
    await renderModal()

    const slider = query<HTMLInputElement>('.tw-crop-modal__slider')
    act(() => setNativeValue(slider, '2'))
    act(() => confirmButton().click())

    // scaleFactor=2：cropX=(30+70)/2=50，cropSize=200/2=100
    expect(ctx.drawImage).toHaveBeenCalledWith(
      createdImages[0],
      50,
      0,
      100,
      100,
      0,
      0,
      EXPORT_SIZE,
      EXPORT_SIZE,
    )
  })

  it('图片未加载完成时点击确认不会导出', async () => {
    imageBehavior = { width: 400, height: 200, auto: false }
    await renderModal()

    act(() => confirmButton().click())

    expect(onConfirm).not.toHaveBeenCalled()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})

describe('QrLogoCropModal：取消路径', () => {
  it('底部取消按钮触发 onCancel，不触发 onConfirm', async () => {
    await renderModal()

    act(() => buttonByText(i18n.t('common.cancel')).click())

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('点击遮罩触发取消，点击卡片内部不触发（stopPropagation）', async () => {
    await renderModal()

    act(() =>
      query('.tw-crop-modal__hint').dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    expect(onCancel).not.toHaveBeenCalled()

    act(() => query('.pd-modal').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape 键触发取消', async () => {
    await renderModal()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('QrLogoCropModal：导出失败反馈', () => {
  it('canvas 2D 上下文不可用时显示导出失败提示，且不回调 onConfirm（回归）', async () => {
    await renderModal()
    // 覆盖 beforeEach 的 getContext 桩：导出阶段拿不到 2D 上下文
    const getContext = HTMLCanvasElement.prototype.getContext as unknown as {
      mockImplementation: (fn: () => null) => void
    }
    getContext.mockImplementation(() => null)

    act(() => confirmButton().click())

    // 回归：源码曾在此静默 return，用户点了确认却毫无反应、也没有任何提示
    expect(onConfirm).not.toHaveBeenCalled()
    expect(container.textContent).toContain(i18n.t('tool.qrcode.cropExportError'))
  })

  it('导出失败后环境恢复：可再次确认并成功导出，错误提示随之清除', async () => {
    await renderModal()
    const getContext = HTMLCanvasElement.prototype.getContext as unknown as {
      mockImplementation: (fn: () => unknown) => void
    }
    getContext.mockImplementation(() => null)

    act(() => confirmButton().click())
    expect(container.textContent).toContain(i18n.t('tool.qrcode.cropExportError'))

    // 失败不关弹窗：按钮只受图片加载状态约束，用户可以直接重试
    expect(container.querySelector('.pd-modal')).not.toBeNull()
    expect(confirmButton().disabled).toBe(false)

    getContext.mockImplementation(() => ctx)
    act(() => confirmButton().click())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(CROPPED_DATA_URL, expect.any(String))
    // 回归：确认路径若不清掉 exportError，用户即使导出成功也会一直看到「导出失败」
    expect(container.textContent).not.toContain(i18n.t('tool.qrcode.cropExportError'))
  })
})
