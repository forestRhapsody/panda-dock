import i18n from '@/i18n'

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
  if (abs < 5) return i18n.t('tool.timestamp.justNow')
  const map: [number, string][] = [
    [31536000, 'unitYear'],
    [2592000, 'unitMonth'],
    [86400, 'unitDay'],
    [3600, 'unitHour'],
    [60, 'unitMinute'],
    [1, 'unitSecond'],
  ]
  for (const [sec, unitKey] of map) {
    if (abs >= sec) {
      const n = Math.floor(abs / sec)
      const unit = i18n.t(`tool.timestamp.${unitKey}`)
      return diffSec >= 0
        ? i18n.t('tool.timestamp.relativeFuture', { count: n, unit })
        : i18n.t('tool.timestamp.relativePast', { count: n, unit })
    }
  }
  return i18n.t('tool.timestamp.relativePast', {
    count: abs,
    unit: i18n.t('tool.timestamp.unitSecond'),
  })
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
      { label: i18n.t('tool.timestamp.unixSeconds'), value: String(secs) },
      { label: i18n.t('tool.timestamp.unixMilliseconds'), value: String(date.getTime()) },
      { label: 'ISO 8601', value: date.toISOString() },
      { label: i18n.t('tool.timestamp.localTime'), value: toLocalText(date) },
      { label: i18n.t('tool.timestamp.localTimeReadable'), value: date.toLocaleString() },
      { label: i18n.t('tool.timestamp.utcTime'), value: date.toUTCString() },
      { label: i18n.t('tool.timestamp.relativeNow'), value: toRelative(date) },
    ],
  }
}
