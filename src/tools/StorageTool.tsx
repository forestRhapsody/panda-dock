import { useCallback, useEffect, useRef, useState } from 'react'

import { useTranslation } from 'react-i18next'

import i18n from '@/i18n'
import ConfirmDialog from '@/ui/ConfirmDialog'
import Icon from '@/ui/Icon'
import { toast } from '@/ui/toast'
import Tooltip from '@/ui/Tooltip'
import { useToolDraft } from '@/utils/draft'

import AutoArea from './AutoArea'
import CookieEditModal from './CookieEditModal'
import CopyButton from './CopyButton'
import JsonTextarea from './JsonTextarea'
import { StatusText } from './StatusText'
import type { ToolStatus } from './StatusText'
import {
  bareCookieDomain,
  clearAllCookies,
  clearStorageArea,
  isPageContext,
  listCookies,
  listStorage,
  removeCookie,
  removeStorageKey,
  setStorageValue,
} from './storage'
import type {
  CookieEntry,
  CookieResult,
  StorageArea,
  StorageEntry,
  StorageResult,
  WebStorageArea,
} from './storage'
import ToolTabs from './ToolTabs'

function formatSameSite(sameSite: string): string {
  if (sameSite === 'no_restriction') return 'None'
  if (sameSite === 'lax') return 'Lax'
  if (sameSite === 'strict') return 'Strict'
  return sameSite
}

interface ConfirmState {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
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
  /** 是否为新增条目（新增时默认聚焦到 key 输入框，编辑已存条目时默认聚焦到值输入框） */
  isNew?: boolean
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
  isNew = false,
  onKeyChange,
  onValueChange,
  onCancel,
  onSave,
}: EditorFormProps) {
  const { t } = useTranslation()
  const keyInputRef = useRef<HTMLInputElement>(null)
  const draftJson = parseJson(draftValue)
  // 原值是 JSON 则全程 JSON 编辑器；否则当前值一旦是 JSON 也切换到 JSON 编辑器
  const showJson = useJson || draftJson.ok

  useEffect(() => {
    if (isNew) {
      keyInputRef.current?.focus()
    }
  }, [isNew])

  function format() {
    if (draftJson.ok) onValueChange(JSON.stringify(draftJson.value, null, 2))
  }

  function minify() {
    if (draftJson.ok) onValueChange(JSON.stringify(draftJson.value))
  }

  return (
    <div
      className='tw-store__edit'
      // 声明「本子树接管 Escape」：抽屉的关闭守卫据此让行（见 content/Drawer.tsx）。
      // Escape = 取消编辑，与「取消」按钮同义（丢弃草稿，不写存储）。
      data-pd-escape
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onCancel()
      }}
    >
      <label className='tw-field'>
        <span className='tw-field__label'>{t('tool.storage.key')}</span>
        <input
          ref={keyInputRef}
          className='tw-input'
          value={draftKey}
          spellCheck={false}
          autoFocus={isNew}
          onChange={(e) => onKeyChange(e.target.value)}
        />
      </label>
      {formError && (
        <div className='tw-store__status-bar tw-store__status-bar--err'>
          <Icon name='alert' size={12} className='tw-store__status-icon' />
          <span>{formError}</span>
        </div>
      )}
      {showJson ? (
        <JsonTextarea
          value={draftValue}
          autoFocus={!isNew}
          maxHeight={300}
          onChange={(e) => onValueChange(e.target.value)}
        />
      ) : (
        <AutoArea
          className='tw-store__editval'
          value={draftValue}
          spellCheck={false}
          autoFocus={!isNew}
          maxHeight={300}
          onChange={(e) => onValueChange(e.target.value)}
        />
      )}
      {showJson && (
        <div
          className={`tw-store__status-bar ${
            draftJson.ok ? 'tw-store__status-bar--ok' : 'tw-store__status-bar--err'
          }`}
        >
          <Icon
            name={draftJson.ok ? 'check' : 'alert'}
            size={12}
            className='tw-store__status-icon'
          />
          <span>
            {draftJson.ok
              ? t('tool.storage.jsonValid')
              : t('tool.storage.jsonInvalidDetail', { error: draftJson.error })}
          </span>
        </div>
      )}
      <div className='tw-store__edit-actions'>
        {showJson && (
          <div className='tw-store__edit-tools'>
            <button
              type='button'
              className='tw-store__text-btn'
              disabled={!draftJson.ok}
              onClick={format}
            >
              {t('tool.storage.format')}
            </button>
            <button
              type='button'
              className='tw-store__text-btn'
              disabled={!draftJson.ok}
              onClick={minify}
            >
              {t('tool.storage.minify')}
            </button>
          </div>
        )}
        <div className='tw-store__edit-btns'>
          <button type='button' className='tw-store__ghost-btn' onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type='button' className='tw-store__save-btn' onClick={onSave}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 本地存储管理：查看/清理当前站点 localStorage / sessionStorage；支持改 key 与新增缓存 */
export default function StorageTool() {
  const { t } = useTranslation()
  // 区域 tab 跨挂载保留：切到别的工具再回来不会跳回 localStorage。
  // 草稿不做校验（AGENTS §5），脏值一律回落到 local。
  const [areaDraft, setArea] = useToolDraft<string>('storage.area', 'local')
  const area: StorageArea = areaDraft === 'session' || areaDraft === 'cookie' ? areaDraft : 'local'
  const [result, setResult] = useState<StorageResult | null>(null)
  const [cookieResult, setCookieResult] = useState<CookieResult | null>(null)
  const [cookieModalOpen, setCookieModalOpen] = useState(false)
  const [editingCookie, setEditingCookie] = useState<CookieEntry | null>(null)
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [filter, setFilter] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [editIsJson, setEditIsJson] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  /**
   * 破坏性操作一律走自定义 ConfirmDialog。
   * 这里**不再**降级到 window.confirm：它在 content script（网页内抽屉）里被 Chrome 禁用，
   * 而且 AGENTS §4 第 14 条统一要求走 ConfirmDialog（setState 本身不会抛错，旧 catch 分支也不可达）。
   */
  function requestConfirm(opts: ConfirmState): void {
    setConfirm(opts)
  }

  const load = useCallback(async () => {
    setStatus(null)
    if (area === 'cookie') {
      const res = await listCookies()
      setCookieResult(res)
      if (!res.ok) setStatus({ kind: 'err', text: res.error })
    } else {
      const res = await listStorage(area)
      setResult(res)
      if (!res.ok) setStatus({ kind: 'err', text: res.error })
    }
  }, [area])

  /** 手动点击刷新：图标旋转平滑过渡，杜绝闪烁 */
  async function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    const MIN_REFRESH_DURATION_MS = 500
    const timerPromise = new Promise((resolve) => setTimeout(resolve, MIN_REFRESH_DURATION_MS))
    try {
      if (area === 'cookie') {
        const [res] = await Promise.all([listCookies(), timerPromise])
        setCookieResult(res)
        if (res.ok) {
          setStatus(null)
        } else {
          setStatus({ kind: 'err', text: res.error })
          toast.error(res.error)
        }
      } else {
        const [res] = await Promise.all([listStorage(area), timerPromise])
        setResult(res)
        if (res.ok) {
          setStatus(null)
        } else {
          setStatus({ kind: 'err', text: res.error })
          toast.error(res.error)
        }
      }
    } finally {
      setRefreshing(false)
    }
  }

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
    if (area === 'cookie') return
    const res = await removeStorageKey(area as WebStorageArea, key)
    if (!res.ok) {
      toast.error(res.error)
      setStatus({ kind: 'err', text: res.error })
      return
    }
    toast.success(t('tool.storage.deleted', { key }))
    setStatus(null)
    void load()
  }

  function askRemove(key: string) {
    requestConfirm({
      title: t('tool.storage.deleteTitle'),
      message: t('tool.storage.deleteMessage', {
        key,
        area: area === 'local' ? 'localStorage' : 'sessionStorage',
      }),
      confirmLabel: t('tool.storage.delete'),
      danger: true,
      onConfirm: () => void doRemove(key),
    })
  }

  // 清空整区（先弹自定义确认框）
  async function doClearAll() {
    if (area === 'cookie') return
    const res = await clearStorageArea(area as WebStorageArea)
    if (!res.ok) {
      toast.error(res.error)
      setStatus({ kind: 'err', text: res.error })
      return
    }
    toast.success(t('tool.storage.cleared'))
    setStatus(null)
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
      confirmLabel: t('tool.storage.clearAll'),
      danger: true,
      onConfirm: () => void doClearAll(),
    })
  }

  // 删除单个 Cookie（弹自定义确认框）
  async function doRemoveCookie(cookie: CookieEntry) {
    if (!cookieResult?.ok) return
    const res = await removeCookie(cookie, cookieResult.data.url)
    if (!res.ok) {
      toast.error(res.error)
      setStatus({ kind: 'err', text: res.error })
      return
    }
    toast.success(t('tool.storage.cookieDeleted', { name: cookie.name }))
    setStatus(null)
    void load()
  }

  function askRemoveCookie(cookie: CookieEntry) {
    requestConfirm({
      title: t('tool.storage.cookieDeleteTitle'),
      message: t('tool.storage.cookieDeleteMessage', { name: cookie.name }),
      confirmLabel: t('tool.storage.delete'),
      danger: true,
      onConfirm: () => void doRemoveCookie(cookie),
    })
  }

  // 清空当前网页所有 Cookie（弹自定义确认框）
  async function doClearAllCookies() {
    if (!cookieResult?.ok) return
    const res = await clearAllCookies(cookieResult.data.url)
    if (!res.ok) {
      toast.error(res.error)
      setStatus({ kind: 'err', text: res.error })
      return
    }
    toast.success(t('tool.storage.cookieCleared'))
    setStatus(null)
    void load()
  }

  function askClearAllCookies() {
    if (!cookieResult?.ok || cookieResult.data.cookies.length === 0) return
    requestConfirm({
      title: t('tool.storage.cookieClearTitle'),
      message: t('tool.storage.cookieClearMessage', {
        origin: cookieResult.data.origin,
        count: cookieResult.data.totalCount,
      }),
      confirmLabel: t('tool.storage.clearAll'),
      danger: true,
      onConfirm: () => void doClearAllCookies(),
    })
  }

  function handleCookieSaved(count: number) {
    toast.success(
      count > 1 ? t('tool.storage.cookieSavedBatch', { count }) : t('tool.storage.cookieSaved'),
    )
    void load()
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
    if (area === 'cookie') return false
    const res = await setStorageValue(area as WebStorageArea, key, value)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return false
    }
    return true
  }

  // 保存：编辑（含改名）/ 新增
  async function commitEntry(key: string, value: string) {
    if (area === 'cookie') return
    if (editingKey != null) {
      if (key === editingKey) {
        if (!(await persist(editingKey, value))) return
      } else {
        // 重命名：写新 key + 删旧 key
        if (!(await persist(key, value))) return
        const rm = await removeStorageKey(area as WebStorageArea, editingKey)
        if (!rm.ok) {
          toast.error(rm.error)
          setStatus({ kind: 'err', text: rm.error })
          return
        }
      }
      toast.success(t('tool.storage.updated', { key }))
    } else {
      if (!(await persist(key, value))) return
      toast.success(t('tool.storage.added', { key }))
    }
    setStatus(null)
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

  const data = area !== 'cookie' && result?.ok ? result.data : null
  const empty = data != null && data.entries.length === 0
  const q = filter.trim().toLowerCase()
  const entries = data
    ? data.entries.filter(
        (e) => !q || e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q),
      )
    : []
  const noMatch = data != null && data.entries.length > 0 && entries.length === 0

  const cookieData = area === 'cookie' && cookieResult?.ok ? cookieResult.data : null
  const cookieEmpty = cookieData != null && cookieData.cookies.length === 0
  const cookieEntries = cookieData
    ? cookieData.cookies.filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.value.toLowerCase().includes(q) ||
          c.domain.toLowerCase().includes(q),
      )
    : []
  const cookieNoMatch =
    cookieData != null && cookieData.cookies.length > 0 && cookieEntries.length === 0

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
        onChange={(a) => {
          setArea(a)
          setEditingKey(null)
          setCreating(false)
        }}
        items={[
          { id: 'local', label: t('tool.storage.areaLocal') },
          { id: 'session', label: t('tool.storage.areaSession') },
          { id: 'cookie', label: t('tool.storage.areaCookie') },
        ]}
      />

      <div className='tw-actions'>
        <button
          type='button'
          className='pd-btn pd-btn--primary'
          onClick={() => void handleRefresh()}
          disabled={refreshing}
        >
          <Icon name='refresh' size={14} className={refreshing ? 'tw-spin' : undefined} />
          {t('tool.storage.refresh')}
        </button>
        <button
          type='button'
          className='pd-btn'
          onClick={
            area === 'cookie'
              ? () => {
                  setEditingCookie(null)
                  setCookieModalOpen(true)
                }
              : startCreate
          }
          disabled={area !== 'cookie' && editorOpen}
        >
          <Icon name='plus' size={13} />
          {t('tool.storage.add')}
        </button>
        <button
          type='button'
          className='pd-btn'
          onClick={area === 'cookie' ? askClearAllCookies : askClearAll}
          disabled={area === 'cookie' ? cookieEmpty : empty}
        >
          {t('tool.storage.clearAll')}
        </button>
      </div>

      {status && <StatusText kind={status.kind}>{status.text}</StatusText>}

      {((area !== 'cookie' && data && (data.entries.length > 0 || filter)) ||
        (area === 'cookie' && cookieData && (cookieData.cookies.length > 0 || filter))) && (
        <div className='tw-store__search'>
          <Icon name='search' size={14} className='tw-store__search-icon' />
          <input
            type='text'
            className='tw-input tw-store__search-input'
            placeholder={t('tool.storage.filter')}
            aria-label={t('tool.storage.filterAriaLabel')}
            value={filter}
            // 只有存在筛选词时才声明接管 Escape：空筛选时若也接管，
            // 焦点停在搜索框上会让抽屉再也无法用 Escape 关闭。
            data-pd-escape={filter ? true : undefined}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setFilter('')
              }
            }}
          />
          {filter && (
            <Tooltip content={t('tool.storage.clearFilter')}>
              <button
                type='button'
                className='tw-store__search-clear'
                onClick={() => setFilter('')}
                aria-label={t('tool.storage.clearFilter')}
              >
                <Icon name='close' size={12} />
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {area !== 'cookie' && data && (
        <StatusText kind='info' className='tw-store__summary'>
          {t('tool.storage.statusSummary', { origin: data.origin, count: data.totalCount })}
          {q ? t('tool.storage.statusFiltered', { count: entries.length }) : ''}
          {data.listTruncated ? t('tool.storage.statusTruncated') : ''}
          {data.area === 'session' && ` · ${t('tool.storage.statusSessionNote')}`}
        </StatusText>
      )}

      {area === 'cookie' && cookieData && (
        <StatusText kind='info' className='tw-store__summary'>
          {t('tool.storage.statusSummary', {
            origin: cookieData.origin,
            count: cookieData.totalCount,
          })}
          {q ? t('tool.storage.statusFiltered', { count: cookieEntries.length }) : ''}
        </StatusText>
      )}

      {creating && area !== 'cookie' && (
        <div className='tw-store__row tw-store__row--editing tw-store__row--creating'>
          <EditorForm {...editorProps} isNew />
        </div>
      )}

      {area !== 'cookie' && empty && <p className='tw-note'>{t('tool.storage.empty')}</p>}
      {area === 'cookie' && cookieEmpty && (
        <p className='tw-note'>{t('tool.storage.cookieEmpty')}</p>
      )}
      {((area !== 'cookie' && noMatch) || (area === 'cookie' && cookieNoMatch)) && (
        <div className='tw-store__nomatch'>
          <p className='tw-note'>{t('tool.storage.noMatch')}</p>
          <button type='button' className='tw-link' onClick={() => setFilter('')}>
            {t('tool.storage.clearFilter')}
          </button>
        </div>
      )}

      {area !== 'cookie' && data && entries.length > 0 && (
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
                    <Tooltip content={entry.key}>
                      <span className='tw-store__key'>{entry.key}</span>
                    </Tooltip>
                    <span className='tw-store__size'>{fmtSize(entry.size)}</span>
                  </div>
                  <Tooltip
                    content={
                      entry.truncated
                        ? t('tool.storage.truncatedShort')
                        : t('tool.storage.dblClickEdit')
                    }
                  >
                    <code className='tw-store__value' onDoubleClick={() => startEdit(entry)}>
                      {entry.truncated
                        ? t('tool.storage.truncatedPreview', { value: entry.value })
                        : entry.value || t('tool.storage.emptyString')}
                    </code>
                  </Tooltip>
                  <div className='tw-store__actions'>
                    <Tooltip
                      content={
                        entry.truncated
                          ? t('tool.storage.truncatedShort')
                          : t('tool.storage.editValue')
                      }
                    >
                      <button
                        type='button'
                        className='tw-link'
                        disabled={entry.truncated}
                        onClick={() => startEdit(entry)}
                      >
                        {t('tool.storage.edit')}
                      </button>
                    </Tooltip>
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
                        if (!ok) {
                          toast.error(t('common.copyFailed'))
                          setStatus({ kind: 'err', text: t('common.copyFailed') })
                        }
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

      {area === 'cookie' && cookieData && cookieEntries.length > 0 && (
        <ul className='tw-store'>
          {cookieEntries.map((cookie) => {
            const cookieId = `${cookie.domain}:${cookie.path}:${cookie.name}`
            return (
              <li key={cookieId} className='tw-store__row'>
                <div className='tw-store__head'>
                  <div className='tw-cookie__meta-head'>
                    <Tooltip content={cookie.name}>
                      <span className='tw-store__key'>{cookie.name}</span>
                    </Tooltip>
                    <div className='tw-cookie__badges'>
                      {cookie.httpOnly && <span className='tw-cookie__badge'>HttpOnly</span>}
                      {cookie.secure && <span className='tw-cookie__badge'>Secure</span>}
                      {cookie.sameSite && cookie.sameSite !== 'unspecified' && (
                        <span className='tw-cookie__badge'>{formatSameSite(cookie.sameSite)}</span>
                      )}
                      {cookie.session && (
                        <span className='tw-cookie__badge'>{t('tool.storage.cookieSession')}</span>
                      )}
                      {cookie.hostOnly === false && (
                        <span className='tw-cookie__badge'>
                          {t('tool.storage.cookieSubdomains')}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className='tw-store__size'>{fmtSize(cookie.size)}</span>
                </div>
                <Tooltip content={t('tool.storage.dblClickEdit')}>
                  <code
                    className='tw-store__value'
                    onDoubleClick={() => {
                      setEditingCookie(cookie)
                      setCookieModalOpen(true)
                    }}
                  >
                    {cookie.value || t('tool.storage.emptyString')}
                  </code>
                </Tooltip>
                {/* 元数据默认常显：HttpOnly / Secure / SameSite / 会话 已由上方徽章呈现，此处只补徽章未覆盖的字段 */}
                <div className='tw-cookie__details'>
                  <div className='tw-cookie__detail-row'>
                    <span className='tw-cookie__detail-label'>
                      {t('tool.storage.cookieDomain')}
                    </span>
                    <span className='tw-cookie__detail-value'>
                      {bareCookieDomain(cookie.domain)}
                    </span>
                  </div>
                  <div className='tw-cookie__detail-row'>
                    <span className='tw-cookie__detail-label'>{t('tool.storage.cookiePath')}</span>
                    <span className='tw-cookie__detail-value'>{cookie.path}</span>
                  </div>
                  <div className='tw-cookie__detail-row'>
                    <span className='tw-cookie__detail-label'>
                      {t('tool.storage.cookieExpires')}
                    </span>
                    <span className='tw-cookie__detail-value'>
                      {cookie.session || !cookie.expirationDate
                        ? t('tool.storage.cookieSession')
                        : new Date(cookie.expirationDate * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className='tw-store__actions'>
                  <button
                    type='button'
                    className='tw-link'
                    onClick={() => {
                      setEditingCookie(cookie)
                      setCookieModalOpen(true)
                    }}
                  >
                    {t('tool.storage.edit')}
                  </button>
                  <CopyButton
                    text={cookie.value}
                    className='tw-link'
                    title={t('tool.storage.copyFullValue')}
                    onResult={(ok) => {
                      if (!ok) {
                        toast.error(t('common.copyFailed'))
                        setStatus({ kind: 'err', text: t('common.copyFailed') })
                      }
                    }}
                  />
                  <button
                    type='button'
                    className='tw-link tw-link--danger'
                    onClick={() => askRemoveCookie(cookie)}
                  >
                    {t('tool.storage.delete')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!isPageContext() && <p className='tw-note'>{t('tool.storage.extPageNote')}</p>}

      {cookieModalOpen && (
        <CookieEditModal
          open={cookieModalOpen}
          cookie={editingCookie}
          pageUrl={
            cookieResult?.ok
              ? cookieResult.data.url
              : isPageContext()
                ? window.location.href
                : 'https://example.com'
          }
          onClose={() => setCookieModalOpen(false)}
          onSaved={handleCookieSaved}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel ?? t('common.confirm')}
          cancelLabel={t('common.cancel')}
          danger={confirm.danger ?? false}
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
