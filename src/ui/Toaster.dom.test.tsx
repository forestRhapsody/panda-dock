// @vitest-environment happy-dom
import { act } from 'react'

import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import { toast } from './toast'
/**
 * Toaster 是 toast.ts 单例在界面上的唯一出口：订阅 → 渲染。
 * 这里只断言真实 DOM 上能观察到的结果（文本、类名、顺序、清理），
 * 不 mock React，也不 mock toast。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警
import Toaster from './Toaster'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let live: boolean

const titles = () => [...container.querySelectorAll('.tk-toast__title')].map((el) => el.textContent)
const toasts = () => [...container.querySelectorAll('.tk-toast')]

beforeEach(() => {
  // toast.ts 是模块级状态，先清空避免上一条用例的通知串进来
  toast.dismiss()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  live = true
})

afterEach(() => {
  if (live) act(() => root.unmount())
  container.remove()
  toast.dismiss()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Toaster 渲染与语义', () => {
  it('空列表时仍渲染 live region 容器，保证首次公告前读屏已订阅（回归）', () => {
    act(() => {
      root.render(<Toaster />)
    })

    const region = container.querySelector('.tk-toaster')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('role')).toBe('region')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    // 常驻容器不能残留任何通知节点或可见文本（空 flex 容器不占位、pointer-events: none）
    expect(toasts()).toHaveLength(0)
    expect(container.textContent).toBe('')
  })

  it('toast.success 后把消息渲染进真实 DOM，并带 region/aria-live 语义', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('保存成功')
    })

    expect(titles()).toEqual(['保存成功'])

    const region = container.querySelector('.tk-toaster')
    expect(region).not.toBeNull()
    expect(region?.getAttribute('role')).toBe('region')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.getAttribute('aria-label')).toBe(i18n.t('common.notifications'))
    // 默认位置是底部居中
    expect(region?.classList.contains('tk-toaster--bottom')).toBe(true)

    // 每条通知自身是 status
    expect(container.querySelector('.tk-toast')?.getAttribute('role')).toBe('status')
  })

  it('position="top" 时改用顶部位置类，不再带底部类', () => {
    act(() => {
      root.render(<Toaster position='top' />)
    })
    act(() => {
      toast.info('顶部提示')
    })

    const region = container.querySelector('.tk-toaster')
    expect(region?.classList.contains('tk-toaster--top')).toBe(true)
    expect(region?.classList.contains('tk-toaster--bottom')).toBe(false)
  })

  it('success 与 error 渲染出不同的 kind 类名（样式差异的挂点）', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('成功')
      toast.error('失败')
    })

    // error 后触发，排在最前
    expect(toasts().map((el) => el.className)).toEqual([
      'tk-toast tk-toast--err',
      'tk-toast tk-toast--success',
    ])
    expect(titles()).toEqual(['失败', '成功'])
  })

  it('info 与 error 使用不同图标（info 不再复用告警图标）', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.error('出错了')
      toast.info('提示一下')
    })

    const iconOf = (el: Element) => el.querySelector('.tk-toast__icon')?.innerHTML ?? ''
    // info 后触发，排在最前
    const [infoToast, errToast] = toasts()
    expect(iconOf(infoToast)).not.toBe('')
    expect(iconOf(errToast)).not.toBe('')
    // 回归：源码曾让 err 与 info 都落 'alert'，两者图标完全一致
    expect(iconOf(infoToast)).not.toBe(iconOf(errToast))
  })
})

describe('Toaster 的堆叠数量与清空', () => {
  it('超过 3 条时最旧的被挤出 DOM，且最新的排在最前', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.create('第一条')
      toast.create('第二条')
      toast.create('第三条')
      toast.create('第四条')
    })

    expect(titles()).toEqual(['第四条', '第三条', '第二条'])
    expect(container.textContent).not.toContain('第一条')
  })

  it('toast.dismiss() 后通知节点全部清空，但 live region 容器常驻', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('一')
      toast.info('二')
    })
    expect(toasts()).toHaveLength(2)

    act(() => {
      toast.dismiss()
    })
    expect(toasts()).toHaveLength(0)
    // 容器若随内容销毁，读屏会丢掉公告区域，故空列表也要保留
    expect(container.querySelector('.tk-toaster')).not.toBeNull()
  })

  it('toast.dismiss(id) 只让对应那一条从 DOM 消失', () => {
    act(() => {
      root.render(<Toaster />)
    })
    let target = ''
    act(() => {
      toast.success('保留')
      target = toast.error('移除')
    })

    act(() => {
      toast.dismiss(target)
    })
    expect(titles()).toEqual(['保留'])
  })

  it('点击关闭按钮只移除该项，其余保留', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('保留')
      toast.error('关闭我')
    })

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.tk-toast__close')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].getAttribute('aria-label')).toBe(i18n.t('common.close'))

    // 第一条是最新的 error，就是要关掉的那条
    act(() => buttons[0].click())
    expect(titles()).toEqual(['保留'])
  })
})

describe('Toaster 的订阅生命周期与定时消失', () => {
  it('unmount 会调用 subscribe 返回的取消订阅函数', () => {
    const original = toast.subscribe
    const off = vi.fn()
    vi.spyOn(toast, 'subscribe').mockImplementation((listener) => {
      const unsubscribe = original(listener)
      return () => {
        unsubscribe()
        off()
      }
    })

    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('卸载前')
    })
    expect(titles()).toEqual(['卸载前'])

    act(() => root.unmount())
    live = false

    expect(off).toHaveBeenCalledTimes(1)
  })

  it('unmount 后再发布通知不会更新旧容器，新挂载的 Toaster 能看到它', () => {
    act(() => {
      root.render(<Toaster />)
    })
    act(() => {
      toast.success('卸载前')
    })
    expect(titles()).toEqual(['卸载前'])

    act(() => root.unmount())
    live = false
    act(() => {
      toast.success('卸载后')
    })

    // 旧容器保持空白，说明没有回调再去驱动它
    expect(container.innerHTML).toBe('')

    // 新容器订阅时直接拿到当前快照（卸载后的新通知 + 尚未到期消失的旧通知）
    const other = document.createElement('div')
    document.body.appendChild(other)
    const otherRoot = createRoot(other)
    act(() => {
      otherRoot.render(<Toaster />)
    })
    expect([...other.querySelectorAll('.tk-toast__title')].map((el) => el.textContent)).toEqual([
      '卸载后',
      '卸载前',
    ])
    act(() => otherRoot.unmount())
    other.remove()
  })

  it('到时间后通知自动从 DOM 中消失', async () => {
    vi.useFakeTimers()
    await act(async () => {
      root.render(<Toaster />)
    })
    await act(async () => {
      toast.success('短暂')
    })
    expect(titles()).toEqual(['短暂'])

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(toasts()).toHaveLength(0)
    // 定时消失只移除通知，live region 容器仍在
    expect(container.querySelector('.tk-toaster')).not.toBeNull()
  })
})
