/** Content Script 与 Background / 扩展页面之间的消息协议 */

/** 原生侧边栏与 Background 建立长连接的 Port 名称（用于互斥状态同步） */
export const PORT_SIDEPANEL = 'panda-dock-sidepanel'

/** 侧边栏页 → content：切换当前网页里的抽屉开合 */
export const MSG_TOGGLE_DRAWER = 'PANDA_TOGGLE_DRAWER'

/** 扩展页面(popup等) → content：强制打开当前网页里的抽屉（不改变悬浮球点击行为） */
export const MSG_OPEN_DRAWER = 'PANDA_OPEN_DRAWER'

/** 扩展页面(popup等) → content：关闭当前网页里的抽屉（用于与原生侧边栏互斥） */
export const MSG_CLOSE_DRAWER = 'PANDA_CLOSE_DRAWER'

/** content → background：关闭当前窗口的原生侧边栏（用于与网页内抽屉互斥） */
export const MSG_CLOSE_NATIVE_SIDE_PANEL = 'CLOSE_NATIVE_SIDE_PANEL'

/** content → background：请求尽力唤起浏览器原生侧边栏 */
export const MSG_OPEN_NATIVE_SIDE_PANEL = 'OPEN_NATIVE_SIDE_PANEL'

/** content → background：请求打开扩展设置页（options.html） */
export const MSG_OPEN_OPTIONS = 'OPEN_OPTIONS_PAGE'

/** 扩展页面(侧边栏等) → content：读取当前页 localStorage/sessionStorage */
export const MSG_STORAGE_READ = 'PANDA_STORAGE_READ'

/** 扩展页面(侧边栏等) → content：读取当前页的网址（window.location.href） */
export const MSG_GET_PAGE_URL = 'PANDA_GET_PAGE_URL'

/** 扩展页面(侧边栏等) → content：删除当前页存储里的某个 key */
export const MSG_STORAGE_REMOVE = 'PANDA_STORAGE_REMOVE'

/** 扩展页面(侧边栏等) → content：写入/更新当前页存储里的某个 key */
export const MSG_STORAGE_SET = 'PANDA_STORAGE_SET'

/** 扩展页面(侧边栏等) → content：清空当前页的某一存储区域 */
export const MSG_STORAGE_CLEAR = 'PANDA_STORAGE_CLEAR'

/** background → content：右键菜单「智能识别选中文字」→ 显示悬浮面板（携带选中文本与位置） */
export const MSG_DETECT_SELECTION = 'PANDA_DETECT_SELECTION'

/** background → content：全局快捷键触发智能解析（解析选中文本或唤起解析面板） */
export const MSG_TOGGLE_DETECT = 'PANDA_TOGGLE_DETECT'

/** 扩展页面/content → background：获取当前网页的 Cookies */
export const MSG_COOKIE_GET_ALL = 'PANDA_COOKIE_GET_ALL'

/** 扩展页面/content → background：删除指定 Cookie */
export const MSG_COOKIE_REMOVE = 'PANDA_COOKIE_REMOVE'

/** 扩展页面/content → background：设置/写入 Cookie（单条或多条） */
export const MSG_COOKIE_SET = 'PANDA_COOKIE_SET'

/** 扩展页面/content → background：清空当前网页的全部 Cookies */
export const MSG_COOKIE_CLEAR_ALL = 'PANDA_COOKIE_CLEAR_ALL'

/** 扩展页面/content → background：打开扩展快捷键设置页（chrome://extensions/shortcuts） */
export const MSG_OPEN_SHORTCUTS = 'OPEN_SHORTCUTS_PAGE'

/** content → background：获取当前 Tab 所属的 windowId（用于窗口级工作区隔离） */
export const MSG_GET_WINDOW_ID = 'PANDA_GET_WINDOW_ID'

/** content → background：获取当前 Tab 的 tabId（用于标签页级工作区草稿隔离） */
export const MSG_GET_TAB_ID = 'PANDA_GET_TAB_ID'

/** 悬浮球点击行为配置 */
export type BallAction = 'drawer' | 'native'

/**
 * 跨端错误码。
 * Service Worker 无法感知用户的语言设置（i18n 由各端的 useLocale 驱动），
 * 因此 background **只回错误码**，由 UI 侧（src/tools/storage.ts）统一映射为当前语言文案，
 * 避免在后台硬编码任何一种语言的句子（历史上曾因此让英文界面显示中文）。
 * 新增错误码时必须同步：storage.ts 的 ERROR_KEYS 映射 + zh/en 语言包（由 storage.test.ts 断言兜底）。
 */
export const ERROR_CODES = [
  /** 当前标签页不是 http(s) 网页，读不到 Cookie */
  'ERR_COOKIE_NO_PAGE_URL',
  /** 删除 Cookie 时缺少 url / name 参数 */
  'ERR_COOKIE_MISSING_PARAM',
  /** chrome.cookies.remove 未删除成功 */
  'ERR_COOKIE_REMOVE_FAILED',
  /** chrome.cookies.set 写入失败（多为 Domain 作用域或 Secure 属性不匹配） */
  'ERR_COOKIE_SET_FAILED',
  /** 没有可写入的 Cookie 数据 */
  'ERR_COOKIE_EMPTY_PAYLOAD',
  /** 无法确定目标网页地址 */
  'ERR_NO_TARGET_URL',
  /** 兜底：未预期的异常（detail 携带原始报错，便于排查） */
  'ERR_UNEXPECTED',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** 运行时判定：只有已注册的错误码才走本地化映射，其余回退到调用方的兜底文案 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/** background → UI 的统一失败响应：只表达语义（code），不携带任何语言的文案 */
export interface ErrorResponse {
  ok: false
  code: ErrorCode
  /** 可选诊断信息（如 Chrome 原生报错），由 UI 侧决定是否展示 */
  detail?: string
}

/** 构造失败响应 */
export function errorResponse(code: ErrorCode, detail?: string): ErrorResponse {
  return detail ? { ok: false, code, detail } : { ok: false, code }
}
