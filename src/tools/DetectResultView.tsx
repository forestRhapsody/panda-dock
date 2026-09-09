import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import type { DetectBlock, DetectField, DetectItem, DetectResult } from './detect'
import DownloadButton from './DownloadButton'
import JsonTextarea from './JsonTextarea'
import { StatusText } from './StatusText'

const KIND_LABEL: Record<DetectResult['kind'], string> = {
  json: 'JSON',
  jwt: 'JWT',
  url: 'URL',
  timestamp: 'Timestamp',
  uuid: 'UUID',
  base64: 'Base64',
  hex: 'Hex',
  dataurl: 'Data URL',
  urls: 'URLs',
}

/** 字段的语义 key → i18n label；claim.* 直接用声明名（如 exp / iat） */
function fieldLabelKey(key: string): string {
  if (key.startsWith('claim.')) return key.slice('claim.'.length)
  if (['protocol', 'host', 'path', 'search', 'hash', 'username', 'password'].includes(key)) {
    return `tool.url.component.${key}`
  }
  return `tool.detect.row.${key}`
}

function FieldRow({ field }: { field: DetectField }) {
  const { t } = useTranslation()
  const [val, setVal] = useState(field.value)

  useEffect(() => {
    setVal(field.value)
  }, [field.value])

  const urlIdx = field.key.match(/^url\.(\d+)$/)
  const isClaim = field.key.startsWith('claim.')
  const label = urlIdx
    ? `${t('tool.detect.row.url')} ${urlIdx[1]}`
    : isClaim
      ? field.key.slice('claim.'.length)
      : t(fieldLabelKey(field.key))
  return (
    <div className='tw-detect__field'>
      <span className='tw-detect__field-label'>{label}</span>
      <input
        className={`tw-detect__field-input${field.mono ? ' tw-detect__field-input--mono' : ''}`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        spellCheck={false}
      />
      <CopyButton text={val} icon className='tw-detect__copy' />
    </div>
  )
}

function BlockRow({ block, blockMaxHeight }: { block: DetectBlock; blockMaxHeight?: number }) {
  const { t } = useTranslation()
  const [val, setVal] = useState(block.value)

  useEffect(() => {
    setVal(block.value)
  }, [block.value])

  return (
    <div className='tw-detect__block'>
      <span className='tw-field__label'>
        {t(`tool.detect.row.${block.key}`)}
        <CopyButton text={val} className='tw-link' />
      </span>
      {block.image ? (
        <img src={block.value} alt={t('tool.detect.previewAlt')} className='tw-detect__image' />
      ) : block.json ? (
        <JsonTextarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          maxHeight={blockMaxHeight}
        />
      ) : (
        <AutoArea
          className='tw-area'
          value={val}
          onChange={(e) => setVal(e.target.value)}
          maxHeight={blockMaxHeight}
          placeholder={t('tool.detect.resultPlaceholder')}
          spellCheck={false}
        />
      )}
    </div>
  )
}

export interface DetectResultViewProps {
  result: DetectResult
  /** 内容块最大高度（超出则在块内滚动）。悬浮面板可传更小值以适配面板高度 */
  blockMaxHeight?: number
  /** 当前所有匹配项列表（若 > 1 则展示结果 Tab 选项卡） */
  items?: DetectItem[]
  /** 当前激活项的索引（0-based） */
  activeMatchIndex?: number
  /** 点击选中某个结果项的回调 */
  onSelectMatch?: (index: number) => void
}

/** 智能解析结果视图：识别徽标 + Tab 选项卡 + 短字段/长文本块。供 Detect 工具与选中文字悬浮面板共用。 */
export default function DetectResultView({
  result,
  blockMaxHeight = 360,
  items,
  activeMatchIndex = 0,
  onSelectMatch,
}: DetectResultViewProps) {
  const { t } = useTranslation()
  const hasMultiple = Boolean(items && items.length > 1 && onSelectMatch)
  const tabsRef = useRef<HTMLDivElement>(null)

  /** 把激活的选项卡平滑滚动到容器水平居中（与能力 Tab 居中行为完全对齐） */
  const revealActiveTab = useCallback((index: number, smooth = true) => {
    const tabsEl = tabsRef.current
    if (!tabsEl) return
    const btn = tabsEl.querySelector<HTMLButtonElement>(`.tw-detect__tab[data-index="${index}"]`)
    if (!btn) return
    const tabsRect = tabsEl.getBoundingClientRect()
    const btnRect = btn.getBoundingClientRect()
    // 滚动量 = 按钮中心 与 容器中心 的水平偏移；浏览器会自动夹取在 [0, maxScroll]
    const delta = btnRect.left + btnRect.width / 2 - (tabsRect.left + tabsRect.width / 2)
    if (Math.abs(delta) > 0.5) {
      tabsEl.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' })
    }
  }, [])

  // 激活项变化时自动滚动到水平居中位置
  useEffect(() => {
    if (hasMultiple) {
      revealActiveTab(activeMatchIndex)
    }
  }, [activeMatchIndex, hasMultiple, revealActiveTab])

  // 容器尺寸或窗口变化后仍保证激活项居中
  useEffect(() => {
    if (!hasMultiple) return
    const onResize = () => {
      revealActiveTab(activeMatchIndex, false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeMatchIndex, hasMultiple, revealActiveTab])

  // 鼠标滚轮在 Tab 栏上滚动时支持顺畅横向滑动
  useEffect(() => {
    const tabsEl = tabsRef.current
    if (!tabsEl || !hasMultiple) return

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && e.deltaY !== 0) {
        e.preventDefault()
        tabsEl.scrollLeft += e.deltaY
      }
    }

    tabsEl.addEventListener('wheel', onWheel, { passive: false })
    return () => tabsEl.removeEventListener('wheel', onWheel)
  }, [hasMultiple])

  return (
    <div className='tw-detect'>
      <div className='tw-detect__head'>
        <StatusText kind='ok'>
          {t('tool.detect.detected')}：{KIND_LABEL[result.kind]}
        </StatusText>

        {hasMultiple && (
          <span className='tw-detect__total-badge'>
            {t('tool.detect.totalMatches', { count: items!.length })}
          </span>
        )}
      </div>

      {hasMultiple && (
        <div ref={tabsRef} className='tw-detect__tabs' role='tablist'>
          {items!.map((it, idx) => {
            const isActive = idx === activeMatchIndex
            const label = `${idx + 1} · ${KIND_LABEL[it.kind]}`
            return (
              <button
                key={idx}
                type='button'
                role='tab'
                data-index={idx}
                aria-selected={isActive}
                aria-label={label}
                className={`tw-detect__tab${isActive ? ' tw-detect__tab--active' : ''}`}
                onClick={() => {
                  onSelectMatch!(idx)
                  revealActiveTab(idx)
                }}
              >
                <span className='tw-detect__tab-num'>{idx + 1}</span>
                <span className='tw-detect__tab-sep'>·</span>
                <span className='tw-detect__tab-kind'>{KIND_LABEL[it.kind]}</span>
              </button>
            )
          })}
        </div>
      )}

      {result.fields.length > 0 && (
        <div className='tw-detect__fields'>
          {result.fields.map((field) => (
            <FieldRow key={field.key} field={field} />
          ))}
        </div>
      )}

      {result.blocks.map((block) => (
        <BlockRow key={block.key} block={block} blockMaxHeight={blockMaxHeight} />
      ))}

      {result.download && (
        <div className='tw-actions'>
          <DownloadButton
            mime={result.download.mime}
            dataUrl={result.download.dataUrl}
            label={t('tool.detect.download')}
          />
        </div>
      )}
    </div>
  )
}
