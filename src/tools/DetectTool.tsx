import { useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import AutoArea from './AutoArea'
import { detect } from './detect'
import DetectResultView from './DetectResultView'
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

      <div className='tw-detect__formats'>
        <span className='tw-detect__formats-label'>{t('tool.detect.supportedFormats')}</span>
        <div className='tw-detect__formats-list'>
          {FORMAT_PRESETS.map((p) => (
            <button
              key={p.key}
              type='button'
              className='tw-detect__format-chip'
              title={t('tool.detect.clickToFillSample')}
              onClick={() => setInput(p.sample)}
            >
              {t(`tool.detect.format.${p.key}`)}
            </button>
          ))}
        </div>
      </div>

      {result && <DetectResultView result={result} />}

      {!result && input.trim() && <StatusText kind='info'>{t('tool.detect.none')}</StatusText>}
    </div>
  )
}
