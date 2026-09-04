import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import type { DetectField, DetectResult } from './detect'
import JsonHighlight from './JsonHighlight'
import { StatusText } from './StatusText'

const KIND_LABEL: Record<DetectResult['kind'], string> = {
  json: 'JSON',
  jwt: 'JWT',
  url: 'URL',
  timestamp: 'Timestamp',
  uuid: 'UUID',
  base64: 'Base64',
  hex: 'Hex',
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
  const isClaim = field.key.startsWith('claim.')
  const label = isClaim ? field.key.slice('claim.'.length) : t(fieldLabelKey(field.key))
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

/** 智能识别结果视图：识别徽标 + 短字段/长文本块 + 逐项复制。供 Detect 工具与选中文字悬浮面板共用。
 *  `expandBlocks`：内容块长开不内部滚动（交给外层滚动容器），用于悬浮面板避免出现双层滚动条。 */
export default function DetectResultView({
  result,
  blockMaxHeight = 360,
}: {
  result: DetectResult
  /** 内容块最大高度（超出则在块内滚动）。悬浮面板可传更小值以适配面板高度 */
  blockMaxHeight?: number
}) {
  const { t } = useTranslation()
  return (
    <div className='tw-detect'>
      <div className='tw-detect__head'>
        <StatusText kind='ok'>
          {t('tool.detect.detected')}：{KIND_LABEL[result.kind]}
        </StatusText>
        <CopyButton text={result.copy} label={t('common.copy')} className='tw-link' />
      </div>

      {result.fields.length > 0 && (
        <div className='tw-detect__fields'>
          {result.fields.map((field) => (
            <FieldRow key={field.key} field={field} />
          ))}
        </div>
      )}

      {result.blocks.map((block) => (
        <div key={block.key} className='tw-detect__block'>
          <span className='tw-field__label'>
            {t(`tool.detect.row.${block.key}`)}
            <CopyButton text={block.value} icon className='tw-link' />
          </span>
          {block.json ? (
            <JsonHighlight text={block.value} maxHeight={blockMaxHeight} />
          ) : (
            <AutoArea
              className='tw-area tw-area--result'
              value={block.value}
              readOnly
              maxHeight={blockMaxHeight}
              placeholder={t('tool.detect.resultPlaceholder')}
            />
          )}
        </div>
      ))}
    </div>
  )
}
