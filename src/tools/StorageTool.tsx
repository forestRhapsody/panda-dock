import { useCallback, useEffect, useRef, useState } from 'react'

import AutoArea from './AutoArea'
import CopyButton from './CopyButton'
import {
  clearStorageArea,
  isPageContext,
  listStorage,
  removeStorageKey,
  setStorageValue,
} from './storage'
import type { StorageArea, StorageEntry, StorageResult } from './storage'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

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

/**
 * 自定义确认弹窗（替代 window.confirm）。
 * window.confirm 在 content script（网页内抽屉，Shadow DOM）里会被 Chrome 禁用，
 * 用 React 渲染的弹窗在抽屉与侧边栏里都能可靠弹出，作为被阻止时的降级方案。
 */
function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Escape 取消 + 打开后自动聚焦确定按钮
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className='tw-modal'
      role='alertdialog'
      aria-modal='true'
      aria-label={title}
      onClick={onCancel}
    >
      <div className='tw-modal__card' onClick={(e) => e.stopPropagation()}>
        <h3 className='tw-modal__title'>{title}</h3>
        <p className='tw-modal__msg'>{message}</p>
        <div className='tw-modal__actions'>
          <button type='button' className='tw-btn' onClick={onCancel}>
            取消
          </button>
          <button
            type='button'
            ref={confirmRef}
            className='tw-btn tw-btn--primary'
            onClick={onConfirm}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

/** 本地存储管理：查看/清理当前站点 localStorage / sessionStorage */
export default function StorageTool() {
  const [area, setArea] = useState<StorageArea>('local')
  const [result, setResult] = useState<StorageResult | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [filter, setFilter] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')

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
  // 抽屉（content script）直接读本页存储、无需跟随；tabs 事件无需新增权限。
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
    setStatus({ kind: 'ok', text: `已删除 ${key}` })
    void load()
  }

  function askRemove(key: string) {
    requestConfirm({
      title: '删除缓存值',
      message: `确定删除「${key}」吗？（${area === 'local' ? 'localStorage' : 'sessionStorage'}）`,
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
    setStatus({ kind: 'ok', text: '已清空' })
    void load()
  }

  function askClearAll() {
    if (!result?.ok || result.data.entries.length === 0) return
    requestConfirm({
      title: '清空缓存',
      message: `确定清空 ${result.data.origin} 的 ${area === 'local' ? 'localStorage' : 'sessionStorage'} 吗？（共 ${result.data.totalCount} 项）`,
      onConfirm: () => void doClearAll(),
    })
  }

  // 双击进入编辑；值过长已截断时禁止编辑（避免覆盖完整数据）
  function startEdit(entry: StorageEntry) {
    if (entry.truncated) {
      setStatus({ kind: 'info', text: '值过长已截断，为保护完整数据，暂不支持编辑' })
      return
    }
    setEditingKey(entry.key)
    setDraftValue(entry.value)
  }

  function cancelEdit() {
    setEditingKey(null)
    setDraftValue('')
  }

  // 保存编辑：写回存储后刷新
  async function saveEdit() {
    if (editingKey == null) return
    const res = await setStorageValue(area, editingKey, draftValue)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return
    }
    setStatus({ kind: 'ok', text: `已更新 ${editingKey}` })
    cancelEdit()
    void load()
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

  return (
    <div className='tw-card'>
      <div className='tw-tabs' role='tablist'>
        <button
          type='button'
          role='tab'
          aria-selected={area === 'local'}
          className={`tw-tabs__btn${area === 'local' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => setArea('local')}
        >
          localStorage
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={area === 'session'}
          className={`tw-tabs__btn${area === 'session' ? ' tw-tabs__btn--on' : ''}`}
          onClick={() => setArea('session')}
        >
          sessionStorage
        </button>
      </div>

      <div className='tw-actions'>
        <button type='button' className='tw-btn tw-btn--primary' onClick={() => void load()}>
          刷新
        </button>
        <button type='button' className='tw-btn' onClick={askClearAll} disabled={empty}>
          清空全部
        </button>
      </div>

      {data && (
        <input
          type='search'
          className='tw-filter'
          placeholder='筛选：按 key 或值过滤…'
          aria-label='筛选缓存条目'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {data && (
        <p className='tw-status tw-status--info'>
          当前站点：{data.origin} · 共 {data.totalCount} 项
          {q ? `（筛选出 ${entries.length} 项）` : ''}
          {data.listTruncated ? '（过多，仅显示前 2000 项）' : ''}
          {data.area === 'session' && ' · sessionStorage 仅当前标签页会话有效'}
        </p>
      )}

      {data && data.entries.length > 0 && (
        <p className='tw-note'>双击值或点「编辑」可直接修改，保存后写回存储。</p>
      )}

      {empty && <p className='tw-note'>该区域暂无数据。</p>}
      {noMatch && <p className='tw-note'>无匹配项。</p>}

      {data && entries.length > 0 && (
        <ul className='tw-store'>
          {entries.map((entry) => (
            <li key={entry.key} className='tw-store__row'>
              <div className='tw-store__head'>
                <span className='tw-store__key' title={entry.key}>
                  {entry.key}
                </span>
                <span className='tw-store__size'>{fmtSize(entry.size)}</span>
              </div>
              {editingKey === entry.key ? (
                <div className='tw-store__edit'>
                  <AutoArea
                    className='tw-store__editval'
                    value={draftValue}
                    spellCheck={false}
                    autoFocus
                    maxHeight={240}
                    onChange={(e) => setDraftValue(e.target.value)}
                  />
                  <div className='tw-store__edit-actions'>
                    <button type='button' className='tw-link' onClick={cancelEdit}>
                      取消
                    </button>
                    <button type='button' className='tw-link' onClick={() => void saveEdit()}>
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <code
                    className='tw-store__value'
                    onDoubleClick={() => startEdit(entry)}
                    title={entry.truncated ? '值过长已截断，暂不支持编辑' : '双击编辑值'}
                  >
                    {entry.truncated
                      ? `${entry.value}…（值过长，仅展示前 8000 字符）`
                      : entry.value || '（空字符串）'}
                  </code>
                  <div className='tw-store__actions'>
                    <button
                      type='button'
                      className='tw-link'
                      disabled={entry.truncated}
                      title={entry.truncated ? '值过长已截断，暂不支持编辑' : '编辑值'}
                      onClick={() => startEdit(entry)}
                    >
                      编辑
                    </button>
                    <CopyButton
                      text={entry.value}
                      className='tw-link'
                      disabled={entry.truncated}
                      title={entry.truncated ? '值过长，已截断，禁止复制不完整内容' : '复制完整值'}
                      onResult={(ok) => {
                        if (!ok) setStatus({ kind: 'err', text: '复制失败' })
                      }}
                    />
                    <button
                      type='button'
                      className='tw-link tw-link--danger'
                      onClick={() => askRemove(entry.key)}
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {!isPageContext() && (
        <p className='tw-note'>
          当前在扩展页面中，读取的是「活动标签页」网页的存储；请先切到目标网页再刷新。
        </p>
      )}

      {status && <p className={`tw-status tw-status--${status.kind}`}>{status.text}</p>}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
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
