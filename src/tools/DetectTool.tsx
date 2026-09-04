import { useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import { detect } from './detect'
import DetectResultView from './DetectResultView'
import { StatusText } from './StatusText'

/** 智能识别：粘贴一段内容，自动判定类型并就地给出可操作的解码/解析结果（不跳转、纯本地） */
export default function DetectTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const result = useMemo(() => detect(input), [input])

  return (
    <div className='tw-card'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.detect.inputLabel')}</span>
        <AutoArea
          className='tw-area'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('tool.detect.inputPlaceholder')}
          spellCheck={false}
        />
      </label>

      {result && <DetectResultView result={result} />}

      {!result && input.trim() && <StatusText kind='info'>{t('tool.detect.none')}</StatusText>}

      <p className='tw-note'>{t('tool.detect.note')}</p>
    </div>
  )
}
