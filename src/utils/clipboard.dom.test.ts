// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './clipboard'

/**
 * 复制按钮的唯一反馈就是返回值：true/false 决定 UI 显示「已复制」还是失败提示。
 * 扩展页面/网页里 navigator.clipboard 可能整体不存在（非安全上下文），
 * 此时必须降级到 execCommand，且降级用的临时 textarea 不能留在页面 DOM 里。
 */
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(navigator),
  'clipboard',
)

/** 覆盖 navigator.clipboard：传 undefined 模拟「没有 Clipboard API」 */
function stubClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

/**
 * happy-dom 没有实现 document.execCommand（属性根本不存在，vi.spyOn 会报 "not defined"），
 * 所以直接定义同名方法并返回它，便于断言调用与影响返回值。
 */
function stubExecCommand(impl: () => boolean): (...args: unknown[]) => boolean {
  const fn = vi.fn(impl)
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true })
  return fn
}

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  delete (document as Partial<Document>).execCommand
  // 清掉被测代码可能遗留的临时节点：既避免污染后续用例，也避免掩盖泄漏问题
  for (const node of document.querySelectorAll('textarea')) node.remove()
  vi.restoreAllMocks()
})

describe('copyText 的 Clipboard API 路径', () => {
  it('writeText 成功时返回 true，并把原文交给剪贴板', async () => {
    const writeText = vi.fn(async () => undefined)
    stubClipboard({ writeText })

    await expect(copyText('hello 复制')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello 复制')
  })

  it('writeText 抛错时降级到 execCommand，并返回降级结果', async () => {
    stubClipboard({
      writeText: vi.fn(async () => {
        throw new Error('Document is not focused')
      }),
    })
    const execCommand = stubExecCommand(() => true)

    await expect(copyText('降级文本')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('没有 navigator.clipboard 时直接走 execCommand 降级', async () => {
    stubClipboard(undefined)
    const execCommand = stubExecCommand(() => true)

    await expect(copyText('无剪贴板 API')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('clipboard 存在但缺 writeText 时同样走降级', async () => {
    stubClipboard({})
    const execCommand = stubExecCommand(() => true)

    await expect(copyText('缺方法')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('降级前把原文写进临时 textarea 再选中', async () => {
    stubClipboard(undefined)
    let valueInTextarea = ''
    stubExecCommand(() => {
      valueInTextarea = document.querySelector('textarea')?.value ?? ''
      return true
    })

    await expect(copyText('被复制的原文')).resolves.toBe(true)
    expect(valueInTextarea).toBe('被复制的原文')
  })
})

describe('copyText 的降级失败路径', () => {
  it('execCommand 返回 false 时 copyText 返回 false', async () => {
    stubClipboard(undefined)
    stubExecCommand(() => false)

    await expect(copyText('复制失败')).resolves.toBe(false)
  })

  it('execCommand 抛错时返回 false，不向外抛，且临时节点仍被移除', async () => {
    stubClipboard(undefined)
    stubExecCommand(() => {
      throw new Error('execCommand is not supported')
    })

    await expect(copyText('复制失败')).resolves.toBe(false)
    // 回归：ta.remove() 已移入 finally，异常路径也不能把 textarea 留在宿主页 DOM 里
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('降级路径创建的临时 textarea 会从 DOM 移除，不污染页面', async () => {
    stubClipboard(undefined)
    const execCommand = stubExecCommand(() => true)

    await expect(copyText('临时节点')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledTimes(1)
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
