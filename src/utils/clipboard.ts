/** 复制文本：优先 Clipboard API，非安全上下文降级 execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走降级方案
  }
  let ta: HTMLTextAreaElement | null = null
  try {
    ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    // execCommand 抛错时也必须移除，否则临时节点会永久残留在宿主页 DOM 里
    ta?.remove()
  }
}
