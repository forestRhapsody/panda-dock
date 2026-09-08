/** Content Script 与 Background / 扩展页面之间的消息协议 */

/** 侧边栏页 → content：切换当前网页里的抽屉开合 */
export const MSG_TOGGLE_DRAWER = 'TOGGLE_TOOLKIT_DRAWER'

/** 扩展页面(popup等) → content：强制打开当前网页里的抽屉（不改变悬浮球点击行为） */
export const MSG_OPEN_DRAWER = 'OPEN_TOOLKIT_DRAWER'

/** 扩展页面(popup等) → content：关闭当前网页里的抽屉（用于与原生侧边栏互斥） */
export const MSG_CLOSE_DRAWER = 'CLOSE_TOOLKIT_DRAWER'

/** content → background：关闭当前窗口的原生侧边栏（用于与网页内抽屉互斥） */
export const MSG_CLOSE_NATIVE_SIDE_PANEL = 'CLOSE_NATIVE_SIDE_PANEL'

/** content → background：请求尽力唤起浏览器原生侧边栏 */
export const MSG_OPEN_NATIVE_SIDE_PANEL = 'OPEN_NATIVE_SIDE_PANEL'

/** content → background：请求打开扩展设置页（options.html） */
export const MSG_OPEN_OPTIONS = 'OPEN_OPTIONS_PAGE'

/** 扩展页面(侧边栏等) → content：读取当前页 localStorage/sessionStorage */
export const MSG_STORAGE_READ = 'TOOLKIT_STORAGE_READ'

/** 扩展页面(侧边栏等) → content：读取当前页的网址（window.location.href） */
export const MSG_GET_PAGE_URL = 'TOOLKIT_GET_PAGE_URL'

/** 扩展页面(侧边栏等) → content：删除当前页存储里的某个 key */
export const MSG_STORAGE_REMOVE = 'TOOLKIT_STORAGE_REMOVE'

/** 扩展页面(侧边栏等) → content：写入/更新当前页存储里的某个 key */
export const MSG_STORAGE_SET = 'TOOLKIT_STORAGE_SET'

/** 扩展页面(侧边栏等) → content：清空当前页的某一存储区域 */
export const MSG_STORAGE_CLEAR = 'TOOLKIT_STORAGE_CLEAR'

/** background → content：右键菜单「智能识别选中文字」→ 显示悬浮面板（携带选中文本与位置） */
export const MSG_DETECT_SELECTION = 'TOOLKIT_DETECT_SELECTION'

/** background → content：全局快捷键触发智能解析（选中文本就地解析 / 未选中右上角弹出，若已打开则收回） */
export const MSG_TOGGLE_DETECT = 'TOOLKIT_TOGGLE_DETECT'

/** 扩展页面/content → background：获取当前网页的 Cookies */
export const MSG_COOKIE_GET_ALL = 'TOOLKIT_COOKIE_GET_ALL'

/** 扩展页面/content → background：删除指定 Cookie */
export const MSG_COOKIE_REMOVE = 'TOOLKIT_COOKIE_REMOVE'

/** 扩展页面/content → background：设置/写入 Cookie（单条或多条） */
export const MSG_COOKIE_SET = 'TOOLKIT_COOKIE_SET'

/** 扩展页面/content → background：清空当前网页的全部 Cookies */
export const MSG_COOKIE_CLEAR_ALL = 'TOOLKIT_COOKIE_CLEAR_ALL'

/** 扩展页面/content → background：打开扩展快捷键设置页（chrome://extensions/shortcuts） */
export const MSG_OPEN_SHORTCUTS = 'OPEN_SHORTCUTS_PAGE'

/** 悬浮球点击行为配置 */
export type BallAction = 'drawer' | 'native'
