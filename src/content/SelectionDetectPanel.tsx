import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from 'react-i18next'

import { detect } from '@/tools/detect'
import type { DetectResult } from '@/tools/detect'
import DetectResultView from '@/tools/DetectResultView'
import { StatusText } from '@/tools/StatusText'
import Icon from '@/ui/Icon'

interface SelectionDetectPanelProps {
  text: string
  /** 触发点（视口坐标），默认屏幕左上角 */
  x?: number
  y?: number
  onClose: () => void
}

const PAD = 8

/**
 * 右键「智能解析选中文字」后在网页内弹出的悬浮面板（沉浸式翻译风格）。
 * - 点击 header（或抓手）任意拖动整卡；
 * - 图钉图标可钉住：钉住后点击页面其它区域不再自动关闭（Escape 仍可关）。
 * 渲染在 Content Script 的 Shadow DOM 里，样式与宿主隔离；贴近视口边缘自动回夹，下方不足翻到上方。
 */
export default function SelectionDetectPanel({
  text,
  x = PAD,
  y = PAD,
  onClose,
}: SelectionDetectPanelProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [pinned, setPinned] = useState(false)
  // 定位好之前先隐藏，避免首帧越界/位置跳动后再回夹的闪烁
  const [shown, setShown] = useState(false)
  // 面板是否已定位过一次；已钉住 + 已定位后，重新识别不再移动位置
  const positionedRef = useRef(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned
  const result = useMemo<DetectResult | null>(() => detect(text), [text])

  const clampPos = useCallback((left: number, top: number) => {
    const el = ref.current
    const w = el?.offsetWidth ?? 480
    const h = el?.offsetHeight ?? 320
    return {
      left: Math.min(Math.max(left, PAD), Math.max(PAD, window.innerWidth - w - PAD)),
      top: Math.min(Math.max(top, PAD), Math.max(PAD, window.innerHeight - h - PAD)),
    }
  }, [])

  // 挂载后按实际尺寸回夹到视口内，避免溢出。
  // 策略：把面板**居中**在右键点上再回夹 —— 面板始终贴近点击处，
  // 不再因面板较高而"翻到上方/夹到顶部远离点击点"。
  // 面板已定位过且已钉住时，重新识别（x/y 变化）不再移动位置（只更新内容）。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (positionedRef.current && pinnedRef.current) return
    const r = el.getBoundingClientRect()
    setPos(clampPos(x - r.width / 2, y - r.height / 2))
    positionedRef.current = true
    setShown(true)
  }, [x, y, clampPos])

  // 拖动：按住 header（非按钮部分）移动整卡
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return
      dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [pos.left, pos.top],
  )
  const moveDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current
      if (!d) return
      setPos(clampPos(e.clientX - d.dx, e.clientY - d.dy))
    },
    [clampPos],
  )
  const endDrag = useCallback(() => {
    dragRef.current = null
  }, [])

  // 点击面板外部关闭（未钉住时）
  // 注意：面板渲染在 Shadow DOM 里，事件越过 shadow 边界时 target 会被重定向为宿主元素，
  // 导致"点在面板内"被误判为"点在外部"。用 composedPath() 取完整路径来判定。
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (pinned) return
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target as Node]
      if (ref.current && path.includes(ref.current)) return
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose, pinned])

  // Escape 始终关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={ref}
      className='tek-detect-panel'
      role='dialog'
      aria-label={t('tool.detect.title')}
      style={{ left: pos.left, top: pos.top, opacity: shown ? 1 : 0 }}
    >
      <div
        className='tek-detect-panel__head'
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className='tek-detect-panel__grip' aria-hidden>
          <Icon name='grip' size={14} />
        </span>
        <strong className='tek-detect-panel__title'>{t('tool.detect.title')}</strong>
        <button
          type='button'
          className={`tk-icon-btn tek-detect-panel__pin${pinned ? ' tek-detect-panel__pin--on' : ''}`}
          title={pinned ? t('tool.detect.unpin') : t('tool.detect.pin')}
          aria-pressed={pinned}
          onClick={() => setPinned((p) => !p)}
        >
          <Icon name='pin' size={14} />
        </button>
        <button
          type='button'
          className='tk-icon-btn'
          title={t('common.cancel')}
          aria-label={t('common.cancel')}
          onClick={onClose}
        >
          <Icon name='close' size={14} />
        </button>
      </div>
      <div className='tek-detect-panel__body'>
        {result ? (
          <DetectResultView result={result} blockMaxHeight={300} />
        ) : (
          <StatusText kind='info'>{t('tool.detect.none')}</StatusText>
        )}
      </div>
    </div>
  )
}
