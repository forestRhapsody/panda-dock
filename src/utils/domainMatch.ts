/** 域名/主机清洗与匹配工具函数：用于判定悬浮球在当前网站是否应该展示。 */

/** 清洗用户输入的单条域名/主机规则：去协议、路径、空白并转小写 */
export function cleanDomainPattern(raw: string): string {
  let s = raw.trim().toLowerCase()
  if (!s) return ''

  // 移除常见协议头 http://, https://, ws://, wss://, //
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^\/\//, '')

  // 移除路径与 hash、query（例如 example.com/path?foo=1 -> example.com）
  s = s.split('/')[0].split('?')[0].split('#')[0]

  return s.trim()
}

/** 将多行或分隔符文本解析为清洗后的唯一域名规则数组 */
export function parseDomainPatterns(text: string): string[] {
  const list = text
    .split(/[\n,;]/)
    .map(cleanDomainPattern)
    .filter(Boolean)
  return Array.from(new Set(list))
}

/** 判定当前页面的 host/hostname 是否命中单条规则 */
export function isDomainMatched(
  currentHost: string,
  currentHostname: string,
  pattern: string,
): boolean {
  const clean = cleanDomainPattern(pattern)
  if (!clean) return false

  const host = currentHost.toLowerCase()
  const hostname = currentHostname.toLowerCase()

  // 1. 通配符前缀：如 *.example.com
  if (clean.startsWith('*.')) {
    const baseDomain = clean.slice(2)
    if (!baseDomain) return false
    return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)
  }

  // 2. 规则指定了具体端口（如 localhost:3000 或 127.0.0.1:8080）
  if (clean.includes(':')) {
    return host === clean
  }

  // 3. 基础域名匹配：例如 github.com 自动匹配 github.com 及其所有子域名（如 api.github.com）
  if (hostname === clean || hostname.endsWith(`.${clean}`)) {
    return true
  }

  return false
}

/** 判定当前 host/hostname 是否在给定的规则列表中 */
export function isHostInList(host: string, hostname: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((p) => isDomainMatched(host, hostname, p))
}

export interface DomainCheckSettings {
  quickOpen?: boolean
  ballDomainMode?: 'blacklist' | 'whitelist'
  ballBlacklist?: string[]
  ballWhitelist?: string[]
}

/** 综合判定悬浮球在当前页面是否应该显示 */
export function shouldShowFloatingBall(
  settings: DomainCheckSettings,
  location?: { host?: string; hostname?: string },
): boolean {
  // 总开关关闭时一律不显示
  if (settings.quickOpen === false) return false

  // 无可用 location 时（如某些测试或特殊环境）默认允许
  if (!location?.hostname && !location?.host) return true

  const host = location.host ?? ''
  const hostname = location.hostname ?? ''
  const mode = settings.ballDomainMode === 'whitelist' ? 'whitelist' : 'blacklist'

  if (mode === 'whitelist') {
    const whitelist = settings.ballWhitelist ?? []
    return isHostInList(host, hostname, whitelist)
  }

  // 黑名单模式：只要不在黑名单中就显示
  const blacklist = settings.ballBlacklist ?? []
  return !isHostInList(host, hostname, blacklist)
}
