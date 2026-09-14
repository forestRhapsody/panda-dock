// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import {
  decodeQrCodeFromBlob,
  DEFAULT_QR_COMPOSE,
  generateQrCodeBlob,
  generateQrCodeResult,
  QR_STYLE_PRESET_KEY,
} from '@/tools/qrcode'
import type { QrStylePreset } from '@/tools/qrcode'
import { clearDraftValue, setDraftValue } from '@/utils/draft'

import QrCodeTool from './QrCodeTool'

/**
 * QrCodeTool 的组件级测试。
 *
 * 底层 qrcode.ts（canvas 栅格 / jsQR 解码）已由纯逻辑测试单独覆盖，这里刻意
 * `vi.mock('@/tools/qrcode')` 只保留可预期的返回值，把注意力放在：
 *  - 生成 / 解析两个模式的状态与切换；
 *  - 参数控件变化后重新生成时真正传给底层的 options；
 *  - Logo 上传 → 裁剪 → 移除、下载、复制、解析、草稿恢复等交互分支。
 *
 * 裁剪弹窗在本文件里用最小替身替换（onConfirm / onCancel 直接暴露成按钮），
 * 真实裁剪逻辑由 QrLogoCropModal.dom.test.tsx 覆盖，避免这里被 canvas/Image 环境拖累。
 */

// React 19 的 act 需要该标记

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/tools/qrcode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/qrcode')>()
  return {
    ...actual,
    generateQrCodeResult: vi.fn(),
    generateQrCodeBlob: vi.fn(),
    decodeQrCodeFromBlob: vi.fn(),
  }
})

vi.mock('./QrLogoCropModal', () => ({
  default: ({
    imageSrc,
    initialShape,
    onConfirm,
    onCancel,
  }: {
    imageSrc: string
    initialShape?: string
    onConfirm: (croppedDataUrl: string, shape: string) => void
    onCancel: () => void
  }) => (
    <div data-testid='crop-modal' data-src={imageSrc} data-shape={initialShape}>
      <button
        type='button'
        data-testid='crop-confirm'
        onClick={() => onConfirm('data:image/png;base64,CROPPED', 'circle')}
      >
        裁剪确认替身
      </button>
      <button type='button' data-testid='crop-cancel' onClick={onCancel}>
        裁剪取消替身
      </button>
    </div>
  ),
}))

const mockedGenerate = vi.mocked(generateQrCodeResult)
const mockedGenerateBlob = vi.mocked(generateQrCodeBlob)
const mockedDecode = vi.mocked(decodeQrCodeFromBlob)

const QR_DATA_URL = 'data:image/png;base64,QR-FIRST'
const QR_DATA_URL_2 = 'data:image/png;base64,QR-SECOND'
const CROPPED_LOGO_URL = 'data:image/png;base64,CROPPED'
const DRAFT_KEY = 'panda.draft.qrcode.input'
const DECODED_URL = 'https://example.com/qr'
const RAW_KEY_PATTERN = /\b(?:tool|common|settings)\.[A-Za-z][\w.]*/

/** 源码里 generateQrCodeResult / generateQrCodeBlob 的默认入参，逐字段断言防回归 */
function defaultOptions() {
  return {
    errorCorrectionLevel: 'M',
    margin: 2,
    targetWidth: 1200,
    foregroundColor: '#000000',
    backgroundColor: '#ffffff',
    logoUrl: null,
    logoShape: 'rounded',
    logoSizeRatio: 0.22,
    logoMargin: 'standard',
    label: '',
    labelFontSize: 18,
  }
}

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
const globalWithChrome = globalThis as unknown as { chrome?: unknown }

let container: HTMLDivElement
let root: Root
let localStore: Record<string, unknown>
let sessionStore: Record<string, unknown>
let changeListeners: ChangeListener[]
let urlSeq = 0
let createObjectURLMock = vi.fn(() => 'blob:mock')
let revokeObjectURLMock = vi.fn(() => undefined)

const realCreateObjectURL = URL.createObjectURL
const realRevokeObjectURL = URL.revokeObjectURL

/** 内存版 chrome.storage 桩：写入派发 onChanged，供 useToolDraft 的实时同步路径使用 */
function stubChrome() {
  sessionStore = {}
  localStore = {}
  changeListeners = []
  const makeArea = (store: Record<string, unknown>, areaName: string) => ({
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj: Record<string, unknown>) => {
      const changes = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))
      Object.assign(store, obj)
      for (const listener of [...changeListeners]) listener(changes, areaName)
    },
    remove: async (key: string) => {
      delete store[key]
    },
  })
  globalWithChrome.chrome = {
    storage: {
      session: makeArea(sessionStore, 'session'),
      sync: makeArea(sessionStore, 'sync'),
      local: makeArea(localStore, 'local'),
      onChanged: {
        addListener: (listener: ChangeListener) => changeListeners.push(listener),
        removeListener: (listener: ChangeListener) => {
          changeListeners = changeListeners.filter((item) => item !== listener)
        },
      },
    },
  }
}

/** 覆盖 navigator.clipboard，afterEach 里删掉自有属性即可恢复原型上的实现 */
function stubClipboard(impl: Record<string, unknown>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: impl,
    configurable: true,
    writable: true,
  })
}

const flush = (ms = 140) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })

/** 挂载组件并等挂载期的会话草稿读取落地，避免它晚到一步覆盖用例刚输入的值 */
async function renderTool() {
  act(() => {
    root.render(<QrCodeTool />)
  })
  await flush(0)
}

/** 当前激活的内层 tab 文案 */
function activeTabLabel(): string {
  return query('[role="tab"][aria-selected="true"]').textContent ?? ''
}

/** 模拟「切到别的工具再切回来」：整棵组件卸载后重新挂载 */
async function remount(): Promise<void> {
  act(() => root.unmount())
  container.remove()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await renderTool()
}

function query<T extends Element>(selector: string): T {
  const el = container.querySelector<T>(selector)
  if (!el) throw new Error(`未找到元素: ${selector}`)
  return el
}

function queryAll<T extends Element>(selector: string): T[] {
  return [...container.querySelectorAll<T>(selector)]
}

function queryByText<T extends Element>(selector: string, text: string): T {
  const el = queryAll<T>(selector).find((item) => (item.textContent ?? '').trim() === text)
  if (!el) {
    throw new Error(
      `未找到文本为「${text}」的 ${selector}，实际：${queryAll(selector)
        .map((item) => item.textContent)
        .join(' | ')}`,
    )
  }
  return el
}

/** 用原生 setter 派发事件，绕过 React 对受控输入 value 的劫持（与 NumberInput.test.tsx 一致） */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function makeFile(name = 'logo.png', type = 'image/png') {
  return new File(['binary'], name, { type })
}

function setFileInput(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const inputArea = () => query<HTMLTextAreaElement>('textarea.tw-area')
const decodeArea = () => query<HTMLTextAreaElement>('textarea.tw-area--result')
const errorStatus = () => container.querySelector('.tw-status--err')

function clickTab(label: string) {
  act(() => queryByText<HTMLButtonElement>('[role="tab"]', label).click())
}

function clickButton(label: string) {
  act(() => queryByText<HTMLButtonElement>('button', label).click())
}

function selectById(id: string) {
  return query<HTMLButtonElement>(`#${id}`)
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

/** 没有 id 的 PdSelect（如标签字号）：用当前选中文案定位触发按钮 */
function chooseOptionByCurrentLabel(currentLabel: string, optionLabel: string) {
  const trigger = queryAll<HTMLButtonElement>('.pd-select').find(
    (el) => (el.textContent ?? '').trim() === currentLabel,
  )
  if (!trigger) throw new Error(`未找到当前显示为「${currentLabel}」的 PdSelect`)
  chooseOption(trigger, optionLabel)
}

/** 点一下「美化与标签」开关（展开↔收起） */
function toggleCustomize() {
  clickButton(i18n.t('tool.qrcode.customizeToggle'))
}

/** 展开「美化与标签」面板（幂等：已经展开时不再点，避免把它又收起来） */
function openCustomize() {
  if (container.querySelector('.tw-qr__custom-panel')) return
  toggleCustomize()
}

function logoFileInput() {
  return query<HTMLInputElement>("input[type='file'][accept='image/*']")
}

async function generateFrom(text: string) {
  act(() => setNativeValue(inputArea(), text))
  await flush()
}

/** 上传 Logo 并在替身弹窗里确认，返回裁剪结果 data URL */
async function uploadLogoAndConfirm() {
  const file = makeFile()
  act(() => setFileInput(logoFileInput(), file))
  expect(container.querySelector("[data-testid='crop-modal']")).not.toBeNull()
  act(() => query<HTMLButtonElement>("[data-testid='crop-confirm']").click())
  await flush()
  return file
}

/** 断言界面上没有漏翻的裸 i18n key（文本与属性都查） */
function expectNoRawI18nKeys() {
  const attrText = queryAll('*')
    .flatMap((el) => [...el.attributes].map((attr) => attr.value))
    .join(' ')
  expect(container.textContent ?? '').not.toMatch(RAW_KEY_PATTERN)
  expect(attrText).not.toMatch(RAW_KEY_PATTERN)
}

beforeEach(async () => {
  await i18n.changeLanguage('zh')
  stubChrome()
  // 草稿的 memoryCache 是模块级常驻的，显式清空，避免用例之间互相污染
  await clearDraftValue('qrcode.input')
  await clearDraftValue('qrcode.tab')
  await clearDraftValue('qrcode.compose')
  await clearDraftValue('qrcode.logo')
  await clearDraftValue('qrcode.customize')

  mockedGenerate.mockReset()
  mockedGenerate.mockResolvedValue({ dataUrl: QR_DATA_URL, width: 1200, height: 1200 })
  mockedGenerateBlob.mockReset()
  mockedGenerateBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  mockedDecode.mockReset()
  mockedDecode.mockResolvedValue(DECODED_URL)

  urlSeq = 0
  createObjectURLMock = vi.fn(() => `blob:mock-${++urlSeq}`)
  revokeObjectURLMock = vi.fn(() => undefined)
  URL.createObjectURL = createObjectURLMock
  URL.revokeObjectURL = revokeObjectURLMock

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  URL.createObjectURL = realCreateObjectURL
  URL.revokeObjectURL = realRevokeObjectURL
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete globalWithChrome.chrome
})

afterAll(async () => {
  await i18n.changeLanguage('zh')
})

describe('QrCodeTool：Tab 切换与状态独立', () => {
  it('初始进入生成模式：有输入框、参数栏与空态引导，没有解析区', async () => {
    await renderTool()

    expect(inputArea().value).toBe('')
    expect(query('.tw-qr__toolbar')).not.toBeNull()
    expect(query('.tw-qr__placeholder').textContent).toContain(i18n.t('tool.qrcode.emptyPrompt'))
    expect(container.querySelector('.tw-qr__drop-zone')).toBeNull()
    expect(queryAll('[role="tab"]').map((tab) => tab.textContent)).toEqual([
      i18n.t('tool.qrcode.generateTab'),
      i18n.t('tool.qrcode.decodeTab'),
    ])
    // 当前激活的是生成 tab
    expect(query('[role="tab"][aria-selected="true"]').textContent).toBe(
      i18n.t('tool.qrcode.generateTab'),
    )
    expectNoRawI18nKeys()
  })

  it('切到解析模式再切回生成，两边的状态互不干扰且都被保留', async () => {
    await renderTool()
    await generateFrom('hello')
    expect(inputArea().value).toBe('hello')

    clickTab(i18n.t('tool.qrcode.decodeTab'))
    expect(container.querySelector('.tw-qr__drop-zone')).not.toBeNull()
    expect(container.querySelector('textarea.tw-area')).toBeNull()

    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()
    expect(decodeArea().value).toBe(DECODED_URL)

    // 回生成：预览与输入都还在
    clickTab(i18n.t('tool.qrcode.generateTab'))
    expect(inputArea().value).toBe('hello')
    expect(query<HTMLImageElement>('.tw-qr__img').src).toBe(QR_DATA_URL)

    // 再回解析：解析结果也还在
    clickTab(i18n.t('tool.qrcode.decodeTab'))
    expect(decodeArea().value).toBe(DECODED_URL)
  })

  it('内层 tab 跨挂载保留：切到解析模式后重挂载仍停在解析（回归）', async () => {
    await renderTool()
    clickTab(i18n.t('tool.qrcode.decodeTab'))
    expect(activeTabLabel()).toBe(i18n.t('tool.qrcode.decodeTab'))

    await remount()

    // 回归：源码曾用 useState 存 mode，切到别的工具再回来会跳回「生成」
    expect(activeTabLabel()).toBe(i18n.t('tool.qrcode.decodeTab'))
    expect(container.querySelector('.tw-qr__drop-zone')).not.toBeNull()
  })

  it('草稿里的脏 tab 值回落到生成模式（草稿不做校验）', async () => {
    await setDraftValue('qrcode.tab', '这不是一个合法 tab')

    await renderTool()

    expect(activeTabLabel()).toBe(i18n.t('tool.qrcode.generateTab'))
    expect(container.querySelector('.tw-qr__drop-zone')).toBeNull()
  })
})

describe('QrCodeTool：生成侧空输入', () => {
  it('空输入不触发生成、不弹错误横幅、只显示空态引导', async () => {
    await renderTool()
    await flush()

    expect(mockedGenerate).not.toHaveBeenCalled()
    expect(errorStatus()).toBeNull()
    expect(inputArea().className).not.toContain('tw-area--empty-err')
    // 注意：源码没有独立的「生成」动作按钮、也没有接入 useEmptyError（§4 条 15），
    // 生成完全靠输入防抖触发，因此空输入只表现为「不生成 + 空态引导 + 无横幅」。
    expect(container.querySelector('.tw-qr__img')).toBeNull()
  })

  it('纯空白输入同样不生成，回到空态', async () => {
    await renderTool()
    act(() => setNativeValue(inputArea(), '   '))
    await flush()

    expect(mockedGenerate).not.toHaveBeenCalled()
    expect(container.querySelector('.tw-qr__img')).toBeNull()
    expect(errorStatus()).toBeNull()
  })
})

describe('QrCodeTool：生成成功后的预览与重新生成', () => {
  it('预览 img 的 src 等于底层返回的 dataUrl，并展示物理尺寸', async () => {
    mockedGenerate.mockResolvedValue({ dataUrl: QR_DATA_URL, width: 960, height: 1020 })

    await renderTool()
    await generateFrom('hello')

    expect(mockedGenerate).toHaveBeenCalledWith('hello', defaultOptions())
    expect(query<HTMLImageElement>('.tw-qr__img').src).toBe(QR_DATA_URL)
    expect(query('.tw-qr__dimension-badge').textContent).toBe('960 × 1020 px')
    expect(container.querySelector('.tw-qr__placeholder')).toBeNull()
    expect(errorStatus()).toBeNull()
  })

  it('内容前后空白会被 trim 后再生成', async () => {
    await renderTool()
    await generateFrom('  hello  ')

    expect(mockedGenerate).toHaveBeenCalledWith('hello', defaultOptions())
  })

  it('重新输入时先显示旧图 + 生成中遮罩，防抖结束后换成新图', async () => {
    await renderTool()
    await generateFrom('first')
    expect(query<HTMLImageElement>('.tw-qr__img').src).toBe(QR_DATA_URL)

    mockedGenerate.mockResolvedValue({ dataUrl: QR_DATA_URL_2, width: 1200, height: 1200 })
    act(() => setNativeValue(inputArea(), 'second'))

    // 防抖窗口内：旧结果仍在，叠一层 loading，不闪白
    expect(query<HTMLImageElement>('.tw-qr__img').src).toBe(QR_DATA_URL)
    expect(container.querySelector('.tw-qr__img-loading')).not.toBeNull()

    await flush(140)
    expect(query<HTMLImageElement>('.tw-qr__img').src).toBe(QR_DATA_URL_2)
    expect(container.querySelector('.tw-qr__img-loading')).toBeNull()
  })

  it('底层 reject 时展示错误提示且不保留旧预览', async () => {
    await renderTool()
    mockedGenerate.mockRejectedValue(new Error('capacity'))
    await generateFrom('too long content')

    expect(errorStatus()?.textContent).toBe(i18n.t('tool.qrcode.generateFailed'))
    expect(container.querySelector('.tw-qr__img')).toBeNull()
    expectNoRawI18nKeys()
  })

  it('点击清空按钮清掉输入与预览', async () => {
    await renderTool()
    await generateFrom('hello')
    expect(query<HTMLImageElement>('.tw-qr__img')).not.toBeNull()

    clickButton(i18n.t('common.clear'))

    expect(inputArea().value).toBe('')
    expect(container.querySelector('.tw-qr__img')).toBeNull()
    expect(container.querySelector('.tw-qr__placeholder')).not.toBeNull()
  })

  it('填入当前网页 URL 会把当前地址写进输入框', async () => {
    await renderTool()

    clickButton(i18n.t('tool.qrcode.fillCurrentUrl'))
    await flush(0)

    expect(inputArea().value).toBe(window.location.href)
  })
})

describe('QrCodeTool：参数控件变化后的 options', () => {
  it('边距 / 纠错等级 / 分辨率变化后按新值重新生成', async () => {
    await renderTool()
    await generateFrom('hello')

    chooseOption(selectById('tw-qr-margin'), i18n.t('tool.qrcode.marginLoose'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith('hello', expect.objectContaining({ margin: 4 }))

    chooseOption(selectById('tw-qr-ec'), 'Q (25%)')
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ margin: 4, errorCorrectionLevel: 'Q' }),
    )

    chooseOption(selectById('tw-qr-resolution'), i18n.t('tool.qrcode.sizeXl'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ margin: 4, errorCorrectionLevel: 'Q', targetWidth: 2400 }),
    )
  })

  it('前景色 / 背景色（取色器与预设色块）都会进入 options', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()

    const [fgInput, bgInput] = queryAll<HTMLInputElement>('.tw-qr__color-input')
    act(() => setNativeValue(fgInput, '#123456'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ foregroundColor: '#123456' }),
    )

    act(() => setNativeValue(bgInput, '#abcdef'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ foregroundColor: '#123456', backgroundColor: '#abcdef' }),
    )

    // 预设色块是纯色按钮（无文本），用 aria-label 定位；点击后前景色切到对应色值
    const redSwatch = query<HTMLButtonElement>(
      `button[aria-label='${i18n.t('tool.qrcode.colorRed')}']`,
    )
    act(() => redSwatch.click())
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ foregroundColor: '#b91c1c' }),
    )
    expect(redSwatch.className).toContain('tw-qr__swatch--active')
  })

  it('标签文字与字号变化后进入 options；纯空白标签原样透传由底层 trim', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()

    act(() => setNativeValue(query<HTMLInputElement>('.tw-qr__label-input'), '扫码访问'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ label: '扫码访问' }),
    )

    chooseOptionByCurrentLabel(i18n.t('tool.qrcode.fontSizeMd'), i18n.t('tool.qrcode.fontSizeLg'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ label: '扫码访问', labelFontSize: 22 }),
    )

    // 组件层不过滤空白，只把原始 label 交给 qrcode.ts（底层 cleanLabel = label.trim()）
    act(() => setNativeValue(query<HTMLInputElement>('.tw-qr__label-input'), '   '))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ label: '   ' }),
    )
  })

  it('美化面板默认折叠，可切换展开与收起', async () => {
    await renderTool()

    expect(container.querySelector('.tw-qr__custom-panel')).toBeNull()

    openCustomize()
    expect(container.querySelector('.tw-qr__custom-panel')).not.toBeNull()
    expect(
      queryByText<HTMLButtonElement>('button', i18n.t('tool.qrcode.customizeToggle')).className,
    ).toContain('pd-btn--primary')

    toggleCustomize()
    expect(container.querySelector('.tw-qr__custom-panel')).toBeNull()
  })
})

describe('QrCodeTool：Logo 上传、裁剪与移除', () => {
  it('上传图片会创建 object URL 并打开裁剪弹窗（带上当前形状）', async () => {
    await renderTool()
    openCustomize()

    const file = makeFile()
    act(() => setFileInput(logoFileInput(), file))

    const modal = query<HTMLElement>("[data-testid='crop-modal']")
    expect(createObjectURLMock).toHaveBeenCalledWith(file)
    expect(modal.dataset.src).toBe('blob:mock-1')
    expect(modal.dataset.shape).toBe('rounded')
  })

  it('取消裁剪：关闭弹窗、不留 Logo、释放 object URL', async () => {
    await renderTool()
    openCustomize()
    act(() => setFileInput(logoFileInput(), makeFile()))

    act(() => query<HTMLButtonElement>("[data-testid='crop-cancel']").click())
    await flush()

    expect(container.querySelector("[data-testid='crop-modal']")).toBeNull()
    expect(container.querySelector('.tw-qr__logo-thumb')).toBeNull()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
    expect(mockedGenerate).not.toHaveBeenCalled()
  })

  it('确认裁剪：写入 Logo 与形状并锁定纠错等级为 H，移除后回落到用户原等级', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()
    await uploadLogoAndConfirm()

    expect(container.querySelector("[data-testid='crop-modal']")).toBeNull()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({
        errorCorrectionLevel: 'H',
        logoUrl: CROPPED_LOGO_URL,
        logoShape: 'circle',
      }),
    )
    expect(query<HTMLImageElement>('.tw-qr__logo-thumb').src).toBe(CROPPED_LOGO_URL)
    expect(query('.tw-qr__logo-thumb').className).toContain('tw-qr__logo-thumb--circle')
    // 有 Logo 时纠错等级被锁定
    expect(selectById('tw-qr-ec').disabled).toBe(true)

    chooseOption(selectById('tw-qr-logo-size'), i18n.t('tool.qrcode.logoSizeSm'))
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ logoSizeRatio: 0.18 }),
    )

    clickButton(i18n.t('tool.qrcode.removeLogo'))
    await flush()

    // 移除后不能把强制 H 留在原地：必须回落到应用 Logo 前的默认等级 M
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ errorCorrectionLevel: 'M', logoUrl: null, logoSizeRatio: 0.18 }),
    )
    expect(container.querySelector('.tw-qr__logo-thumb')).toBeNull()
    expect(selectById('tw-qr-ec').disabled).toBe(false)
  })

  it('Logo 留白选项切换：支持默认、紧凑与无留白切换', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()
    await uploadLogoAndConfirm()

    const marginSelect = selectById('tw-qr-logo-margin')
    expect(marginSelect).not.toBeNull()
    expect(marginSelect.textContent).toContain(i18n.t('tool.qrcode.logoMarginStandard'))

    // 切换到「紧凑」
    chooseOption(marginSelect, i18n.t('tool.qrcode.logoMarginTight'))
    await flush()

    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({
        logoUrl: CROPPED_LOGO_URL,
        logoMargin: 'tight',
      }),
    )

    // 切换到「无边框」
    chooseOption(marginSelect, i18n.t('tool.qrcode.logoMarginNone'))
    await flush()

    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({
        logoUrl: CROPPED_LOGO_URL,
        logoMargin: 'none',
      }),
    )

    // 重新切回「默认」
    chooseOption(marginSelect, i18n.t('tool.qrcode.logoMarginStandard'))
    await flush()

    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({
        logoUrl: CROPPED_LOGO_URL,
        logoMargin: 'standard',
      }),
    )
  })

  it('移除 Logo 回落的是用户手动改过的等级（Q），而不是默认 M', async () => {
    await renderTool()
    await generateFrom('hello')

    // 上传 Logo 前用户把纠错等级手动改成 Q
    chooseOption(selectById('tw-qr-ec'), 'Q (25%)')
    await flush()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ errorCorrectionLevel: 'Q' }),
    )

    openCustomize()
    await uploadLogoAndConfirm()
    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ errorCorrectionLevel: 'H' }),
    )

    clickButton(i18n.t('tool.qrcode.removeLogo'))
    await flush()

    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'hello',
      expect.objectContaining({ errorCorrectionLevel: 'Q', logoUrl: null }),
    )
  })

  it('「重新裁剪」用已有的裁剪源重新打开弹窗', async () => {
    await renderTool()
    openCustomize()
    await uploadLogoAndConfirm()

    clickButton(i18n.t('tool.qrcode.recropLogo'))

    expect(query<HTMLElement>("[data-testid='crop-modal']").dataset.src).toBe('blob:mock-1')
  })
})

describe('QrCodeTool：下载与复制', () => {
  it('下载会调用 generateQrCodeBlob 并触发一次带 download 的链接点击', async () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })

    await renderTool()
    await generateFrom('hello')

    clickButton(i18n.t('tool.qrcode.downloadPng'))
    await flush(0)

    expect(mockedGenerateBlob).toHaveBeenCalledWith('hello', defaultOptions())
    expect(clicked).toHaveLength(1)
    expect(clicked[0].href).toBe('blob:mock-1')
    expect(clicked[0].download).toMatch(/^qrcode-\d+\.png$/)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
  })

  it('生成 Blob 失败时回退到直接用预览 dataUrl 下载', async () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })

    await renderTool()
    await generateFrom('hello')

    mockedGenerateBlob.mockRejectedValueOnce(new Error('blob failed'))
    clickButton(i18n.t('tool.qrcode.downloadPng'))
    await flush(0)

    expect(clicked).toHaveLength(1)
    expect(clicked[0].href).toBe(QR_DATA_URL)
    expect(clicked[0].download).toMatch(/^qrcode-\d+\.png$/)
  })

  it('支持 ClipboardItem 时复制图片并短暂提示「已复制图片」', async () => {
    class FakeClipboardItem {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    const write = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ write })

    await renderTool()
    await generateFrom('hello')

    const copyBtn = queryByText<HTMLButtonElement>('button', i18n.t('tool.qrcode.copyImage'))

    // 复制成功后的提示用 setTimeout 复位，用假定时器避免真等 2 秒
    vi.useFakeTimers()
    await act(async () => {
      copyBtn.click()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(write).toHaveBeenCalledTimes(1)
    const [items] = write.mock.calls[0] as [FakeClipboardItem[]]
    expect(items).toHaveLength(1)
    expect(items[0].items['image/png']).toBeInstanceOf(Blob)
    expect(copyBtn.textContent).toBe(i18n.t('tool.qrcode.imageCopied'))

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(copyBtn.textContent).toBe(i18n.t('tool.qrcode.copyImage'))
  })

  it('没有 ClipboardItem 时降级为复制 dataUrl 文本', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    await renderTool()
    await generateFrom('hello')

    clickButton(i18n.t('tool.qrcode.copyImage'))
    await flush(0)

    expect(writeText).toHaveBeenCalledWith(QR_DATA_URL)
  })

  it('查看原图会新开窗口并写入包含预览图的 HTML', async () => {
    const write = vi.fn()
    const close = vi.fn()
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue({ document: { write, close } } as unknown as Window)

    await renderTool()
    await generateFrom('hello')

    clickButton(i18n.t('tool.qrcode.openOriginal'))

    expect(openSpy).toHaveBeenCalled()
    expect(write).toHaveBeenCalledTimes(1)
    expect(String(write.mock.calls[0][0])).toContain(QR_DATA_URL)
    expect(close).toHaveBeenCalled()
  })
})

describe('QrCodeTool：解析模式', () => {
  const toDecode = () => clickTab(i18n.t('tool.qrcode.decodeTab'))

  it('选择文件后解析成功：预览、可复制、结果框只读', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    await renderTool()
    toDecode()

    expect(query('.tw-qr__drop-prompt').textContent).toContain(i18n.t('tool.qrcode.dropTitle'))

    const file = makeFile('qr.png')
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), file))
    await flush()

    expect(mockedDecode).toHaveBeenCalledWith(file)
    expect(query<HTMLImageElement>('.tw-qr__thumb').src).toBe('blob:mock-1')

    const result = decodeArea()
    expect(result.value).toBe(DECODED_URL)
    // §4 条 16：解析结果只读，不允许改成可编辑表单
    expect(result.readOnly).toBe(true)

    // 结果是 URL 时额外给出外链
    const link = query<HTMLAnchorElement>('a.tw-link')
    expect(link.getAttribute('href')).toBe(DECODED_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')

    clickButton(i18n.t('common.copy'))
    await flush(0)
    expect(writeText).toHaveBeenCalledWith(DECODED_URL)
    expectNoRawI18nKeys()
  })

  it('解析结果不是 URL 时不渲染外链', async () => {
    mockedDecode.mockResolvedValue('纯文本内容')

    await renderTool()
    toDecode()
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()

    expect(decodeArea().value).toBe('纯文本内容')
    expect(container.querySelector('a.tw-link')).toBeNull()
    // 结果区仍带复制按钮
    expect(query<HTMLButtonElement>('button.tw-link').getAttribute('aria-label')).toBe(
      i18n.t('common.copy'),
    )
  })

  it('解析失败时给出错误提示（中文）', async () => {
    mockedDecode.mockRejectedValue(new Error('no qr'))

    await renderTool()
    toDecode()
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()

    expect(errorStatus()?.textContent).toBe(i18n.t('tool.qrcode.decodeFailed'))
    expect(container.querySelector('textarea.tw-area--result')).toBeNull()
    expectNoRawI18nKeys()
  })

  it('切到 en 后失败提示为英文且不含中文；切回 zh 后为中文', async () => {
    mockedDecode.mockRejectedValue(new Error('no qr'))

    await renderTool()
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    toDecode()
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()

    const englishError = errorStatus()?.textContent ?? ''
    expect(englishError).toBe(i18n.t('tool.qrcode.decodeFailed'))
    expect(englishError).toMatch(/No valid QR code/)
    expect(englishError).not.toMatch(/[\u4e00-\u9fa5]/)

    // 再失败一次，验证中文语言下取到中文文案（错误文案是失败瞬间的翻译快照）
    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()
    expect(errorStatus()?.textContent).toBe(i18n.t('tool.qrcode.decodeFailed'))
    expect(errorStatus()?.textContent).toMatch(/[\u4e00-\u9fa5]/)
  })

  it('切换语言会同步刷新静态文案，且不出现裸 key', async () => {
    await renderTool()
    expect(queryAll('[role="tab"]')[0].textContent).toBe(i18n.t('tool.qrcode.generateTab'))
    expectNoRawI18nKeys()

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(queryAll('[role="tab"]')[0].textContent).toBe(i18n.t('tool.qrcode.generateTab'))
    expect(queryAll('[role="tab"]')[0].textContent).toBe('Generate')
    expectNoRawI18nKeys()
  })

  it('拖拽进入 / 离开会切换高亮类，拖入图片才会触发解析', async () => {
    await renderTool()
    toDecode()

    const zone = query('.tw-qr__drop-zone')
    act(() => {
      zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    })
    expect(zone.className).toContain('tw-qr__drop-zone--drag')

    act(() => {
      zone.dispatchEvent(new Event('dragleave', { bubbles: true }))
    })
    expect(zone.className).not.toContain('tw-qr__drop-zone--drag')

    // 非图片类型被忽略
    const textFile = makeFile('note.txt', 'text/plain')
    act(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [textFile] } })
      zone.dispatchEvent(event)
    })
    await flush(0)
    expect(mockedDecode).not.toHaveBeenCalled()

    const imageFile = makeFile('qr.png')
    act(() => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: { files: [imageFile] } })
      zone.dispatchEvent(event)
    })
    await flush()
    expect(mockedDecode).toHaveBeenCalledWith(imageFile)
    expect(decodeArea().value).toBe(DECODED_URL)
  })

  it('解析模式下粘贴图片会直接解析；生成模式下粘贴无副作用', async () => {
    await renderTool()

    const pasteFile = makeFile('paste.png')
    const makePasteEvent = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { items: [{ type: pasteFile.type, getAsFile: () => pasteFile }] },
      })
      return event
    }

    // 生成模式：没有监听器，不解析
    act(() => {
      window.dispatchEvent(makePasteEvent())
    })
    await flush(0)
    expect(mockedDecode).not.toHaveBeenCalled()

    clickTab(i18n.t('tool.qrcode.decodeTab'))
    act(() => {
      window.dispatchEvent(makePasteEvent())
    })
    await flush()
    expect(mockedDecode).toHaveBeenCalledWith(pasteFile)
  })

  it('读取剪贴板：有图片就解析，没图片给出对应提示，读取失败给出权限提示', async () => {
    await renderTool()
    clickTab(i18n.t('tool.qrcode.decodeTab'))

    const imageBlob = new Blob(['img'], { type: 'image/png' })
    const read = vi
      .fn()
      .mockResolvedValue([{ types: ['image/png'], getType: async () => imageBlob }])
    stubClipboard({ read })

    clickButton(i18n.t('tool.qrcode.pasteClipboard'))
    await flush()
    expect(mockedDecode).toHaveBeenCalledWith(imageBlob)
    expect(errorStatus()).toBeNull()

    // 剪贴板里只有文本：提示「未找到图片」
    read.mockResolvedValue([{ types: ['text/plain'], getType: async () => imageBlob }])
    clickButton(i18n.t('tool.qrcode.pasteClipboard'))
    await flush()
    expect(errorStatus()?.textContent).toBe(i18n.t('tool.qrcode.noClipboardImage'))

    // 完全读不到剪贴板：提示权限问题
    read.mockRejectedValue(new Error('denied'))
    clickButton(i18n.t('tool.qrcode.pasteClipboard'))
    await flush()
    expect(errorStatus()?.textContent).toBe(i18n.t('tool.qrcode.clipboardAccessDenied'))
  })

  it('取消按钮清掉解析结果与预览，回到拖拽引导', async () => {
    await renderTool()
    clickTab(i18n.t('tool.qrcode.decodeTab'))
    act(() => setFileInput(query<HTMLInputElement>('input.tw-qr__file-input'), makeFile()))
    await flush()
    expect(decodeArea()).not.toBeNull()

    clickButton(i18n.t('common.cancel'))
    await flush(0)

    expect(container.querySelector('textarea.tw-area--result')).toBeNull()
    expect(container.querySelector('.tw-qr__thumb')).toBeNull()
    expect(query('.tw-qr__drop-prompt')).not.toBeNull()
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
  })
})

describe('QrCodeTool：会话草稿', () => {
  it('输入经防抖写入 chrome.storage.session，重挂载后恢复', async () => {
    await renderTool()
    act(() => setNativeValue(inputArea(), 'draft text'))

    // 草稿写入的防抖是 200ms
    await flush(260)
    expect(sessionStore[DRAFT_KEY]).toBe('draft text')

    act(() => root.unmount())
    root = createRoot(container)
    await renderTool()

    expect(inputArea().value).toBe('draft text')
  })

  it('仅有会话存储（其它入口写入、绕过内存缓存）时，挂载后收敛到存储值', async () => {
    sessionStore[DRAFT_KEY] = '来自会话存储'

    await renderTool()
    await flush(0)

    expect(inputArea().value).toBe('来自会话存储')
  })
})

describe('QrCodeTool：样式偏好持久化（默认预设）', () => {
  it('初始未保存预设时仅有「保存为默认样式」，点击后写入 local 存储并呈现恢复按钮', async () => {
    await renderTool()
    openCustomize()
    expect(queryByText('button', i18n.t('tool.qrcode.saveAsDefault'))).not.toBeNull()
    expect(
      queryAll('button').find((b) => b.textContent?.includes(i18n.t('tool.qrcode.resetDefault'))),
    ).toBeUndefined()

    // 调整一些外观参数
    chooseOption(selectById('tw-qr-margin'), i18n.t('tool.qrcode.marginLoose'))
    chooseOption(selectById('tw-qr-resolution'), i18n.t('tool.qrcode.sizeSm'))

    // 点击保存为默认样式
    clickButton(i18n.t('tool.qrcode.saveAsDefault'))
    await flush()

    // 验证写入 localStore
    const saved = localStore[QR_STYLE_PRESET_KEY] as QrStylePreset
    expect(saved).toBeDefined()
    expect(saved.margin).toBe(4)
    expect(saved.resolution).toBe(800)
    expect(saved.ecLevel).toBe('M')

    // 界面出现「恢复初始默认」按钮
    expect(
      queryAll('button').find((b) => b.textContent?.includes(i18n.t('tool.qrcode.resetDefault'))),
    ).toBeDefined()
  })

  it('已存在持久化预设时挂载：自动回填所有样式参数，并按该参数生成二维码', async () => {
    localStore[QR_STYLE_PRESET_KEY] = {
      margin: 4,
      resolution: 800,
      fgColor: '#123456',
      bgColor: '#abcdef',
      labelFontSize: 24,
      logoShape: 'circle',
      logoSizeRatio: 0.26,
      logoMargin: 'tight',
      ecLevel: 'Q',
    }

    await renderTool()
    await generateFrom('https://example.com')

    expect(mockedGenerate).toHaveBeenLastCalledWith('https://example.com', {
      ...defaultOptions(),
      margin: 4,
      targetWidth: 800,
      foregroundColor: '#123456',
      backgroundColor: '#abcdef',
      labelFontSize: 24,
      logoShape: 'circle',
      logoSizeRatio: 0.26,
      logoMargin: 'tight',
      errorCorrectionLevel: 'Q',
    })

    openCustomize()
    expect(
      queryAll('button').find((b) => b.textContent?.includes(i18n.t('tool.qrcode.resetDefault'))),
    ).toBeDefined()
  })

  it('兼容旧版偏好：logoMargin 为 boolean 时自动归一化', async () => {
    localStore[QR_STYLE_PRESET_KEY] = {
      logoMargin: false,
    }

    await renderTool()
    await generateFrom('test')

    expect(mockedGenerate).toHaveBeenLastCalledWith(
      'test',
      expect.objectContaining({
        logoMargin: 'none',
      }),
    )
  })

  it('恢复初始默认需二次确认：取消保留，确认后清除存储并恢复出厂默认', async () => {
    localStore[QR_STYLE_PRESET_KEY] = {
      margin: 4,
      resolution: 800,
      fgColor: '#ff0000',
      bgColor: '#ffff00',
    }

    await renderTool()
    await generateFrom('hello')
    openCustomize()

    const resetButton = queryByText<HTMLButtonElement>('button', i18n.t('tool.qrcode.resetDefault'))
    act(() => resetButton.click())
    await flush(0)

    // 弹出确认弹窗
    const dialog = query('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(i18n.t('tool.qrcode.resetConfirmTitle'))
    expect(dialog.textContent).toContain(i18n.t('tool.qrcode.resetConfirmMessage'))

    // 点击取消
    const cancelBtn = queryByText<HTMLButtonElement>(
      '.pd-modal__actions button',
      i18n.t('common.cancel'),
    )
    act(() => cancelBtn.click())
    await flush(0)

    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(localStore[QR_STYLE_PRESET_KEY]).toBeDefined()

    // 再次点击恢复
    clickButton(i18n.t('tool.qrcode.resetDefault'))
    await flush(0)

    // 点击确认
    const confirmBtn = queryByText<HTMLButtonElement>(
      '.pd-modal__actions button',
      i18n.t('common.confirm'),
    )
    act(() => confirmBtn.click())
    await flush(0)
    await flush(200)

    // 存储已被移除
    expect(localStore[QR_STYLE_PRESET_KEY]).toBeUndefined()

    // 恢复按钮消失
    expect(
      queryAll('button').find((b) => b.textContent?.includes(i18n.t('tool.qrcode.resetDefault'))),
    ).toBeUndefined()

    // options 回归出厂默认
    expect(mockedGenerate).toHaveBeenLastCalledWith('hello', defaultOptions())
  })

  it('上传 Logo 锁定 H 级别期间保存预设，持久化的是用户原本的纠错等级', async () => {
    await renderTool()
    openCustomize()
    await uploadLogoAndConfirm()

    // 当前 ecLevel 已经被锁定为 H，保存预设仍应保存用户先前的等级（默认 M）
    clickButton(i18n.t('tool.qrcode.saveAsDefault'))
    await flush()

    const saved = localStore[QR_STYLE_PRESET_KEY] as QrStylePreset
    expect(saved.ecLevel).toBe('M')
  })
})

describe('QrCodeTool：合成参数会话草稿（关抽屉再打开仍在）', () => {
  const COMPOSE_DRAFT_KEY = 'panda.draft.qrcode.compose'
  const LOGO_DRAFT_KEY = 'panda.draft.qrcode.logo'

  const marginSelectText = () => selectById('tw-qr-margin').textContent ?? ''
  const labelInput = () => query<HTMLInputElement>('.tw-qr__label-input')

  it('样式调整与底部说明文字写进会话草稿，重挂载后原样恢复', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()
    chooseOption(selectById('tw-qr-margin'), i18n.t('tool.qrcode.marginLoose'))
    chooseOption(selectById('tw-qr-ec'), 'Q (25%)')
    act(() => setNativeValue(labelInput(), '扫我'))
    await flush(260)

    // 写的是会话存储（而不是只留在内存里）
    expect(sessionStore[COMPOSE_DRAFT_KEY]).toEqual(
      expect.objectContaining({ margin: 4, ecLevel: 'Q', label: '扫我' }),
    )

    await remount()
    openCustomize()

    expect(marginSelectText()).toContain(i18n.t('tool.qrcode.marginLoose'))
    expect(selectById('tw-qr-ec').textContent).toContain('Q (25%)')
    expect(labelInput().value).toBe('扫我')
  })

  it('中心 Logo 写进会话草稿，重挂载后仍显示同一张图', async () => {
    await renderTool()
    await generateFrom('hello')
    openCustomize()
    await uploadLogoAndConfirm()
    await flush(260)

    expect(sessionStore[LOGO_DRAFT_KEY]).toBe(CROPPED_LOGO_URL)

    await remount()
    openCustomize()

    expect(query<HTMLImageElement>('.tw-qr__logo-thumb').src).toBe(CROPPED_LOGO_URL)
    // Logo 在场时纠错等级仍锁定为 H
    expect(selectById('tw-qr-ec').disabled).toBe(true)
  })

  it('只有会话存储（内存缓存已失效，如页面刷新）时，样式 / 标签 / Logo 一并恢复', async () => {
    sessionStore[COMPOSE_DRAFT_KEY] = { ...DEFAULT_QR_COMPOSE, margin: 4, label: '来自会话存储' }
    sessionStore[LOGO_DRAFT_KEY] = CROPPED_LOGO_URL

    await renderTool()
    openCustomize()

    expect(marginSelectText()).toContain(i18n.t('tool.qrcode.marginLoose'))
    expect(labelInput().value).toBe('来自会话存储')
    expect(query<HTMLImageElement>('.tw-qr__logo-thumb').src).toBe(CROPPED_LOGO_URL)
  })

  it('本地草稿缺字段（旧版本写入）时补齐出厂值，不把 undefined 打进生成参数', async () => {
    sessionStore[COMPOSE_DRAFT_KEY] = { margin: 4 }

    await renderTool()
    await generateFrom('hello')

    expect(mockedGenerate).toHaveBeenLastCalledWith('hello', {
      ...defaultOptions(),
      margin: 4,
    })
  })

  it('「美化与标签」面板的展开状态同样重挂载保留（展开着关掉，再打开还是展开的）', async () => {
    await renderTool()
    expect(container.querySelector('.tw-qr__custom-panel')).toBeNull()

    openCustomize()
    await flush(260)
    expect(container.querySelector('.tw-qr__custom-panel')).not.toBeNull()
    expect(sessionStore['panda.draft.qrcode.customize']).toBe(true)

    await remount()
    expect(container.querySelector('.tw-qr__custom-panel')).not.toBeNull()
  })

  it('恢复出厂默认样式不会顺手收起面板（否则刚重置完什么都看不见）', async () => {
    localStore[QR_STYLE_PRESET_KEY] = { margin: 4 }

    await renderTool()
    openCustomize()
    clickButton(i18n.t('tool.qrcode.resetDefault'))
    await flush(0)
    act(() => query<HTMLButtonElement>('.pd-modal__actions button.pd-btn--danger').click())
    await flush(260)
    await flush(400)

    expect(container.querySelector('.tw-qr__custom-panel')).not.toBeNull()
  })

  it('会话草稿优先于「保存的默认样式」，但保存入口仍然可见', async () => {
    localStore[QR_STYLE_PRESET_KEY] = { margin: 1 }
    sessionStore[COMPOSE_DRAFT_KEY] = { ...DEFAULT_QR_COMPOSE, margin: 4 }

    await renderTool()
    openCustomize()

    expect(marginSelectText()).toContain(i18n.t('tool.qrcode.marginLoose'))
    expect(
      queryAll('button').find((b) => b.textContent?.includes(i18n.t('tool.qrcode.resetDefault'))),
    ).toBeDefined()
  })

  it('恢复出厂默认样式会连会话草稿一起重置，关掉再打开不回弹', async () => {
    localStore[QR_STYLE_PRESET_KEY] = { margin: 4 }

    await renderTool()
    await generateFrom('hello')
    openCustomize()
    chooseOption(selectById('tw-qr-margin'), i18n.t('tool.qrcode.marginLoose'))
    act(() => setNativeValue(labelInput(), '扫我'))
    await flush(260)

    clickButton(i18n.t('tool.qrcode.resetDefault'))
    await flush(0)
    act(() => query<HTMLButtonElement>('.pd-modal__actions button.pd-btn--danger').click())
    // 重置链是异步的（确认 → 删除预设 → 写草稿，防抖 200ms），分两次等它彻底落地
    await flush(260)
    await flush(400)

    // 草稿被拉回出厂样式，但底部说明文字属于内容，不随样式重置清空
    expect(sessionStore[COMPOSE_DRAFT_KEY]).toEqual(
      expect.objectContaining({ margin: 2, resolution: 1200, fgColor: '#000000', label: '扫我' }),
    )

    await remount()
    openCustomize()

    expect(marginSelectText()).toContain(i18n.t('tool.qrcode.marginStandard'))
    expect(labelInput().value).toBe('扫我')
  })
})
