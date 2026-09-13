import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import { useToolDraft } from '@/utils/draft'

import AutoArea from './AutoArea'
import { decodeBase64, encodeBase64, isLikelyBase64 } from './base64'
import CopyButton from './CopyButton'
import DownloadButton from './DownloadButton'
import { detectMimeFromBytes, fmtSize } from './file'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import ToolTabs from './ToolTabs'
import { useEmptyError } from './useEmptyError'

export type Base64Mode = 'decode' | 'encode' | 'file-encode' | 'file-decode'

interface Base64Draft {
  tab: Base64Mode
  decodeInput: string
  decodeOutput: string
  encodeInput: string
  encodeOutput: string
  fileB64Input: string
}

const DEFAULT_DRAFT: Base64Draft = {
  tab: 'decode',
  decodeInput: '',
  decodeOutput: '',
  encodeInput: '',
  encodeOutput: '',
  fileB64Input: '',
}

/** 文件大小上限（5MB 超出拒绝），以及软警告阈值（1MB） */
const MAX_FILE_BYTES = 5 * 1024 * 1024
const WARN_FILE_BYTES = 1 * 1024 * 1024

function firstFile(list: FileList | null): File | null {
  return list && list.length > 0 ? list[0] : null
}

/**
 * Base64 综合工具卡片：
 * 整合「文本解码 / 文本编码 / 文件转Base64 / Base64转文件」4 个 Tab 能力，
 * 各 Tab 拥有完全独立的输入框、输出框与状态，切换互不污染、各自持久化保留。
 */
export default function Base64Tool() {
  const { t } = useTranslation()
  const [draft, setDraft] = useToolDraft<Base64Draft>('base64', DEFAULT_DRAFT)

  // 兼容旧草稿字段
  const rawDraft = draft as unknown as {
    tab?: Base64Mode
    mode?: Base64Mode
    decodeInput?: string
    decodeOutput?: string
    encodeInput?: string
    encodeOutput?: string
    textInput?: string
    textOutput?: string
    input?: string
    output?: string
    fileB64Input?: string
  }
  const tab: Base64Mode = rawDraft.tab ?? rawDraft.mode ?? 'decode'
  const decodeInput =
    rawDraft.decodeInput ??
    (rawDraft.tab === 'decode' || rawDraft.mode === 'decode'
      ? (rawDraft.textInput ?? rawDraft.input ?? '')
      : '')
  const decodeOutput =
    rawDraft.decodeOutput ??
    (rawDraft.tab === 'decode' || rawDraft.mode === 'decode'
      ? (rawDraft.textOutput ?? rawDraft.output ?? '')
      : '')
  const encodeInput =
    rawDraft.encodeInput ??
    (rawDraft.tab === 'encode' || rawDraft.mode === 'encode'
      ? (rawDraft.textInput ?? rawDraft.input ?? '')
      : '')
  const encodeOutput =
    rawDraft.encodeOutput ??
    (rawDraft.tab === 'encode' || rawDraft.mode === 'encode'
      ? (rawDraft.textOutput ?? rawDraft.output ?? '')
      : '')
  const fileB64Input = rawDraft.fileB64Input ?? ''

  // —— 独立状态：文本解码 ——
  const [decodeStatus, setDecodeStatus] = useState<ToolStatus | null>(null)
  const {
    emptyErr: decodeEmptyErr,
    areaRef: decodeInputRef,
    triggerEmpty: triggerDecodeEmpty,
    clearEmpty: clearDecodeEmpty,
  } = useEmptyError()

  // —— 独立状态：文本编码 ——
  const [encodeStatus, setEncodeStatus] = useState<ToolStatus | null>(null)
  const {
    emptyErr: encodeEmptyErr,
    areaRef: encodeInputRef,
    triggerEmpty: triggerEncodeEmpty,
    clearEmpty: clearEncodeEmpty,
  } = useEmptyError()

  // —— 独立状态：文件 → Base64 ——
  const [file, setFile] = useState<File | null>(null)
  const [fileDataUrl, setFileDataUrl] = useState('')
  const [encError, setEncError] = useState<string | null>(null)
  const [encDragging, setEncDragging] = useState(false)
  const encInputRef = useRef<HTMLInputElement>(null)
  const encDragCount = useRef(0)

  // —— 独立状态：Base64 → 文件 ——
  const [decInfo, setDecInfo] = useState<{
    mime: string
    dataUrl: string
    sizeBytes: number
  } | null>(null)
  const [decError, setDecError] = useState<string | null>(null)

  function switchTab(next: Base64Mode) {
    setDraft((prev) => ({ ...prev, tab: next }))
    clearDecodeEmpty()
    clearEncodeEmpty()
  }

  // —— 文本解码独立操作 ——
  function runDecode() {
    const text = decodeInput.trim()
    if (!text) {
      triggerDecodeEmpty()
      setDraft((prev) => ({ ...prev, decodeOutput: '' }))
      setDecodeStatus(null)
      return
    }
    if (!isLikelyBase64(text)) {
      setDecodeStatus({ kind: 'err', text: t('tool.base64.statusNotBase64') })
      setDraft((prev) => ({ ...prev, decodeOutput: '' }))
      return
    }
    try {
      const { text: decoded, isText } = decodeBase64(text)
      setDraft((prev) => ({ ...prev, decodeOutput: decoded }))
      setDecodeStatus({
        kind: 'ok',
        text: isText ? t('tool.base64.statusDecodedText') : t('tool.base64.statusDecodedBytes'),
      })
    } catch (e) {
      setDraft((prev) => ({ ...prev, decodeOutput: '' }))
      setDecodeStatus({
        kind: 'err',
        text: e instanceof Error ? e.message : t('tool.base64.statusFailed'),
      })
    }
  }

  function clearDecode() {
    setDraft((prev) => ({ ...prev, decodeInput: '', decodeOutput: '' }))
    setDecodeStatus(null)
    clearDecodeEmpty()
  }

  // —— 文本编码独立操作 ——
  function runEncode() {
    const text = encodeInput.trim()
    if (!text) {
      triggerEncodeEmpty()
      setDraft((prev) => ({ ...prev, encodeOutput: '' }))
      setEncodeStatus(null)
      return
    }
    try {
      const result = encodeBase64(text)
      setDraft((prev) => ({ ...prev, encodeOutput: result }))
      setEncodeStatus({
        kind: 'ok',
        text: t('tool.base64.statusEncoded', { count: result.length }),
      })
    } catch (e) {
      setDraft((prev) => ({ ...prev, encodeOutput: '' }))
      setEncodeStatus({
        kind: 'err',
        text: e instanceof Error ? e.message : t('tool.base64.statusFailed'),
      })
    }
  }

  function clearEncode() {
    setDraft((prev) => ({ ...prev, encodeInput: '', encodeOutput: '' }))
    setEncodeStatus(null)
    clearEncodeEmpty()
  }

  // —— 文件转 Base64 独立操作 ——
  const readFile = useCallback(
    (f: File) => {
      if (f.size > MAX_FILE_BYTES) {
        setEncError(t('tool.fileB64.tooLarge'))
        setFile(null)
        setFileDataUrl('')
        return
      }
      setFile(f)
      setEncError(null)
      const reader = new FileReader()
      reader.onload = () => setFileDataUrl(String(reader.result ?? ''))
      reader.onerror = () => setEncError(t('tool.fileB64.readFailed'))
      reader.readAsDataURL(f)
    },
    [t],
  )

  const handleEncChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = firstFile(e.target.files)
    if (f) readFile(f)
    e.target.value = ''
  }

  const handleEncDrop = (e: DragEvent) => {
    e.preventDefault()
    encDragCount.current = 0
    setEncDragging(false)
    const f = firstFile(e.dataTransfer.files)
    if (f) readFile(f)
  }

  const handleEncDragEnter = (e: DragEvent) => {
    e.preventDefault()
    encDragCount.current++
    setEncDragging(true)
  }
  const handleEncDragLeave = () => {
    encDragCount.current = Math.max(0, encDragCount.current - 1)
    if (encDragCount.current === 0) setEncDragging(false)
  }

  const openEncPicker = () => encInputRef.current?.click()

  function clearFileEncode() {
    setFile(null)
    setFileDataUrl('')
    setEncError(null)
    if (encInputRef.current) encInputRef.current.value = ''
  }

  // 粘贴图片/文件（仅在 tab === 'file-encode' 时生效）
  useEffect(() => {
    if (tab !== 'file-encode') return
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      const fileItem = items ? Array.from(items).find((i) => i.kind === 'file') : undefined
      const f = fileItem?.getAsFile()
      if (f) {
        e.preventDefault()
        readFile(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [tab, readFile])

  // —— Base64 转文件 独立操作 ——
  useEffect(() => {
    const raw = fileB64Input.trim()
    if (!raw) {
      setDecInfo(null)
      setDecError(null)
      return
    }
    let dUrl = raw
    let mime = 'application/octet-stream'
    if (raw.startsWith('data:')) {
      mime = raw.match(/^data:([^;]+);/)?.[1] ?? mime
      const b64Part = (raw.split(',')[1] ?? '').replace(/\s+/g, '')
      dUrl = `data:${mime};base64,${b64Part}`
    } else {
      let clean = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
      if (clean.length % 4 === 1) {
        setDecInfo(null)
        setDecError(t('tool.fileB64.invalidBase64'))
        return
      }
      if (clean.length % 4 !== 0) {
        clean = clean + '='.repeat((4 - (clean.length % 4)) % 4)
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
        setDecInfo(null)
        setDecError(t('tool.fileB64.invalidBase64'))
        return
      }
      mime = detectMimeFromBytes(clean) ?? mime
      dUrl = `data:${mime};base64,${clean}`
    }
    try {
      const b64 = dUrl.split(',')[1] ?? ''
      const bin = atob(b64)
      setDecInfo({ mime, dataUrl: dUrl, sizeBytes: bin.length })
      setDecError(null)
    } catch {
      setDecInfo(null)
      setDecError(t('tool.fileB64.invalidBase64'))
    }
  }, [fileB64Input, t])

  async function pasteClipboardText() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setDraft((prev) => ({ ...prev, fileB64Input: text }))
      else setDecError(t('tool.fileB64.noClipboardText'))
    } catch {
      setDecError(t('tool.fileB64.clipboardDenied'))
    }
  }

  function clearFileDecode() {
    setDraft((prev) => ({ ...prev, fileB64Input: '' }))
    setDecInfo(null)
    setDecError(null)
  }

  const fileMime = fileDataUrl.match(/^data:([^;]+);/)?.[1] ?? ''
  const filePureBase64 = fileDataUrl.split(',')[1] ?? ''
  const isImage = fileMime.startsWith('image/')
  const encWarn = file != null && file.size > WARN_FILE_BYTES

  const onDropKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openEncPicker()
    }
  }

  const tabItems: { id: Base64Mode; label: string }[] = [
    { id: 'decode', label: t('tool.base64.tabTextDecode') },
    { id: 'encode', label: t('tool.base64.tabTextEncode') },
    { id: 'file-encode', label: t('tool.base64.tabFileEncode') },
    { id: 'file-decode', label: t('tool.base64.tabFileDecode') },
  ]

  return (
    <div className='tw-card'>
      <ToolTabs<Base64Mode> value={tab} onChange={switchTab} items={tabItems} />

      {/* 1. 文本解码面板：独立维护 decodeInput / decodeOutput */}
      <div hidden={tab !== 'decode'} className='tw-card'>
        <label className='tw-field'>
          <span className='tw-field__label'>{t('tool.base64.labelInputDecode')}</span>
          <textarea
            ref={decodeInputRef}
            className={`tw-area${decodeEmptyErr ? ' tw-area--empty-err' : ''}`}
            value={decodeInput}
            placeholder={t('tool.base64.inputPlaceholderDecode')}
            onChange={(e) => {
              const val = e.target.value
              setDraft((prev) => ({ ...prev, decodeInput: val, decodeOutput: '' }))
              if (decodeEmptyErr) clearDecodeEmpty()
              setDecodeStatus(null)
            }}
            spellCheck={false}
          />
        </label>

        <div className='tw-actions'>
          <button type='button' className='pd-btn pd-btn--primary' onClick={runDecode}>
            {t('tool.base64.runDecode')}
          </button>
          <button type='button' className='pd-btn' onClick={clearDecode}>
            {t('common.clear')}
          </button>
        </div>

        {decodeStatus && <StatusText kind={decodeStatus.kind}>{decodeStatus.text}</StatusText>}

        {Boolean(decodeOutput) && (
          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.base64.result')}
              <CopyButton
                text={decodeOutput}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setDecodeStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
            </span>
            <AutoArea
              className='tw-area tw-area--result'
              value={decodeOutput}
              readOnly
              placeholder={t('tool.base64.resultPlaceholder')}
            />
          </div>
        )}
      </div>

      {/* 2. 文本编码面板：独立维护 encodeInput / encodeOutput */}
      <div hidden={tab !== 'encode'} className='tw-card'>
        <label className='tw-field'>
          <span className='tw-field__label'>{t('tool.base64.labelInputEncode')}</span>
          <textarea
            ref={encodeInputRef}
            className={`tw-area${encodeEmptyErr ? ' tw-area--empty-err' : ''}`}
            value={encodeInput}
            placeholder={t('tool.base64.inputPlaceholderEncode')}
            onChange={(e) => {
              const val = e.target.value
              setDraft((prev) => ({ ...prev, encodeInput: val, encodeOutput: '' }))
              if (encodeEmptyErr) clearEncodeEmpty()
              setEncodeStatus(null)
            }}
            spellCheck={false}
          />
        </label>

        <div className='tw-actions'>
          <button type='button' className='pd-btn pd-btn--primary' onClick={runEncode}>
            {t('tool.base64.runEncode')}
          </button>
          <button type='button' className='pd-btn' onClick={clearEncode}>
            {t('common.clear')}
          </button>
        </div>

        {encodeStatus && <StatusText kind={encodeStatus.kind}>{encodeStatus.text}</StatusText>}

        {Boolean(encodeOutput) && (
          <div className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.base64.result')}
              <CopyButton
                text={encodeOutput}
                className='tw-link'
                onResult={(ok) => {
                  if (!ok) setEncodeStatus({ kind: 'err', text: t('common.copyFailed') })
                }}
              />
            </span>
            <AutoArea
              className='tw-area tw-area--result'
              value={encodeOutput}
              readOnly
              placeholder={t('tool.base64.resultPlaceholder')}
            />
          </div>
        )}
      </div>

      {/* 3. 文件转 Base64 面板 */}
      <div hidden={tab !== 'file-encode'} className='tw-fileb64'>
        <input
          ref={encInputRef}
          type='file'
          style={{ display: 'none' }}
          onChange={handleEncChange}
        />

        {!fileDataUrl ? (
          <div
            className={`tw-fileb64__drop${encDragging ? ' tw-fileb64__drop--drag' : ''}`}
            role='button'
            tabIndex={0}
            onClick={openEncPicker}
            onKeyDown={onDropKey}
            onDragOver={(e) => {
              e.preventDefault()
              setEncDragging(true)
            }}
            onDragEnter={handleEncDragEnter}
            onDragLeave={handleEncDragLeave}
            onDrop={handleEncDrop}
          >
            <Icon name='upload' size={32} className='tw-fileb64__drop-icon' />
            <strong>{t('tool.fileB64.dropText')}</strong>
            <p>{t('tool.fileB64.dropSubtitle')}</p>
          </div>
        ) : (
          <>
            <div className='tw-fileb64__file'>
              {isImage && (
                <img
                  src={fileDataUrl}
                  alt={t('tool.fileB64.previewAlt')}
                  className='tw-fileb64__thumb'
                />
              )}
              <div className='tw-fileb64__fileinfo'>
                <span className='tw-fileb64__filename'>{file?.name ?? ''}</span>
                <span className='tw-fileb64__meta'>
                  {file ? fmtSize(file.size) : ''} · {fileMime || t('tool.fileB64.unknownType')}
                </span>
              </div>
              <button
                type='button'
                className='pd-btn pd-btn--sm'
                onClick={() => {
                  setFile(null)
                  setFileDataUrl('')
                  setEncError(null)
                  openEncPicker()
                }}
              >
                {t('tool.fileB64.rechoose')}
              </button>
            </div>

            {encWarn && <StatusText kind='info'>{t('tool.fileB64.sizeWarning')}</StatusText>}

            <div className='tw-field'>
              <span className='tw-field__label'>
                {t('tool.fileB64.base64Label')}
                <CopyButton text={filePureBase64} disabled={!filePureBase64} className='tw-link' />
              </span>
              <AutoArea
                className='tw-area tw-area--result'
                value={filePureBase64}
                readOnly
                maxHeight={200}
              />
            </div>

            <div className='tw-field'>
              <span className='tw-field__label'>
                {t('tool.fileB64.dataUrlLabel')}
                <CopyButton text={fileDataUrl} disabled={!fileDataUrl} className='tw-link' />
              </span>
              <AutoArea
                className='tw-area tw-area--result'
                value={fileDataUrl}
                readOnly
                maxHeight={120}
              />
            </div>

            <div className='tw-actions'>
              <button type='button' className='pd-btn' onClick={clearFileEncode}>
                {t('common.clear')}
              </button>
            </div>
          </>
        )}

        {encError && <StatusText kind='err'>{encError}</StatusText>}
      </div>

      {/* 4. Base64 转文件 面板 */}
      <div hidden={tab !== 'file-decode'} className='tw-fileb64'>
        <label className='tw-field'>
          <span className='tw-field__label'>{t('tool.fileB64.decodeInputLabel')}</span>
          <AutoArea
            className='tw-area'
            value={fileB64Input}
            onChange={(e) => {
              const val = e.target.value
              setDraft((prev) => ({ ...prev, fileB64Input: val }))
            }}
            placeholder={t('tool.fileB64.decodePlaceholder')}
            spellCheck={false}
          />
        </label>

        <div className='tw-actions'>
          <button type='button' className='pd-btn' onClick={() => void pasteClipboardText()}>
            {t('tool.fileB64.pasteFromClipboard')}
          </button>
          <button type='button' className='pd-btn' onClick={clearFileDecode}>
            {t('common.clear')}
          </button>
        </div>

        {decError && <StatusText kind='err'>{decError}</StatusText>}

        {decInfo && (
          <div className='tw-fileb64__result'>
            {decInfo.mime.startsWith('image/') && (
              <img
                src={decInfo.dataUrl}
                alt={t('tool.fileB64.previewAlt')}
                className='tw-fileb64__thumb'
              />
            )}
            <div className='tw-detect__fields'>
              <div className='tw-detect__field'>
                <span className='tw-detect__field-label'>MIME</span>
                <code className='tw-detect__field-value tw-detect__field-value--mono'>
                  {decInfo.mime}
                </code>
                <CopyButton text={decInfo.mime} icon className='tw-detect__copy' />
              </div>
              <div className='tw-detect__field'>
                <span className='tw-detect__field-label'>{t('tool.fileB64.fileSize')}</span>
                <code className='tw-detect__field-value tw-detect__field-value--mono'>
                  {fmtSize(decInfo.sizeBytes)}
                </code>
                <CopyButton text={fmtSize(decInfo.sizeBytes)} icon className='tw-detect__copy' />
              </div>
            </div>
            <div className='tw-actions'>
              <DownloadButton
                mime={decInfo.mime}
                dataUrl={decInfo.dataUrl}
                label={t('tool.fileB64.download')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
