export type StampSource = 'secs' | 'ms' | 'text'

export interface ParsedStamp {
  date: Date
  source: StampSource
}

export interface StampRow {
  label: string
  value: string
}

export type StampResult = { ok: true; source: StampSource; rows: StampRow[] } | { ok: false }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 本地时间 YYYY-MM-DD HH:mm:ss（无时区歧义，适合直接写入数据库） */
function toLocalText(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 相对现在的时间描述 */
function toRelative(date: Date): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 5) return '刚刚'
  const map: [number, string][] = [
    [31536000, '年'],
    [2592000, '个月'],
    [86400, '天'],
    [3600, '小时'],
    [60, '分钟'],
    [1, '秒'],
  ]
  for (const [sec, label] of map) {
    if (abs >= sec) {
      const n = Math.floor(abs / sec)
      return diffSec >= 0 ? `${n} ${label}后` : `${n} ${label}前`
    }
  }
  return `${abs} 秒前`
}

/** 解析时间戳：纯数字自动判断秒/毫秒；否则尝试按日期文本解析 */
export function parseStamp(input: string): StampResult {
  const raw = input.trim()
  if (!raw) return { ok: false }

  let date: Date
  let source: StampSource

  if (/^-?\d+$/.test(raw)) {
    const num = Number(raw)
    if (raw.length <= 10) {
      date = new Date(num * 1000)
      source = 'secs'
    } else {
      date = new Date(num)
      source = 'ms'
    }
  } else {
    date = new Date(raw)
    source = 'text'
  }

  if (Number.isNaN(date.getTime())) return { ok: false }

  const secs = Math.floor(date.getTime() / 1000)
  return {
    ok: true,
    source,
    rows: [
      { label: 'Unix 秒', value: String(secs) },
      { label: 'Unix 毫秒', value: String(date.getTime()) },
      { label: 'ISO 8601', value: date.toISOString() },
      { label: '本地时间', value: toLocalText(date) },
      { label: '本地时间(可读)', value: date.toLocaleString() },
      { label: 'UTC 时间', value: date.toUTCString() },
      { label: '相对现在', value: toRelative(date) },
    ],
  }
}
