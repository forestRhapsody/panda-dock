import { useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import TkSelect from '@/ui/TkSelect'
import Tooltip from '@/ui/Tooltip'
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
  minify: boolean
  lastAction: JsonAction | null
  splitRatio?: number
}

/** JSON 工具的草稿 key：新增/改动时必须同步 `handoff.ts`（智能解析据此把文本送进来） */
export const JSON_DRAFT_KEY = 'json.workbench'

export const DEFAULT_JSON_DRAFT: JsonDraft = {
  input: '',
  output: '',
  indent: 2,
  sortKeys: false,
  minify: false,
  lastAction: null,
  splitRatio: 50,
}

/**
 * 全功能 JSON 工具工作台：
 * 采用类似 IDE 的上下可拖拽分屏布局，高度 100% 自适应撑满且无外层滚动条；
 * 输入区与结果区支持独立纵向滚动，汇聚格式化、单行压缩、字符串转义、去转义能力，
 * 并支持「单行压缩」与「键名排序」复选框自由组合与即时联动。
 */
export default function JsonTool() {
  const { t } = useTranslation()
  const [draft, setDraft] = useToolDraft<JsonDraft>(JSON_DRAFT_KEY, DEFAULT_JSON_DRAFT)
  const { input, output, indent, sortKeys, minify = false } = draft
  const [status, setStatus] = useState<ToolStatus | null>(null)

  // 分屏高度比例（上方面板占比百分比，范围 15~85，默认 50）
  const [splitRatio, setSplitRatio] = useState<number>(
    Math.max(15, Math.min(85, draft.splitRatio ?? 50)),
  )
  const [isDragging, setIsDragging] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [emptyError, setEmptyError] = useState(false)
  const [errorLine, setErrorLine] = useState<number | null>(null)

  const inputLineCount = useMemo(() => {
    if (!input) return 1
    return input.split('\n').length
  }, [input])
  const inputLnDigits = Math.max(2, String(inputLineCount).length)
  const inputLnStyle = { width: `${inputLnDigits}ch` }

  const handleInputScroll = () => {
    if (gutterRef.current && inputRef.current) {
      gutterRef.current.scrollTop = inputRef.current.scrollTop
    }
  }

  // 当外部 draft.splitRatio 改变（如切换标签还原）且不在拖拽中时同步
  useEffect(() => {
    if (!isDragging && draft.splitRatio !== undefined && draft.splitRatio !== splitRatio) {
      setSplitRatio(Math.max(15, Math.min(85, draft.splitRatio)))
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

    // 保障上方面板输入框(72px + 头部/按钮/状态~64px = ~136px) 与 下方面板结果区(72px + 头部/配置~54px = ~126px)
    const minTopPx = 136
    const minBottomPx = 126
    const minPct = Math.min(45, Math.max(15, (minTopPx / rect.height) * 100))
    const maxPct = Math.max(55, Math.min(85, 100 - (minBottomPx / rect.height) * 100))

    const offsetY = e.clientY - rect.top
    let pct = (offsetY / rect.height) * 100
    pct = Math.max(minPct, Math.min(maxPct, pct))
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

  function handleParseError(res: { error?: string; line?: number; offset?: number }) {
    setOutput('')
    setStatus({ kind: 'err', text: res.error ?? t('tool.json.failed') })
    if (res.line) {
      setErrorLine(res.line)
      if (inputRef.current) {
        const offset = res.offset ?? 0
        inputRef.current.focus()
        const end = Math.min(offset + 1, inputRef.current.value.length)
        inputRef.current.setSelectionRange(offset, end)
        const targetScrollTop = Math.max(0, (res.line - 3) * 22.4)
        inputRef.current.scrollTop = targetScrollTop
        if (gutterRef.current) gutterRef.current.scrollTop = targetScrollTop
      }
    } else {
      setErrorLine(null)
    }
  }

  function runFormat(
    text = input,
    opts?: { indent?: JsonIndent; sortKeys?: boolean; minify?: boolean },
  ) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus(null)
      setErrorLine(null)
      setEmptyError(true)
      inputRef.current?.focus()
      return
    }
    setEmptyError(false)
    const shouldMinify = opts?.minify ?? minify
    const currentSort = opts?.sortKeys ?? sortKeys

    if (shouldMinify) {
      const res = minifyJson(raw, { sortKeys: currentSort })
      if (res.ok) {
        setErrorLine(null)
        setDraft((prev) => ({
          ...prev,
          output: res.text ?? '',
          lastAction: 'minify',
          ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
          ...(opts?.minify !== undefined ? { minify: opts.minify } : {}),
        }))
        setStatus(null)
      } else {
        handleParseError(res)
      }
    } else {
      const currentIndent = opts?.indent ?? indent
      const res = formatJson(raw, { indent: currentIndent, sortKeys: currentSort })
      if (res.ok) {
        setErrorLine(null)
        setDraft((prev) => ({
          ...prev,
          output: res.text ?? '',
          lastAction: 'format',
          ...(opts?.indent !== undefined ? { indent: opts.indent } : {}),
          ...(opts?.sortKeys !== undefined ? { sortKeys: opts.sortKeys } : {}),
          ...(opts?.minify !== undefined ? { minify: opts.minify } : {}),
        }))
        setStatus(null)
      } else {
        handleParseError(res)
      }
    }
  }

  function runEscape(text = input) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus(null)
      setErrorLine(null)
      setEmptyError(true)
      inputRef.current?.focus()
      return
    }
    setEmptyError(false)
    const res = escapeJson(raw, { sortKeys })
    if (res.ok) {
      setErrorLine(null)
      setDraft((prev) => ({ ...prev, output: res.text ?? '', lastAction: 'escape' }))
      setStatus(null)
    } else {
      handleParseError(res)
    }
  }

  function runUnescape(text = input) {
    const raw = text.trim()
    if (!raw) {
      setOutput('')
      setStatus(null)
      setErrorLine(null)
      setEmptyError(true)
      inputRef.current?.focus()
      return
    }
    setEmptyError(false)
    const res = unescapeJson(raw, { indent, sortKeys })
    if (res.ok) {
      setErrorLine(null)
      setDraft((prev) => ({
        ...prev,
        output: res.text ?? '',
        lastAction: 'unescape',
      }))
      setStatus(null)
    } else {
      handleParseError(res)
    }
  }

  function onMinifyChange(checked: boolean) {
    setDraft((prev) => ({ ...prev, minify: checked }))
    if (output) {
      runFormat(input || output, { minify: checked })
    }
  }

  function onSortKeysChange(checked: boolean) {
    setDraft((prev) => ({ ...prev, sortKeys: checked }))
    if (output) {
      runFormat(input || output, { sortKeys: checked })
    }
  }

  function onIndentChange(val: string | number) {
    const nextIndent: JsonIndent = val === 'tab' ? 'tab' : (Number(val) as 2 | 4)
    setDraft((prev) => ({ ...prev, indent: nextIndent }))
    if (output && !minify) {
      runFormat(input || output, { indent: nextIndent })
    }
  }

  function fillSample() {
    setEmptyError(false)
    setErrorLine(null)
    setInput(SAMPLE_JSON)
    runFormat(SAMPLE_JSON, { indent, sortKeys, minify })
    if (gutterRef.current) gutterRef.current.scrollTop = 0
  }

  function clear() {
    setEmptyError(false)
    setErrorLine(null)
    setDraft((prev) => ({
      ...prev,
      input: '',
      output: '',
      lastAction: null,
    }))
    setStatus(null)
    if (gutterRef.current) gutterRef.current.scrollTop = 0
  }

  const outputByteSize = output ? new Blob([output]).size : 0
  const outputLineCount = output ? output.split('\n').length : 0

  return (
    <div className={`tw-json-split${isDragging ? ' tw-json-split--dragging' : ''}`}>
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
          <div
            className={`tw-json-editor-wrap${emptyError ? ' tw-json-editor-wrap--empty-err' : ''}`}
          >
            {Boolean(input) && (
              <div ref={gutterRef} className='tw-json-editor__gutter' aria-hidden='true'>
                {Array.from({ length: inputLineCount }, (_, i) => {
                  const lineNum = i + 1
                  const isErr = lineNum === errorLine
                  return (
                    <div
                      key={i}
                      className={`tw-json-editor__ln${isErr ? ' tw-json-editor__ln--error' : ''}`}
                      style={inputLnStyle}
                    >
                      {lineNum}
                    </div>
                  )
                })}
              </div>
            )}
            <textarea
              ref={inputRef}
              className='tw-json-editor__input'
              value={input}
              placeholder={t('tool.json.inputPlaceholder')}
              onScroll={handleInputScroll}
              onChange={(e) => {
                setInput(e.target.value)
                if (emptyError) setEmptyError(false)
                if (errorLine !== null) setErrorLine(null)
                if (status) setStatus(null)
              }}
              spellCheck={false}
            />
          </div>
          <div className='tw-json__actions'>
            <button type='button' className='tk-btn tk-btn--primary' onClick={() => runFormat()}>
              {t('tool.json.formatBtn')}
            </button>
            <button type='button' className='tk-btn' onClick={() => runEscape()}>
              {t('tool.json.escapeBtn')}
            </button>
            <button type='button' className='tk-btn' onClick={() => runUnescape()}>
              {t('tool.json.unescapeBtn')}
            </button>
            <button type='button' className='tk-btn' onClick={clear}>
              {t('common.clear')}
            </button>
          </div>
          {status && (
            <div className='tw-json__input-status' aria-live='polite'>
              <StatusText kind={status.kind}>{status.text}</StatusText>
            </div>
          )}
        </section>

        {/* 可拖拽分屏控制条 (Splitter) */}
        <Tooltip content={t('tool.json.splitterTip')}>
          <div
            role='separator'
            aria-orientation='horizontal'
            aria-label={t('tool.json.splitterLabel')}
            aria-valuenow={Math.round(splitRatio)}
            aria-valuemin={15}
            aria-valuemax={85}
            tabIndex={0}
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
        </Tooltip>

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
                  if (!ok) setStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
              {output && (
                <button
                  type='button'
                  className='tw-link tw-json__download-link'
                  onClick={() => downloadText(output, 'data.json')}
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
            showLineNumbers={outputLineCount > 1}
            placeholder={t('tool.json.resultPlaceholder')}
            className='tw-json__viewer'
          />
          <div className='tw-json__options'>
            <div className='tw-json__options-group'>
              <Tooltip content={t('tool.json.minifyDesc')}>
                <label className='tk-checkbox'>
                  <input
                    type='checkbox'
                    checked={minify}
                    onChange={(e) => onMinifyChange(e.target.checked)}
                  />
                  <span>{t('tool.json.minifyOption')}</span>
                </label>
              </Tooltip>

              <Tooltip content={t('tool.json.sortKeysDesc')}>
                <label className='tk-checkbox'>
                  <input
                    type='checkbox'
                    checked={sortKeys}
                    onChange={(e) => onSortKeysChange(e.target.checked)}
                  />
                  <span>{t('tool.json.sortKeysOption')}</span>
                </label>
              </Tooltip>
            </div>

            <div className='tw-json__indent'>
              <TkSelect
                variant='sm'
                value={indent}
                disabled={minify}
                onChange={(e) => onIndentChange(e.target.value)}
                title={t('tool.json.indent')}
              >
                <option value={2}>{t('tool.json.indent2')}</option>
                <option value={4}>{t('tool.json.indent4')}</option>
                <option value='tab'>{t('tool.json.indentTab')}</option>
              </TkSelect>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
