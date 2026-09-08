import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import AutoArea from './AutoArea'
import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'
import CopyButton from './CopyButton'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import ToolTabs from './ToolTabs'

type Mode = 'encode' | 'decode'

interface Base64Draft {
  mode: Mode
  input: string
  output: string
}

/** Base64 编解码工具卡片 */
export default function Base64Tool() {
  const { t } = useTranslation()
  const [draft, setDraft, clearDraft] = useToolDraft<Base64Draft>('base64', {
    mode: 'decode',
    input: '',
    output: '',
  })
  const { mode, input, output } = draft
  const [status, setStatus] = useState<ToolStatus | null>(null)

  function switchMode(next: Mode) {
    setDraft({ mode: next, input: '', output: '' })
    setStatus(null)
  }

  function setInput(val: string) {
    setDraft((prev) => ({ ...prev, input: val }))
  }

  function run() {
    const text = input.trim()
    if (!text) {
      setStatus({ kind: 'info', text: t('tool.base64.statusEmpty') })
      setDraft((prev) => ({ ...prev, output: '' }))
      return
    }
    try {
      if (mode === 'encode') {
        const result = encodeBase64(text)
        setDraft((prev) => ({ ...prev, output: result }))
        setStatus({ kind: 'ok', text: t('tool.base64.statusEncoded', { count: result.length }) })
      } else {
        if (!isLikelyBase64(text)) {
          setStatus({ kind: 'err', text: t('tool.base64.statusNotBase64') })
          setDraft((prev) => ({ ...prev, output: '' }))
          return
        }
        const { text: decoded, isText } = decodeBase64(text)
        setDraft((prev) => ({ ...prev, output: decoded }))
        setStatus({
          kind: 'ok',
          text: isText ? t('tool.base64.statusDecodedText') : t('tool.base64.statusDecodedBytes'),
        })
      }
    } catch (e) {
      setDraft((prev) => ({ ...prev, output: '' }))
      setStatus({
        kind: 'err',
        text: e instanceof Error ? e.message : t('tool.base64.statusFailed'),
      })
    }
  }

  function clear() {
    clearDraft()
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
