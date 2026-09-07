import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'
import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import ToolTabs from './ToolTabs'

type Mode = 'encode' | 'decode'

/** Base64 编解码工具卡片 */
export default function Base64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('decode')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<ToolStatus | null>(null)

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
      <ToolTabs<Mode>
        value={mode}
        onChange={switchMode}
        items={[
          { id: 'decode', label: t('tool.base64.decode') },
          { id: 'encode', label: t('tool.base64.encode') },
        ]}
      />

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

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}
    </div>
  )
}
