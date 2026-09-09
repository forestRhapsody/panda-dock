import { useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import { useToolDraft } from '@/utils/draft'

import CopyButton from './CopyButton'
import { downloadText, fmtSize } from './file'
import {
  escapeJson,
  formatJson,
  minifyJson,
  SAMPLE_JSON,
  unescapeJson,
  type JsonIndent,
  type JsonProcessOptions,
} from './json'
import JsonHighlight from './JsonHighlight'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'

type JsonAction = 'format' | 'minify' | 'escape' | 'unescape'

interface JsonDraft {
  input: string
  output: string
  indent: JsonIndent
  sortKeys: boolean
  autoUnescape: boolean
  lastAction: JsonAction | null
  splitRatio?: number
}

const DEFAULT_DRAFT: JsonDraft = {
  input: '',
  output: '',
  indent: 2,
  sortKeys: false,
  autoUnescape: false,
  lastAction: null,
  splitRatio: 50,
}

/**
 * 全功能 JSON 工具工作台：
 * 采用类似 IDE 的上下可拖拽分屏布局，高度 100% 自适应撑满且无外层滚动条；
 * 输入区与结果区支持独立纵向滚动，汇聚格式化、单行压缩、字符串转义、去转义能力，
 * 并支持「键名排序」与「自动去转义」复选框自由组合与即时联动。
 */
export default function JsonTool() {
  const { t } = useTranslation()
  const [draft, setDraft] = useToolDraft<JsonDraft>('json.workbench', DEFAULT_DRAFT)
  const { input, output, indent, sortKeys, autoUnescape, lastAction } = draft
  const [status, setStatus] = useState<ToolStatus | null>(null)

  // 分屏高度比例（上方面板占比百分比，范围 15~85，默认 50）
  const [splitRatio, setSplitRatio] = useState<number>(draft.splitRatio ?? 50)
  const [isDragging, setIsDragging] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

  // 当外部 draft.splitRatio 改变（如切换标签还原）且不在拖拽中时同步
  useEffect(() => {
    if (!isDragging && draft.splitRatio !== undefined && draft.splitRatio !== splitRatio) {
      setSplitRatio(draft.splitRatio)
    }
  }, [draft.splitRatio, isDragging, splitRatio])

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const workspace = workspaceRef.current
    if (!workspace) return

    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 降级保护
    }
    setIsDragging(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return
    const workspace = workspaceRef.current
    if (!workspace) return

    const rect = workspace.getBoundingClientRect()
    if (rect.height <= 0) return

    const offsetY = e.clientY - rect.top
    let pct = (offsetY / rect.height) * 100
    pct = Math.max(15, Math.min(85, pct))
    setSplitRatio(Math.round(pct * 10) / 10)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return
    setIsDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 降级保护
    }
    setDraft((prev) => ({ ...prev, splitRatio }))
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (isDragging) {
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // 降级保护
      }
      setDraft((prev) => ({ ...prev, splitRatio }))
    }
  }

  function handleDoubleClick() {
    setSplitRatio(50)
    setDraft((prev) => ({ ...prev, splitRatio: 50 }))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.max(15, splitRatio - 5)
      setSplitRatio(next)
      setDraft((prev) => ({ ...prev, splitRatio: next }))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.min(85, splitRatio + 5)
      setSplitRatio(next)
      setDraft((prev) => ({ ...prev, splitRatio: next }))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSplitRatio(50)
      setDraft((prev) => ({ ...prev, splitRatio: 50 }))
    }
  }

  function setInput(val: string) {
    setDraft((prev) => ({ ...prev, input: val }))
  }

  function setOutput(val: string) {
    setDraft((prev) => ({ ...prev, output: val }))
  }

  function runFormat(text = input, opts?: Partial<JsonProcessOptions>) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const currentOpts: JsonProcessOptions = {
      indent: opts?.indent ?? indent,
      sortKeys: opts?.sortKeys ?? sortKeys,
      autoUnescape: opts?.autoUnescape ?? autoUnescape,
    }
    const res = formatJson(raw, currentOpts)
    if (res.ok) {
      setDraft((prev) => ({
        ...prev,
        output: res.text ?? '',
        lastAction: 'format',
        ...(opts?.indent !== undefined ? { indent: opts.indent as JsonIndent } : {}),
        ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
        ...(opts?.autoUnescape !== undefined ? { autoUnescape: opts.autoUnescape } : {}),
      }))
      setStatus({ kind: 'ok', text: t('tool.json.formatOk') })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: res.error ?? t('tool.json.failed') })
    }
  }

  function runMinify(text = input, opts?: Partial<JsonProcessOptions>) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const currentOpts: JsonProcessOptions = {
      sortKeys: opts?.sortKeys ?? sortKeys,
      autoUnescape: opts?.autoUnescape ?? autoUnescape,
    }
    const res = minifyJson(raw, currentOpts)
    if (res.ok) {
      setDraft((prev) => ({
        ...prev,
        output: res.text ?? '',
        lastAction: 'minify',
        ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
        ...(opts?.autoUnescape !== undefined ? { autoUnescape: opts.autoUnescape } : {}),
      }))
      setStatus({ kind: 'ok', text: t('tool.json.minifyOk') })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: res.error ?? t('tool.json.failed') })
    }
  }

  function runEscape(text = input, opts?: Partial<JsonProcessOptions>) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const currentOpts: JsonProcessOptions = {
      sortKeys: opts?.sortKeys ?? sortKeys,
    }
    const res = escapeJson(raw, currentOpts)
    if (res.ok) {
      setDraft((prev) => ({
        ...prev,
        output: res.text ?? '',
        lastAction: 'escape',
        ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
      }))
      setStatus({ kind: 'ok', text: t('tool.json.escapeOk') })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: res.error ?? t('tool.json.failed') })
    }
  }

  function runUnescape(text = input, opts?: Partial<JsonProcessOptions>) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus({ kind: 'info', text: t('tool.json.pasteFirst') })
      return
    }
    const currentOpts: JsonProcessOptions = {
      indent: opts?.indent ?? indent,
      sortKeys: opts?.sortKeys ?? sortKeys,
    }
    const res = unescapeJson(raw, currentOpts)
    if (res.ok) {
      setDraft((prev) => ({
        ...prev,
        output: res.text ?? '',
        lastAction: 'unescape',
        ...(opts?.indent !== undefined ? { indent: opts.indent as JsonIndent } : {}),
        ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
      }))
      setStatus({ kind: 'ok', text: t('tool.json.unescapeOk') })
    } else {
      setOutput('')
      setStatus({ kind: 'err', text: res.error ?? t('tool.json.failed') })
    }
  }

  /** 当复选框或缩进状态改变时，若当前有输出结果，无缝就地重新计算输出 */
  function reprocess(overrides: Partial<JsonProcessOptions> = {}) {
    const action = lastAction ?? 'format'
    if (action === 'format') runFormat(input, overrides)
    else if (action === 'minify') runMinify(input, overrides)
    else if (action === 'unescape') runUnescape(input, overrides)
    else if (action === 'escape') runEscape(input, overrides)
  }

  function onSortKeysChange(checked: boolean) {
    setDraft((prev) => ({ ...prev, sortKeys: checked }))
    if (output) {
      reprocess({ sortKeys: checked })
    }
  }

  function onAutoUnescapeChange(checked: boolean) {
    setDraft((prev) => ({ ...prev, autoUnescape: checked }))
    if (output && (lastAction === 'format' || lastAction === 'minify')) {
      reprocess({ autoUnescape: checked })
    }
  }

  function onIndentChange(nextIndent: JsonIndent) {
    setDraft((prev) => ({ ...prev, indent: nextIndent }))
    if (output && (lastAction === 'format' || lastAction === 'unescape')) {
      reprocess({ indent: nextIndent })
    }
  }

  function fillSample() {
    setInput(SAMPLE_JSON)
    runFormat(SAMPLE_JSON, { indent, sortKeys, autoUnescape })
  }

  function clear() {
    setDraft((prev) => ({
      ...prev,
      input: '',
      output: '',
      lastAction: null,
    }))
    setStatus(null)
  }

  const outputByteSize = output ? new Blob([output]).size : 0
  const outputLineCount = output ? output.split('\n').length : 0

  return (
    <div className={`tw-json-split${isDragging ? ' tw-json-split--dragging' : ''}`}>
      <div className='tw-json__toolbar'>
        <div className='tw-json__actions'>
          <button type='button' className='tk-btn tk-btn--primary' onClick={() => runFormat()}>
            {t('tool.json.formatBtn')}
          </button>
          <button type='button' className='tk-btn' onClick={() => runMinify()}>
            {t('tool.json.minifyBtn')}
          </button>
          <button type='button' className='tk-btn' onClick={() => runEscape()}>
            {t('tool.json.escapeBtn')}
          </button>
          <button type='button' className='tk-btn' onClick={() => runUnescape()}>
            {t('tool.json.unescapeBtn')}
          </button>
          <button type='button' className='tk-btn' onClick={clear}>
            {t('tool.json.clear')}
          </button>
        </div>

        <div className='tw-json__options'>
          <label className='tk-checkbox' title={t('tool.json.sortKeysDesc')}>
            <input
              type='checkbox'
              checked={sortKeys}
              onChange={(e) => onSortKeysChange(e.target.checked)}
            />
            <span>{t('tool.json.sortKeysOption')}</span>
          </label>

          <label className='tk-checkbox' title={t('tool.json.autoUnescapeDesc')}>
            <input
              type='checkbox'
              checked={autoUnescape}
              onChange={(e) => onAutoUnescapeChange(e.target.checked)}
            />
            <span>{t('tool.json.autoUnescapeOption')}</span>
          </label>

          <div className='tw-json__indent'>
            <TkSelect
              variant='sm'
              value={indent}
              onChange={(e) => onIndentChange(e.target.value as unknown as JsonIndent)}
              title={t('tool.json.indent')}
            >
              <option value={2}>{t('tool.json.indent2')}</option>
              <option value={4}>{t('tool.json.indent4')}</option>
              <option value='tab'>{t('tool.json.indentTab')}</option>
            </TkSelect>
          </div>
        </div>
      </div>

      <div ref={workspaceRef} className='tw-json__workspace'>
        {/* 上方面板：输入区 */}
        <section
          className='tw-json__pane tw-json__pane--top'
          style={{ flex: `${splitRatio} 1 0%` }}
        >
          <div className='tw-field__label'>
            <span>{t('tool.json.inputLabel')}</span>
            <button type='button' className='tw-link' onClick={fillSample}>
              {t('tool.json.fillSample')}
            </button>
          </div>
          <textarea
            className='tw-area tw-json__editor'
            value={input}
            placeholder={t('tool.json.inputPlaceholder')}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
        </section>

        {/* 可拖拽分屏控制条 (Splitter) */}
        <div
          role='separator'
          aria-orientation='horizontal'
          aria-label={t('tool.json.splitterLabel')}
          aria-valuenow={Math.round(splitRatio)}
          aria-valuemin={15}
          aria-valuemax={85}
          tabIndex={0}
          title={t('tool.json.splitterTip')}
          className={`tw-json__splitter${isDragging ? ' tw-json__splitter--active' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        >
          <div className='tw-json__splitter-handle' />
        </div>

        {/* 下方面板：结果展示区 */}
        <section
          className='tw-json__pane tw-json__pane--bottom'
          style={{ flex: `${100 - splitRatio} 1 0%` }}
        >
          <div className='tw-field__label'>
            <div className='tw-json__result-title'>
              <span>{t('tool.json.result')}</span>
              {output && (
                <span className='tw-json__stats'>
                  {t('tool.json.stats', {
                    size: fmtSize(outputByteSize),
                    lines: outputLineCount,
                  })}
                </span>
              )}
            </div>
            <div className='tw-json__result-actions'>
              <CopyButton
                text={output}
                disabled={!output}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setStatus({ kind: 'err', text: t('tool.json.copyFailed') })
                }}
              />
              {output && (
                <button
                  type='button'
                  className='tw-link tw-json__download-link'
                  onClick={() => downloadText(output, 'data.json')}
                  title={t('tool.json.download')}
                >
                  <Icon name='download' size={12} />
                  {t('tool.json.download')}
                </button>
              )}
            </div>
          </div>
          <JsonHighlight
            text={output}
            fill
            placeholder={t('tool.json.resultPlaceholder')}
            className='tw-json__viewer'
          />
        </section>
      </div>

      {status && (
        <div className='tw-json__status-bar'>
          <StatusText kind={status.kind}>{status.text}</StatusText>
        </div>
      )}
    </div>
  )
}
