import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import type { DetectBlock, DetectField, DetectItem, DetectResult } from './detect'
import DownloadButton from './DownloadButton'
import { toolForDetectKind } from './handoff'
import JsonHighlight from './JsonHighlight'
import type { ToolId } from './registry'
import { StatusText } from './StatusText'

// 值类型含 undefined：kind 在类型层是联合类型，但运行时可能拿到旧草稿 / 跨端消息里的脏值，
// 取不到标签时必须走 tool.detect.unknown 兜底，而不是渲染成空白。
const KIND_LABEL: Record<string, string | undefined> = {
  json: 'JSON',
  jwt: 'JWT',
  url: 'URL',
  timestamp: 'Timestamp',
  uuid: 'UUID',
  base64: 'Base64',
  hex: 'Hex',
  dataurl: 'Data URL',
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
  const urlIdx = field.key.match(/^url\.(\d+)$/)
  const isClaim = field.key.startsWith('claim.')
  const claimKey = isClaim ? field.key.slice('claim.'.length) : ''
  const label = urlIdx
    ? `${t('tool.detect.row.url')} ${urlIdx[1]}`
    : isClaim
      ? t(`tool.jwt.claim.${claimKey}`, { defaultValue: claimKey })
      : t(fieldLabelKey(field.key))
  return (
    <div className='tw-detect__field'>
      <span className='tw-detect__field-label'>{label}</span>
      <code
        className={`tw-detect__field-value${field.mono ? ' tw-detect__field-value--mono' : ''}`}
      >
        {field.value}
      </code>
      <CopyButton text={field.value} icon className='tw-detect__copy' />
    </div>
  )
}

function BlockRow({
  block,
  blockMaxHeight,
  kind,
}: {
  block: DetectBlock
  blockMaxHeight?: number
  kind?: DetectResult['kind']
}) {
  const { t } = useTranslation()
  const [minified, setMinified] = useState(false)
  const canMinify = Boolean(block.minifiedValue)

  useEffect(() => {
    setMinified(false)
  }, [block.value])

  const currentValue =
    canMinify && minified
      ? (block.minifiedValue ?? block.value)
      : (block.formattedValue ?? block.value)
  const isMultiLine = currentValue.includes('\n')
  // 压缩为单行或 JWT 解码块时不显示行号；仅在未压缩的多行格式化视图下展示等宽行号栏
  const showLineNumbers = kind !== 'jwt' && !minified && isMultiLine

  return (
    <div className='tw-detect__block'>
      <span className='tw-field__label'>
        {t(`tool.detect.row.${block.key}`)}
        <CopyButton text={currentValue} className='tw-link' />
      </span>
      {block.image ? (
        <img src={currentValue} alt={t('tool.detect.previewAlt')} className='tw-detect__image' />
      ) : block.json || isMultiLine ? (
        <JsonHighlight
          text={currentValue}
          maxHeight={blockMaxHeight}
          showLineNumbers={showLineNumbers}
        />
      ) : (
        <AutoArea
          className='tw-area tw-area--result'
          value={currentValue}
          readOnly
          maxHeight={blockMaxHeight}
          placeholder={t('tool.detect.resultPlaceholder')}
          spellCheck={false}
        />
      )}
      {canMinify && (
        <div className='tw-detect__block-options'>
          <label className='tk-checkbox'>
            <input
              type='checkbox'
              checked={minified}
              onChange={(e) => setMinified(e.target.checked)}
            />
            <span>{t('tool.detect.minifyOption')}</span>
          </label>
        </div>
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
  /**
   * 「在 XX 工具中打开」：把当前激活匹配的原文本交给目标工具继续加工（T134）。
   * 宿主负责唤起方式：工具箱内直接切 Tab；网页内抽屉 / 侧边栏则先准备草稿再唤起。
   */
  onOpenInTool?: (tool: ToolId, text: string) => void
}

/** 智能解析结果视图：识别徽标 + Tab 选项卡 + 短字段/长文本块。供 Detect 工具与选中文字悬浮面板共用。 */
export default function DetectResultView({
  result,
  blockMaxHeight = 360,
  items,
  activeMatchIndex = 0,
  onSelectMatch,
  onOpenInTool,
}: DetectResultViewProps) {
  const { t } = useTranslation()
  const hasMultiple = Boolean(items && items.length > 1 && onSelectMatch)
  const tabsRef = useRef<HTMLDivElement>(null)
  // 「在 XX 工具中打开」：只对目标工具确有额外能力的类型显示入口（见 handoff.ts 的评估结论）
  const targetTool = toolForDetectKind(result.kind)
  // 交给目标工具的是**当前激活匹配的原文**；纯净输入没有匹配区间时退回复制内容
  const handoffText = result.sourceMatches?.find((m) => m.active)?.text ?? result.copy

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
          {t('tool.detect.detected', {
            kind: KIND_LABEL[result.kind] ?? t('tool.detect.unknown'),
          })}
        </StatusText>

        {hasMultiple && (
          <span className='tw-detect__total-badge'>
            {t('tool.detect.totalMatches', { count: items!.length })}
          </span>
        )}

        {targetTool && onOpenInTool && (
          <button
            type='button'
            className='tw-link tw-detect__head-action'
            onClick={() => onOpenInTool(targetTool, handoffText)}
          >
            {t('tool.detect.openInTool', { tool: t(`tool.registry.${targetTool}`) })}
            <Icon name='chevron-right' size={12} />
          </button>
        )}
      </div>

      {hasMultiple && (
        <div ref={tabsRef} className='tw-detect__tabs' role='tablist'>
          {items!.map((it, idx) => {
            const isActive = idx === activeMatchIndex
            // 脏 kind 的 Tab 也要有可读标签，否则只剩编号与分隔符
            const kindText = KIND_LABEL[it.kind] ?? t('tool.detect.unknown')
            const label = `${idx + 1} · ${kindText}`
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
                <span className='tw-detect__tab-kind'>{kindText}</span>
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
        <BlockRow
          key={block.key}
          block={block}
          blockMaxHeight={blockMaxHeight}
          kind={result.kind}
        />
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
