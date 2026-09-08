import { useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import type { DetectBlock, DetectField, DetectResult } from './detect'
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

/** 智能识别结果视图：识别徽标 + 短字段/长文本块（均支持自由编辑与复制）。供 Detect 工具与选中文字悬浮面板共用。 */
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
      </div>

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
