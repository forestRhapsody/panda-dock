import { useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { detect } from './detect'
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

/** 智能识别：粘贴一段内容，自动判定类型并就地给出可操作的解码/解析结果（不跳转、纯本地） */
export default function DetectTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const result = useMemo(() => detect(input), [input])

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.detect.inputLabel')}</span>
        <AutoArea
          className='tw-area'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('tool.detect.inputPlaceholder')}
          spellCheck={false}
        />
      </label>

      {result && (
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
                <JsonHighlight text={block.value} />
              ) : (
                <AutoArea
                  className='tw-area tw-area--result'
                  value={block.value}
                  readOnly
                  placeholder={t('tool.detect.resultPlaceholder')}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {!result && input.trim() && <StatusText kind='info'>{t('tool.detect.none')}</StatusText>}

      <p className='tw-note'>{t('tool.detect.note')}</p>
    </div>
  )
}
