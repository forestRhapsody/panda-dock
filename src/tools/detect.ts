import { decodeBase64 } from './base64'
import { base64ToDataUrl, detectMimeFromBytes, fmtSize } from './file'
import { formatAndMinifyJson, formatJson, isJsonText, minifyJson } from './json'
import { decodeJwt } from './jwt'
import { parseTimeValue, toLocalText, toRelative } from './timestamp'

export type DetectKind =
  | 'json'
  | 'jwt'
  | 'url'
  | 'timestamp'
  | 'uuid'
  | 'base64'
  | 'hex'
  | 'dataurl'

/** 短字段（单行 label|value，可逐项复制） */
export interface DetectField {
  key: string
  value: string
  mono?: boolean
}

/** 长文本输出（格式化 JSON / 解码结果，整块复制），json=true 用语法高亮展示，image=true 展示图片 */
export interface DetectBlock {
  key: string
  value: string
  json?: boolean
  image?: boolean
  formattedValue?: string
  minifiedValue?: string
}

/** 可下载的文件（base64 反解成原始文件，点击可还原下载） */
export interface DetectDownload {
  mime: string
  /** Data URL（含 base64 数据），用于还原文件 */
  dataUrl: string
  sizeBytes: number
}

export interface DetectSourceMatch {
  /** 被解析的目标子串 */
  text: string
  /** 在原始完整输入中的起始字符偏移（0-based，闭区间） */
  startIndex: number
  /** 在原始完整输入中的结束字符偏移（0-based，开区间） */
  endIndex: number
  /** 在多项匹配中，是否为当前正在查看的激活项（供高亮层区分焦点态与次级态） */
  active?: boolean
}

/** 单个被成功识别并解析的匹配条目 */
export interface DetectItem {
  kind: DetectKind
  fields: DetectField[]
  blocks: DetectBlock[]
  copy: string
  download?: DetectDownload
  /** 该项关联的原始输入匹配区间（单区间或多区间，如提取网址命中多条 URL） */
  sourceMatches: DetectSourceMatch[]
  /** 兼容旧版访问首个匹配区间 */
  sourceMatch: DetectSourceMatch
}

/**
 * 解析解释提示：文本层面存在多种等价解读时（如多行 Base64 既可当「每行一段」也可当「一段折行」），
 * 把本次实际采用的解释显性告知用户，而不是让他猜。
 */
export type DetectHint = 'base64-lines' | 'base64-wrapped'

export interface DetectResult {
  kind: DetectKind
  fields: DetectField[]
  blocks: DetectBlock[]
  /** 主复制文本（优先取第一个 block，否则第一个 field） */
  copy: string
  /** 若输入是一段 Base64 / Data URL 文件，携带还原下载所需的信息 */
  download?: DetectDownload
  /** 输入文本中被成功提取解析的匹配区间（供输入框精准高亮显示） */
  sourceMatches?: DetectSourceMatch[]
  /** 当输入中存在多个可解析结果时（如两个 Base64），提供完整的匹配项列表供切换 */
  items?: DetectItem[]
  /** 本次采用的解释方式（结果区显性标注，见 DetectHint） */
  hint?: DetectHint
}

// 版本段允许 1–8：v6/v7 是 RFC 9562 现行标准，v8 也已存在；variant 仍是 [89ab]。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX_RE = /^[0-9a-fA-F]+$/
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/
/** 形如英文单词的 4 字符全小写串：4 字符 Base64 只有 3 字节信息量，无法与这类单词区分（见 detectBase64） */
const B64_SHORT_WORD_RE = /^[a-z]{4}$/
const DATA_URL_RE = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:', 'file:'])

// 带协议的 URL（http/https/ftp/ws/wss/file）：后面跟到 空白/引号/尖括号/CJK/全角标点 为止
const URL_PROTO_RE =
  /(?:https?:\/\/|ftp:\/\/|ws:\/\/|wss:\/\/|file:\/\/)[^\s<>"'`\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/gi
// 裸域名（无协议，含 www.）：用于从文本里捞网址；负向后顾避免命中邮箱里的域名（user@qq.com）
const BARE_URL_RE =
  /(?<![@\w])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>"'`\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*)?/gi

/** 把一条候选 URL 规范化（去尾部标点、无协议补 https、校验协议），返回规范 href 或 null */
function normalizeUrl(raw: string): string | null {
  const u = raw.replace(/[.,;:!?)\]}>'"`]+$/g, '').trim()
  if (!u) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`)
    if (ALLOWED_PROTOCOLS.has(url.protocol)) return url.href
  } catch {
    // 忽略
  }
  return null
}

/**
 * 裸域名只认常见 TLD。
 * 背景：`BARE_URL_RE` 把 `[a-z]{2,}` 当 TLD，于是 `file.txt` / `README.md` 这类**文件名**会被当成网址
 * （`md` 虽是摩尔多瓦 ccTLD，但作为文件名出现得多得多）。这里用白名单换取可预测的误判方向：
 * 宁可漏报冷门后缀，也不把普通文件名当网址。需要新后缀时在此补充（注意别把常见文件扩展名放进来）。
 */
const KNOWN_TLDS = new Set([
  // 通用 / 常见新 gTLD
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'mil',
  'int',
  'info',
  'biz',
  'name',
  'pro',
  'mobi',
  'asia',
  'app',
  'dev',
  'io',
  'ai',
  'sh',
  'co',
  'me',
  'tv',
  'cc',
  'xyz',
  'top',
  'site',
  'online',
  'store',
  'shop',
  'tech',
  'cloud',
  'blog',
  'wiki',
  'news',
  'media',
  'live',
  'life',
  'world',
  'today',
  'space',
  'fun',
  'games',
  'group',
  'team',
  'work',
  'zone',
  'network',
  'systems',
  'solutions',
  'digital',
  'studio',
  'agency',
  'design',
  'art',
  'club',
  'email',
  'host',
  'page',
  'link',
  'click',
  // 常见国家 / 地区
  'cn',
  'uk',
  'de',
  'fr',
  'jp',
  'kr',
  'ru',
  'br',
  'in',
  'au',
  'ca',
  'us',
  'eu',
  'ch',
  'it',
  'nl',
  'se',
  'no',
  'es',
  'pl',
  'be',
  'at',
  'dk',
  'fi',
  'cz',
  'pt',
  'gr',
  'tr',
  'tw',
  'hk',
  'sg',
  'my',
  'th',
  'vn',
  'id',
  'ph',
  'mx',
  'ar',
  'cl',
  'za',
  'eg',
  'sa',
  'ae',
  'il',
  'nz',
  'ie',
  'is',
  'lu',
  'ee',
  'lv',
  'lt',
  'sk',
  'si',
  'hr',
  'rs',
  'bg',
  'ro',
  'hu',
  'ua',
  'kz',
  'pk',
  'bd',
  'lk',
  'np',
])

/** 裸域名候选的 TLD 是否可信（去掉端口 / 路径 / 查询 / hash 后取最后一段） */
function isKnownBareDomain(raw: string): boolean {
  const host = raw.split(/[/?#]/)[0].split(':')[0].toLowerCase()
  const dot = host.lastIndexOf('.')
  if (dot < 0) return false
  return KNOWN_TLDS.has(host.slice(dot + 1))
}

interface ExtractedUrl {
  value: string
  start: number
  end: number
}

/**
 * 从一段文本中提取所有 URL（带协议 or 裸域名）。
 * 保留每处出现（含完全相同的重复，如两行相同的 https://baidu.com）；
 * 仅当裸域名是某个带协议 URL 的一部分时跳过，避免 a.com 在 https://a.com 里重复计一次。
 */
function extractUrls(input: string): ExtractedUrl[] {
  const found: ExtractedUrl[] = []
  for (const m of input.matchAll(URL_PROTO_RE)) {
    const start = m.index ?? 0
    const url = normalizeUrl(m[0])
    if (url) found.push({ value: url, start, end: start + m[0].length })
  }
  for (const m of input.matchAll(BARE_URL_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (found.some((p) => start >= p.start && end <= p.end)) continue
    // 文件名不是网址：只有 TLD 在白名单里才认（`file.txt` / `README.md` / base64 片段都被挡在这里）
    if (!isKnownBareDomain(m[0])) continue
    const url = normalizeUrl(m[0])
    if (url) found.push({ value: url, start, end })
  }
  // 按文本出现顺序输出（保留重复）
  found.sort((a, b) => a.start - b.start)
  return found
}

function isJsonLike(s: string): boolean {
  return s.startsWith('{') || s.startsWith('[')
}

function detectJson(s: string): DetectResult | null {
  if (!isJsonLike(s)) return null
  // 一次解析同时拿到「格式化 + 压缩」两份文本：大 JSON 不必解析两遍（见 T20）
  const pair = formatAndMinifyJson(s)
  if (!pair) return null
  return {
    kind: 'json',
    // 不做「JSON 内时间字段可读化」这类猜测（T21 已按产品决定回滚）：
    // 值本身分不清时间戳与 ID/金额，猜错的代价是误导，收益又有限
    fields: [],
    blocks: [
      {
        key: 'parsed',
        value: pair.formatted,
        formattedValue: pair.formatted,
        minifiedValue: pair.minified,
        json: true,
      },
    ],
    copy: pair.formatted,
  }
}

function detectJwt(s: string): DetectResult | null {
  const clean = s.replace(/^Bearer\s+/i, '').trim()
  if (clean.split('.').length !== 3) return null
  const res = decodeJwt(clean)
  if (!res.ok) return null
  const d = res.data
  const fields: DetectField[] = []
  if (d.alg) fields.push({ key: 'algorithm', value: d.alg, mono: true })
  for (const c of d.claims) fields.push({ key: `claim.${c.key}`, value: c.display, mono: true })
  return {
    kind: 'jwt',
    fields,
    blocks: [
      { key: 'header', value: d.headerText, json: true },
      { key: 'payload', value: d.payloadText, json: true },
      { key: 'signature', value: d.signatureB64 },
    ],
    copy: d.payloadText,
  }
}

function detectUrl(s: string): DetectResult | null {
  // 单个 URL 不应含空白（换行/空格）。含空白说明是多段文本（如两行相同网址），
  // 交给「提取网址」(detectUrls) 逐条列出，而不是按单个 URL 解析出协议/主机/路径。
  if (/\s/.test(s)) return null
  let url: URL | null = null
  try {
    url = new URL(s)
  } catch {
    // 忽略
  }
  if (!url || !ALLOWED_PROTOCOLS.has(url.protocol)) {
    try {
      if (/^localhost(?::\d+)?([/?#].*)?$/i.test(s)) {
        url = new URL(`http://${s}`)
      } else if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?([/?#].*)?$/.test(s)) {
        url = new URL(`http://${s}`)
      } else if (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?([/?#].*)?$/i.test(s)) {
        // 与 extractUrls 同一套 TLD 白名单：否则 `README.md` / `file.txt` 会在「纯输入」路径上
        // 绕过白名单被直接判成网址
        if (!isKnownBareDomain(s)) return null
        url = new URL(`https://${s}`)
      } else {
        url = null
      }
    } catch {
      url = null
    }
  }
  if (!url || !ALLOWED_PROTOCOLS.has(url.protocol)) return null

  // 只需展示网址本身，不再拆分协议/主机/路径等
  return {
    kind: 'url',
    fields: [{ key: 'url', value: url.href, mono: true }],
    blocks: [],
    copy: url.href,
  }
}

function detectTimestamp(s: string): DetectResult | null {
  const trimmed = s.trim()
  if (!trimmed) return null

  // 口径与「JSON 值内的时间提示」共用同一个解析函数，避免两处判断不一致
  const date = parseTimeValue(trimmed)
  if (!date) return null

  const local = toLocalText(date)
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

  return {
    kind: 'timestamp',
    fields: [
      { key: 'seconds', value: String(Math.floor(date.getTime() / 1000)), mono: true },
      { key: 'milliseconds', value: String(date.getTime()), mono: true },
      { key: 'iso', value: iso, mono: true },
      { key: 'date', value: local, mono: true },
      { key: 'utc', value: utc, mono: true },
      { key: 'relative', value: toRelative(date), mono: true },
    ],
    blocks: [],
    copy: local,
  }
}

function detectUuid(s: string): DetectResult | null {
  const m = s.match(UUID_RE)
  if (!m) return null
  const ver = s.slice(14, 15)
  return {
    kind: 'uuid',
    fields: [
      { key: 'valid', value: '✓' },
      { key: 'version', value: `v${ver}` },
    ],
    blocks: [],
    copy: s,
  }
}

function hasControlChars(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // 允许制表符(9)、换行(10)、回车(13)，其余 0~31 均为不可见控制字符
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true
  }
  return false
}

function detectBase64(s: string): DetectResult | null {
  // 只有折行算「格式空白」（MIME Base64 每 76 字符折行，粘贴时常带 CR/LF）；
  // 其它任何空白（半角空格 / 制表符 / NBSP / 全角空格…）都说明这是被分词的自由文本，
  // 不是一段 Base64 —— 否则两段相邻的 Base64 会被静默拼成一段，解出拼接后的错误文本。
  if (/[^\S\n\r]/.test(s)) return null
  const clean = s.replace(/[\n\r]+/g, '')
  if (clean.length < 4 || clean.length % 4 !== 0 || !B64_RE.test(clean)) return null
  // 长度恰为 4 是最小 Base64 单元，仅含 3 字节信息量：全小写纯字母（file / edit / aced）
  // 几乎必然是被误当密文的英文单词，而其解码结果又恰好是合法 UTF-8 可打印文本，
  // 后续「canonical + UTF-8 + 无控制字符」护栏无法区分，故在此直接排除。
  // 含大写、数字或 padding 的 4 字符短密文（YWFh → aaa、YQ== → a、5L2g → 你）不受影响。
  if (clean.length === 4 && B64_SHORT_WORD_RE.test(clean)) return null
  try {
    const canonical = btoa(atob(clean)) === clean
    if (!canonical) return null
    const decoded = decodeBase64(clean)
    if (decoded.isText) {
      // 若解码出的文本含有不可见控制字符（除了制表符/换行/回车），说明并非有意义的文本 Base64
      if (hasControlChars(decoded.text)) return null
      const trimmed = decoded.text.trim()
      const jsonRes = isJsonLike(trimmed) ? formatJson(trimmed) : null
      const isJson = Boolean(jsonRes?.ok && jsonRes.text)
      const minifiedRes = isJson ? minifyJson(trimmed) : null
      const formattedVal = isJson ? jsonRes!.text! : decoded.text
      const minifiedVal = isJson ? (minifiedRes?.text ?? trimmed) : undefined
      return {
        kind: 'base64',
        fields: [],
        blocks: [
          {
            key: isJson ? 'parsed' : 'decoded',
            value: formattedVal,
            formattedValue: formattedVal,
            minifiedValue: minifiedVal,
            json: isJson,
          },
        ],
        copy: formattedVal,
      }
    }
    // 非 UTF-8 文本：必须能通过魔数识别出明确的文件类型（图片/文档/压缩包等），避免将随机字母串误识别为二进制文件
    const mime = detectMimeFromBytes(clean)
    if (!mime) return null
    const sizeBytes = atob(clean).length
    const dataUrl = base64ToDataUrl(clean, mime)
    const blocks: DetectBlock[] = []
    if (mime.startsWith('image/')) {
      blocks.push({ key: 'image', value: dataUrl, image: true })
    }
    return {
      kind: 'base64',
      fields: [{ key: 'bytes', value: fmtSize(sizeBytes), mono: true }],
      blocks,
      copy: dataUrl,
      download: { mime, dataUrl, sizeBytes },
    }
  } catch {
    return null
  }
}

/** 常见 Base64 折行宽度：`openssl base64` 默认 64 列，MIME / `base64 -w 76` 为 76 列 */
const BASE64_WRAP_WIDTHS = [64, 76]

/**
 * 判断「多行输入」是否该按「每行一段 Base64」解析（只在真有歧义时生效）：
 * - 至少 2 个非空行，且**每行**都能独立通过 Base64 校验（否则交给逐块挖掘去处理混杂文本）；
 * - 折行护栏：任一行长度恰为 64/76 列 → 视为「一段被折行的 Base64」，交回整段解释
 *   （典型来源：`openssl base64` / MIME 邮件正文 / `base64 -w`）；
 * - 反向护栏：非末行出现 padding(`=`) → 必然是列表 —— 折行的 padding 只可能落在整段最后一个字符。
 * 返回按行切好的候选（含精确高亮区间），不满足时返回 null。
 */
function base64LineCandidates(
  input: string,
): { text: string; startIndex: number; endIndex: number }[] | null {
  const lines: { text: string; startIndex: number; endIndex: number }[] = []
  for (const m of input.matchAll(/[^\r\n]+/g)) {
    const raw = m[0]
    const text = raw.trim()
    if (!text) continue
    const startIndex = (m.index ?? 0) + raw.indexOf(text)
    lines.push({ text, startIndex, endIndex: startIndex + text.length })
  }
  if (lines.length < 2) return null
  if (!lines.every((line) => detectBase64(line.text) !== null)) return null
  const hitsWrapWidth = lines.some((line) => BASE64_WRAP_WIDTHS.includes(line.text.length))
  const interiorPadding = lines.slice(0, -1).some((line) => line.text.endsWith('='))
  if (hitsWrapWidth && !interiorPadding) return null
  return lines
}

function detectHex(s: string): DetectResult | null {
  const clean = s.replace(/^0x/i, '').replace(/\s+/g, '')
  if (clean.length < 8 || clean.length % 2 !== 0 || !HEX_RE.test(clean)) return null
  const groups = clean.match(/.{2}/g)
  if (!groups) return null
  const bytes = new Uint8Array(groups.map((g) => parseInt(g, 16)))
  let ascii = ''
  for (const b of bytes) ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '·'
  return {
    kind: 'hex',
    fields: [{ key: 'bytes', value: `${bytes.length} B`, mono: true }],
    blocks: [{ key: 'decoded', value: ascii }],
    copy: ascii,
  }
}

/** Data URL：data:<mime>;base64,<base64> —— 识别类型，图片会展示预览 */
function detectDataUrl(s: string): DetectResult | null {
  const m = s.match(DATA_URL_RE)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const b64 = m[2].replace(/\s+/g, '')
  if (b64.length < 4 || b64.length % 4 !== 0 || !B64_RE.test(b64)) return null
  let sizeBytes = 0
  try {
    sizeBytes = atob(b64).length
  } catch {
    return null
  }
  const cleanUrl = `data:${mime};base64,${b64}`
  const isImg = mime.startsWith('image/')
  return {
    kind: 'dataurl',
    fields: [
      { key: 'mime', value: mime, mono: true },
      { key: 'bytes', value: fmtSize(sizeBytes), mono: true },
    ],
    blocks: isImg ? [{ key: 'image', value: cleanUrl, image: true }] : [],
    copy: cleanUrl,
    download: { mime, dataUrl: cleanUrl, sizeBytes },
  }
}

/** 对纯净单段输入执行逐项基础类型检测 */
function detectCore(s: string): DetectResult | null {
  return (
    detectJson(s) ??
    detectDataUrl(s) ??
    detectJwt(s) ??
    detectUrl(s) ??
    detectTimestamp(s) ??
    detectUuid(s) ??
    detectBase64(s) ??
    detectHex(s)
  )
}

interface StrippedInfo {
  stripped: string
  start: number
  end: number
}

/**
 * 剥离常见的调用外壳或首尾成对包裹符号，并记录核心载荷在原输入中的起止偏移：
 * 1. 代码函数外壳：如 atob(...) / btoa(...) / atob`...`
 * 2. 首尾对称成对引号：如 "hello" -> hello, “hello” -> hello, `hello` -> hello
 */
function stripCommonWrappers(input: string): StrippedInfo | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const baseOffset = input.indexOf(trimmed)
  let cur = trimmed
  let curStart = baseOffset

  // 1. 代码函数外壳剥离：atob(...) / btoa(...) / atob`...`
  const funcMatch = cur.match(/^(?:atob|btoa)\s*(?:\(\s*([\s\S]+?)\s*\)|`([\s\S]+?)`)$/i)
  if (funcMatch) {
    const rawArg = funcMatch[1] ?? funcMatch[2] ?? ''
    const argOffset = funcMatch[0].indexOf(rawArg)
    cur = rawArg.trim()
    const trimOffset = rawArg.indexOf(cur)
    curStart += (funcMatch.index ?? 0) + argOffset + trimOffset
  }

  // 2. 首尾对称成对引号剥离
  if (
    (cur.startsWith('"') && cur.endsWith('"')) ||
    (cur.startsWith("'") && cur.endsWith("'")) ||
    (cur.startsWith('`') && cur.endsWith('`')) ||
    (cur.startsWith('“') && cur.endsWith('”')) ||
    (cur.startsWith('‘') && cur.endsWith('’'))
  ) {
    cur = cur.slice(1, -1).trim()
    curStart += 1
  }

  if (cur && cur !== trimmed) {
    return { stripped: cur, start: curStart, end: curStart + cur.length }
  }
  return null
}

interface QuotedCandidate {
  text: string
  startIndex: number
  endIndex: number
}

/**
 * 从可能混杂自然语言的文本中提取所有成对引号内的子串及其绝对字符偏移：
 * 支持：
 * - 中文全角双引：“...”
 * - 中文全角单引：‘...’
 * - 反引号：`...`
 * - 英文半角双引："..."
 * - 英文半角单引：'...'（带负向环视，防止误匹配 it's / don't 等撇号）
 */
function extractQuotedCandidates(input: string): QuotedCandidate[] {
  const candidates: QuotedCandidate[] = []
  const seen = new Set<string>()

  const patterns = [
    /“([^”]+?)”/g,
    /‘([^’]+?)’/g,
    /`([^`]+?)`/g,
    /"([^"]+?)"/g,
    /(?<![a-zA-Z0-9])'([^']+?)'(?![a-zA-Z0-9])/g,
  ]

  for (const regex of patterns) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(input)) !== null) {
      const rawVal = match[1] ?? ''
      const val = rawVal.trim()
      if (!val) continue
      const matchStart = match.index
      const innerOffset = match[0].indexOf(val)
      const startIndex = matchStart + innerOffset
      const endIndex = startIndex + val.length
      const key = `${startIndex}:${endIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        candidates.push({ text: val, startIndex, endIndex })
      }
    }
  }

  candidates.sort((a, b) => a.startIndex - b.startIndex)
  return candidates
}

interface EmbeddedCandidate {
  text: string
  startIndex: number
  endIndex: number
  kindHint?: 'jwt' | 'base64' | 'timestamp'
}

/**
 * 几乎零成本的「首 token」预筛：紧跟在 `{` / `[` 后的第一个非空白字符，
 * 是否可能是合法 JSON 的起始字符（对象只能是 `"` / `}` / JSONC 注释；数组只能是值起始字符或 `]`）。
 * 这是**必要不充分**条件：不满足者必然不是 JSON，于是代码块（`{ return 1 }` / `{a: 1}`）
 * 连切片和解析都省了 —— 这是热路径上最划算的一刀。
 */
function looksLikeJsonStart(input: string, start: number, end: number): boolean {
  let i = start + 1
  while (i < end) {
    const ch = input[i]
    if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') break
    i++
  }
  const ch = input[i]
  if (ch === undefined) return false
  return input[start] === '{'
    ? ch === '"' || ch === '}' || ch === '/'
    : '"[]{}-0123456789tfn/'.includes(ch)
}

/**
 * 扫描正文中夹带的 JSON 对象 / 数组（「数据 + 一句说明」是最常见的粘贴形态，而整段又不是纯 JSON）。
 *
 * 实现要点（都是性能相关）：
 * - **单遍 O(n) 遍历 + 括号栈**：只在括号栈回到空时产出一个「顶层配平区间」，
 *   因此不存在「每个 `{` 各自向后重扫」的 O(n²) 隐患，也不需要限制尝试次数；
 *   顶层块命中后，其内部的嵌套对象不会被重复挖出来（也不会重复解析）。
 * - 字符串内部的括号与 `\"` 转义都跳过，JSON 值里的花括号不会把配对带偏。
 * - 先用 `looksLikeJsonStart` 预筛，再用 `isJsonText`（只做布尔解析、不拼错误文案）校验。
 */
function extractEmbeddedJsonCandidates(
  input: string,
): { text: string; startIndex: number; endIndex: number }[] {
  const out: { text: string; startIndex: number; endIndex: number }[] = []
  const open: { ch: string; index: number }[] = []
  let inString = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      open.push({ ch, index: i })
      continue
    }
    if (ch !== '}' && ch !== ']') continue

    const top = open[open.length - 1]
    if (!top) continue // 多余的收尾括号：忽略
    if ((top.ch === '{') !== (ch === '}')) {
      // 括号类型不匹配：当前这段结构（如 JS 代码块）已不可能配平，丢弃整个栈
      open.length = 0
      continue
    }
    open.pop()
    if (open.length > 0) continue // 只产出顶层块

    if (!looksLikeJsonStart(input, top.index, i)) continue
    const text = input.slice(top.index, i + 1)
    if (!isJsonText(text)) continue
    out.push({ text, startIndex: top.index, endIndex: i + 1 })
  }
  return out
}

// 连续 JWT 特征：由两个点分隔的 3 段 Base64URL 字符
const EMBEDDED_JWT_RE =
  /(?<![A-Za-z0-9_-])([A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g

// 中文日期特征：如 2025年1月1日 15点30分 / 2025年1月1日 15:30:00 / 2025年1月1日
const EMBEDDED_CN_DATE_RE =
  /(\d{4}年\d{1,2}月\d{1,2}[日号]?(?:\s*(?:\d{1,2}[点时](?:\d{1,2}分?(?:\d{1,2}秒?)?)?|\d{1,2}:\d{1,2}(?::\d{1,2})?))?)/g

// 标准年月日特征：如 2025-01-01 15:30:00 / 2025/01/01 / 2025-01-01T15:30:00Z
const EMBEDDED_STD_DATE_RE =
  /(?<![A-Za-z0-9])(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?|T\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?)(?![A-Za-z0-9])/g

// 10位或13位纯数字时间戳（如 1712345678、1712345678000）
const EMBEDDED_STAMP_NUM_RE = /(?<!\d)(\d{10}|\d{13})(?!\d)/g

// 连续 Base64 特征：边界非 Base64 字符（中文、全半角标点、空格、换行等），长度 >= 8 且为 4 的倍数
const EMBEDDED_B64_RE = /(?<![A-Za-z0-9+/=])([A-Za-z0-9+/]{4,}=*={0,2})(?![A-Za-z0-9+/=])/g

/**
 * 从可能夹杂在中文内部、或者两个空格/标点符号之间的文本中挖掘独立的目标：
 * 解决用户场景：
 * 1. 夹在中文内：如“这个密文SGVsbG8gV29yZA==发你”、“收到密文5L2g5aW95LiW55WM请查收”
 * 2. 两个空格间：如“你好 SGGVsbG8gV29yZA== 好的”、“token: eyJhbGci... 已生成”
 */
function extractEmbeddedCandidates(input: string): EmbeddedCandidate[] {
  const candidates: EmbeddedCandidate[] = []
  const seen = new Set<string>()

  // 1. 优先扫描潜伏的 JWT Token（特征强、双点分割）
  for (const m of input.matchAll(EMBEDDED_JWT_RE)) {
    const text = m[1]
    const startIndex = m.index ?? 0
    const endIndex = startIndex + text.length
    const key = `${startIndex}:${endIndex}`
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push({ text, startIndex, endIndex, kindHint: 'jwt' })
    }
  }

  // 2. 扫描中文日期与标准格式日期
  for (const m of input.matchAll(EMBEDDED_CN_DATE_RE)) {
    const text = m[1].trim()
    const startIndex = m.index ?? 0
    const endIndex = startIndex + m[1].length
    const key = `${startIndex}:${endIndex}`
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push({ text, startIndex, endIndex, kindHint: 'timestamp' })
    }
  }

  for (const m of input.matchAll(EMBEDDED_STD_DATE_RE)) {
    const text = m[1].trim()
    if (text.length < 8) continue
    const startIndex = m.index ?? 0
    const endIndex = startIndex + m[1].length
    const key = `${startIndex}:${endIndex}`
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push({ text, startIndex, endIndex, kindHint: 'timestamp' })
    }
  }

  // 3. 扫描独立 10 位或 13 位纯数字时间戳
  for (const m of input.matchAll(EMBEDDED_STAMP_NUM_RE)) {
    const text = m[1]
    const startIndex = m.index ?? 0
    const endIndex = startIndex + text.length
    const key = `${startIndex}:${endIndex}`
    if (!seen.has(key)) {
      seen.add(key)
      candidates.push({ text, startIndex, endIndex, kindHint: 'timestamp' })
    }
  }

  // 4. 扫描潜伏在中文或空格/标点周围的 Base64 连续块
  for (const m of input.matchAll(EMBEDDED_B64_RE)) {
    const text = m[1]
    if (text.length < 8 || text.length % 4 !== 0) continue
    const startIndex = m.index ?? 0
    const endIndex = startIndex + text.length
    const key = `${startIndex}:${endIndex}`
    if (seen.has(key)) continue
    // 若已被命中范围包含则跳过
    if (candidates.some((c) => startIndex >= c.startIndex && endIndex <= c.endIndex)) continue
    seen.add(key)
    candidates.push({ text, startIndex, endIndex, kindHint: 'base64' })
  }

  // 5. 扫描正文中夹带的 JSON 对象 / 数组
  for (const json of extractEmbeddedJsonCandidates(input)) {
    const key = `${json.startIndex}:${json.endIndex}`
    if (seen.has(key)) continue
    // 若已被前面命中的范围包含则跳过（与其它扫描一致的去重策略）
    if (candidates.some((c) => json.startIndex >= c.startIndex && json.endIndex <= c.endIndex)) {
      continue
    }
    seen.add(key)
    candidates.push(json)
  }

  candidates.sort((a, b) => a.startIndex - b.startIndex)
  return candidates
}

/**
 * 智能解析总入口：
 * 1. 优先对整段输入做严格检测；
 * 2. 若未命中，尝试剥离常见代码外壳（如 atob(...)）或首尾引号后再测；
 * 3. 若仍未命中，从文本中提取被成对引号（“”‘’`"''`）包裹的子串逐一检测；
 * 4. 若仍未命中，从自由文本中挖掘夹在中文内或空格/标点间的独立 Base64/JWT 候选块；
 * 命中时记录 sourceMatches 偏移区间以支持输入框高亮；识别不出返回 null。
 */
export function detect(input: string): DetectResult | null {
  // 超过 5 万字保护，避免扫描巨型日志/文本阻塞主线程
  if (!input || input.length > 50000) return null
  const s = input.trim()
  if (!s) return null

  // 0) 多行 Base64 的歧义消解：文本层面「每行一段」与「一段折行」完全等价，
  //    这里优先按行成项（符合「一行一项」的普遍直觉），由 base64LineCandidates 的护栏兜住折行场景。
  const lineCandidates = base64LineCandidates(input)

  // 1. 原文直接检测（纯净单目标，如纯单个 Base64、纯单个 URL、纯 JSON、纯 JWT 等）
  //    多行 Base64 列表不走这条路，否则会被当成「一段折行」拼起来。
  if (!lineCandidates) {
    const direct = detectCore(s)
    if (direct) {
      // 整段文本就是纯净目标，不存在其他字符，不应高亮
      direct.sourceMatches = undefined
      // 多行却被整段解出：本次采用「一段折行的 Base64」解释，显性标注出来
      if (direct.kind === 'base64' && /[\r\n]/.test(input)) direct.hint = 'base64-wrapped'
      return direct
    }
  }

  // 2. 收集所有可能的候选区间（外壳剥离、成对引号、嵌入式挖掘）
  interface RawCandidate {
    text: string
    startIndex: number
    endIndex: number
    kindHint?: 'jwt' | 'base64' | 'timestamp'
    priority: number // 2: 引号或外壳; 1: 嵌入式挖掘
  }

  const rawCandidates: RawCandidate[] = []

  // 2.0 每行一段的 Base64（最高优先级）：此时整段是 N 个独立值，而不是一段折行
  if (lineCandidates) {
    for (const line of lineCandidates) {
      rawCandidates.push({ ...line, kindHint: 'base64', priority: 3 })
    }
  }

  // 2.1 整段代码外壳或对称首尾引号
  const strippedInfo = stripCommonWrappers(input)
  if (strippedInfo) {
    rawCandidates.push({
      text: strippedInfo.stripped,
      startIndex: strippedInfo.start,
      endIndex: strippedInfo.end,
      priority: 2,
    })
  }

  // 2.2 自由文本中嵌入的 atob(...) / btoa(...) 函数调用（支持未加引号或加引号的参数）
  for (const fc of input.matchAll(/(?:atob|btoa)\s*\(\s*([^()]+?)\s*\)/gi)) {
    const rawArg = fc[1]?.trim()
    if (!rawArg) continue
    let cleanArg = rawArg
    let offsetInArg = 0
    if (
      (cleanArg.startsWith('"') && cleanArg.endsWith('"')) ||
      (cleanArg.startsWith("'") && cleanArg.endsWith("'")) ||
      (cleanArg.startsWith('`') && cleanArg.endsWith('`'))
    ) {
      cleanArg = cleanArg.slice(1, -1).trim()
      offsetInArg = 1
    }
    if (cleanArg) {
      const matchStart = fc.index ?? 0
      const argIndex = fc[0].indexOf(rawArg)
      const start = matchStart + argIndex + offsetInArg
      const end = start + cleanArg.length
      rawCandidates.push({
        text: cleanArg,
        startIndex: start,
        endIndex: end,
        kindHint: 'base64',
        priority: 2,
      })
    }
  }

  // 2.3 成对引号内的候选串（解决 哈哈“SGVsbG8gV29yZA==”、'eyJ...' 等场景）
  const quoted = extractQuotedCandidates(input)
  for (const q of quoted) {
    rawCandidates.push({
      text: q.text,
      startIndex: q.startIndex,
      endIndex: q.endIndex,
      priority: 2,
    })
  }

  // 2.4 自由文本中嵌入的候选目标（中文夹带、空格分隔等）
  const embedded = extractEmbeddedCandidates(input)
  for (const em of embedded) {
    rawCandidates.push({
      text: em.text,
      startIndex: em.startIndex,
      endIndex: em.endIndex,
      kindHint: em.kindHint,
      priority: 1,
    })
  }

  // 3. 候选区间去重与排序：按 startIndex 升序，重叠时保留优先级高的候选
  rawCandidates.sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex
    return b.priority - a.priority
  })

  const mergedCandidates: RawCandidate[] = []
  for (const cand of rawCandidates) {
    const overlaps = mergedCandidates.some(
      (m) => Math.max(m.startIndex, cand.startIndex) < Math.min(m.endIndex, cand.endIndex),
    )
    if (!overlaps) {
      mergedCandidates.push(cand)
    }
  }

  // 4. 对每个候选区间依次进行实体解析判定（非 URL 实体：Base64、JWT、JSON、时间戳等）
  const items: DetectItem[] = []
  // 已识别为 JSON 的块区间：其内部的 URL 不再单独成项（见第 5 步）
  const jsonRanges: { start: number; end: number }[] = []
  for (const cand of mergedCandidates) {
    let res: DetectResult | null = null
    if (cand.kindHint === 'jwt') {
      res = detectJwt(cand.text)
    } else if (cand.kindHint === 'base64') {
      res = detectBase64(cand.text)
    } else if (cand.kindHint === 'timestamp') {
      res = detectTimestamp(cand.text)
    }
    if (!res) {
      res = detectCore(cand.text)
    }
    // URL 统一由后续 extractUrls 统揽处理，避免零星重复
    if (res && res.kind !== 'url') {
      const match: DetectSourceMatch = {
        text: cand.text,
        startIndex: cand.startIndex,
        endIndex: cand.endIndex,
      }
      items.push({
        kind: res.kind,
        fields: res.fields,
        blocks: res.blocks,
        copy: res.copy,
        download: res.download,
        sourceMatches: [match],
        sourceMatch: match,
      })
      if (res.kind === 'json') jsonRanges.push({ start: cand.startIndex, end: cand.endIndex })
    }
  }

  // 5. 提取自由文本中出现的所有网址：每个网址独立作为一个匹配项（与 Base64/JWT 等行为完全一致，每次解析/高亮一个）
  const extractedUrls = extractUrls(input)
  for (const u of extractedUrls) {
    // JSON 块内部的 URL 不单独成项：结构化容器优先，与「整段是 JSON」时的行为保持一致
    if (jsonRanges.some((r) => u.start >= r.start && u.end <= r.end)) continue
    const match: DetectSourceMatch = {
      text: u.value,
      startIndex: u.start,
      endIndex: u.end,
    }
    items.push({
      kind: 'url',
      fields: [{ key: 'url', value: u.value, mono: true }],
      blocks: [],
      copy: u.value,
      sourceMatches: [match],
      sourceMatch: match,
    })
  }

  // 6. 关键：对所有匹配项统一按在输入文本中出现的绝对起始位置（从前到后、从上到下）严格升序排列
  // 确保上一项/下一项在文本流中自然线性推进，绝不出现跨跳乱序（如 1 -> 3 -> 2）
  items.sort((a, b) => {
    const aStart = a.sourceMatches[0]?.startIndex ?? 0
    const bStart = b.sourceMatches[0]?.startIndex ?? 0
    return aStart - bStart
  })

  if (items.length === 0) return null

  // 由「每行一段」解释而来：显性标注，让用户看出这是多段而不是一段折行
  const hint: DetectHint | undefined = lineCandidates ? 'base64-lines' : undefined

  if (items.length === 1) {
    return {
      kind: items[0].kind,
      fields: items[0].fields,
      blocks: items[0].blocks,
      copy: items[0].copy,
      download: items[0].download,
      sourceMatches: items[0].sourceMatches.map((m) => ({ ...m, active: true })),
      items,
      hint,
    }
  }

  // 存在 >= 2 个匹配结果（如多个 Base64、多个独立 URL、或 Base64 + URL 混杂）
  // 默认激活第 0 项，仅第 0 项标记为 active: true，其他项标记为 active: false
  return {
    kind: items[0].kind,
    fields: items[0].fields,
    blocks: items[0].blocks,
    copy: items[0].copy,
    download: items[0].download,
    sourceMatches: items.flatMap((it, idx) =>
      it.sourceMatches.map((m) => ({ ...m, active: idx === 0 })),
    ),
    items,
    hint,
  }
}
