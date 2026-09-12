import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import { toast } from '@/ui/toast'
import Tooltip from '@/ui/Tooltip'
import { useToolDraft } from '@/utils/draft'

import { detect } from './detect'
import type { DetectResult } from './detect'
import DetectResultView from './DetectResultView'
import { prepareToolHandoff } from './handoff'
import HighlightArea from './HighlightArea'
import type { ToolId } from './registry'
import { StatusText } from './StatusText'

interface FormatPreset {
  key: string
  sample: string
}

const FORMAT_PRESETS: FormatPreset[] = [
  {
    key: 'base64',
    sample: 'SGVsbG8sIFBhbmRhIERvY2shIFdlbGNvbWUgdG8gdGhlIHRvb2xraXQu',
  },
  {
    key: 'urls',
    sample: `Panda Dock: https://github.com/
Dev Guide: https://developer.mozilla.org/zh-CN/
Search Engine: https://www.google.com`,
  },
  {
    key: 'json',
    sample:
      '{"name":"Panda Dock","version":"1.0.0","tools":["parse","storage","qrcode"],"active":true}',
  },
  {
    key: 'jwt',
    sample:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IlBhbmRhIERvY2siLCJpYXQiOjE1MTYyMzkwMjJ9.4pcPyMD0eeOmEkRhO6sq8C6BRZYTn52kZPB0upW97Mw',
  },
  {
    key: 'timestamp',
    sample: '1710000000',
  },
  {
    key: 'hex',
    sample: '48 65 6c 6c 6f 2c 20 50 61 6e 64 61 20 44 6f 63 6b 21',
  },
  {
    key: 'uuid',
    sample: 'c9bf022d-f519-4b5f-ae50-6b16b7a27e5f',
  },
]

/** 智能解析：粘贴一段内容，自动判定类型并就地给出可操作的解码/解析结果（不跳转、纯本地） */
export default function DetectTool() {
  const { t } = useTranslation()
  const [input, setInput, clearInput] = useToolDraft<string>('detect.input', '')
  const deferredInput = useDeferredValue(input)
  const result = useMemo(() => detect(deferredInput), [deferredInput])

  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  // 当草稿文本变化时（例如从划选弹窗带入侧边栏），重置激活匹配项为第 1 项
  const prevInputRef = useRef(input)
  useEffect(() => {
    if (prevInputRef.current !== input) {
      prevInputRef.current = input
      setActiveMatchIndex(0)
    }
  }, [input])

  // 当 items 存在且数量 > 1 时，按当前索引切换解析结果与高亮焦点
  const items = result?.items
  const totalMatches = items?.length ?? 1
  const safeActiveIndex = activeMatchIndex >= totalMatches ? 0 : activeMatchIndex

  /**
   * 「在 XX 工具中打开」：检测工具与目标工具本来就同处一个宿主（侧边栏 / 抽屉），
   * 因此只需准备草稿并激活该 Tab——`activeToolTab` 的草稿变化会被 ToolsApp 的
   * useToolDraft 监听到，Tab 随之切换。
   */
  const handleOpenInTool = useCallback(
    (tool: ToolId, text: string) => {
      void prepareToolHandoff(tool, text).then((res) => {
        // 目标工具被禁用且启用失败时，Tab 不会切过去，必须告知用户
        if (!res.ok && res.reason === 'enable-failed') {
          toast.error(t('tool.detect.openInToolFailed', { tool: t(`tool.registry.${tool}`) }))
        }
      })
    },
    [t],
  )

  const currentResult = useMemo<DetectResult | null>(() => {
    if (!result) return null
    if (!items || items.length <= 1) return result
    const item = items[safeActiveIndex]
    return {
      kind: item.kind,
      fields: item.fields,
      blocks: item.blocks,
      copy: item.copy,
      download: item.download,
      sourceMatches: items.flatMap((it, idx) =>
        (it.sourceMatches ?? (it.sourceMatch ? [it.sourceMatch] : [])).map((m) => ({
          ...m,
          active: idx === safeActiveIndex,
        })),
      ),
      items,
    }
  }, [result, items, safeActiveIndex])

  const handleClear = useCallback(() => {
    clearInput()
    setActiveMatchIndex(0)
  }, [clearInput])

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>
          {t('tool.detect.inputLabel')}
          {input && (
            <button type='button' className='tw-link' onClick={handleClear}>
              {t('common.clear')}
            </button>
          )}
        </span>
        <HighlightArea
          value={input}
          matches={currentResult?.sourceMatches}
          onChange={(e) => {
            setInput(e.target.value)
            setActiveMatchIndex(0)
          }}
          placeholder={t('tool.detect.inputPlaceholder')}
          spellCheck={false}
        />
      </label>

      <div className='tw-detect__formats'>
        <span className='tw-detect__formats-label'>{t('tool.detect.supportedFormats')}</span>
        <div className='tw-detect__formats-list'>
          {FORMAT_PRESETS.map((p) => (
            <Tooltip key={p.key} content={t('tool.detect.clickToFillSample')}>
              <button
                type='button'
                className='tw-detect__format-chip'
                onClick={() => {
                  setInput(p.sample)
                  setActiveMatchIndex(0)
                }}
              >
                {t(`tool.detect.format.${p.key}`)}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {currentResult && (
        <DetectResultView
          result={currentResult}
          items={items}
          activeMatchIndex={safeActiveIndex}
          onSelectMatch={setActiveMatchIndex}
          onOpenInTool={handleOpenInTool}
        />
      )}

      {!result && input.trim() && <StatusText kind='info'>{t('tool.detect.none')}</StatusText>}
    </div>
  )
}
