// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { downloadDataUrl, downloadText } from './file'

/**
 * 下载路径不真下载：把 createObjectURL / revokeObjectURL / 锚点 click 全部换成 spy，
 * 再直接检查被创建出来的 Blob（MIME + 真实字节）与临时锚点的文件名/移除情况。
 * 只断言「不抛错」无法发现文件名写错、Blob 为空或锚点残留污染宿主页面这类回归。
 */

/** 把字节数组编码成真实 base64，覆盖含 0xff 的高位字节 */
function base64Of(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

interface DownloadCapture {
  createObjectURL: Mock<(obj: Blob | MediaSource) => string>
  revokeObjectURL: Mock<(url: string) => void>
  click: Mock<() => void>
  blob: Blob | null
  url: string
  anchor: HTMLAnchorElement | null
  revoked: string | null
}

/** 安装下载桩并返回可断言的记录对象 */
function captureDownload(): DownloadCapture {
  const capture: DownloadCapture = {
    createObjectURL: vi.fn<(obj: Blob | MediaSource) => string>(),
    revokeObjectURL: vi.fn<(url: string) => void>(),
    click: vi.fn<() => void>(),
    blob: null,
    url: 'blob:panda-dock-test',
    anchor: null,
    revoked: null,
  }

  capture.createObjectURL.mockImplementation((obj) => {
    capture.blob = obj as Blob
    return capture.url
  })
  capture.revokeObjectURL.mockImplementation((url) => {
    capture.revoked = url
  })

  vi.spyOn(URL, 'createObjectURL').mockImplementation(capture.createObjectURL)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(capture.revokeObjectURL)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    capture.anchor = this
    capture.click()
  })

  return capture
}

/** 取出被创建的 Blob，缺失时直接失败而不是静默通过 */
function requireBlob(capture: DownloadCapture): Blob {
  if (!capture.blob) throw new Error('URL.createObjectURL 未被调用，没有 Blob 可断言')
  return capture.blob
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('downloadDataUrl', () => {
  it('文件名、Data URL、MIME 与真实字节都正确，并在下载后移除临时锚点', async () => {
    const capture = captureDownload()
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x00, 0xfe, 0xff]

    downloadDataUrl(`data:image/png;base64,${base64Of(bytes)}`, 'image.png')

    expect(capture.createObjectURL).toHaveBeenCalledTimes(1)
    expect(capture.anchor?.download).toBe('image.png')
    expect(capture.anchor?.getAttribute('href')).toBe('blob:panda-dock-test')
    expect(capture.click).toHaveBeenCalledTimes(1)

    const blob = requireBlob(capture)
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual(bytes)

    // 临时锚点必须移除，否则会在宿主页面留下不可见节点
    expect(capture.anchor?.isConnected).toBe(false)
    expect(document.body.querySelectorAll('a')).toHaveLength(0)
    expect(capture.revoked).toBe('blob:panda-dock-test')
  })

  it('缺少 data: 前缀时 MIME 回退 application/octet-stream，但仍解出逗号后的 base64', async () => {
    const capture = captureDownload()

    downloadDataUrl('not-a-data-url,QUJD', 'raw.bin')

    const blob = requireBlob(capture)
    expect(blob.type).toBe('application/octet-stream')
    expect(await blob.text()).toBe('ABC')
    expect(capture.anchor?.download).toBe('raw.bin')
  })

  it('data URL 不含逗号时 base64 为空串，生成空 Blob 而不是抛错', async () => {
    const capture = captureDownload()

    downloadDataUrl('data:image/png;base64', 'empty.png')

    const blob = requireBlob(capture)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(0)
    expect(capture.anchor?.isConnected).toBe(false)
  })
})

describe('downloadText', () => {
  it('默认 MIME 为 application/json 并拼上 charset=utf-8', async () => {
    const capture = captureDownload()

    downloadText('{"a":1}', 'data.json')

    const blob = requireBlob(capture)
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(await blob.text()).toBe('{"a":1}')
    expect(capture.anchor?.download).toBe('data.json')
    expect(capture.click).toHaveBeenCalledTimes(1)
    expect(capture.revoked).toBe('blob:panda-dock-test')
    expect(document.body.querySelectorAll('a')).toHaveLength(0)
  })

  it('自定义 MIME 被透传并拼上 charset=utf-8', async () => {
    const capture = captureDownload()

    downloadText('hello 熊猫', 'note.txt', 'text/plain')

    const blob = requireBlob(capture)
    expect(blob.type).toBe('text/plain;charset=utf-8')
    expect(await blob.text()).toBe('hello 熊猫')
  })
})
