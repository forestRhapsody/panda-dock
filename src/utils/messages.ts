/** Content Script 与 Background / 扩展页面之间的消息协议 */

/** 侧边栏页 → content：切换当前网页里的抽屉开合 */
export const MSG_TOGGLE_DRAWER = 'TOGGLE_TOOLKIT_DRAWER'

/** content → background：请求尽力唤起浏览器原生侧边栏 */
export const MSG_OPEN_NATIVE_SIDE_PANEL = 'OPEN_NATIVE_SIDE_PANEL'

/** content → background：请求打开扩展设置页（options.html） */
export const MSG_OPEN_OPTIONS = 'OPEN_OPTIONS_PAGE'

/** 扩展页面(侧边栏等) → content：读取当前页 localStorage/sessionStorage */
export const MSG_STORAGE_READ = 'TOOLKIT_STORAGE_READ'

/** 扩展页面(侧边栏等) → content：删除当前页存储里的某个 key */
export const MSG_STORAGE_REMOVE = 'TOOLKIT_STORAGE_REMOVE'

/** 扩展页面(侧边栏等) → content：写入/更新当前页存储里的某个 key */
export const MSG_STORAGE_SET = 'TOOLKIT_STORAGE_SET'

/** 扩展页面(侧边栏等) → content：清空当前页的某一存储区域 */
export const MSG_STORAGE_CLEAR = 'TOOLKIT_STORAGE_CLEAR'

/** 悬浮球点击行为配置 */
export type BallAction = 'drawer' | 'native'
