import { useCallback, useEffect, useState } from 'react'

import { useTranslation } from 'react-i18next'

import i18n from '@/i18n'
import ConfirmDialog from '@/ui/ConfirmDialog'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import JsonTextarea from './JsonTextarea'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import {
  clearStorageArea,
  isPageContext,
  listStorage,
  removeStorageKey,
  setStorageValue,
} from './storage'
import type { StorageArea, StorageEntry, StorageResult } from './storage'
import ToolTabs from './ToolTabs'

interface ConfirmState {
  title: string
  message: string
  onConfirm: () => void
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 尝试解析 JSON：用于判断存储值是否为 JSON，以及编辑时的实时校验 */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim()
  if (!t) return { ok: false, error: i18n.t('tool.storage.errorEmpty') }
  try {
    return { ok: true, value: JSON.parse(t) }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : i18n.t('tool.storage.jsonInvalid'),
    }
  }
}

/** 去除换行（保留行内空格），把多行文本紧凑为单行（用于保存非法 JSON 时去掉换行） */
function stripLineBreaks(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim()
}

/**
 * 确认弹窗复用 src/ui/ConfirmDialog.tsx（替代 window.confirm）。
 * window.confirm 在 content script（网页内抽屉，Shadow DOM）里会被 Chrome 禁用，
 * 用 React 渲染的弹窗在抽屉与侧边栏里都能可靠弹出，作为被阻止时的降级方案。
 */

interface EditorFormProps {
  draftKey: string
  draftValue: string
  /** 原值是否是 JSON（决定是否强制 JSON 编辑器与严格校验） */
  useJson: boolean
  /** 表单内联校验错误（如「请填写 Key」），显示在 Key 下方 */
  formError: string | null
  onKeyChange: (v: string) => void
  onValueChange: (v: string) => void
  onCancel: () => void
  onSave: () => void
}

/** 编辑器：key 输入 + 值编辑器 + 状态 + 格式化/压缩 + 取消/保存。编辑与新增共用。 */
function EditorForm({
  draftKey,
  draftValue,
  useJson,
  formError,
  onKeyChange,
  onValueChange,
  onCancel,
  onSave,
}: EditorFormProps) {
  const { t } = useTranslation()
  const draftJson = parseJson(draftValue)
  // 原值是 JSON 则全程 JSON 编辑器；否则当前值一旦是 JSON 也切换到 JSON 编辑器
  const showJson = useJson || draftJson.ok

  function format() {
    if (draftJson.ok) onValueChange(JSON.stringify(draftJson.value, null, 2))
  }

  function minify() {
    if (draftJson.ok) onValueChange(JSON.stringify(draftJson.value))
  }

  return (
    <div className='tw-store__edit'>
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.storage.key')}</span>
        <input
          className='tw-input'
          value={draftKey}
          spellCheck={false}
          onChange={(e) => onKeyChange(e.target.value)}
        />
      </label>
      {formError && <StatusText kind='err'>{formError}</StatusText>}
      {showJson ? (
        <JsonTextarea
          value={draftValue}
          autoFocus
          maxHeight={300}
          onChange={(e) => onValueChange(e.target.value)}
        />
      ) : (
        <AutoArea
          className='tw-store__editval'
          value={draftValue}
          spellCheck={false}
          autoFocus
          maxHeight={300}
          onChange={(e) => onValueChange(e.target.value)}
        />
      )}
      {showJson && (
        <StatusText kind={draftJson.ok ? 'ok' : 'err'}>
          {draftJson.ok
            ? t('tool.storage.jsonValid')
            : t('tool.storage.jsonInvalidDetail', { error: draftJson.error })}
        </StatusText>
      )}
      <div className='tw-store__edit-actions'>
        {showJson && (
          <>
            <button type='button' className='tw-link' disabled={!draftJson.ok} onClick={format}>
              {t('tool.storage.format')}
            </button>
            <button type='button' className='tw-link' disabled={!draftJson.ok} onClick={minify}>
              {t('tool.storage.minify')}
            </button>
          </>
        )}
        <button type='button' className='tw-link' onClick={onCancel}>
          {t('tool.storage.cancel')}
        </button>
        <button type='button' className='tw-link' onClick={onSave}>
          {t('tool.storage.save')}
        </button>
      </div>
    </div>
  )
}

/** 本地存储管理：查看/清理当前站点 localStorage / sessionStorage；支持改 key 与新增缓存 */
export default function StorageTool() {
  const { t } = useTranslation()
  const [area, setArea] = useState<StorageArea>('local')
  const [result, setResult] = useState<StorageResult | null>(null)
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [filter, setFilter] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [editIsJson, setEditIsJson] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /** 高优先级：自定义弹窗；仅极端情况（自定义弹窗无法渲染）下降级到 window.confirm */
  function requestConfirm(opts: ConfirmState): void {
    try {
      setConfirm(opts)
      return
    } catch {
      // 自定义弹窗不可用时，退回浏览器原生 confirm（侧边栏可用；content script 里会被禁）
    }
    try {
      if (window.confirm(opts.message)) opts.onConfirm()
    } catch {
      // 忽略
    }
  }

  const load = useCallback(async () => {
    setStatus(null)
    const res = await listStorage(area)
    setResult(res)
    if (!res.ok) setStatus({ kind: 'err', text: res.error })
  }, [area])

  useEffect(() => {
    void load()
  }, [load])

  // 扩展页面（侧边栏等）下：跟随活动标签页 —— 切换 tab 时自动重读该站存储。
  useEffect(() => {
    if (typeof chrome === 'undefined' || isPageContext()) return
    const reload = () => void load()
    chrome.tabs.onActivated.addListener(reload)
    return () => chrome.tabs.onActivated.removeListener(reload)
  }, [load])

  // 删除单个 key（先弹自定义确认框，避免误删）
  async function doRemove(key: string) {
    const res = await removeStorageKey(area, key)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return
    }
    setStatus({ kind: 'ok', text: t('tool.storage.deleted', { key }) })
    void load()
  }

  function askRemove(key: string) {
    requestConfirm({
      title: t('tool.storage.deleteTitle'),
      message: t('tool.storage.deleteMessage', {
        key,
        area: area === 'local' ? 'localStorage' : 'sessionStorage',
      }),
      onConfirm: () => void doRemove(key),
    })
  }

  // 清空整区（先弹自定义确认框）
  async function doClearAll() {
    const res = await clearStorageArea(area)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return
    }
    setStatus({ kind: 'ok', text: t('tool.storage.cleared') })
    void load()
  }

  function askClearAll() {
    if (!result?.ok || result.data.entries.length === 0) return
    requestConfirm({
      title: t('tool.storage.clearTitle'),
      message: t('tool.storage.clearMessage', {
        origin: result.data.origin,
        area: area === 'local' ? 'localStorage' : 'sessionStorage',
        count: result.data.totalCount,
      }),
      onConfirm: () => void doClearAll(),
    })
  }

  // 进入编辑（可同时改 key）；值过长已截断时禁止编辑
  function startEdit(entry: StorageEntry) {
    if (entry.truncated) {
      setStatus({ kind: 'info', text: t('tool.storage.truncatedNoEdit') })
      return
    }
    const parsed = parseJson(entry.value)
    setCreating(false)
    setEditingKey(entry.key)
    setDraftKey(entry.key)
    setEditIsJson(parsed.ok)
    setDraftValue(parsed.ok ? JSON.stringify(parsed.value, null, 2) : entry.value)
    setFormError(null)
  }

  // 进入新增
  function startCreate() {
    setEditingKey(null)
    setCreating(true)
    setDraftKey('')
    setDraftValue('')
    setEditIsJson(false)
    setFormError(null)
  }

  function closeEditor() {
    setEditingKey(null)
    setCreating(false)
    setDraftKey('')
    setDraftValue('')
    setEditIsJson(false)
    setFormError(null)
  }

  async function persist(key: string, value: string): Promise<boolean> {
    const res = await setStorageValue(area, key, value)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return false
    }
    return true
  }

  // 保存：编辑（含改名）/ 新增
  async function commitEntry(key: string, value: string) {
    if (editingKey != null) {
      if (key === editingKey) {
        if (!(await persist(editingKey, value))) return
      } else {
        // 重命名：写新 key + 删旧 key
        if (!(await persist(key, value))) return
        const rm = await removeStorageKey(area, editingKey)
        if (!rm.ok) {
          setStatus({ kind: 'err', text: rm.error })
          return
        }
      }
      setStatus({ kind: 'ok', text: t('tool.storage.updated', { key }) })
    } else {
      if (!(await persist(key, value))) return
      setStatus({ kind: 'ok', text: t('tool.storage.added', { key }) })
    }
    closeEditor()
    void load()
  }

  // 保存：合法 JSON 压缩；非法 JSON（且原值为 JSON）弹窗确认后去换行；其余按原文
  function saveEntry() {
    const key = draftKey.trim()
    if (!key) {
      setFormError(t('tool.storage.errorKeyRequired'))
      return
    }
    const parsed = parseJson(draftValue)
    if (parsed.ok) {
      void commitEntry(key, JSON.stringify(parsed.value))
      return
    }
    if (editIsJson) {
      requestConfirm({
        title: t('tool.storage.jsonInvalid'),
        message: t('tool.storage.invalidJsonSaveMessage'),
        onConfirm: () => void commitEntry(key, stripLineBreaks(draftValue)),
      })
      return
    }
    void commitEntry(key, draftValue)
  }

  const data = result?.ok ? result.data : null
  const empty = data != null && data.entries.length === 0
  const q = filter.trim().toLowerCase()
  const entries = data
    ? data.entries.filter(
        (e) => !q || e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q),
      )
    : []
  const noMatch = data != null && data.entries.length > 0 && entries.length === 0

  const editorOpen = creating || editingKey != null
  const editorProps = {
    draftKey,
    draftValue,
    useJson: editIsJson,
    formError,
    onKeyChange: (v: string) => {
      setDraftKey(v)
      setFormError(null)
    },
    onValueChange: (v: string) => {
      setDraftValue(v)
      setFormError(null)
    },
    onCancel: closeEditor,
    onSave: saveEntry,
  }

  return (
    <div className='tw-card'>
      <ToolTabs<StorageArea>
        value={area}
        onChange={setArea}
        items={[
          { id: 'local', label: 'localStorage' },
          { id: 'session', label: 'sessionStorage' },
        ]}
      />

      <div className='tw-actions'>
        <button type='button' className='tk-btn tk-btn--primary' onClick={() => void load()}>
          {t('tool.storage.refresh')}
        </button>
        <button type='button' className='tk-btn' onClick={startCreate} disabled={editorOpen}>
          {t('tool.storage.add')}
        </button>
        <button type='button' className='tk-btn' onClick={askClearAll} disabled={empty}>
          {t('tool.storage.clearAll')}
        </button>
      </div>

      {data && (
        <input
          type='search'
          className='tw-input'
          placeholder={t('tool.storage.filter')}
          aria-label={t('tool.storage.filterAriaLabel')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {data && (
        <StatusText kind='info'>
          {t('tool.storage.statusSummary', { origin: data.origin, count: data.totalCount })}
          {q ? t('tool.storage.statusFiltered', { count: entries.length }) : ''}
          {data.listTruncated ? t('tool.storage.statusTruncated') : ''}
          {data.area === 'session' && ` · ${t('tool.storage.statusSessionNote')}`}
        </StatusText>
      )}

      {creating && <EditorForm {...editorProps} />}

      {empty && <p className='tw-note'>{t('tool.storage.empty')}</p>}
      {noMatch && <p className='tw-note'>{t('tool.storage.noMatch')}</p>}

      {data && entries.length > 0 && (
        <ul className='tw-store'>
          {entries.map((entry) => (
            <li
              key={entry.key}
              className={`tw-store__row${editingKey === entry.key ? ' tw-store__row--editing' : ''}`}
            >
              {editingKey === entry.key ? (
                <EditorForm {...editorProps} />
              ) : (
                <>
                  <div className='tw-store__head'>
                    <span className='tw-store__key' title={entry.key}>
                      {entry.key}
                    </span>
                    <span className='tw-store__size'>{fmtSize(entry.size)}</span>
                  </div>
                  <code
                    className='tw-store__value'
                    onDoubleClick={() => startEdit(entry)}
                    title={
                      entry.truncated
                        ? t('tool.storage.truncatedShort')
                        : t('tool.storage.dblClickEdit')
                    }
                  >
                    {entry.truncated
                      ? t('tool.storage.truncatedPreview', { value: entry.value })
                      : entry.value || t('tool.storage.emptyString')}
                  </code>
                  <div className='tw-store__actions'>
                    <button
                      type='button'
                      className='tw-link'
                      disabled={entry.truncated}
                      title={
                        entry.truncated
                          ? t('tool.storage.truncatedShort')
                          : t('tool.storage.editValue')
                      }
                      onClick={() => startEdit(entry)}
                    >
                      {t('tool.storage.edit')}
                    </button>
                    <CopyButton
                      text={entry.value}
                      className='tw-link'
                      disabled={entry.truncated}
                      title={
                        entry.truncated
                          ? t('tool.storage.truncatedNoCopy')
                          : t('tool.storage.copyFullValue')
                      }
                      onResult={(ok) => {
                        if (!ok) setStatus({ kind: 'err', text: t('tool.storage.copyFailed') })
                      }}
                    />
                    <button
                      type='button'
                      className='tw-link tw-link--danger'
                      onClick={() => askRemove(entry.key)}
                    >
                      {t('tool.storage.delete')}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isPageContext() && <p className='tw-note'>{t('tool.storage.extPageNote')}</p>}

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={t('tool.storage.confirm')}
          cancelLabel={t('tool.storage.cancel')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.onConfirm()
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}
