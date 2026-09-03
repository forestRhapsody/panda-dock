import { useState } from 'react'

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
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  function run() {
    const raw = input.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: '请先粘贴 JSON 内容' })
      return
    }
    const result = mode === 'format' ? formatJson(raw) : minifyJson(raw)
    if (result.ok) {
      setOutput(result.text ?? '')
      setStatus({
        kind: 'ok',
        text: mode === 'format' ? '格式化成功（2 空格缩进）' : '压缩成功（单行）',
      })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: result.error ?? '处理失败' })
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
        <span className='tw-field__label'>JSON 输入</span>
        <textarea
          className='tw-area tw-area--tall'
          value={input}
          placeholder='粘贴 JSON，例如 {"name":"toolkit"}…'
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className='tw-actions'>
        <button type='button' className='tw-btn tw-btn--primary' onClick={run}>
          {mode === 'format' ? '格式化 →' : '压缩 →'}
        </button>
        <button type='button' className='tw-btn' onClick={clear}>
          清空
        </button>
      </div>

      <div className='tw-field'>
        <span className='tw-field__label'>
          结果
          <CopyButton
            text={output}
            disabled={!output}
            className='tw-link'
            onResult={(ok) => {
              if (!ok) setStatus({ kind: 'err', text: '复制失败' })
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
            placeholder='结果会显示在这里…'
          />
        )}
      </div>

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}
    </div>
  )
}

/** JSON 工具：格式化 / 压缩 tab 切换，各自独立输入与结果（切 tab 时各自保留） */
export default function JsonTool() {
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
          格式化
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'minify'}
          className={`tw-tabs__btn${tab === 'minify' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => setTab('minify')}
        >
          压缩
        </button>
      </div>

      {/* 两个面板都挂载，仅按 tab 显隐，以保留各自独立的输入/结果状态 */}
      <div hidden={tab !== 'format'}>
        <JsonPanel mode='format' />
      </div>
      <div hidden={tab !== 'minify'}>
        <JsonPanel mode='minify' />
      </div>

      <p className='tw-note'>
        支持带注释（JSONC）与尾随逗号；输出为去掉注释和多余逗号后的合法 JSON。
      </p>
    </div>
  )
}
