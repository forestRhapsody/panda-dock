export interface JsonResult {
  ok: boolean
  text?: string
  error?: string
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** JSON 格式化（默认 2 空格缩进） */
export function formatJson(raw: string, indent = 2): JsonResult {
  try {
    const value: unknown = JSON.parse(raw)
    return { ok: true, text: JSON.stringify(value, null, indent) }
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${errorText(e)}` }
  }
}

/** JSON 压缩为单行 */
export function minifyJson(raw: string): JsonResult {
  try {
    const value: unknown = JSON.parse(raw)
    return { ok: true, text: JSON.stringify(value) }
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${errorText(e)}` }
  }
}
