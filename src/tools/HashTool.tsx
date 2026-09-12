import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'

import { useTranslation } from 'react-i18next'

import Icon from '@/ui/Icon'
import { useToolDraft } from '@/utils/draft'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import { fmtSize } from './file'
import { computeFileHash, computeTextHash, HASH_FILE_MD5_SKIP_BYTES, matchChecksum } from './hash'
import type { HashAlgorithmName, HashResult } from './hash'
import { StatusText } from './StatusText'
import ToolTabs from './ToolTabs'

export type HashTab = 'text' | 'file'

interface HashDraft {
  tab: HashTab
  textInput: string
  hmacKey: string
  showHmac: boolean
  uppercase: boolean
  expectedChecksum: string
}

const DEFAULT_DRAFT: HashDraft = {
  tab: 'text',
  textInput: '',
  hmacKey: '',
  showHmac: false,
  uppercase: false,
  expectedChecksum: '',
}

const ALGORITHMS: { name: HashAlgorithmName; key: keyof HashResult }[] = [
  { name: 'MD5', key: 'md5' },
  { name: 'SHA-1', key: 'sha1' },
  { name: 'SHA-256', key: 'sha256' },
  { name: 'SHA-512', key: 'sha512' },
]

export default function HashTool() {
  const { t } = useTranslation()
  const [draft, setDraft] = useToolDraft<HashDraft>('hash', DEFAULT_DRAFT)

  const tab = draft.tab ?? 'text'
  const textInput = draft.textInput ?? ''
  const hmacKey = draft.hmacKey ?? ''
  const showHmac = draft.showHmac ?? false
  const uppercase = draft.uppercase ?? false
  const expectedChecksum = draft.expectedChecksum ?? ''

  // 文本哈希结果
  const [textResult, setTextResult] = useState<HashResult | null>(null)
  const [textLoading, setTextLoading] = useState(false)

  // 文件哈希状态
  const [file, setFile] = useState<File | null>(null)
  const [fileResult, setFileResult] = useState<HashResult | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  /** 文件超过 MD5 阈值：只算了原生 SHA，MD5 一栏为空 */
  const [fileMd5Skipped, setFileMd5Skipped] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCount = useRef(0)

  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uppercaseRef = useRef(uppercase)
  uppercaseRef.current = uppercase

  // —— 1. 文本哈希计算（防抖实时自动计算） ——
  useEffect(() => {
    const trimmed = textInput.trim()
    if (!trimmed) {
      setTextResult(null)
      setTextLoading(false)
      return
    }

    let active = true
    const timer = setTimeout(async () => {
      setTextLoading(true)
      try {
        const res = await computeTextHash(textInput, {
          hmacKey: showHmac && hmacKey.trim() ? hmacKey.trim() : undefined,
          uppercase: uppercaseRef.current,
        })
        if (active) {
          setTextResult(res)
        }
      } catch (err) {
        console.error('[HashTool] text hash error:', err)
      } finally {
        if (active) {
          setTextLoading(false)
        }
      }
    }, 60)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [textInput, showHmac, hmacKey])

  // 小写 / 大写 HEX 切换（勾选表示小写，取消勾选表示大写）
  const onLowercaseChange = (checked: boolean) => {
    const nextUpper = !checked
    setDraft((d) => ({ ...d, uppercase: nextUpper }))
    if (textResult) {
      setTextResult({
        md5: nextUpper ? textResult.md5.toUpperCase() : textResult.md5.toLowerCase(),
        sha1: nextUpper ? textResult.sha1.toUpperCase() : textResult.sha1.toLowerCase(),
        sha256: nextUpper ? textResult.sha256.toUpperCase() : textResult.sha256.toLowerCase(),
        sha512: nextUpper ? textResult.sha512.toUpperCase() : textResult.sha512.toLowerCase(),
      })
    }
  }

  // HMAC 开关切换（勾选展开 HMAC 密钥输入框，取消勾选收起）
  const onHmacChange = (checked: boolean) => {
    setDraft((d) => ({ ...d, showHmac: checked }))
  }

  // 文件大写 / 小写 HEX 切换（纯同步就地转换，避免大文件重复读取）
  const toggleFileCase = () => {
    const nextUpper = !uppercase
    setDraft((d) => ({ ...d, uppercase: nextUpper }))
    if (fileResult) {
      setFileResult({
        md5: nextUpper ? fileResult.md5.toUpperCase() : fileResult.md5.toLowerCase(),
        sha1: nextUpper ? fileResult.sha1.toUpperCase() : fileResult.sha1.toLowerCase(),
        sha256: nextUpper ? fileResult.sha256.toUpperCase() : fileResult.sha256.toLowerCase(),
        sha512: nextUpper ? fileResult.sha512.toUpperCase() : fileResult.sha512.toLowerCase(),
      })
    }
  }

  // —— 2. 文件哈希计算 ——
  const handleCalculateFile = useCallback(
    async (targetFile: File, isUpper: boolean) => {
      setFileLoading(true)
      setFileError('')
      try {
        const outcome = await computeFileHash(targetFile, { uppercase: isUpper })
        if (!outcome.ok) {
          setFileError(
            t('tool.hash.fileTooLarge', {
              size: fmtSize(outcome.sizeBytes),
              max: fmtSize(outcome.maxBytes),
            }),
          )
          setFileResult(null)
          setFileMd5Skipped(false)
          return
        }
        setFileResult(outcome.hashes)
        setFileMd5Skipped(outcome.md5Skipped)
      } catch (err) {
        console.error('[HashTool] file hash error:', err)
        setFileError(err instanceof Error ? err.message : t('tool.hash.fileReadError'))
        setFileResult(null)
        setFileMd5Skipped(false)
      } finally {
        setFileLoading(false)
      }
    },
    [t],
  )

  useEffect(() => {
    if (file) {
      handleCalculateFile(file, uppercaseRef.current)
    } else {
      setFileResult(null)
      setFileMd5Skipped(false)
      setFileLoading(false)
    }
  }, [file, handleCalculateFile])

  // 文件拖拽与选择处理
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
  }

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault()
    dragCount.current++
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    dragCount.current = Math.max(0, dragCount.current - 1)
    if (dragCount.current === 0) setIsDragOver(false)
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    dragCount.current = 0
    setIsDragOver(false)
    const droppedFiles = e.dataTransfer.files
    if (droppedFiles && droppedFiles.length > 0) {
      setFile(droppedFiles[0])
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files
    if (selected && selected.length > 0) {
      setFile(selected[0])
    }
    e.target.value = ''
  }

  const onDropKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInputRef.current?.click()
    }
  }

  const clearText = () => {
    setDraft((d) => ({ ...d, textInput: '', hmacKey: '' }))
    setTextResult(null)
  }

  const clearFile = () => {
    setFile(null)
    setFileResult(null)
    setFileError('')
    setFileMd5Skipped(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const formatAllHashes = (res: HashResult | null, title?: string) => {
    if (!res) return ''
    // 跳过计算（超限的 MD5）的算法不写入，避免复制到空值行
    return [
      title ? `# ${title}` : '',
      res.md5 && `MD5:    ${res.md5}`,
      res.sha1 && `SHA-1:  ${res.sha1}`,
      res.sha256 && `SHA256: ${res.sha256}`,
      res.sha512 && `SHA512: ${res.sha512}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  // 比对结果
  const matchInfo = fileResult ? matchChecksum(expectedChecksum, fileResult) : null

  return (
    <div className='tw-card'>
      {/* 统一 Tab 切换 */}
      <ToolTabs<HashTab>
        value={tab}
        onChange={(val) => setDraft((d) => ({ ...d, tab: val }))}
        items={[
          { id: 'text', label: t('tool.hash.tabText') },
          { id: 'file', label: t('tool.hash.tabFile') },
        ]}
      />

      {/* =========================================================================
          Tab 1: 文本哈希
          ========================================================================= */}
      <div hidden={tab !== 'text'} className='tw-sec'>
        <label className='tw-field'>
          <span className='tw-field__label'>{t('tool.hash.textLabel')}</span>
          <AutoArea
            className='tw-area'
            value={textInput}
            onChange={(e) => setDraft((d) => ({ ...d, textInput: e.target.value }))}
            placeholder={t('tool.hash.textPlaceholder')}
            maxHeight={200}
            spellCheck={false}
          />
        </label>

        {showHmac && (
          <label className='tw-field'>
            <span className='tw-field__label'>
              {t('tool.hash.hmacLabel')}
              {hmacKey && (
                <button
                  type='button'
                  className='tw-link'
                  onClick={() => setDraft((d) => ({ ...d, hmacKey: '' }))}
                >
                  {t('common.clear')}
                </button>
              )}
            </span>
            <input
              type='text'
              className='tw-input'
              value={hmacKey}
              onChange={(e) => setDraft((d) => ({ ...d, hmacKey: e.target.value }))}
              placeholder={t('tool.hash.hmacPlaceholder')}
              spellCheck={false}
            />
          </label>
        )}

        <div className='tw-hash__toolbar'>
          <div className='tw-hash__options'>
            <label className='tk-checkbox'>
              <input
                type='checkbox'
                checked={!uppercase}
                onChange={(e) => onLowercaseChange(e.target.checked)}
              />
              <span>{t('tool.hash.lower')}</span>
            </label>

            <label className='tk-checkbox'>
              <input
                type='checkbox'
                checked={showHmac}
                onChange={(e) => onHmacChange(e.target.checked)}
              />
              <span>HMAC</span>
            </label>
          </div>

          <div className='tw-actions'>
            <button type='button' className='tk-btn' onClick={clearText}>
              {t('common.clear')}
            </button>
          </div>
        </div>

        {!textResult && textLoading && (
          <StatusText kind='info'>
            <Icon name='refresh' className='tw-spin' size={14} /> {t('tool.hash.computing')}
          </StatusText>
        )}

        {!textInput.trim() && !textLoading && (
          <StatusText kind='info'>{t('tool.hash.emptyPrompt')}</StatusText>
        )}

        {textResult && (
          <div className='tw-detect__block'>
            <span className='tw-field__label'>
              {t('tool.hash.resultsTitle')}
              <CopyButton
                text={formatAllHashes(textResult)}
                className='tw-link'
                label={t('tool.hash.copyAll')}
              />
            </span>
            <div className='tw-detect__fields'>
              {ALGORITHMS.map(({ name, key }) => {
                const val = textResult[key]
                return (
                  <div key={key} className='tw-detect__field'>
                    <span className='tw-detect__field-label'>{name}</span>
                    <code className='tw-detect__field-value tw-detect__field-value--mono'>
                      {val}
                    </code>
                    <CopyButton text={val} icon className='tw-detect__copy' />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          Tab 2: 文件校验和
          ========================================================================= */}
      <div hidden={tab !== 'file'} className='tw-sec'>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type='file'
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {!file ? (
          <div
            className={`tw-fileb64__drop${isDragOver ? ' tw-fileb64__drop--drag' : ''}`}
            role='button'
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={onDropKey}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Icon name='upload' size={32} className='tw-fileb64__drop-icon' />
            <strong>{t('tool.hash.dropPrimary')}</strong>
            <p>{t('tool.hash.dropSub')}</p>
          </div>
        ) : (
          <div className='tw-fileb64__file'>
            <div className='tw-fileb64__fileinfo'>
              <span className='tw-fileb64__filename'>{file.name}</span>
              <span className='tw-fileb64__meta'>
                {fmtSize(file.size)} · {file.type || 'file'}
              </span>
            </div>
            <button
              type='button'
              className='tk-btn tk-btn--sm'
              onClick={() => fileInputRef.current?.click()}
            >
              {t('tool.hash.changeFile')}
            </button>
            <button type='button' className='tk-btn tk-btn--sm' onClick={clearFile}>
              {t('common.clear')}
            </button>
          </div>
        )}

        {fileError && <StatusText kind='err'>{fileError}</StatusText>}

        {fileMd5Skipped && !fileLoading && (
          <StatusText kind='info'>
            {t('tool.hash.md5SkippedNotice', { limit: fmtSize(HASH_FILE_MD5_SKIP_BYTES) })}
          </StatusText>
        )}

        {fileLoading && (
          <StatusText kind='info'>
            <Icon name='refresh' className='tw-spin' size={14} /> {t('tool.hash.computingFile')}
          </StatusText>
        )}

        {/* 校验和比对与结果展示 */}
        {fileResult && !fileLoading && (
          <>
            <label className='tw-field'>
              <span className='tw-field__label'>
                {t('tool.hash.matcherLabel')}
                {expectedChecksum && (
                  <button
                    type='button'
                    className='tw-link'
                    onClick={() => setDraft((d) => ({ ...d, expectedChecksum: '' }))}
                  >
                    {t('common.clear')}
                  </button>
                )}
              </span>
              <input
                type='text'
                className='tw-input'
                value={expectedChecksum}
                onChange={(e) => setDraft((d) => ({ ...d, expectedChecksum: e.target.value }))}
                placeholder={t('tool.hash.matcherPlaceholder')}
                spellCheck={false}
              />
            </label>

            {expectedChecksum.trim() &&
              matchInfo &&
              (matchInfo.matched || expectedChecksum.trim().length >= 32) && (
                <StatusText kind={matchInfo.matched ? 'ok' : 'err'}>
                  {matchInfo.matched
                    ? t('tool.hash.matchSuccessDesc', { algo: matchInfo.algorithm })
                    : t('tool.hash.matchFailedDesc')}
                </StatusText>
              )}

            <div className='tw-detect__block'>
              <span className='tw-field__label'>
                {t('tool.hash.fileResultsTitle')}
                <span className='tw-field__actions'>
                  <button type='button' className='tw-link' onClick={toggleFileCase}>
                    {uppercase ? 'HEX' : 'hex'}
                  </button>
                  <CopyButton
                    text={formatAllHashes(fileResult, file?.name)}
                    className='tw-link'
                    label={t('tool.hash.copyAll')}
                  />
                </span>
              </span>

              <div className='tw-detect__fields'>
                {ALGORITHMS.map(({ name, key }) => {
                  const val = fileResult[key]
                  const skipped = key === 'md5' && fileMd5Skipped
                  const isMatched = matchInfo?.matched && matchInfo.algorithm === name

                  return (
                    <div
                      key={key}
                      className={`tw-detect__field${isMatched ? ' tw-detect__field--matched' : ''}`}
                    >
                      <span className='tw-detect__field-label'>{name}</span>
                      {skipped ? (
                        <span className='tw-detect__field-value tw-note'>
                          {t('tool.hash.md5SkippedShort')}
                        </span>
                      ) : (
                        <code className='tw-detect__field-value tw-detect__field-value--mono'>
                          {val}
                        </code>
                      )}
                      {!skipped && <CopyButton text={val} icon className='tw-detect__copy' />}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
