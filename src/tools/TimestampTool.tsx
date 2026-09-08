import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import { parseStamp } from './timestamp'

const SOURCE_KEY: Record<string, string> = {
  secs: 'tool.timestamp.sourceSeconds',
  ms: 'tool.timestamp.sourceMilliseconds',
  text: 'tool.timestamp.sourceText',
}

/** 时间戳转换工具：输入秒/毫秒/日期文本，实时输出多格式 */
export default function TimestampTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const result = parseStamp(input)
  const status: ToolStatus | null = input.trim()
    ? result.ok
      ? { kind: 'ok', text: t(SOURCE_KEY[result.source]) }
      : { kind: 'err', text: t('tool.timestamp.errorInvalid') }
    : null

  function fillNow() {
    setInput(String(Date.now()))
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.timestamp.labelInput')}</span>
        <textarea
          className='tw-area'
          value={input}
          rows={2}
          placeholder={t('tool.timestamp.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={fillNow}>
          {t('tool.timestamp.now')}
        </button>
        <button type='button' className='tk-btn' onClick={() => setInput('')}>
          {t('tool.timestamp.clear')}
        </button>
      </div>

      {result.ok && (
        <div className='tw-detect__fields'>
          {result.rows.map((row) => (
            <div key={row.label} className='tw-detect__field'>
              <span className='tw-detect__field-label'>{row.label}</span>
              <code className='tw-detect__field-value tw-detect__field-value--mono'>
                {row.value}
              </code>
              <CopyButton text={row.value} icon className='tw-detect__copy' />
            </div>
          ))}
        </div>
      )}

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}
    </div>
  )
}
