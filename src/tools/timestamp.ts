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
export function toLocalText(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 相对现在的时间描述 */
export function toRelative(date: Date): string {
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

const VALID_DATE_WORDS = new Set([
  'mon',
  'monday',
  'tue',
  'tues',
  'tuesday',
  'wed',
  'wednesday',
  'thu',
  'thur',
  'thurs',
  'thursday',
  'fri',
  'friday',
  'sat',
  'saturday',
  'sun',
  'sunday',
  'jan',
  'january',
  'feb',
  'february',
  'mar',
  'march',
  'apr',
  'april',
  'may',
  'jun',
  'june',
  'jul',
  'july',
  'aug',
  'august',
  'sep',
  'sept',
  'september',
  'oct',
  'october',
  'nov',
  'november',
  'dec',
  'december',
  'gmt',
  'utc',
  'am',
  'pm',
  'z',
  't',
  'st',
  'nd',
  'rd',
  'th',
  'cst',
  'est',
  'pst',
  'mst',
  'edt',
  'pdt',
  'mdt',
  'bst',
  'cet',
  'cest',
])

const MONTH_WORDS = new Set([
  'jan',
  'january',
  'feb',
  'february',
  'mar',
  'march',
  'apr',
  'april',
  'may',
  'jun',
  'june',
  'jul',
  'july',
  'aug',
  'august',
  'sep',
  'sept',
  'september',
  'oct',
  'october',
  'nov',
  'november',
  'dec',
  'december',
])

// 标准纯数字日期（带可选时间与时区）：年-月-日 或 年/月/日 或 年.月.日
const STD_DATE_RE =
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d{1,6})?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/
// 月/日/年 或 日/月/年 或 月-日-年
const US_DATE_RE =
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d{1,6})?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/

/** 解析日期文本：严格校验格式（中文年月日、标准数字日期、英文月份日期），避免随意文本误判 */
export function parseCustomDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // 1. 匹配中文年月日：2025年1月1日 / 2025年01月01号，后跟可选时间部分
  const cnDateMatch = trimmed.match(/^(\d{4})年(\d{1,2})月(\d{1,2})[日号]?(?:\s*(.*))?$/)
  if (cnDateMatch) {
    const year = Number(cnDateMatch[1])
    const month = Number(cnDateMatch[2]) - 1
    const day = Number(cnDateMatch[3])
    const timePart = (cnDateMatch[4] || '').trim()

    let hour = 0
    let minute = 0
    let second = 0

    if (timePart) {
      const colonMatch = timePart.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
      if (colonMatch) {
        hour = Number(colonMatch[1])
        minute = Number(colonMatch[2])
        second = colonMatch[3] ? Number(colonMatch[3]) : 0
      } else {
        const textMatch = timePart.match(/^(\d{1,2})[点时](?:(\d{1,2})分?(?:(\d{1,2})秒?)?)?$/)
        if (textMatch) {
          hour = Number(textMatch[1])
          minute = textMatch[2] ? Number(textMatch[2]) : 0
          second = textMatch[3] ? Number(textMatch[3]) : 0
        } else {
          return null
        }
      }
    }

    if (
      month >= 0 &&
      month < 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour < 24 &&
      minute >= 0 &&
      minute < 60 &&
      second >= 0 &&
      second < 60
    ) {
      const d = new Date(year, month, day, hour, minute, second)
      if (!Number.isNaN(d.getTime())) return d
    }
    return null
  }

  // 2. 混合格式：2025-01-01 15点30分 或 2025/01/01 15点30分20秒
  const mixedMatch = trimmed.match(
    /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*(\d{1,2})[点时](?:(\d{1,2})分?(?:(\d{1,2})秒?)?)?$/,
  )
  if (mixedMatch) {
    const datePrefix = mixedMatch[1].replace(/[./]/g, '-')
    const hour = Number(mixedMatch[2])
    const minute = mixedMatch[3] ? Number(mixedMatch[3]) : 0
    const second = mixedMatch[4] ? Number(mixedMatch[4]) : 0
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60) {
      const d = new Date(`${datePrefix} ${pad(hour)}:${pad(minute)}:${pad(second)}`)
      if (!Number.isNaN(d.getTime())) return d
    }
    return null
  }

  // 3. 包含中文但未命中上述中文规则的，直接判为非日期
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return null

  // 4. 标准纯数字日期格式（YYYY-MM-DD / MM/DD/YYYY 等）
  if (STD_DATE_RE.test(trimmed) || US_DATE_RE.test(trimmed)) {
    const normalized = trimmed.replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, '$1-$2-$3')
    const d = new Date(normalized)
    if (!Number.isNaN(d.getTime())) {
      const yearMatch = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
      if (yearMatch) {
        const y = Number(yearMatch[1])
        const m = Number(yearMatch[2]) - 1
        const day = Number(yearMatch[3])
        const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        const checkYear = hasTz ? d.getUTCFullYear() : d.getFullYear()
        const checkMonth = hasTz ? d.getUTCMonth() : d.getMonth()
        const checkDate = hasTz ? d.getUTCDate() : d.getDate()
        if (checkYear !== y || checkMonth !== m || checkDate !== day) {
          return null
        }
      }
      if (d.getFullYear() >= 1900 && d.getFullYear() <= 2200) {
        return d
      }
    }
    return null
  }

  // 5. 英文月份日期（RFC 2822 / HTTP Date / 英文格式，如 Jan 01, 2025、Wed, 01 Jan 2025 00:00:00 GMT）
  const words = trimmed.match(/[a-zA-Z]+/g)
  if (words && words.length > 0) {
    // 文本中所有英文单词必须在合法白名单内，坚决拒绝非日期单词（如 Debian, Linux, bookworm 等）
    const allValid = words.every((w) => VALID_DATE_WORDS.has(w.toLowerCase()))
    if (!allValid) return null

    // 必须包含至少一个合法英文月份单词
    const hasMonth = words.some((w) => MONTH_WORDS.has(w.toLowerCase()))
    if (!hasMonth) return null

    // 必须包含 4 位年份数字（1900-2200）
    const numbers = trimmed.match(/\d+/g) || []
    const hasYear = numbers.some((n) => n.length === 4 && Number(n) >= 1900 && Number(n) <= 2200)
    if (!hasYear) return null

    const d = new Date(trimmed)
    if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2200) {
      return d
    }
  }

  return null
}

/** 解析时间戳：纯数字自动判断秒/毫秒；否则尝试按日期文本解析 */
export function parseStamp(input: string): StampResult {
  const raw = input.trim()
  if (!raw) return { ok: false }

  let date: Date
  let source: StampSource

  if (/^-?\d+$/.test(raw)) {
    const num = Number(raw)
    const digits = raw.replace(/^-/, '')
    if (digits.length <= 10) {
      date = new Date(num * 1000)
      source = 'secs'
    } else {
      date = new Date(num)
      source = 'ms'
    }
  } else {
    const parsed = parseCustomDate(raw)
    if (!parsed) return { ok: false }
    date = parsed
    source = 'text'
  }

  if (Number.isNaN(date.getTime())) return { ok: false }

  let iso = ''
  try {
    iso = date.toISOString()
  } catch {
    iso = '-'
  }

  let utc = ''
  try {
    utc = date.toUTCString()
  } catch {
    utc = '-'
  }

  const secs = Math.floor(date.getTime() / 1000)
  return {
    ok: true,
    source,
    rows: [
      { label: i18n.t('tool.timestamp.unixSeconds'), value: String(secs) },
      { label: i18n.t('tool.timestamp.unixMilliseconds'), value: String(date.getTime()) },
      { label: 'ISO 8601', value: iso },
      { label: i18n.t('tool.timestamp.localTime'), value: toLocalText(date) },
      { label: i18n.t('tool.timestamp.utcTime'), value: utc },
      { label: i18n.t('tool.timestamp.relativeNow'), value: toRelative(date) },
    ],
  }
}
