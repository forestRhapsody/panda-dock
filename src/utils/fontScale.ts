import { useEffect } from 'react'

import { isExtension, storageGet } from '@/utils/env'
import { HOST_ID } from '@/utils/theme'

/** 把字体缩放应用到各入口：扩展页面设到 :root，content script 设到 Shadow DOM 宿主 */
function applyFontScale(scale: number): void {
  if (typeof document === 'undefined') return
  const v = String(scale)
  // 与 applyTheme 一致：content script（有 shadow 宿主）只写宿主，绝不动页面 <html>；
  // 扩展页面（无宿主）才写 documentElement，避免把 --pd-font-scale 泄漏到宿主网页。
  const host = document.getElementById(HOST_ID)
  const setRoot = !host || !isExtension()
  if (host) host.style.setProperty('--pd-font-scale', v)
  if (setRoot) document.documentElement.style.setProperty('--pd-font-scale', v)
}

/**
 * 读取并使用「字体大小」设置（chrome.storage.sync 的 settings.fontScale）。
 * 各入口（Popup / Options / 侧边栏 / 抽屉 / 悬浮球）调用后，整体字号随设置即时缩放。
 */
export function useFontScale(): void {
  const inExt = isExtension()

  useEffect(() => {
    if (!inExt) return
    let alive = true
    const apply = (s: { fontScale?: number } | null | undefined) => {
      applyFontScale(s?.fontScale ?? 1)
    }
    void storageGet<{ fontScale?: number }>('sync', 'settings').then((s) => {
      if (alive) apply(s)
    })
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || changes.settings == null) return
      apply(changes.settings.newValue as { fontScale?: number } | undefined)
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [inExt])
}
