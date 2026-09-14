// @vitest-environment happy-dom
import { act } from 'react'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { BALL_SIZE_PX } from '@/utils/settings'

import FloatingBall, { clampBallPos, snapToEdge } from './FloatingBall'

/** content 样式只能内联进 Shadow DOM，这里直接读源码文本做守卫（`?raw` 在测试环境返回空串） */
const contentCss = readFileSync(resolve(import.meta.dirname, 'content.css'), 'utf8')

/**
 * 悬浮球的几何计算（夹取 / 吸边）与真实 DOM 行为：
 * 位置算错会让球跑出视口或永远回不到边上，是拖拽体验里最容易被忽略又最容易坏的部分，
 * 所以纯函数与渲染样式都要在实际视口尺寸下断言，而不是只看「渲染成功」。
 */

// React 19 的 act 需要该标记，否则会打印 "not wrapped in act" 告警

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 视口宽度（用来构造左右越界与左右半区） */
const VW = 400
/** 视口高度 */
const VH = 300
/** 默认球直径：BALL_SIZE_PX.sm（默认大小为「小」） */
const D = BALL_SIZE_PX.sm
/** 源码里的纵向最小边距 */
const EDGE_MARGIN = 8

let container: HTMLDivElement
let root: Root
let originalWidth: number
let originalHeight: number
let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture

function setViewport(width: number, height: number) {
  window.innerWidth = width
  window.innerHeight = height
}

function ballEl(): HTMLDivElement {
  const el = container.querySelector<HTMLDivElement>('.tek__dock')
  if (!el) throw new Error('未找到悬浮球元素')
  return el
}

/** 与源码一致的纵向夹取期望值 */
function expectDockTop(top: number, d = D, vh = VH) {
  return Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, vh - d - EDGE_MARGIN))
}

function dispatchPointer(
  el: Element,
  type: string,
  init: { x: number; y: number; button?: number },
) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: init.x,
        clientY: init.y,
        button: init.button ?? 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
      }),
    )
  })
}

/**
 * React 的 onPointerEnter / onPointerLeave 是由 pointerover / pointerout 合成的，
 * 单独派发 pointerenter 不会触发；这里两者都发一次，兼容不同版本的合成策略。
 */
function hover(el: Element) {
  dispatchPointer(el, 'pointerover', { x: 0, y: 0 })
  dispatchPointer(el, 'pointerenter', { x: 0, y: 0 })
}

function unhover(el: Element) {
  dispatchPointer(el, 'pointerout', { x: 0, y: 0 })
  dispatchPointer(el, 'pointerleave', { x: 0, y: 0 })
}

function renderBall(props: Partial<Parameters<typeof FloatingBall>[0]> = {}) {
  const onDrop = props.onDrop ?? (() => {})
  const onToggle = props.onToggle ?? (() => {})
  act(() => {
    root.render(
      <FloatingBall pos={{ x: 0, y: 100 }} onDrop={onDrop} onToggle={onToggle} {...props} />,
    )
  })
  return ballEl()
}

beforeEach(() => {
  originalWidth = window.innerWidth
  originalHeight = window.innerHeight
  setViewport(VW, VH)
  // happy-dom 不保证实现 Pointer Capture，源码在 pointerdown 里无条件调用，缺了就补一个 no-op
  originalSetPointerCapture = HTMLElement.prototype.setPointerCapture
  HTMLElement.prototype.setPointerCapture = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  HTMLElement.prototype.setPointerCapture = originalSetPointerCapture
  setViewport(originalWidth, originalHeight)
})

describe('FloatingBall clampBallPos（视口夹取）', () => {
  it('左上越界时夹到左边缘 0 与纵向最小边距 8', () => {
    expect(clampBallPos({ x: -120, y: -50 }, D)).toEqual({ x: 0, y: EDGE_MARGIN })
  })

  it('右下越界时夹到 innerWidth-d 与 innerHeight-d-8', () => {
    expect(clampBallPos({ x: 9999, y: 9999 }, D)).toEqual({
      x: VW - D,
      y: VH - D - EDGE_MARGIN,
    })
  })

  it('视口比球还小时退化：x 夹到 0、y 夹到纵向边距，而不是负数', () => {
    setViewport(30, 30)
    expect(clampBallPos({ x: 100, y: 100 }, D)).toEqual({ x: 0, y: EDGE_MARGIN })
    // 视口宽度刚好比球小 1px 也应停在 0
    setViewport(D - 1, 20)
    expect(clampBallPos({ x: 55, y: 55 }, D)).toEqual({ x: 0, y: EDGE_MARGIN })
  })

  it('已在范围内的坐标原样保留', () => {
    expect(clampBallPos({ x: 100, y: 120 }, D)).toEqual({ x: 100, y: 120 })
  })

  it('幂等：对已夹取的结果再次夹取不变', () => {
    const once = clampBallPos({ x: 9999, y: -9999 }, D)
    expect(clampBallPos(once, D)).toEqual(once)
  })
})

describe('FloatingBall snapToEdge（左右吸边）', () => {
  it('球心落在左半区时吸到左缘 x=0', () => {
    // 10 + 22 = 32 < 200
    expect(snapToEdge({ x: 10, y: 100 }, D)).toEqual({ x: 0, y: 100 })
  })

  it('球心落在右半区时吸到右缘 x=innerWidth-d', () => {
    // 300 + 22 = 322 >= 200
    expect(snapToEdge({ x: 300, y: 100 }, D)).toEqual({ x: VW - D, y: 100 })
  })

  it('球心恰好落在中线时按右缘处理（源码用 < 判定左半区）', () => {
    // 178 + 22 = 200，不小于 innerWidth/2
    expect(snapToEdge({ x: VW / 2 - D / 2, y: 100 }, D)).toEqual({ x: VW - D, y: 100 })
  })

  it('纵向留边：上下越界时夹在 [8, innerHeight-d-8] 内', () => {
    expect(snapToEdge({ x: 0, y: -100 }, D)).toEqual({ x: 0, y: EDGE_MARGIN })
    expect(snapToEdge({ x: 0, y: 10000 }, D)).toEqual({ x: 0, y: VH - D - EDGE_MARGIN })
  })

  it('视口高度不足以容纳球时纵向退化为最小边距', () => {
    setViewport(VW, 30)
    expect(snapToEdge({ x: 0, y: 500 }, D).y).toBe(expectDockTop(500, D, 30))
    expect(snapToEdge({ x: 0, y: 500 }, D).y).toBe(EDGE_MARGIN)
  })

  it('幂等：吸边结果再次吸边不变（拖拽结束与窗口 resize 会重复调用）', () => {
    const once = snapToEdge({ x: 300, y: 250 }, D)
    expect(snapToEdge(once, D)).toEqual(once)
  })
})

describe('FloatingBall 渲染与定位', () => {
  it('bottomRight 模式用 right/bottom 固定定位并显示手型，且不写 left/top', () => {
    const el = renderBall({ dockMode: 'bottomRight', bottomRightOffset: { right: 24, bottom: 40 } })
    expect(el.style.right).toBe('24px')
    expect(el.style.bottom).toBe('40px')
    expect(el.style.cursor).toBe('pointer')
    expect(el.style.left).toBe('')
    expect(el.style.top).toBe('')
  })

  it('bottomRight 未传边距时回退到默认 80/80', () => {
    const el = renderBall({ dockMode: 'bottomRight' })
    expect(el.style.right).toBe('80px')
    expect(el.style.bottom).toBe('80px')
  })

  it('free 模式用 left/top 落在任意位置且不吸边', () => {
    const el = renderBall({ dockMode: 'free', pos: { x: 123, y: 45 } })
    expect(el.style.left).toBe('123px')
    expect(el.style.top).toBe('45px')
    expect(el.style.right).toBe('')
    expect(el.style.transform).toBe('')
  })

  it('兼容旧字段：snap=false 且未传 dockMode 时按 free 模式定位', () => {
    const el = renderBall({ snap: false, pos: { x: 88, y: 66 } })
    expect(el.style.left).toBe('88px')
    expect(el.style.top).toBe('66px')
  })

  it('edge 模式默认半隐：左半区的球未悬停时 translateX(-50%)，悬停后完全滑出', () => {
    const el = renderBall({ pos: { x: 0, y: 100 } })
    expect(el.style.left).toBe('0px')
    expect(el.style.top).toBe('100px')
    expect(el.style.transform).toBe('translateX(-50%)')

    hover(el)
    expect(el.style.transform).toBe('translateX(0)')

    // 移开后重新半隐
    unhover(el)
    expect(el.style.transform).toBe('translateX(-50%)')
  })

  it('edge 模式在右半区改用 right 定位，未悬停时 translateX(50%)', () => {
    const el = renderBall({ pos: { x: VW - D, y: 120 } })
    expect(el.style.right).toBe('0px')
    expect(el.style.left).toBe('')
    expect(el.style.transform).toBe('translateX(50%)')

    hover(el)
    expect(el.style.transform).toBe('translateX(0)')
  })

  it('形状决定 borderRadius：circle=50% / rounded=比例圆角 / square=0', () => {
    expect(renderBall({ shape: 'circle' }).style.borderRadius).toBe('50%')
    expect(renderBall({ shape: 'rounded' }).style.borderRadius).toBe(`${Math.round(D * 0.28)}px`)
    expect(renderBall({ shape: 'square' }).style.borderRadius).toBe('0px')
  })

  it('大小档位映射到 BALL_SIZE_PX 的宽高', () => {
    expect(renderBall({ size: 'sm' }).style.width).toBe(`${BALL_SIZE_PX.sm}px`)
    expect(renderBall({ size: 'md' }).style.height).toBe(`${BALL_SIZE_PX.md}px`)
    expect(renderBall({ size: 'lg' }).style.width).toBe(`${BALL_SIZE_PX.lg}px`)
  })

  it('球体容器默认不带底色：有图 / 无图两条分支都不写 background', () => {
    const withImage = renderBall({ image: 'data:image/png;base64,AAAA' })
    expect(withImage.style.background).toBe('')
    expect(withImage.style.backgroundColor).toBe('')

    const withEmoji = renderBall({ preset: 'unknown' as never })
    expect(withEmoji.style.background).toBe('')
    expect(withEmoji.style.backgroundColor).toBe('')
  })

  it('内容脚本样式不给悬浮球加底色与投影（容器默认无背景，也不需要一圈阴影）', () => {
    // 取 .tek__dock 基础规则（:hover / --drag 修饰符不参与）
    const dockRule = /\.tek__dock\s*\{[^}]*\}/.exec(contentCss)?.[0] ?? ''
    expect(dockRule).not.toBe('')
    expect(dockRule).not.toContain('box-shadow')
    expect(dockRule).not.toMatch(/(^|[;{\s])background\s*:/)
  })

  it('有自定义图片时用 backgroundImage 铺满，且不再渲染 emoji logo', () => {
    const image = 'data:image/png;base64,AAAA'
    const el = renderBall({ image })
    expect(el.style.backgroundImage).toContain(image)
    expect(el.style.backgroundSize).toBe('cover')
    expect(el.querySelector('.tek__dock-logo')).toBeNull()
  })

  it('无自定义图片时沿用预设 logo：带图片的预设走 backgroundImage', () => {
    const el = renderBall({ preset: 'primary' })
    expect(el.style.backgroundImage).toContain('ball-default.png')
    expect(el.querySelector('.tek__dock-logo')).toBeNull()
  })

  it('无自定义图片且预设无对应图片资源时回退渲染默认 emoji logo', () => {
    const el = renderBall({ preset: 'unknown' as never })
    expect(el.style.backgroundImage).toBe('')
    const logo = el.querySelector('.tek__dock-logo')
    expect(logo?.textContent).toBe('🔵')
    // logo 字号跟随球直径的一半，保证各档位下比例一致
    expect((logo as HTMLElement | null)?.style.fontSize).toBe(`${Math.round(D * 0.5)}px`)
  })

  it('aria-label 走 i18n（中文不是裸 key，且与语言包一致）', () => {
    const el = renderBall()
    expect(el.getAttribute('role')).toBe('button')
    expect(el.getAttribute('aria-label')).toBe(i18n.t('ball.ariaOpen'))
    expect(el.getAttribute('aria-label')).not.toBe('ball.ariaOpen')
  })
})

describe('FloatingBall 拖拽与点击交互', () => {
  it('非左键按下被忽略：既不触发 onToggle 也不触发 onDrop', () => {
    const onToggle = vi.fn()
    const onDrop = vi.fn()
    const el = renderBall({ onToggle, onDrop })

    dispatchPointer(el, 'pointerdown', { x: 100, y: 100, button: 2 })
    dispatchPointer(el, 'pointerup', { x: 100, y: 100, button: 2 })

    expect(onToggle).not.toHaveBeenCalled()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('位移小于 6px 视为轻点：pointerup 触发 onToggle 且不触发 onDrop', () => {
    const onToggle = vi.fn()
    const onDrop = vi.fn()
    const el = renderBall({ onToggle, onDrop })

    dispatchPointer(el, 'pointerdown', { x: 100, y: 100 })
    dispatchPointer(el, 'pointermove', { x: 103, y: 101 })
    dispatchPointer(el, 'pointerup', { x: 103, y: 101 })

    expect(onDrop).not.toHaveBeenCalled()
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('edge 模式拖拽超过阈值后 pointerup：onDrop 收到已吸边的坐标', () => {
    const onToggle = vi.fn()
    const onDrop = vi.fn()
    const el = renderBall({ dockMode: 'edge', onToggle, onDrop })

    dispatchPointer(el, 'pointerdown', { x: 100, y: 100 })
    dispatchPointer(el, 'pointermove', { x: 200, y: 180 })
    // 拖动中整圆跟随指针（不吸边）
    expect(el.style.left).toBe(`${200 - D / 2}px`)
    expect(el.style.top).toBe(`${180 - D / 2}px`)

    dispatchPointer(el, 'pointerup', { x: 200, y: 180 })

    expect(onToggle).not.toHaveBeenCalled()
    expect(onDrop).toHaveBeenCalledTimes(1)
    // x=178 时球心 178+22=200 不在左半区 → 吸到右缘
    expect(onDrop).toHaveBeenCalledWith({ x: VW - D, y: 180 - D / 2 })
  })

  it('free 模式拖拽结束后 onDrop 收到夹取（而非吸边）的坐标', () => {
    const onDrop = vi.fn()
    const el = renderBall({ dockMode: 'free', onDrop })

    dispatchPointer(el, 'pointerdown', { x: 10, y: 10 })
    // 往左上拖出视口，验证夹取而不是吸边
    dispatchPointer(el, 'pointermove', { x: -50, y: -50 })
    dispatchPointer(el, 'pointerup', { x: -50, y: -50 })

    expect(onDrop).toHaveBeenCalledWith({ x: 0, y: EDGE_MARGIN })
  })

  it('bottomRight 模式指针移动不改变定位（仍固定在右下角），也不触发 onDrop', () => {
    const onDrop = vi.fn()
    const onToggle = vi.fn()
    const el = renderBall({ dockMode: 'bottomRight', onToggle, onDrop })

    dispatchPointer(el, 'pointerdown', { x: 100, y: 100 })
    dispatchPointer(el, 'pointermove', { x: 320, y: 260 })

    expect(el.style.right).toBe('80px')
    expect(el.style.bottom).toBe('80px')
    expect(el.style.left).toBe('')
    expect(el.style.top).toBe('')
    expect(el.className).not.toContain('tek__dock--drag')

    dispatchPointer(el, 'pointerup', { x: 320, y: 260 })
    expect(onDrop).not.toHaveBeenCalled()
    // 该模式没有拖拽语义，整段手势按「轻点」处理
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('pointercancel 与 pointerup 等价：拖拽被取消也会落定并回调 onDrop', () => {
    const onDrop = vi.fn()
    const onToggle = vi.fn()
    const el = renderBall({ dockMode: 'free', onDrop, onToggle })

    dispatchPointer(el, 'pointerdown', { x: 100, y: 100 })
    dispatchPointer(el, 'pointermove', { x: 160, y: 160 })
    dispatchPointer(el, 'pointercancel', { x: 160, y: 160 })

    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
