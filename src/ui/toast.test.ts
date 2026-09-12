// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from './toast'
import type { ToastItem } from './toast'

/**
 * toast.ts 是模块级单例：条目与订阅者都挂在模块作用域上，用例之间会互相污染。
 * 因此每个用例开始前都先 `toast.dismiss()` 清空，结束后再取消订阅，
 * 保证用例可以任意顺序执行。
 *
 * 环境用 happy-dom 而不是默认的 node：源码的自动消失走 `window.setTimeout`，
 * node 环境没有 window，测「到点自动移除」会直接 ReferenceError。
 */

let frames: ToastItem[][]
let unsubscribe: (() => void) | undefined

/** 开始订阅，并把每次推送的「当前快照」按先后顺序记下来 */
function startCapture(): void {
  frames = []
  unsubscribe = toast.subscribe((items) => frames.push(items))
}

/** 最近一次推送的快照 = 管理器当前对外可见的状态 */
const latest = (): ToastItem[] => frames.at(-1) ?? []
const messages = (): string[] => latest().map((item) => item.message)

beforeEach(() => {
  vi.useFakeTimers()
  toast.dismiss()
  frames = []
  unsubscribe = undefined
})

afterEach(() => {
  unsubscribe?.()
  toast.dismiss()
  vi.useRealTimers()
})

describe('toast.subscribe：快照推送与退订', () => {
  it('订阅时立即收到当前快照（包含订阅之前就已存在的条目）', () => {
    toast.create('先来的')
    startCapture()

    // 只推送了一次，且就是「现在有什么」
    expect(frames).toHaveLength(1)
    expect(messages()).toEqual(['先来的'])
  })

  it('推送的是快照拷贝，外部改动它不会污染管理器内部状态', () => {
    startCapture()
    expect(latest()).toEqual([])

    // 篡改收到的数组：如果内部状态是按引用共用的，下面的断言就会看到这个伪造条目
    latest().push({ id: '伪造', message: '伪造', kind: 'default' })

    toast.info('真实的')
    expect(messages()).toEqual(['真实的'])
  })

  it('取消订阅后不再收到推送，但管理器本身照常记录', () => {
    startCapture()
    unsubscribe?.()
    unsubscribe = undefined
    frames = []

    const second: ToastItem[][] = []
    const off = toast.subscribe((items) => second.push(items))
    toast.success('取消订阅之后')

    // 老订阅者一条都收不到……
    expect(frames).toHaveLength(0)
    // ……但通知确实进了管理器：新订阅者能看到它
    expect(second.at(-1)?.map((item) => item.message)).toEqual(['取消订阅之后'])
    off()
  })
})

describe('toast.create：默认 kind 与 duration', () => {
  it('未指定 kind 时为 default，非错误类型默认 2000ms，返回值即条目 id', () => {
    startCapture()
    const id = toast.create('普通通知')

    expect(latest()).toHaveLength(1)
    expect(latest()[0]).toEqual({
      id,
      message: '普通通知',
      kind: 'default',
      duration: 2000,
      icon: undefined,
    })
  })

  it('kind=err 默认 3000ms，显式 duration 覆盖默认值', () => {
    startCapture()

    toast.create('出错了', { kind: 'err' })
    expect(latest()[0]).toMatchObject({ kind: 'err', duration: 3000 })

    toast.create('出错了但很短', { kind: 'err', duration: 500 })
    expect(latest()[0]).toMatchObject({ kind: 'err', duration: 500 })
  })

  it('create 会保留调用方传入的 icon', () => {
    startCapture()
    toast.create('带图标', { icon: 'alert' })

    expect(latest()[0].icon).toBe('alert')
  })
})

describe('success / error / info 三种糖', () => {
  it('success：kind=success，默认 2000ms', () => {
    startCapture()
    const id = toast.success('保存成功')

    expect(latest()[0]).toMatchObject({ id, message: '保存成功', kind: 'success', duration: 2000 })
  })

  it('error：kind=err（不是 error），默认 3000ms', () => {
    startCapture()
    toast.error('失败了')

    expect(latest()[0]).toMatchObject({ message: '失败了', kind: 'err', duration: 3000 })
  })

  it('info：kind=info，默认 2000ms', () => {
    startCapture()
    toast.info('提示一下')

    expect(latest()[0]).toMatchObject({ message: '提示一下', kind: 'info', duration: 2000 })
  })

  it('第二个参数传 number 时被当作 duration（含 0 = 常驻）', () => {
    startCapture()

    toast.success('接口回调', 1234)
    expect(latest()[0]).toMatchObject({ kind: 'success', duration: 1234 })

    toast.error('常驻错误', 0)
    expect(latest()[0]).toMatchObject({ kind: 'err', duration: 0 })
  })

  it('第二个参数传 options 对象时透传 duration 与 icon，未传则回落到默认时长', () => {
    startCapture()

    toast.info('带图标提示', { duration: 800, icon: 'alert' })
    expect(latest()[0]).toMatchObject({ kind: 'info', duration: 800, icon: 'alert' })

    toast.success('仅图标', { icon: 'check' })
    expect(latest()[0]).toMatchObject({ kind: 'success', duration: 2000, icon: 'check' })
  })

  it('负数 / NaN / Infinity 的 duration 属非法输入，回落到该 kind 的默认时长', () => {
    startCapture()

    toast.create('负数', { kind: 'success', duration: -100 })
    expect(latest()[0]).toMatchObject({ kind: 'success', duration: 2000 })

    toast.create('NaN', { kind: 'err', duration: Number.NaN })
    expect(latest()[0]).toMatchObject({ kind: 'err', duration: 3000 })

    toast.create('Infinity', { kind: 'info', duration: Number.POSITIVE_INFINITY })
    expect(latest()[0]).toMatchObject({ kind: 'info', duration: 2000 })
  })
})

describe('toast.dismiss', () => {
  it('dismiss(id) 只删除指定条目，其余保持原顺序', () => {
    startCapture()
    toast.success('a')
    const b = toast.info('b')
    toast.error('c')
    expect(messages()).toEqual(['c', 'b', 'a'])

    toast.dismiss(b)
    expect(messages()).toEqual(['c', 'a'])
  })

  it('dismiss() 不带 id 时清空全部', () => {
    startCapture()
    toast.success('a')
    toast.info('b')
    expect(latest()).toHaveLength(2)

    toast.dismiss()
    expect(latest()).toEqual([])
    // 清空也要推送一次，订阅者才能把界面一并清掉
    expect(frames).toHaveLength(4)
  })

  it('dismiss 一个不存在的 id 不影响现有条目', () => {
    startCapture()
    toast.success('a')

    toast.dismiss('不存在的-id')
    expect(messages()).toEqual(['a'])
  })

  it('dismiss(id) 会清理该条已排期的定时器（不再留下无效回调）', () => {
    startCapture()
    const id = toast.create('待清理', { duration: 2000 })
    expect(vi.getTimerCount()).toBe(1)

    toast.dismiss(id)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('dismiss() 清空时同样清理全部已排期定时器', () => {
    startCapture()
    toast.create('a', { duration: 2000 })
    toast.create('b', { duration: 3000 })
    expect(vi.getTimerCount()).toBe(2)

    toast.dismiss()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('数量上限与顺序', () => {
  it('被挤出的第 4 条会连带清理它的定时器（不会留下悬挂回调）', () => {
    startCapture()
    toast.create('1', { duration: 2000 })
    toast.create('2', { duration: 2000 })
    toast.create('3', { duration: 2000 })
    expect(vi.getTimerCount()).toBe(3)

    toast.create('4', { duration: 2000 })
    // 仍是 3 个：第 1 条被挤出时其定时器已 clearTimeout
    expect(vi.getTimerCount()).toBe(3)
    expect(messages()).toEqual(['4', '3', '2'])
  })

  it('最多保留 3 条，最新的排在最前，最旧的被挤出', () => {
    startCapture()
    toast.create('1')
    toast.create('2')
    toast.create('3')
    expect(messages()).toEqual(['3', '2', '1'])

    toast.create('4')
    expect(messages()).toEqual(['4', '3', '2'])
    expect(messages()).not.toContain('1')
  })

  it('被挤出后 dismiss 最新一条，剩余顺序不被打乱', () => {
    startCapture()
    toast.create('1')
    toast.create('2')
    toast.create('3')
    const fourth = toast.create('4')

    toast.dismiss(fourth)
    expect(messages()).toEqual(['3', '2'])
  })
})

describe('id 唯一性', () => {
  it('同一时刻连续创建 50 条，id 互不相同', () => {
    startCapture()
    const ids = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      ids.add(toast.create(`消息 ${i}`))
    }

    expect(ids.size).toBe(50)
  })
})

describe('到点自动消失', () => {
  it('success 默认 2000ms：差 1ms 还在，走满即消失', () => {
    startCapture()
    toast.success('短提示')

    vi.advanceTimersByTime(1999)
    expect(messages()).toEqual(['短提示'])

    vi.advanceTimersByTime(1)
    expect(messages()).toEqual([])
  })

  it('error 默认 3000ms 后自动消失', () => {
    startCapture()
    toast.error('错误')

    vi.advanceTimersByTime(2999)
    expect(latest()).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(latest()).toEqual([])
  })

  it('duration=0 的条目永不自动消失', () => {
    startCapture()
    toast.create('常驻', { duration: 0 })
    toast.error('常驻错误', 0)

    vi.advanceTimersByTime(60_000)
    expect(messages()).toEqual(['常驻错误', '常驻'])
  })

  it('自定义 duration 各自到期：只移除到点的那一条', () => {
    startCapture()
    toast.success('短的', 1000)
    toast.error('长的', 5000)

    vi.advanceTimersByTime(1000)
    expect(messages()).toEqual(['长的'])

    vi.advanceTimersByTime(4000)
    expect(latest()).toEqual([])
  })
})
