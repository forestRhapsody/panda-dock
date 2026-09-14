import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { useTranslation } from 'react-i18next'

import CopyButton from '@/tools/CopyButton'
import { detect } from '@/tools/detect'
import type { DetectResult } from '@/tools/detect'
import DetectResultView from '@/tools/DetectResultView'
import HighlightArea from '@/tools/HighlightArea'
import type { ToolId } from '@/tools/registry'
import { StatusText } from '@/tools/StatusText'
import Icon from '@/ui/Icon'
import Tooltip from '@/ui/Tooltip'

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface SelectionDetectPanelProps {
  text: string
  /** 触发点（视口坐标），默认屏幕左上角 */
  x?: number
  y?: number
  /** 选中文本在视口中的包围盒矩形（用于精确定位在文本下方） */
  targetRect?: SelectionRect
  /** 定位策略：未选中文字时固定在右上角；选中文字时居中跟随选区 */
  position?: 'selection' | 'top-right'
  onClose: () => void
  /** 一键把当前文本带入工具箱（宿主按用户设置选择原生侧边栏或网页抽屉） */
  onOpenToolbox?: (text: string) => void
  /** 「在 XX 工具中打开」：交由宿主准备草稿并唤起（T134） */
  onOpenInTool?: (tool: ToolId, text: string) => void
  /** 图钉状态变化：宿主据此决定「在工具中打开」后是否收起面板（钉住则常驻） */
  onPinnedChange?: (pinned: boolean) => void
}

const PAD = 10
const GAP = 8
/**
 * 输入框的最大高度（约 8 行文本高度，约 180px）。刻意**与是否有解析结果无关**：
 * 输入框内部可滚动，压低上限不会让内容不可见，同时为下方结果区留出更多舒适的阅读空间。
 */
const INPUT_MAX_HEIGHT = 180

/**
 * 右键「智能解析选中文字」或快捷键触发在网页内弹出的悬浮面板。
 * - 选中文字时默认优先精准出现在选中文本正下方（空间不足翻转上方）；
 * - 未选中文字时直接定位在浏览器右上角，输入框自动聚焦方便直接粘贴；
 * - 点击 header 任意拖动整卡；图钉可钉住面板（点击页面外部不关闭，打开工具后也保持常驻）。
 */
export default function SelectionDetectPanel({
  text,
  x = PAD,
  y = PAD,
  targetRect,
  position = 'selection',
  onClose,
  onOpenToolbox,
  onOpenInTool,
  onPinnedChange,
}: SelectionDetectPanelProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [pinned, setPinned] = useState(false)
  const [shown, setShown] = useState(false)
  const positionedRef = useRef(false)
  // 是否被用户手动拖动过：拖动过之后 resize/scroll 只做「夹回视口」，
  // 不能按锚点重算，否则会覆盖用户刚摆放好的位置。
  const draggedRef = useRef(false)
  const pinnedRef = useRef(false)
  pinnedRef.current = pinned

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 维护可编辑的文本状态（初始为选中文本）
  const [input, setInput] = useState(text)

  // 当外部发起新一次智能解析时同步重置输入框
  // 注意：切勿在此重置 positionedRef，否则首挂载时 useEffect 会在 useLayoutEffect 之后执行
  // 并误清空已定位标记，导致钉住后第二次解析仍被错误触发重定位。
  useEffect(() => {
    setInput(text)
    setActiveMatchIndex(0)
  }, [text, x, y, targetRect])

  // 动态响应式识别：结合并发 deferredValue，在连续打字时优先保证输入 0 延迟
  const deferredInput = useDeferredValue(input)
  const result = useMemo<DetectResult | null>(() => detect(deferredInput), [deferredInput])

  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const [scrollTrigger, setScrollTrigger] = useState(0)

  const handleSelectMatch = useCallback((idx: number) => {
    setActiveMatchIndex(idx)
    setScrollTrigger((n) => n + 1)
  }, [])

  // 当 items 存在且数量 > 1 时，按当前索引切换解析结果与高亮焦点
  const items = result?.items
  const totalMatches = items?.length ?? 1
  const safeActiveIndex = activeMatchIndex >= totalMatches ? 0 : activeMatchIndex

  const currentResult = useMemo<DetectResult | null>(() => {
    if (!result) return null
    if (!items || items.length <= 1) return result
    const item = items[safeActiveIndex]
    return {
      kind: item.kind,
      fields: item.fields,
      blocks: item.blocks,
      copy: item.copy,
      download: item.download,
      sourceMatches: items.flatMap((it, idx) =>
        (it.sourceMatches ?? (it.sourceMatch ? [it.sourceMatch] : [])).map((m) => ({
          ...m,
          active: idx === safeActiveIndex,
        })),
      ),
      items,
    }
  }, [result, items, safeActiveIndex])

  const clampPos = useCallback((left: number, top: number) => {
    const el = ref.current
    const w = el?.offsetWidth ?? 480
    const h = el?.offsetHeight ?? 300
    return {
      left: Math.min(Math.max(left, PAD), Math.max(PAD, window.innerWidth - w - PAD)),
      top: Math.min(Math.max(top, PAD), Math.max(PAD, window.innerHeight - h - PAD)),
    }
  }, [])

  // 依据当前锚点（选区矩形，降级到右键坐标）算出完整位置。
  // 挂载 / 选区变化 / 未拖动时的 resize·scroll 重定位共用这一套逻辑，避免两处算法漂移。
  const anchorPos = useCallback(() => {
    const el = ref.current
    const r = el?.getBoundingClientRect()
    const w = r?.width || 480
    const h = r?.height || 300
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (position === 'top-right') {
      // 未选中文字时：直接出现在浏览器右上角（距右侧与顶部各 24px）
      const rightPad = 24
      const topPad = 24
      return {
        left: Math.max(PAD, vw - w - rightPad),
        top: Math.min(topPad, vh - h - PAD),
      }
    }

    // 锚点基准坐标：优先取选区包围矩形，降级取点击坐标点
    const anchorTop = targetRect ? targetRect.top : y
    const anchorBottom = targetRect ? targetRect.bottom : y
    const anchorCenterX = targetRect
      ? targetRect.left + (targetRect.width || targetRect.right - targetRect.left) / 2
      : x

    // 垂直方向逻辑：优先位于下方；下方不足且上方足够时翻转至上方
    const topBelow = anchorBottom + GAP
    const spaceBelow = vh - topBelow - PAD
    const topAbove = anchorTop - h - GAP
    const spaceAbove = anchorTop - GAP - PAD

    let top: number
    if (spaceBelow >= h) {
      // 下方高度充足
      top = topBelow
    } else if (spaceAbove >= h) {
      // 下方空间不足，但上方高度充足
      top = topAbove
    } else {
      // 上下高度均受限：选择空间更大的一侧，并回夹在视口安全范围内
      top =
        spaceBelow >= spaceAbove
          ? Math.max(PAD, Math.min(topBelow, vh - h - PAD))
          : Math.max(PAD, Math.min(topAbove, vh - h - PAD))
    }

    // 水平方向逻辑：以选中文本的水平中心（如 "123" 的 "2" 处）为基准居中显示，并夹在视口安全范围内
    const idealLeft = anchorCenterX - w / 2
    const left = Math.max(PAD, Math.min(idealLeft, vw - w - PAD))

    return { left, top }
  }, [position, targetRect, x, y])

  // 挂载与选区变化时定位：
  // 核心预期：在高度足够的情况下，精准出现在选中文本正下方（GAP = 8px）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (positionedRef.current && pinnedRef.current) return

    setPos(anchorPos())
    // 落回锚点意味着进入一次新的定位上下文，此前的拖动不再阻止后续 resize/scroll 跟随锚点
    draggedRef.current = false
    positionedRef.current = true
    setShown(true)
  }, [anchorPos])

  // 窗口 resize / 页面滚动后浮层可能被挤出视口：用 requestAnimationFrame 节流地重定位。
  // - 用户没拖动过：按当前锚点重算完整位置（复用上面的 anchorPos）；
  // - 用户拖动过：位置完全归用户所有 —— 不按锚点重算，也不夹回视口（允许被刻意摆到屏幕外）。
  useEffect(() => {
    let frame = 0
    const reposition = () => {
      frame = 0
      if (draggedRef.current) return
      setPos(anchorPos())
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(reposition)
    }
    const onScroll = (e: Event) => {
      // 忽略面板内部（输入框 / 结果区）自身的滚动，避免用户滚动内容时整卡跳动
      const target = e.target
      if (ref.current && target instanceof Node && ref.current.contains(target)) return
      schedule()
    }
    window.addEventListener('resize', schedule)
    // scroll 事件不冒泡，必须用捕获阶段才能覆盖嵌套滚动容器
    window.addEventListener('scroll', onScroll, true)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchorPos])

  // 拖动过程中输入变化会让卡片长高（如选中 JWT 后结果区展开）：
  // 被用户手动摆放过的卡片不会按锚点重算，但高度变化后必须只夹回**垂直**方向，
  // 否则底部结果会随高度增长溢出到视口之外（只能用 offsetHeight 测真实高度）；
  // 水平位置不参与夹取，尊重用户「把卡片摆到屏幕外」的意图。
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let lastHeight = el.offsetHeight
    const ro = new ResizeObserver(() => {
      const height = el.offsetHeight
      if (height === lastHeight) return
      lastHeight = height
      if (!draggedRef.current) return
      setPos((p) => ({ left: p.left, top: clampPos(p.left, p.top).top }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [clampPos])

  // 拖动：按住 header（非按钮部分）移动整卡
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 只响应左键：与 FloatingBall / Drawer 的拖拽守卫保持一致，避免右键菜单拖拽时整卡乱跑
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button')) return
      dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [pos.left, pos.top],
  )
  const moveDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    // 一旦真正移动过，后续 resize/scroll 就不能再按锚点覆盖这个位置
    draggedRef.current = true
    // 拖动不做任何视口夹取：用户可以把卡片摆到屏幕任意位置（含屏幕外）
    setPos({ left: e.clientX - d.dx, top: e.clientY - d.dy })
  }, [])
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

  // 把图钉状态镜像给宿主：钉住的面板在「在工具中打开」后要保持常驻，不随唤起一起收起
  useEffect(() => {
    onPinnedChange?.(pinned)
  }, [onPinnedChange, pinned])

  // Escape 始终关闭面板（快捷键唤起/收回由扩展 commands.onCommand 驱动，不在此硬编码 DOM 劫持）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 当以空文本打开时（如右上角快捷弹出），自动聚焦输入编辑框方便直接粘贴
  useEffect(() => {
    if (!text && inputRef.current) {
      inputRef.current.focus()
    }
  }, [text])

  const handleOpenToolbox = useCallback(() => {
    onOpenToolbox?.(input)
  }, [input, onOpenToolbox])

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
        {onOpenToolbox && (
          <Tooltip content={t('tool.detect.openToolbox')} side='bottom'>
            <button
              type='button'
              className='pd-icon-btn'
              aria-label={t('tool.detect.openToolbox')}
              onClick={handleOpenToolbox}
            >
              <Icon name='panel-right' size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip content={pinned ? t('tool.detect.unpin') : t('tool.detect.pin')} side='bottom'>
          <button
            type='button'
            className={`pd-icon-btn tek-detect-panel__pin${pinned ? ' tek-detect-panel__pin--on' : ''}`}
            aria-label={pinned ? t('tool.detect.unpin') : t('tool.detect.pin')}
            aria-pressed={pinned}
            onClick={() => setPinned((p) => !p)}
          >
            <Icon name='pin' size={14} />
          </button>
        </Tooltip>
        <Tooltip content={t('common.cancel')} side='bottom'>
          <button
            type='button'
            className='pd-icon-btn'
            aria-label={t('common.cancel')}
            onClick={onClose}
          >
            <Icon name='close' size={14} />
          </button>
        </Tooltip>
      </div>
      <div className='tek-detect-panel__body'>
        <div className='tek-detect__editor'>
          <div className='tek-detect__editor-head'>
            <span className='tw-field__label'>{t('tool.detect.sourceLabel')}</span>
            <div className='tek-detect__editor-actions'>
              <CopyButton text={input} label={t('common.copy')} className='tw-link' />
              <button
                type='button'
                className='tw-link'
                disabled={!input}
                onClick={() => {
                  setInput('')
                  setActiveMatchIndex(0)
                  inputRef.current?.focus()
                }}
              >
                {t('common.clear')}
              </button>
            </div>
          </div>
          <HighlightArea
            areaRef={inputRef}
            value={input}
            matches={currentResult?.sourceMatches}
            scrollTrigger={scrollTrigger}
            onChange={(e) => {
              setInput(e.target.value)
              setActiveMatchIndex(0)
            }}
            placeholder={t('tool.detect.inputPlaceholder')}
            maxHeight={INPUT_MAX_HEIGHT}
            spellCheck={false}
            autoFocus={!currentResult}
          />
        </div>

        {currentResult ? (
          <div className='tek-detect__result'>
            <DetectResultView
              result={currentResult}
              blockMaxHeight={260}
              items={items}
              activeMatchIndex={safeActiveIndex}
              onSelectMatch={handleSelectMatch}
              onOpenInTool={onOpenInTool}
            />
          </div>
        ) : input.trim() ? (
          <StatusText kind='info'>{t('tool.detect.none')}</StatusText>
        ) : null}
      </div>
    </div>
  )
}
