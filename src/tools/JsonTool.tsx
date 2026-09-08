import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import { formatJson, minifyJson } from './json'
import JsonHighlight from './JsonHighlight'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import ToolTabs from './ToolTabs'

type Mode = 'format' | 'minify'

interface JsonDraft {
  input: string
  output: string
}

/** 单个 JSON 处理面板：独立维护输入/结果/状态 */
function JsonPanel({ mode }: { mode: Mode }) {
  const { t } = useTranslation()
  const [draft, setDraft, clearDraft] = useToolDraft<JsonDraft>(`json.${mode}`, {
    input: '',
    output: '',
  })
  const { input, output } = draft
  const [status, setStatus] = useState<ToolStatus | null>(null)

  function run() {
    const raw = input.trim()
    if (!raw) {
      setDraft((prev) => ({ ...prev, output: '' }))
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const result = mode === 'format' ? formatJson(raw) : minifyJson(raw)
    if (result.ok) {
      setDraft((prev) => ({ ...prev, output: result.text ?? '' }))
      setStatus({
        kind: 'ok',
        text: mode === 'format' ? t('tool.json.formatOk') : t('tool.json.minifyOk'),
      })
    } else {
      setDraft((prev) => ({ ...prev, output: '' }))
      setStatus({ kind: 'err', text: result.error ?? t('tool.json.failed') })
    }
  }

  function clear() {
    clearDraft()
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
          onChange={(e) => setDraft((prev) => ({ ...prev, input: e.target.value }))}
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
        <JsonHighlight text={output} placeholder={t('tool.json.resultPlaceholder')} />
      </div>

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}
    </div>
  )
}

/** JSON 工具：格式化 / 压缩 tab 切换，各自独立输入与结果（切 tab 时各自保留） */
export default function JsonTool() {
  const { t } = useTranslation()
  const [tab, setTab] = useToolDraft<Mode>('json.tab', 'format')

  return (
    <div className='tw-card'>
      <ToolTabs<Mode>
        value={tab}
        onChange={setTab}
        items={[
          { id: 'format', label: t('tool.json.format') },
          { id: 'minify', label: t('tool.json.minify') },
        ]}
      />

      {/* 两个面板都挂载，仅按 tab 显隐，以保留各自独立的输入/结果状态 */}
      <div hidden={tab !== 'format'}>
        <JsonPanel mode='format' />
      </div>
      <div hidden={tab !== 'minify'}>
        <JsonPanel mode='minify' />
      </div>
    </div>
  )
}
