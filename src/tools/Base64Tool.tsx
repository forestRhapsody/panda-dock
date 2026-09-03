import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'
import CopyButton from './CopyButton'

type Mode = 'encode' | 'decode'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

/** Base64 编解码工具卡片 */
export default function Base64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('decode')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setInput('')
    setOutput('')
    setStatus(null)
  }

  function run() {
    const text = input.trim()
    if (!text) {
      setStatus({ kind: 'info', text: t('tool.base64.statusEmpty') })
      setOutput('')
      return
    }
    try {
      if (mode === 'encode') {
        const result = encodeBase64(text)
        setOutput(result)
        setStatus({ kind: 'ok', text: t('tool.base64.statusEncoded', { count: result.length }) })
      } else {
        if (!isLikelyBase64(text)) {
          setStatus({ kind: 'err', text: t('tool.base64.statusNotBase64') })
          setOutput('')
          return
        }
        const { text: decoded, isText } = decodeBase64(text)
        setOutput(decoded)
        setStatus({
          kind: 'ok',
          text: isText ? t('tool.base64.statusDecodedText') : t('tool.base64.statusDecodedBytes'),
        })
      }
    } catch (e) {
      setOutput('')
      setStatus({
        kind: 'err',
        text: e instanceof Error ? e.message : t('tool.base64.statusFailed'),
      })
    }
  }

  function clear() {
    setInput('')
    setOutput('')
    setStatus(null)
  }

  return (
    <div className='tw-card'>
      <div className='tw-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'decode'}
          className={`tw-tabs__btn${mode === 'decode' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('decode')}
        >
          {t('tool.base64.decode')}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'encode'}
          className={`tw-tabs__btn${mode === 'encode' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('encode')}
        >
          {t('tool.base64.encode')}
        </button>
      </div>

      <label className='tw-field'>
        <span className='tw-field__label'>
          {mode === 'encode'
            ? t('tool.base64.labelInputEncode')
            : t('tool.base64.labelInputDecode')}
        </span>
        <textarea
          className='tw-area'
          value={input}
          placeholder={
            mode === 'encode'
              ? t('tool.base64.inputPlaceholderEncode')
              : t('tool.base64.inputPlaceholderDecode')
          }
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={run}>
          {mode === 'encode' ? t('tool.base64.runEncode') : t('tool.base64.runDecode')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('tool.base64.clear')}
        </button>
      </div>

      <div className='tw-field'>
        <span className='tw-field__label'>
          {t('tool.base64.result')}
          <CopyButton
            text={output}
            disabled={!output}
            className='tw-link'
            onResult={(ok) => {
              if (!ok) setStatus({ kind: 'err', text: t('tool.base64.copyFailed') })
            }}
          />
        </span>
        <AutoArea
          className='tw-area tw-area--result'
          value={output}
          readOnly
          placeholder={t('tool.base64.resultPlaceholder')}
        />
      </div>

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}
      <p className='tw-note'>{t('tool.base64.note')}</p>
    </div>
  )
}
