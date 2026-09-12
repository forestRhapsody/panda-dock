# TASKS

> 本文件是仓库内的任务清单，供维护者与 AI 编码代理协作使用（可选）。
> 历史任务记录已在发布前清理——那些是开发过程中的内部笔记，不适合随仓库公开。

## 约定

1. 只推进状态为 `[~]`（进行中）的条目；同一时刻尽量只保留一个。
2. 完成后改为 `[x]`，并在「结果」简述产出；再把下一个 `[ ]` 改为 `[~]`。
3. 遇到需要人拍板的问题改为 `[!]`，在「阻塞原因」写清卡点与建议，不要臆测硬做。
4. 动手前先读 [`AGENTS.md`](./AGENTS.md)，遵守其中的核心硬约定与「新增一个工具」流程。
5. 改完跑 `pnpm format && pnpm lint && pnpm type-check && pnpm test`（涉及构建再加 `pnpm build`）。

## 状态图例

| 标记 | 含义 |
| --- | --- |
| `[ ]` | 待办 |
| `[~]` | 进行中 |
| `[x]` | 完成 |
| `[!]` | 阻塞（需人介入） |
| `[?]` | 待确认 |

## 任务列表

- [x] **T1 单元测试全面补齐（默认现有测试不完整）**
  - 描述：为 `src/` 下所有可测模块补齐/加强单元测试。纯逻辑模块（`tools/*.ts`、`utils/*.ts`）逐分支覆盖；DOM 与 hook 模块用 happy-dom + 手写 `createRoot`/`act`（仓库无 @testing-library/react，不新增依赖）；跨端 `background` 用完整 chrome 桩按消息路由验证错误码协议。默认现有测试均不完整，需补边界值、错误分支、旧数据兼容与 i18n 中英双向断言。仅新增/修改 `*.test.ts(x)`，不改动任何非测试源码。
  - 验收标准：`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿；盘点表中每个可测模块都有同目录测试文件；未覆盖项与源码疑点在「结果 / 未验证」中如实列出。
  - 依赖：无
  - 关联文件：`src/**/*.test.ts(x)`、`src/**/*.dom.test.ts(x)`、`TASKS.md`
  - 结果：**完成。**
    - 规模：测试文件 **18 → 76**，用例 **217 → 1819**（0 失败）。新增 58 个测试文件，扩建 18 个既有文件；未删除任何原有断言。
    - 覆盖：`src/` 下所有 `.ts/.tsx` 模块均有测试。唯一例外是四个入口 bootstrap（`src/main.tsx`、`src/options/main.tsx`、`src/popup/main.tsx`、`src/sidepanel/main.tsx`），它们由合并的 `src/entries.dom.test.tsx` 统一覆盖，因此没有同名测试文件。
    - 重点：`background/main.ts` 66 例（4 个 Cookie handler 的全部 `ERROR_CODES`、`getCookieUrl` 规则、sidePanel 开/关/toggle/`forceOpen`、Port 长连接、快捷键三条路径含 native 模式首帧同步 `sidePanel.open` 的手势令牌保护、右键菜单）；`detect.ts` 205 例；`hash.ts` 71 例；`storage`/`cookieRaw`/`handoff` 154 例；`qrcode.ts` 26 例（canvas fake ctx + 真实 jsQR 解码还原原文）；`ToolsApp` / `Tooltip` / `TkSelect` / `ConfirmDialog` / `StorageTool`（断言删除/清空必须走 `ConfirmDialog` 且 `window.confirm` 从未被调用）等组件层；所有涉及文案的用例均做 zh/en 双向断言并恢复 zh。
    - 门禁（逐条实测）：`pnpm format` ✓（全 unchanged）、`pnpm lint` ✓（exit 0）、`pnpm type-check` ✓（0 error）、`pnpm test` ✓（76 files / 1819 tests）、`pnpm build` ✓（三段 vite 构建全部成功）。
    - 约束遵守：未改动任何非测试源码（`git status` 确认源码改动仅为本次工作开始前已存在的暂存改动），未新增依赖，无网络请求，无 snapshot，无 `.only/.skip`。
  - 未验证（本次未做，需在真实扩展环境补做）：
    - **未在真实浏览器/扩展里实测**。本任务只新增/修改测试，未改 `chrome.*`、content script、快捷键、抽屉/侧边栏互斥等源码，因此按 AGENTS §7 未做 build 后手测；上述路径的行为只由 happy-dom + chrome 桩证明。
    - happy-dom 无排版：真实像素高度、滚动条、`getBoundingClientRect` 相关行为未验证（Tooltip/TkSelect 的真实翻转与防溢出定位、`AutoArea`/`JsonTextarea` 自适应高度、`HighlightArea` 滚动同步、`revealActiveTab` 的 `scrollBy`）；这些用例只断言零矩形下可确定的分支。
    - 拖拽：`OptionsPage`/`ToolsApp` 的 dnd-kit PointerSensor 真实拖拽序列无法在 happy-dom 复现，改为断言「写入存储的顺序数据结构正确」。
    - 真实文件选择对话框、`FileReader.onerror`、真实下载落盘、canvas 2D 真实栅格/图片解码：以 mock 断言调用参数，端到端未验证。
    - 夏令时切换瞬间的本地时间歧义（依赖运行环境时区）：改用固定 `Z`/偏移时间戳覆盖。
  - 源码疑点（原始记录，**测试按当时的真实现状锁定**）。**处置状态**：T2 已修复第 2、3、4、5、8 组，以及第 1 组的主缺陷与第 9 组的 `ConfirmDialog` 部分；**第 1 组的 `askActiveTab` 死文案、第 9 组的 `persist` 立即写入仍未处理**；第 10 组只修了 `SidePanelPage` 的 chrome 守卫（入口 `getElementById('root')!` 兜底未做）。剩余项已重新分类为 T3（A 类可直接修 / B 类需拍板）：
    1. `src/tools/storage.ts` `resolveStorageError`：`detail` 插值只对 `ERR_COOKIE_SET_FAILED` 生效，而语言包 `tool.storage.errorUnexpected` 模板含 `{{detail}}` → 兜底码 `ERR_UNEXPECTED` 会把字面量 `{{detail}}` 显示给用户（已 grep 两个语言包确认）。另 `askActiveTab` 中 `errorNoActiveTab` 抛错即被同函数 catch 吞掉，是永不出现的死文案。
    2. `src/tools/UrlTool.tsx` `UrlCodecPanel`：给 `useToolDraft` 传的是**内联对象字面量**默认值，使 `draft.ts` 挂载 effect 依赖每帧变化 → 每帧 `clearTimeout` 掉 200ms 草稿写入，`url.codec` 从不落盘；且存储已有旧值时会回滚用户刚输入的内容（实测 OLD→NEW 回滚为 OLD）。修复方向：默认对象提为模块常量。
    3. `src/tools/file.ts` `detectMimeFromBytes`：SQLite 用 `ascii(0,15)` 比较 16 字节字面量、RAR 用 `ascii(0,7)` 比较 6 字节字面量（缺结尾 `\x00`）→ 两个分支永远不可达，真实 SQLite/RAR 头返回 `null`。
    4. `src/utils/clipboard.ts`：降级路径的 `ta.remove()` 不在 `finally`，`execCommand` 抛错时临时 `textarea` 残留在宿主页。
    5. `src/utils/shortcuts.ts` `openShortcutsPage`：`tabs.create` 抛错被外层 catch 吞掉直接 `return false`，不会回退到 `runtime.sendMessage`（与 `env.openOptionsPage` 不一致）。
    6. `src/utils/timestamp.ts`：date-only（`YYYY-MM-DD`/`YYYY.MM.DD`）按 UTC 解析却用本地日历校验，负 UTC 偏移时区会被误判为非法；中文/US/英文月份分支不校验日期滚动（`2025年2月31日`、`Feb 30, 2025` 静默进位）；`parseStamp` 的 `toISOString/toUTCString` catch 不可达。
    7. `src/utils/cookieRaw.ts`：不识别引号值（`note="a;b"` 被按 `;` 截断）；属性名冲突时整行按 Set-Cookie 解析；`serializeCookieToRaw` 对 `expirationDate===0` 省略、空 name 输出 `=1`，序列化↔解析不闭环。
    8. `src/tools/StorageTool.tsx` `requestConfirm` 的 `catch { window.confirm(...) }` 降级分支不可达，但它是源码中唯一残留的原生 `confirm` 调用点（AGENTS §4 第 14 条禁止）。
    9. `src/options/OptionsPage.tsx`：`removeBallImage` / `resetBallStyle` 直接清空 `chrome.storage.local` 的 ballImage 而未走 `ConfirmDialog`（与 §8「不静默毁数据」有出入）；`persist` 为每次改动立即写入，未用 §5 的「脏标记 + useEffect」模式。
    10. `src/sidepanel/SidePanelPage.tsx`：`chrome.runtime?.onMessage` 未落在 `typeof chrome !== 'undefined'` 守卫块内（同函数上方 Port 块有守卫），与 §4 第 4 条不一致；四个入口用 `getElementById('root')!` 无兜底。
    11. `src/tools/QrCodeTool.tsx`：移除 Logo 后纠错等级仍停在 `'H'` 不回落；`handleCropConfirm` 不清理 `cropSourceUrl`（objectURL 延后 revoke）；`QrLogoCropModal.handleConfirm` 在 `getContext('2d')` 为 null 时静默 return。
    12. `src/tools/detect.ts`：UUID 只认 v1–v5（v6/v7 退化为 hex 候选）；自由文本中的 JWT 会额外产出一条重叠的伪 URL 项；裸域名规则把 `file.txt` / `README.md` 误判为 URL；`detect` 从不返回 `kind:'urls'`（仅存在于类型与 `KIND_LABEL`）。
    13. `AGENTS.md` §5 草稿表与实现不符：`hash` 实为对象（`{tab,textInput,hmacKey,showHmac,uppercase,expectedChecksum}`）而非 string；`timestamp` 的实际 key 是 `timestamp.input`。
    14. 其它文案/语义细节：`Toaster` 对 `info` 使用 `alert` 图标且空列表 `return null` 使 live region 随内容销毁；`StatusText` 无 `role="status"`；`DetectResultView` 的 `KIND_LABEL` 无未知 kind 兜底、类型名前的全角「：」在英文界面仍为全角；`env.extVersion` 用 `??`（`version===''` 返回空串）；`formatShortcutForDisplay` 非 mac 分支不改大小写；`FloatingBall`/`settings` 注释写「默认 60」实际常量 80；`Drawer`/`ToolkitOverlay` 无 Escape/遮罩关闭路径。

- [x] **T2 修复 A 类明确源码 bug（T1 疑点中已复现/有代码级铁证的部分）**
  - 描述：按用户确认的范围，只修「明确 bug」，不动需要产品拍板的设计取舍。每项都同步更新原先「锁定现状」的断言，并补一条会在旧代码上变红的回归用例。
  - 验收标准：`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿；被修行为都有新断言覆盖。
  - 依赖：T1
  - 关联文件：见下表
  - 结果：**完成（9 项）**，测试 1819 → **1825 例**（新增/改写后仍 0 失败）。

    | # | 文件 | 修复内容 | 测试变更 |
    | --- | --- | --- | --- |
    | 1 | `src/tools/storage.ts`、`src/i18n/locales/{zh,en}.json` | 新增 `ERROR_DETAIL_KEYS`：有 detail 才用带 `{{detail}}` 的模板，否则回落无占位符基础文案；`errorUnexpected` 拆成 `errorUnexpected` + `errorUnexpectedDetail`，新增 `storageErrorDetailKey()` 供断言 | `storage.test.ts` 改写原「占位符残留」用例，新增「基础文案一律不含 `{{}}`、详情模板真的插值」回归 |
    | 2 | `src/tools/file.ts` | RAR 比较串补结尾 `\x00`（7 字节）、SQLite 取长改为 16 字节，两个魔数分支可达 | `file.test.ts` 改为断言识别成功，并新增「差一个字节的伪头不误判」 |
    | 3 | `src/utils/clipboard.ts` | `ta.remove()` 移入 `finally`，`execCommand` 抛错也不再残留临时节点 | `clipboard.dom.test.ts` 断言异常路径 textarea 数量为 0 |
    | 4 | `src/tools/UrlTool.tsx` | 新增模块常量 `DEFAULT_CODEC_DRAFT`，`useToolDraft` 的 effect 依赖稳定 | `UrlTool.dom.test.tsx` 去掉「删存储」的绕过手段，断言 `chrome.storage.session` 真落盘，并新增「旧草稿不回滚新输入」回归 |
    | 5 | `src/utils/shortcuts.ts` | `tabs.create` 失败改为回退 `runtime.sendMessage(MSG_OPEN_SHORTCUTS)`，与 `openOptionsPage` 同套降级 | `shortcuts.test.ts` 改为断言二级降级被调用，并新增「两者都失败 → false」 |
    | 6 | `src/tools/StorageTool.tsx` | 删除不可达且违反 §4 第 14 条的 `window.confirm` 降级分支，破坏性操作只走 `ConfirmDialog` | `StorageTool.dom.test.tsx` 既有「`window.confirm` 从未被调用」断言继续覆盖 |
    | 7 | `src/options/OptionsPage.tsx`、`src/i18n/locales/{zh,en}.json` | 移除自定义图片、以及「恢复默认样式」（会连带删图）都改为先弹 `ConfirmDialog`（danger）；无自定义图片时直接生效；新增 4 个确认文案 key | `OptionsPage.dom.test.tsx` 改为「取消不删 / 确认才删」双向断言，并新增「无图时不弹框」 |
    | 8 | `src/sidepanel/SidePanelPage.tsx` | `chrome.runtime.onMessage` 的 add/removeListener 落回 `typeof chrome !== 'undefined'` 守卫（§4 第 4 条） | `SidePanelPage.dom.test.tsx` 新增「无 chrome 也能挂载、不抛 ReferenceError」 |
    | 9 | `src/tools/handoff.ts` | JSON 草稿改为 `{...DEFAULT_JSON_DRAFT, ...(stored ?? {}), ...}`，历史残缺草稿补齐缺失字段 | `handoff.test.ts` 改为断言 key 集合等于默认对象且存量偏好保留 |

  - 浏览器实测进展（人工在真实 Chrome 中逐条走查）：
    - ✅ **第 4 项已实测通过**：URL 工具「编解码」输入后，Service Worker 控制台 `chrome.storage.session.get('toolkit.draft.url.codec')` 能读到 `{scope,input,output}`（修复前该 key 根本不存在），刷新页面后停留在编解码页且输入/结果完整恢复。
    - ✅ **第 7 项已实测通过**：Options 页「移除」自定义图片与「悬浮球样式 - 恢复默认」都会弹**应用内** `ConfirmDialog`（不是浏览器原生对话框），取消时数据保留、确认后才清除图片。
    - ✅ **第 1 项已实测通过**：在 Service Worker 控制台把 `chrome.cookies.getAll` 覆盖成抛错，Cookies 区域刷新后状态行显示「操作失败：boom-detail」——detail 正确插值，**没有**字面量 `{{detail}}`（修复前的表现正是后者）。
    - ✅ **第 8 项已实测通过**：侧边栏关闭通道归位——Escape 不再误关面板、Cookie 弹窗上的 Escape 只关弹窗、`Alt+Shift+D` 与 Chrome 自带 X 按钮仍能关闭、抽屉与侧边栏双向互斥正常。
    - ✅ **第 5 项已实测通过**：Options 页「前往修改」与 Popup 底部快捷键按钮都能打开 `chrome://extensions/shortcuts`；把 Options 页的 `chrome.tabs.create` 覆盖成抛错后再点，**仍能打开**（走 background 中转的降级分支，修复前点了没反应）。
    - ✅ **第 9 项已实测通过**：先在 `chrome.storage.session` 塞入**缺 `splitRatio`** 的残缺 JSON 草稿，再从智能解析点「在 JSON 工具中打开」——JSON 工具正常打开、输入为格式化结果、`indent=8` 与 `sortKeys` 等存量偏好保留、分屏正常；回读草稿确认 `splitRatio` 已由默认值补齐。
    - ⏳ **未做 UI 实测（可观测性低 / 无行为变更，仅单测覆盖）**：第 2 项（`file.ts` 的 RAR/SQLite 魔数——需要构造真实二进制样本，单测已直接覆盖魔数分支）、第 3 项（剪贴板降级路径的 textarea 清理——需人为让 `execCommand` 抛错）、第 6 项（StorageTool 删除不可达的 `window.confirm` 分支，行为无变化）。
  - 未验证（**本环境无浏览器**）：本环境是 WSL2/Debian 13、非 root，且缺少 Chromium 运行所需的 16 个共享库（`libnss3`/`libgbm`/`libasound`/`libpango` 等，`ldconfig -p` 全部为 MISS），无法启动任何浏览器，因此按 AGENTS §7 应在 `pnpm build` 后手测的部分由维护者在自己的 Chrome 上人工完成：
    - **第 1 项**：让一次 Cookie 操作走 `ERR_UNEXPECTED`，确认状态区显示「操作失败：<原因>」而不是字面量 `{{detail}}`；无 detail 时显示「操作失败」。
    - **第 3 项**：在非安全上下文（http 页面）点复制，确认页面 DOM 里没有残留的隐藏 `textarea`。
    - **第 4 项**：URL 工具切到「编解码」输入内容 → 重开侧边栏/新标签页，确认内容被恢复（修复前必然丢失）；打开 DevTools 确认 `toolkit.draft.url.codec` 出现在 `chrome.storage.session`。
    - **第 5 项**：点界面上的「设置快捷键」入口，确认能打开 `chrome://extensions/shortcuts`（content script 路径下走的是 background 中转）。
    - **第 7 项**：Options 页「移除」自定义图片与「悬浮球样式 - 恢复默认」都应弹确认框，取消后图片仍在；确认后 `chrome.storage.local.ballImage` 被清空。
    - **第 8 项**：真实扩展页里侧边栏的关闭指令（Port / runtime 消息 / 快捷键）仍然生效——守卫改造不得影响正常路径。
    - **第 9 项**：从智能解析点「在 JSON 工具中打开」，确认 JSON 工作台的缩进/排序/分屏偏好被保留且不会因缺字段报错。
  - 说明：第 2 项（`file.ts` 魔数）也影响「智能识别」对文件头的判断，`detect.test.ts` 中 7z 等用例已覆盖相邻分支；SQLite/RAR 的端到端表现建议一并手测。

- [x] **T3 剩余开放疑点的 A 类修复（15 项，已完成）**
  - 描述：把 T1 遗留的开放疑点按「修法是否唯一、是否涉及产品取舍」分成 A / B 两类后，先执行 A 类（无争议、修法唯一）。分类结论均在源码里逐条核对；每项都同步更新了原先锁定现状的断言，并补了会在旧代码上变红的回归用例。
  - 验收标准：`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：T1、T2
  - 结果：**15 项全部完成**（原计划 9 项 + 人工浏览器实测追加发现并修复 A10～A12、A14、A15 + 行为对齐 A13），测试 1825 → **1838 例**（0 失败）。

    | # | 文件 | 修复内容 | 测试变更 |
    | --- | --- | --- | --- |
    | A1 | `src/tools/storage.ts` | `askActiveTab` 无活动标签页时改为直接 `return` 失败结果（原来 `throw` 被同函数 catch 吞掉，`errorNoActiveTab` 是死文案） | `storage.test.ts` 桥接用例拆成「无 tab → `errorNoActiveTab`」「query/sendMessage 抛错 → `errorUnreadable`」，并断言两条文案确实不同 |
    | A2 | `src/tools/DetectResultView.tsx` + 语言包 | 全角「：」硬编码改为 `tool.detect.detected` 带 `{{kind}}` 插值（en 变 `Parsed as: JSON`） | `DetectResultView.dom.test.tsx` 3 处断言改为插值形式 + 新增「英文界面不出现全角冒号」；`SelectionDetectPanel.dom.test.tsx` 同步 |
    | A3 | `src/ui/Icon.tsx`、`src/ui/Toaster.tsx` | 新增 `info` 图标（圆 + 倒置惊叹号），Toaster 的 `info` 不再复用 `alert` | `Icon.dom.test.tsx` 清单加 `info`；`Toaster.dom.test.tsx` 新增「info 与 error 图标不同」 |
    | A4 | `src/content/FloatingBall.tsx`、`src/utils/settings.ts` | 注释「默认 60」改正为 80，并指向常量名 | 纯注释，无测试改动 |
    | A5 | 四个 `main.tsx`（`src`、`options`、`popup`、`sidepanel`） | `getElementById('root')!` 改为判空后安全跳过 + `console.error` 可读提示 | `entries.dom.test.tsx` 用例从「断言抛错」改为「不创建 root、打印含 `#root` 的提示」 |
    | A6 | `src/ui/toast.ts` | `duration` 仅接受有限非负值（负数/NaN/Infinity 回落默认；`0` 仍为常驻）；维护 id→timer 表，dismiss 与被挤出时 `clearTimeout` | `toast.test.ts` 新增 4 例：非法 duration 回落、`dismiss(id)`/`dismiss()` 清定时器、第 4 条挤出时清定时器 |
    | A7 | `src/content/SelectionDetectPanel.tsx` | `startDrag` 增加 `e.button !== 0` 守卫（与 FloatingBall / Drawer 一致） | `SelectionDetectPanel.dom.test.tsx` 新增「右键按下不拖动、不捕获指针」 |
    | A8 | `src/tools/QrLogoCropModal.tsx` + 语言包 | `getContext('2d')` 为 null 时不再静默 return，改为显示 `tool.qrcode.cropExportError` | `QrLogoCropModal.dom.test.tsx` 新增「ctx 为 null 时提示且不回调 `onConfirm`」 |
    | A9 | `AGENTS.md` §5 草稿表 | 按源码补全草稿 key 表（`activeToolTab`/`detect.input`/`hash` 对象/`jwt.token`/`qrcode.input`/`timestamp.input`），并加「逻辑 key 由 `draft.ts` 加前缀、值类型不做校验」的说明 | 文档，无测试改动 |
    | A10 | `src/tools/QrLogoCropModal.tsx` | **人工浏览器实测发现**：React 的 `onWheel` 是**被动（passive）注册**，其中的 `preventDefault()` 无效并打印 `Unable to preventDefault inside passive event listener invocation`，实际后果是滚轮缩放裁剪框时**背后页面跟着一起滚**。改为手动注册 `{ passive: false }`（与 `DetectResultView` 的 Tab 横滚同一写法） | `QrLogoCropModal.dom.test.tsx` 新增「wheel 以非 passive 注册且 `defaultPrevented === true`」；已实测去掉 `passive:false` 后该用例变红 |
    | A11 | `src/sidepanel/SidePanelPage.tsx` | **人工浏览器实测发现**：面板内的 Escape / Alt+Shift+D 分支唯一动作是 `window.close()`，而它对浏览器自有的侧边栏窗口是**空操作**（实测按 Escape 关不掉）——单测只断言「close 被调用」所以一直是假绿。更糟的是全局 keydown 会在用户编辑 JSON / Cookie 弹窗时按 Escape（本意取消当前编辑）而**误关整个面板**。经确认**删除**该分支：关闭职责归 Chrome 自带 X 按钮、background 的全局快捷键、抽屉互斥消息 | `SidePanelPage.dom.test.tsx`：原「键盘关闭」3 例改为「不自行处理全局键盘」2 例（Escape / Alt+Shift+D 不再触发 close）；`connect 抛错` 用例改为断言 `runtime.onMessage` 关闭通道仍生效 |
    | A12 | `src/background/main.ts` | **人工浏览器实测发现**：默认（drawer）模式下快捷键的语义是「切抽屉 + 顺带关侧边栏」，于是「用 Popup 打开侧边栏 → 按快捷键」表现为**先关掉侧边栏、再弹出网页抽屉**，与用户「收起」的直觉不符。经确认改为：侧边栏已开时本次按键**只收起并 return**，不再发 `MSG_TOGGLE_DRAWER`（代价：侧边栏→抽屉需按两次；与 native 模式的 toggle 语义对齐） | `background/main.test.ts` 新增「侧边栏已打开时只作收起，不再弹出网页抽屉」；已实测去掉 `return` 后该用例变红 |
    | A13 | `src/tools/handoff.ts` | **行为对齐（用户提出）**：从智能解析点「在 JSON 工具中打开」后，结果区是空的，还要手动点一下「格式化」。根因：`handoff` 只写 `input` 并把 `output` 留空（附带发现 `JsonDraft.lastAction` 是**只写不读**的死字段）。改为 handoff **顺手执行一次格式化**——按用户已存的 `indent`/`sortKeys`/`minify` 偏好算好 `output` 一并落盘，打开即可见；解析失败则不写结果（`output:''`、`lastAction:null`） | `handoff.test.ts`：json 用例改为断言算好的 `output`/`lastAction`，并新增「单行偏好 → 单行输出」「非法 JSON 不写结果」两例 |
    | A14 | `src/ui/TkSelect.tsx` | **人工浏览器实测发现**：抽屉里切换缩进后，下拉偶发「跑到屏幕最左侧」，并伴随抽屉内部出现滚动条。定位到三处脆弱点：①`popupPos` 初值 `left:0`，`calcPosition()` 一旦提前 return，弹层就会以 `left:0`（屏幕最左）露一帧；②水平纠偏**只夹右边界**，且右对齐用 `window.innerWidth - triggerRect.right` 估算，视口宽度跳变（滚动条出现/消失、面板宽度变化）时会把弹层推到左边界之外；③纠偏**直接改 DOM**，与 React 的 `style` 形成两套真相。修复：实测校正前先 `visibility:hidden`；用**实测宽度**做左右双向夹取并通过 state 回写（不再直接改 DOM）；夹取后统一用 `left` 定位 | `TkSelect.dom.test.tsx` 新增「校正后可见、`left ≥ 8`、不再同时挂 `right`」。**根因未能在本地复现**（无浏览器），属按构造消除整类成因；若线上仍复现，按下方的诊断脚本抓现场数据 |
    | A15 | `src/ui/Tooltip.tsx` | **人工浏览器实测（截图）定位**：切换缩进后鼠标移到按钮上时，**tooltip 出现在屏幕左侧而垂直位置正常**。根因同源于退化几何：`position` 初值 (0,0)、`calcPosition()` 拿不到触发元素就整段跳过；而交叉轴对齐 `left + (width - tooltipW)/2` 在 `triggerRect` 为 **0×0**（节点已脱离文档 / 布局未就绪）时算出负数，再被 `Math.max(8, …)` 夹到 8px —— 正好是「贴屏幕左缘、纵向正确」。修复：①`calcPosition()` 改为返回是否测到**有效**矩形，0×0 直接判为「本次无法定位」；②新增 `positioned` 状态，portal 仅在 `open && positioned` 时渲染（既不在 (0,0) 露帧，也不会显示错位置）；③`hideTooltip()` 复位 `positioned`，下次显示强制重新测量 | `Tooltip.dom.test.tsx`：新增「0×0 退化矩形不显示气泡」回归（已验证去掉守卫即变红）与「上方空间不足向下翻转」；并把几何桩（rect 120×20 / 气泡 80×26）引入 `beforeEach`，位置断言不再是零尺寸推出来的魔数。`CopyButton.dom.test.tsx` 同步加几何桩 |

  - 浏览器实测进展（人工在真实 Chrome 中逐条走查，随进度更新）：
    - ✅ **A1 已实测通过**：在 `chrome-extension://<id>/sidepanel.html` 里覆盖 `chrome.tabs.query = async () => []`，网页存储工具刷新后显示「找不到活动标签页」，与基线（不覆盖时显示「当前标签页不支持访问网页存储」）明显不同。
    - ✅ **A7 已实测通过**：划选面板左键可拖动标题栏、**右键按住拖动不动**。
    - ✅ **A10 已修复并实测通过**：裁剪弹窗上滚轮缩放时**背后页面不再跟着滚动**，Console 中的 `Unable to preventDefault inside passive event listener invocation` 消失；回归用例也已验证有效（去掉 `{passive:false}` 立即变红）。
    - ✅ **A11 已修复并实测通过**：删除面板内的 Escape / Alt+Shift+D 分支后，实测确认①按 Escape 不再关面板；②在 Cookie 编辑弹窗上按 Escape 只关弹窗、面板保持打开（原误伤点消失）；③`Alt+Shift+D` 与 Chrome 自带 X 按钮仍能关闭；④抽屉互斥双向正常（开抽屉自动收侧边栏、反向亦然）。
    - ✅ **A12 已修复并实测通过**：Popup 打开侧边栏后按 `Alt+Shift+D` 只收起侧边栏、**不再弹出网页抽屉**；再次按下（侧边栏未开）才按 drawer 模式打开抽屉；抽屉开着时按快捷键正常收起；native 模式下 toggle 亦正常。
    - ✅ **A14 + A15 已修复并实测通过**：抽屉里切换缩进后，下拉不再跑到屏幕左侧、tooltip 不再贴屏幕左缘，随附的滚动条也不再出现（用户回报「行为正常了」）。⚠️ 归属说明：A14 与 A15 一起生效，无法区分最终是哪一条起决定作用；两者的机制分别由 `TkSelect.dom.test.tsx` 与 `Tooltip.dom.test.tsx` 的回归用例锁定。
    - ⏳ **A13 仅由单测覆盖**：handoff 自动格式化的实现与回归用例已完成，但用户当时直接转去报 A14/A15 的问题，**浏览器实测未单独回报**。复核方式：智能解析粘贴 `{"b":2,"a":1}` → 「在 JSON 工具中打开」，结果区应直接显示格式化好的 JSON（无需再点「格式化」）。
    - ✅ **A8 正常路径已实测通过**（上传 Logo → 裁剪 → 应用 + 纠错等级 H；真实 canvas 下载 PNG 正常）。⏭️ **A8 失败路径未能在浏览器复现**：用 DevTools 覆盖 `HTMLCanvasElement.prototype.getContext` 后点「完成裁剪」仍走成功路径（覆盖未作用到应用 realm，属调试手段问题而非功能问题）。经确认**不再占用人工时间**，该分支仅由单测覆盖（`QrLogoCropModal.dom.test.tsx` 的「ctx 为 null 时提示且不回调」）。
    - ⏳ **A5 / A6 未做 UI 实测**：A5 的 `#root` 兜底已通过反混淆构建产物确认进入 bundle（`console.error` 分支在 `dist` 里可见），浏览器无法自然触发（入口 HTML 必然带 `#root`）；A6 的非法 duration 与定时器清理可观测性有限，仅由单测覆盖。
  - 未验证（**无浏览器环境**）：本环境是 WSL2/Debian 13、非 root，且缺少 Chromium 运行所需的 16 个共享库（`libnss3`/`libgbm`/`libasound`/`libpango` 等，`ldconfig -p` 全部为 MISS），无法启动任何浏览器；上述人工实测由维护者在自己的 Chrome 上完成，不依赖 CI。

- [!] **T4 B 类疑点：需产品/交互拍板后才能动（17 条）**
  - 描述：这些改动的「修法」取决于产品语义或交互策略，没有唯一正确答案；每条括号里是待定问题。决定后按 T2/T3 的同样纪律执行（改源码 + 同步断言 + 回归用例 + 满门禁）。
  - 验收标准：每条先给出决定，再改代码；改完 `pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：T1、T2、T3
  - 阻塞原因（需人介入）：17 条都需要产品语义或交互取舍，代码侧无法自行判定；建议维护者逐条给出决定（或先挑影响面最大的 date-only 时区、引号 cookie、裸域名误判三条）。
  - 关联文件：见下面每条的路径
  - 清单：
    1. `src/tools/timestamp.ts:227,235-237` — date-only（`YYYY-MM-DD`）按 **UTC** 解析却按**本地**字段校验，负 UTC 偏移时区会把 `2025-01-01` 判为非法、`detect` 返回 null。（按本地零点解析，还是保持 UTC 且校验也用 UTC？）
    2. `src/tools/timestamp.ts:199` — 中文分支 `new Date(y,m,d)` 不校验滚动（`2025年2月31日`→3月3日、`Feb 30, 2025`→3月2日），而 `YYYY-MM-DD` 分支会拒绝。（统一为拒绝还是允许滚动？）
    3. `src/utils/cookieRaw.ts:86-89` — `split(';')` 不感知引号，`note="a;b"` 被截断；非首段命中已知属性名时整行按 Set-Cookie 解析。（是否支持 RFC 6265 引号值——需引入词法扫描？）
    4. `src/utils/cookieRaw.ts` 序列化 — `expirationDate === 0` 被省略、空 name 输出 `=1`（parse 端拒绝），序列化↔解析不闭环。（`0` 是否算合法过期时间？空 name 应拒绝还是丢弃？）
    5. `src/tools/QrCodeTool.tsx:216` vs `232-243` — 应用 Logo 时强制 `ecLevel='H'`，移除 Logo 后不回落。（保留 H 还是恢复用户原等级？）
    6. `src/tools/QrCodeTool.tsx:211-218` — `handleCropConfirm` 不清理 `cropSourceUrl`（为支持「重新裁剪」复用同一 objectURL）。（接受这点内存驻留，还是每次重裁剪重建 URL？）
    7. `src/tools/detect.ts` `BARE_URL_RE`(93) — `file.txt`/`README.md` 被判为 URL（`detect.test.ts:958-959` 锁定）。（加 TLD 白名单还是排除常见文件扩展名？）
    8. `src/tools/detect.ts` — 自由文本中的 JWT 会额外产出重叠的伪 URL 项（`detect.test.ts:868` 锁定）。（是否值得让 URL 提取感知已识别实体区间？要调整检测阶段顺序）
    9. `src/tools/detect.ts` — UUID 只认 v1–v5（v6/v7 退化为 hex 候选）；`kind:'urls'` 只存在于类型与 `KIND_LABEL`、`detect` 从不产出（`detect.test.ts:280` 锁定）。（补 v6/v7 正则？删不删死类型？）
    10. `src/tools/DetectResultView.tsx:16` — `KIND_LABEL` 是 `Record<DetectResult['kind'], string>`，运行时脏 kind 渲染成「解析为：」+ 空白。（加兜底文案）
    11. `src/content/Drawer.tsx` / `src/content/ToolkitOverlay.tsx` — 抽屉无 Escape / 遮罩关闭（`ToolkitOverlay.dom.test.tsx:325`、`Drawer.dom.test.tsx:216` 锁定），目前只有关闭按钮、消息、`Alt+Shift+D`。（加不加 Escape？）
    12. `src/content/SelectionDetectPanel.tsx` — 定位只在挂载/选区变化时执行，resize/滚动不重定位，面板可能被挤出视口。（是否加 resize/scroll 重定位？）
    13. `src/content/Drawer.tsx` `onResizeEnd` — 用闭包 `width` 持久化，同批次事件下可能写旧值（真实浏览器分属两个任务通常无碍）。（是否改 ref 以消掉时序脆弱点？）
    14. `src/options/OptionsPage.tsx` `persist` — 每次改动立即 `saveSettings(完整 Settings)`，未用 §5「脏标记 + useEffect」（`QuickSettings` 用了）。（是否统一到脏标记模式？会带来延迟写入观感）
    15. `src/ui/Toaster.tsx`（空列表 `return null`，live region 随内容销毁，可能漏播首次公告）+ `src/tools/StatusText.tsx`（无 `role="status"`/`aria-live`）。（是否补 live region 语义？会改变读屏播报）
    16. `src/utils/env.ts` `extVersion` — 用 `??`，`version === ''` 时返回空串而非占位 `0.2.0`（真实 Chrome 不会给空串）。（低优先，是否改？）
    17. `src/utils/shortcuts.ts` `formatShortcutForDisplay` — 非 mac 分支不改大小写（`alt+shift+d`），mac 分支会大写。（非 mac 是否统一成 `Alt + Shift + D`？）
