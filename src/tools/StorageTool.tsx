import { useCallback, useEffect, useState } from 'react'

import { copyText } from '@/utils/clipboard'

import { clearStorageArea, isPageContext, listStorage, removeStorageKey } from './storage'
import type { StorageArea, StorageResult } from './storage'

interface Status {
  kind: 'ok' | 'err' | 'info'
  text: string
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 本地存储管理：查看/清理当前站点 localStorage / sessionStorage */
export default function StorageTool() {
  const [area, setArea] = useState<StorageArea>('local')
  const [result, setResult] = useState<StorageResult | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  const load = useCallback(async () => {
    setStatus(null)
    const res = await listStorage(area)
    setResult(res)
    if (!res.ok) setStatus({ kind: 'err', text: res.error })
  }, [area])

  useEffect(() => {
    void load()
  }, [load])

  // 删除单个 key
  async function remove(key: string) {
    const res = await removeStorageKey(area, key)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return
    }
    setStatus({ kind: 'ok', text: `已删除 ${key}` })
    void load()
  }

  // 清空整区
  async function clearAll() {
    if (!result?.ok || result.data.entries.length === 0) return
    const ok = window.confirm(
      `确定清空 ${result.data.origin} 的 ${area === 'local' ? 'localStorage' : 'sessionStorage'} 吗？（共 ${result.data.totalCount} 项）`,
    )
    if (!ok) return
    const res = await clearStorageArea(area)
    if (!res.ok) {
      setStatus({ kind: 'err', text: res.error })
      return
    }
    setStatus({ kind: 'ok', text: '已清空' })
    void load()
  }

  async function copyValue(value: string) {
    const ok = await copyText(value)
    setStatus({ kind: ok ? 'ok' : 'err', text: ok ? '值已复制' : '复制失败' })
  }

  const data = result?.ok ? result.data : null
  const empty = data != null && data.entries.length === 0

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
        <button type='button' className='tw-btn' onClick={() => void clearAll()} disabled={empty}>
          清空全部
        </button>
      </div>

      {data && (
        <p className='tw-status tw-status--info'>
          ℹ 当前站点：{data.origin} · 共 {data.totalCount} 项
          {data.listTruncated ? '（过多，仅显示前 2000 项）' : ''}
          {data.area === 'session' && ' · sessionStorage 仅当前标签页会话有效'}
        </p>
      )}

      {empty && <p className='tw-note'>该区域暂无数据。</p>}

      {data && data.entries.length > 0 && (
        <ul className='tw-store'>
          {data.entries.map((entry) => (
            <li key={entry.key} className='tw-store__row'>
              <div className='tw-store__head'>
                <span className='tw-store__key' title={entry.key}>
                  {entry.key}
                </span>
                <span className='tw-store__size'>{fmtSize(entry.size)}</span>
              </div>
              <code className='tw-store__value'>
                {entry.truncated
                  ? `${entry.value}…（值过长，仅展示前 8000 字符）`
                  : entry.value || '（空字符串）'}
              </code>
              <div className='tw-store__actions'>
                <button
                  type='button'
                  className='tw-link'
                  disabled={entry.truncated}
                  title={entry.truncated ? '值过长，已截断，禁止复制不完整内容' : '复制完整值'}
                  onClick={() => void copyValue(entry.value)}
                >
                  复制值
                </button>
                <button
                  type='button'
                  className='tw-link tw-link--danger'
                  onClick={() => void remove(entry.key)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!isPageContext() && (
        <p className='tw-note'>
          当前在扩展页面中，读取的是「活动标签页」网页的存储；请先切到目标网页再刷新。
        </p>
      )}

      {status && (
        <p className={`tw-status tw-status--${status.kind}`}>
          {status.kind === 'ok' ? '✓ ' : status.kind === 'err' ? '✕ ' : 'ℹ '}
          {status.text}
        </p>
      )}
    </div>
  )
}
