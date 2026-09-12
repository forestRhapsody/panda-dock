import { describe, expect, it } from 'vitest'

import {
  cleanDomainPattern,
  isDomainMatched,
  isHostInList,
  parseDomainPatterns,
  shouldShowFloatingBall,
} from './domainMatch'

describe('cleanDomainPattern', () => {
  it('去掉协议、路径、查询、hash 并转小写', () => {
    expect(cleanDomainPattern('HTTPS://Example.com/path?x=1#h')).toBe('example.com')
    expect(cleanDomainPattern('  //a.com  ')).toBe('a.com')
  })

  it('空输入返回空串', () => {
    expect(cleanDomainPattern('')).toBe('')
    expect(cleanDomainPattern('   ')).toBe('')
  })
})

describe('parseDomainPatterns', () => {
  it('按换行/逗号/分号切分、清洗并去重', () => {
    expect(parseDomainPatterns('a.com\nb.com, c.com; https://a.com/x')).toEqual([
      'a.com',
      'b.com',
      'c.com',
    ])
  })

  it('忽略空项', () => {
    expect(parseDomainPatterns('\n , ; ')).toEqual([])
  })
})

describe('isDomainMatched', () => {
  it('基础域名同时命中自身与子域名', () => {
    expect(isDomainMatched('github.com', 'github.com', 'github.com')).toBe(true)
    expect(isDomainMatched('api.github.com', 'api.github.com', 'github.com')).toBe(true)
  })

  it('不做子串匹配：notgithub.com 不命中 github.com', () => {
    expect(isDomainMatched('notgithub.com', 'notgithub.com', 'github.com')).toBe(false)
  })

  it('通配符 *.example.com 命中自身与子域', () => {
    expect(isDomainMatched('a.example.com', 'a.example.com', '*.example.com')).toBe(true)
    expect(isDomainMatched('example.com', 'example.com', '*.example.com')).toBe(true)
    expect(isDomainMatched('example.com.evil.com', 'example.com.evil.com', '*.example.com')).toBe(
      false,
    )
  })

  it('带端口的规则按 host 精确匹配', () => {
    expect(isDomainMatched('localhost:3000', 'localhost', 'localhost:3000')).toBe(true)
    expect(isDomainMatched('localhost:3001', 'localhost', 'localhost:3000')).toBe(false)
  })

  it('空规则或空主机不命中', () => {
    expect(isDomainMatched('a.com', 'a.com', '')).toBe(false)
    expect(isDomainMatched('', '', 'a.com')).toBe(false)
  })
})

describe('isHostInList', () => {
  it('空列表不命中，命中任一规则即通过', () => {
    expect(isHostInList('a.com', 'a.com', [])).toBe(false)
    expect(isHostInList('api.a.com', 'api.a.com', ['b.com', 'a.com'])).toBe(true)
  })
})

describe('shouldShowFloatingBall', () => {
  const location = { host: 'api.github.com', hostname: 'api.github.com' }

  it('总开关关闭时一律不显示', () => {
    expect(shouldShowFloatingBall({ quickOpen: false }, location)).toBe(false)
  })

  it('缺少 location 信息时默认允许', () => {
    expect(shouldShowFloatingBall({ quickOpen: true })).toBe(true)
  })

  it('黑名单模式：命中则不显示，未命中则显示', () => {
    expect(
      shouldShowFloatingBall(
        { quickOpen: true, ballDomainMode: 'blacklist', ballBlacklist: ['github.com'] },
        location,
      ),
    ).toBe(false)
    expect(
      shouldShowFloatingBall(
        { quickOpen: true, ballDomainMode: 'blacklist', ballBlacklist: ['gitlab.com'] },
        location,
      ),
    ).toBe(true)
  })

  it('白名单模式：命中才显示，空名单则一律不显示', () => {
    expect(
      shouldShowFloatingBall(
        { quickOpen: true, ballDomainMode: 'whitelist', ballWhitelist: ['github.com'] },
        location,
      ),
    ).toBe(true)
    expect(
      shouldShowFloatingBall(
        { quickOpen: true, ballDomainMode: 'whitelist', ballWhitelist: ['gitlab.com'] },
        location,
      ),
    ).toBe(false)
    expect(shouldShowFloatingBall({ quickOpen: true, ballDomainMode: 'whitelist' }, location)).toBe(
      false,
    )
  })
})

describe('cleanDomainPattern 边界', () => {
  it('支持 http / https / ws / wss 与 // 前缀', () => {
    expect(cleanDomainPattern('http://a.com')).toBe('a.com')
    expect(cleanDomainPattern('ws://a.com')).toBe('a.com')
    expect(cleanDomainPattern('WSS://A.com/x')).toBe('a.com')
    expect(cleanDomainPattern('//a.com/x')).toBe('a.com')
  })

  it('只剥离路径 / 查询 / 哈希，端口保留（端口是匹配语义的一部分）', () => {
    expect(cleanDomainPattern('localhost:3000/path?x=1#h')).toBe('localhost:3000')
    expect(cleanDomainPattern('example.com?q=1')).toBe('example.com')
    expect(cleanDomainPattern('example.com#top')).toBe('example.com')
  })

  it('纯协议没有主机时清洗为空串（不会退化成可匹配的空规则）', () => {
    expect(cleanDomainPattern('http://')).toBe('')
    expect(cleanDomainPattern('https:///path')).toBe('')
  })
})

describe('parseDomainPatterns 边界', () => {
  it('大小写与协议差异产生的重复项会被去重', () => {
    expect(parseDomainPatterns('HTTPS://A.com/x\n a.com, a.com/')).toEqual(['a.com'])
  })

  it('只有分隔符或空白时返回空数组', () => {
    expect(parseDomainPatterns('')).toEqual([])
    expect(parseDomainPatterns(' ; , \n ; ')).toEqual([])
  })

  it('保留首次出现顺序', () => {
    expect(parseDomainPatterns('b.com; a.com; b.com, c.com')).toEqual(['b.com', 'a.com', 'c.com'])
  })
})

describe('isDomainMatched 边界与误匹配防护', () => {
  it('大小写不敏感（规则与主机都归一化）', () => {
    expect(isDomainMatched('API.GitHub.COM', 'API.GitHub.COM', 'GitHub.com')).toBe(true)
  })

  it('规则里带协议与路径不影响匹配', () => {
    expect(isDomainMatched('api.github.com', 'api.github.com', 'https://github.com/a/b?x=1')).toBe(
      true,
    )
  })

  it('规则带端口时只按完整 host 精确相等，子域与不同端口都不命中', () => {
    expect(isDomainMatched('LOCALHOST:3000', 'localhost', 'LocalHost:3000')).toBe(true)
    expect(isDomainMatched('sub.localhost:3000', 'sub.localhost', 'localhost:3000')).toBe(false)
    expect(isDomainMatched('localhost', 'localhost', 'localhost:3000')).toBe(false)
  })

  it('后缀匹配必须是「点 + 规则」：中缀与后缀伪装都不命中', () => {
    expect(isDomainMatched('evilgithub.com', 'evilgithub.com', 'github.com')).toBe(false)
    expect(isDomainMatched('github.com.evil.com', 'github.com.evil.com', 'github.com')).toBe(false)
    expect(isDomainMatched('github.com', 'github.com', 'github.com')).toBe(true)
    expect(isDomainMatched('a.b.github.com', 'a.b.github.com', 'github.com')).toBe(true)
  })

  it('通配符 *. 需要非空基础域名，漏点写法不命中', () => {
    expect(isDomainMatched('a.com', 'a.com', '*.')).toBe(false)
    expect(isDomainMatched('a.example.com', 'a.example.com', '*example.com')).toBe(false)
    expect(isDomainMatched('notexample.com', 'notexample.com', '*.example.com')).toBe(false)
    expect(isDomainMatched('a.b.example.com', 'a.b.example.com', '*.example.com')).toBe(true)
  })

  it('空 / 纯空白 / 纯协议规则不命中，空主机也不命中', () => {
    expect(isDomainMatched('a.com', 'a.com', '   ')).toBe(false)
    expect(isDomainMatched('a.com', 'a.com', 'https://')).toBe(false)
    expect(isDomainMatched('', '', '*.example.com')).toBe(false)
  })
})

describe('isHostInList 边界', () => {
  it('undefined / null / 全空白规则一律不命中', () => {
    expect(isHostInList('a.com', 'a.com', undefined as never)).toBe(false)
    expect(isHostInList('a.com', 'a.com', null as never)).toBe(false)
    expect(isHostInList('a.com', 'a.com', ['   '])).toBe(false)
  })

  it('任一规则命中即通过，支持纯域名 + 端口 + 通配符混合', () => {
    expect(isHostInList('localhost:3000', 'localhost', ['*.github.com', 'localhost:3000'])).toBe(
      true,
    )
    expect(isHostInList('a.other.com', 'a.other.com', ['*.github.com', 'localhost:3000'])).toBe(
      false,
    )
  })
})

describe('shouldShowFloatingBall 边界', () => {
  const loc = { host: 'a.com', hostname: 'a.com' }

  it('quickOpen 未设置（undefined）视为开启', () => {
    expect(shouldShowFloatingBall({}, loc)).toBe(true)
  })

  it('location 为空对象或完全缺省时默认允许', () => {
    expect(shouldShowFloatingBall({ quickOpen: true }, {})).toBe(true)
    expect(shouldShowFloatingBall({ quickOpen: true })).toBe(true)
  })

  it('location 只有 host（无 hostname）时，带端口的黑名单仍按 host 命中', () => {
    expect(
      shouldShowFloatingBall(
        { quickOpen: true, ballBlacklist: ['localhost:3000'] },
        { host: 'localhost:3000' },
      ),
    ).toBe(false)
  })

  it('白名单为空（undefined）时一律不显示', () => {
    expect(shouldShowFloatingBall({ ballDomainMode: 'whitelist' }, loc)).toBe(false)
  })

  it('黑名单为空时默认显示，通配符命中子域则隐藏', () => {
    const sub = { host: 'api.example.com', hostname: 'api.example.com' }
    expect(shouldShowFloatingBall({ quickOpen: true, ballBlacklist: [] }, sub)).toBe(true)
    expect(shouldShowFloatingBall({ quickOpen: true, ballBlacklist: ['*.example.com'] }, sub)).toBe(
      false,
    )
  })

  it('quickOpen=false 优先于白名单命中（总开关优先级最高）', () => {
    expect(
      shouldShowFloatingBall(
        { quickOpen: false, ballDomainMode: 'whitelist', ballWhitelist: ['a.com'] },
        loc,
      ),
    ).toBe(false)
  })

  it('未知域名模式按黑名单处理', () => {
    expect(
      shouldShowFloatingBall({ ballDomainMode: 'allow' as never, ballBlacklist: ['a.com'] }, loc),
    ).toBe(false)
  })
})
