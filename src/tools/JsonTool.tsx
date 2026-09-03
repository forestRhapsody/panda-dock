import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { formatJson, minifyJson } from './json'
import JsonHighlight from './JsonHighlight'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

type Mode = 'format' | 'minify'

/** 单个 JSON 处理面板：独立维护输入/结果/状态 */
function JsonPanel({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  function run() {
    const raw = input.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const result = mode === 'format' ? formatJson(raw) : minifyJson(raw)
    if (result.ok) {
      setOutput(result.text ?? '')
      setStatus({
        kind: 'ok',
        text: mode === 'format' ? t('tool.json.formatOk') : t('tool.json.minifyOk'),
      })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: result.error ?? t('tool.json.failed') })
    }
  }

  function clear() {
    setInput('')
    setOutput('')
    setStatus(null)
  }

  return (
    <div className='tw-json-sec'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.json.inputLabel')}</span>
        <textarea
          className='tw-area tw-area--tall'
          value={input}
          placeholder={t('tool.json.inputPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={run}>
          {mode === 'format' ? t('tool.json.formatBtn') : t('tool.json.minifyBtn')}
        </button>
        <button type='button' className='tk-btn' onClick={clear}>
          {t('tool.json.clear')}
        </button>
      </div>

      <div className='tw-field'>
        <span className='tw-field__label'>
          {t('tool.json.result')}
          <CopyButton
            text={output}
            disabled={!output}
            className='tw-link'
            onResult={(ok) => {
              if (!ok) setStatus({ kind: 'err', text: t('tool.json.copyFailed') })
            }}
          />
        </span>
        {mode === 'format' ? (
          <JsonHighlight text={output} />
        ) : (
          <AutoArea
            className='tw-area tw-area--result'
            value={output}
            readOnly
            placeholder={t('tool.json.resultPlaceholder')}
          />
        )}
      </div>

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}
    </div>
  )
}

/** JSON 工具：格式化 / 压缩 tab 切换，各自独立输入与结果（切 tab 时各自保留） */
export default function JsonTool() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Mode>('format')

  return (
    <div className='tw-card'>
      <div className='tw-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'format'}
          className={`tw-tabs__btn${tab === 'format' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => setTab('format')}
        >
          {t('tool.json.format')}
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'minify'}
          className={`tw-tabs__btn${tab === 'minify' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => setTab('minify')}
        >
          {t('tool.json.minify')}
        </button>
      </div>

      {/* 两个面板都挂载，仅按 tab 显隐，以保留各自独立的输入/结果状态 */}
      <div hidden={tab !== 'format'}>
        <JsonPanel mode='format' />
      </div>
      <div hidden={tab !== 'minify'}>
        <JsonPanel mode='minify' />
      </div>

      <p className='tw-note'>{t('tool.json.note')}</p>
    </div>
  )
}
