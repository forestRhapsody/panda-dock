import { useState } from 'react'

import { copyText } from '@/utils/clipboard'

import { formatJson, minifyJson } from './json'

type Mode = 'format' | 'minify'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

/** JSON 格式化工具：格式化 / 压缩 / 复制 */
export default function JsonTool() {
  const [mode, setMode] = useState<Mode>('format')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setOutput('')
    setStatus(null)
  }

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

  async function copy() {
    if (!output) return
    const ok = await copyText(output)
    setStatus({ kind: ok ? 'ok' : 'err', text: ok ? '已复制到剪贴板' : '复制失败' })
  }

  return (
    <div className='tw-card'>
      <div className='tw-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'format'}
          className={`tw-tabs__btn${mode === 'format' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('format')}
        >
          格式化
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'minify'}
          className={`tw-tabs__btn${mode === 'minify' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => switchMode('minify')}
        >
          压缩
        </button>
      </div>

      <label className='tw-field'>
        <span className='tw-field__label'>JSON 输入</span>
        <textarea
          className='tw-area'
          value={input}
          placeholder='粘贴 JSON，例如 {"name":"toolkit","version":"0.2.0"}…'
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

      <label className='tw-field'>
        <span className='tw-field__label'>
          结果
          <button type='button' className='tw-link' onClick={() => void copy()} disabled={!output}>
            复制
          </button>
        </span>
        <textarea
          className='tw-area tw-area--result'
          value={output}
          readOnly
          placeholder='格式化后的 JSON 会显示在这里…'
        />
      </label>

      {status && (
        <p className={`tw-status tw-status--${status.kind}`}>
          {status.kind === 'ok' ? '✓ ' : status.kind === 'err' ? '✕ ' : 'ℹ '}
          {status.text}
        </p>
      )}
    </div>
  )
}
