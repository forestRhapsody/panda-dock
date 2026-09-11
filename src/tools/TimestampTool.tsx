import { useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import { parseStamp } from './timestamp'
import type { StampResult, StampSource } from './timestamp'

const SOURCE_KEY: Record<StampSource, string> = {
  secs: 'tool.timestamp.sourceSeconds',
  ms: 'tool.timestamp.sourceMilliseconds',
  text: 'tool.timestamp.sourceText',
}

/** 时间戳转换工具：输入秒/毫秒/日期文本，按钮触发转换多格式输出 */
export default function TimestampTool() {
  const { t } = useTranslation()
  const [input, setInput, clearInput] = useToolDraft<string>('timestamp.input', '')
  const [result, setResult] = useState<StampResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emptyErr, setEmptyErr] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function run(text = input) {
    const raw = text.trim()
    if (!raw) {
      setResult(null)
      setError(null)
      setEmptyErr(true)
      inputRef.current?.focus()
      return
    }
    const res = parseStamp(raw)
    if (!res.ok) {
      setResult(null)
      setError(t('tool.timestamp.errorInvalid'))
      return
    }
    setResult(res)
    setError(null)
  }

  function fillNow() {
    setEmptyErr(false)
    const nowStr = String(Date.now())
    setInput(nowStr)
    run(nowStr)
  }

  function clear() {
    clearInput()
    setResult(null)
    setError(null)
    setEmptyErr(false)
  }

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.timestamp.labelInput')}</span>
        <textarea
          ref={inputRef}
          className={`tw-area${emptyErr ? ' tw-area--empty-err' : ''}`}
          value={input}
          rows={2}
          placeholder={t('tool.timestamp.placeholder')}
          onChange={(e) => {
            setInput(e.target.value)
            if (emptyErr) setEmptyErr(false)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              run()
            }
          }}
          spellCheck={false}
        />
        <span className='tw-field__hint'>{t('tool.timestamp.hint')}</span>
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => run()}>
          {t('tool.timestamp.convert')}
        </button>
        <button type='button' className='tk-btn' onClick={fillNow}>
          {t('tool.timestamp.now')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('common.clear')}
        </button>
      </div>

      {error && <StatusText kind='err'>{error}</StatusText>}

      {result && result.ok && (
        <>
          <StatusText kind='ok'>{t(SOURCE_KEY[result.source])}</StatusText>
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
        </>
      )}
    </div>
  )
}
