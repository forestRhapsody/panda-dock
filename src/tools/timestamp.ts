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

/** 英文月份缩写 / 全称 → 0 基月份下标：既当白名单，也当滚动校验的期望月份 */
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const MONTH_WORDS = new Set(Object.keys(MONTH_INDEX))

// 标准纯数字日期（带可选时间与时区）：年-月-日 或 年/月/日 或 年.月.日
const STD_DATE_RE =
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d{1,6})?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/
// 月/日/年 或 日/月/年 或 月-日-年
const US_DATE_RE =
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}(?:[ T]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d{1,6})?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?)?$/

/**
 * 用输入里的年月日反查 Date 字段，拒绝「非法日历日静默进位」。
 * `new Date` 会把 2 月 31 日滚到 3 月，日期是否合法只能靠字段比对得出；
 * 输入带显式时区时按 UTC 字段比对（与 4b 的既有写法一致），否则按本地字段。
 */
function matchesCalendarDate(date: Date, year: number, month: number, day: number, hasTz: boolean) {
  const checkYear = hasTz ? date.getUTCFullYear() : date.getFullYear()
  const checkMonth = hasTz ? date.getUTCMonth() : date.getMonth()
  const checkDate = hasTz ? date.getUTCDate() : date.getDate()
  return checkYear === year && checkMonth === month && checkDate === day
}

/**
 * 「这个值算不算一个时间」的统一判定 —— 独立的时间戳候选（detect）与 JSON 值内的时间提示共用，
 * 保证两处口径一致：纯数字按 9~16 位截断（≤10 位视为秒、否则视为毫秒），其余走 `parseCustomDate`；
 * 命中后还要求年份落在 1900~2200，避免把毫秒时长（如 3600000）当成 1970 年。
 */
export function parseTimeValue(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let date: Date | null = null
  if (/^-?\d+$/.test(trimmed)) {
    const digits = trimmed.replace(/^-/, '')
    // 纯数字时间戳：秒通常 9~11 位、毫秒 12~16 位；过滤掉普通简短数字如 200 / 8080 / 2025
    if (digits.length < 9 || digits.length > 16) return null
    const num = Number(trimmed)
    const isSecs = digits.length <= 10
    const parsed = new Date(isSecs ? num * 1000 : num)
    if (!Number.isNaN(parsed.getTime())) date = parsed
  } else {
    const parsed = parseCustomDate(trimmed)
    if (parsed && !Number.isNaN(parsed.getTime())) date = parsed
  }

  if (!date) return null
  if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null
  return date
}

/** 英文日期里的显式时区标记（含 RFC 2822 的命名时区），用于决定字段比对按 UTC 还是本地 */
const EN_TZ_RE =
  /(?:z$|[+-]\d{2}:?\d{2}$|\b(?:gmt|utc|est|edt|cst|mst|mdt|pst|pdt|bst|cet|cest)\b)/i

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
      // 中文分支没有时区信息：`new Date` 会把 2 月 31 日进位到 3 月，字段对不上即非法
      if (!Number.isNaN(d.getTime()) && matchesCalendarDate(d, year, month, day, false)) return d
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
      const parts = datePrefix.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
      // 混合写法同样按本地字段比对，拒绝 2025-02-31 15点30分 这类静默进位
      if (
        parts &&
        !Number.isNaN(d.getTime()) &&
        matchesCalendarDate(d, Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), false)
      ) {
        return d
      }
    }
    return null
  }

  // 3. 包含中文但未命中上述中文规则的，直接判为非日期
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return null

  // 4. 标准纯数字日期格式（YYYY-MM-DD / MM/DD/YYYY 等）
  if (STD_DATE_RE.test(trimmed) || US_DATE_RE.test(trimmed)) {
    const normalized = trimmed.replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/, '$1-$2-$3')

    // 4a. 纯日期（无时间、无时区）必须按**本地零点**构造。
    // `new Date('2025-01-01')` 按 UTC 解析，在负 UTC 偏移时区里会落到前一天（本地 2024-12-31），
    // 再配合后面的本地字段校验就会被判为非法 —— `detect('2025-01-01')` 因此直接返回 null。
    // 日期在直觉上属于「本地日历」，这里统一按本地零点解析，与中文分支的构造方式保持一致。
    const dateOnly = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (dateOnly) {
      const y = Number(dateOnly[1])
      const m = Number(dateOnly[2]) - 1
      const day = Number(dateOnly[3])
      const local = new Date(0)
      local.setHours(0, 0, 0, 0)
      local.setFullYear(y, m, day)
      // setFullYear 会把 2 月 31 日滚动到 3 月：字段对不上即视为非法日期
      if (local.getFullYear() !== y || local.getMonth() !== m || local.getDate() !== day) {
        return null
      }
      return y >= 1900 && y <= 2200 ? local : null
    }

    const d = new Date(normalized)
    if (!Number.isNaN(d.getTime())) {
      const isoParts = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
      const usParts = normalized.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
      const expected = isoParts
        ? { y: Number(isoParts[1]), m: Number(isoParts[2]) - 1, day: Number(isoParts[3]) }
        : usParts
          ? { y: Number(usParts[3]), m: Number(usParts[1]) - 1, day: Number(usParts[2]) }
          : null
      // 带时间的数字日期也按字段比对：US 风格（月在前）此前漏掉校验，02/31/2025 会静默滚到 3 月
      if (expected) {
        const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
        if (!matchesCalendarDate(d, expected.y, expected.m, expected.day, hasTz)) {
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
      // 英文分支同样要防静默进位（Feb 30 会被 Date 滚到 3 月）。
      // 先把时间部分剥掉，否则 HH:MM 与 AM/PM 小时里的数字会被误当成「日」。
      const datePart = trimmed
        .replace(/\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d+)?/g, ' ')
        .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, ' ')
      const dayMatch = datePart.match(/\b\d{1,2}\b/)
      const monthWord = words.find((w) => MONTH_WORDS.has(w.toLowerCase()))
      const yearWord = numbers.find((n) => n.length === 4 && Number(n) >= 1900 && Number(n) <= 2200)
      const expectedMonth = monthWord ? MONTH_INDEX[monthWord.toLowerCase()] : undefined
      if (expectedMonth !== undefined) {
        // 没写「日」时 Date 默认 1 号（如 Jan 2025），按 1 号比对即可。
        // 年份优先取输入里的 4 位年份；没有时回填 Date 自己选定的年份（带命名时区要用 UTC 字段），
        // 这样校验只关注「月 / 日是否被滚动」，不依赖上方 hasYear 守卫的当前写法。
        const expectedDay = dayMatch ? Number(dayMatch[0]) : 1
        const hasTz = EN_TZ_RE.test(trimmed)
        const ownYear = hasTz ? d.getUTCFullYear() : d.getFullYear()
        const expectedYear = yearWord ? Number(yearWord) : ownYear
        if (!matchesCalendarDate(d, expectedYear, expectedMonth, expectedDay, hasTz)) {
          return null
        }
      }
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
