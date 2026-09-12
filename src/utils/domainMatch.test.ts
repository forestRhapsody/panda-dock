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
