# TASKS

> 本文件是仓库内的任务清单，供维护者与 AI 编码代理协作使用（可选）。
> 历史任务记录已在发布前清理——那些是开发过程中的内部笔记，不适合随仓库公开。

## 约定

1. 只推进状态为 `[~]`（进行中）的条目；同一时刻尽量只保留一个。
2. 完成后改为 `[x]`，并在「结果」简述产出；再把下一个 `[ ]` 改为 `[~]`。
3. 遇到需要人拍板的问题改为 `[!]`，在「阻塞原因」写清卡点与建议，不要臆测硬做。
4. 动手前先读 [`AGENTS.md`](./AGENTS.md)，遵守其中的核心硬约定与「新增一个工具」流程。
5. 验证按 [`AGENTS.md`](./AGENTS.md) §7 分级：过程中只跑最小集（§7.1 的对照表），交付前才跑全量门禁（§7.2）。

## 状态图例

| 标记 | 含义 |
| --- | --- |
| `[ ]` | 待办 |
| `[~]` | 进行中 |
| `[x]` | 完成 |
| `[!]` | 阻塞（需人介入） |
| `[?]` | 待确认 |

## 遗留复验（来自已完成任务，**未做真实浏览器实测**或受测试环境限制）

- `A5` 入口缺 `#root` 的兜底：已通过反混淆构建产物确认 `console.error` 分支进入 `dist`；浏览器无法自然触发（入口 HTML 必然带 `#root`）。
- `A6` `toast` 的非法 duration 回落与定时器清理：**可自动化的逻辑分支已由变异验证钉死**（见 `T6` 新增 2 例），另有 `Toaster.dom.test.tsx` 覆盖 DOM 级到点消失；真实浏览器里的动画/消失观感仍未实测。
- `A8` 裁剪导出的失败提示：**失败与重试两条路径已由变异验证钉死**（见 `T6`），正常路径此前已实测；真实浏览器里用 DevTools 覆盖 `getContext` 的失败注入仍未做。
- T4 `#11`（抽屉 Escape 与内层浮层让行）、`#12`（划选面板 resize/scroll 重定位）：机制由 happy-dom 覆盖，真实浏览器里「划选面板与抽屉同开时 Escape 只关面板」「滚动时浮层跟随」未实测。
- T4 `#15`（live region 改动）：读屏实际播报行为需在真实辅助技术下确认。
- T11 / T12：内层 tab 的跨工具记忆、以及「输入后立刻切走工具再回来不丢内容」，需在真实扩展里复验——单测走的是 `chrome` 桩或 `sessionStorage` 降级，真实环境写的是 `chrome.storage.session`。
- T8 内联编辑的 Escape 让行：守卫要求「焦点确实落在 `[data-tk-escape]` 子树内」，而焦点来自编辑器挂载时的 `autoFocus`。happy-dom 用例里焦点是显式 `focus()` 造出来的；真实浏览器 content script 影子 DOM 内 `autoFocus` 是否总能生效未实测。另：popup 宿主未实测——若 Escape 在扩展 popup 里由浏览器直接消费，页面侧无法拦截（本机无浏览器，未能确认）。
- 测试侧限制（happy-dom 无排版）：真实像素高度/滚动条、dnd-kit 真实拖拽序列、真实文件选择与 `FileReader.onerror`、canvas 真实栅格；相关用例只断言可确定的分支。

## 任务列表

- [x] **T4 B 类疑点：需产品/交互拍板（17 条，全部完成）**
  - 描述：这些改动的「修法」取决于产品语义或交互策略，没有唯一正确答案。逐条先记录决定，再按既有纪律执行：改源码 + 同步被锁定的断言 + 补会在旧代码上变红的回归用例 + 满门禁。
  - 验收标准：`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：**17 条全部落地**（首批 4 条见提交 `ed5cbe2`，其余见后续提交），测试 1841 → **1856 例**；门禁 `format / lint / type-check / test(76 files / 1856) / build` 全绿。

    | 原编号 | 决定 | 实现 / 验证 |
    | --- | --- | --- |
    | 1 | date-only 按**本地零点**解析 | 新增 4a 分支（`setHours(0,0,0,0)` + `setFullYear`），保留字段比对拒绝 `2025-02-31`；负 UTC 偏移时区不再误判。**浏览器已实测** |
    | 3 | cookie **引号感知切分** | `splitCookieSegments()` 跳过双引号内的 `;`，引号原样保留以支持 Raw 往返。**浏览器已实测** |
    | 7 | 裸域名 **TLD 白名单** | `KNOWN_TLDS` + `isKnownBareDomain()`，在 `extractUrls` 与 `detectUrl` **两处**生效（只改前者时 `README.md` 仍误判）。**浏览器已实测**。取舍：漏报冷门后缀（`example.zip`/`example.md`） |
    | 8 | （由 7 顺带解决） | base64 片段不再被当成 TLD，自由文本中的 JWT 不再产生重叠伪 URL 项 |
    | 2 | 三个分支**统一拒绝日期滚动** | 新增 `matchesCalendarDate()` 复用到中文/混合/US/英文月份分支；`MONTH_WORDS` 改由 `MONTH_INDEX` 派生。顺带覆盖混合写法 `2025-02-31 15点30分`。红→绿：旧代码 5 例失败 |
    | 4 | cookie 序列化**闭环** | 空 name → 返回 `''`（不再产出 parse 端必拒的 `=value`）；`expirationDate != null && !Number.isNaN()`，`0` 照常输出 1970 的 Expires。红→绿：3 例 |
    | 5 | 移除 Logo 后**回落用户原等级** | `ecLevelBeforeLogoRef` 仅在未记录时记录一次，`removeLogo` 回落并清空；避免重复上传后记录被 H 覆盖。红→绿：2 例 |
    | 6 | `cropSourceUrl` **保持现状** | 仅在 `handleCropConfirm` 补注释：刻意复用同一 objectURL 支持「重新裁剪」，属有界驻留（下次上传/移除/卸载时 revoke）。无行为改动 |
    | 9 | UUID 补 **v6/v7** | `UUID_RE` 版本段 `[1-5]` → `[1-8]`，variant 仍 `[89ab]`。红→绿：2 例 |
    | 10 | 未知 kind **兜底文案** | `KIND_LABEL` 放宽为 `Record<string, string \| undefined>` + 两处 `?? t('tool.detect.unknown')`，zh/en 各加 key。红→绿：2 例 |
    | 11 | 抽屉 **Escape 关闭**（带内层浮层守卫） | `INNER_LAYER_SELECTOR = '.tk-modal, .tk-select-popup, .tek-detect-panel'`；`document` **捕获阶段**监听（TkSelect 会在冒泡时同步卸载下拉，冒泡阶段查不到）；命中守卫时不 `preventDefault`，把按键让给内层。反转 2 条「现状」断言 + 新增 3 条守卫用例 |
    | 12 | 划选面板 **resize/scroll 重定位** | 抽出 `anchorPos()` 供挂载/重定位共用；`draggedRef` 区分「跟随锚点」与「只夹回视口」；rAF 节流；`scroll` 用捕获阶段并忽略面板内部滚动。新增 3 条回归（先红后绿） |
    | 13 | `onResizeEnd` **改读 ref** | `widthRef` 成为宽度的单一数据源（读取/收敛/拖拽/方向键都写入），消除同批次事件写旧值的隐患。新增「同批次 pointermove+pointerup 写最终宽度」 |
    | 14 | Options **保持立即写入** | 不引入脏标记；改 `AGENTS.md` §5 为两种合法写法（高频控件用脏标记、显式表单操作可直接 `saveSettings`），消除规则与实现的矛盾 |
    | 15 | 补 **live region** | `Toaster` 空列表也常驻容器（避免首条公告漏播）；`StatusText` 加 `role="status"`。更新 4 条冲突断言（先红后绿） |
    | 16 | `extVersion` 空串回退 | `??` → `||`，`version === ''` 也返回占位 `'0.2.0'`。红→绿：1 例 |
    | 17 | 快捷键非 mac **首字母大写** | `alt+shift+d` → `Alt + Shift + D`；多字符键名（`PageUp`）保持原样；mac 分支不动。红→绿：2 例 |

  - 额外交付（本轮发现并修掉）：**`OptionsPage.dom.test.tsx` 偶发红**——`pickFile` 之后的 `FileReader → chrome.storage → setState` 异步链在负载下会超过固定 `settle(10)`。新增 `waitFor()` 条件轮询并替换 10 处固定等待。验证：全量连跑 4 轮 + 3 个并发单文件，均全绿。
  - 后续可选项（本轮**刻意未做**，需要时再拍板）：
    1. 无年份英文日期（`Feb 28`）仍返回 `null`：英文分支有「必须含 4 位年份（1900–2200）」守卫，删掉会让 `Feb 28` 静默落到 2001 年、并让 `Jan 01, 25` 变合法。**决定：保留严格校验**。
    2. `CookieEditModal` 表单态 name 为空时切到 Raw 得到空串（原为 `=value`）：属 `#4` 的预期结果（`=value` 在 Raw 解析端必被拒）；若要更友好可禁用 Raw 页签或给提示。
    3. 裸域名白名单的漏报面：`example.zip` / `example.md` 不再识别为网址；需要时在 `KNOWN_TLDS` 补充。
    4. `detect` 的 `kind:'urls'` 仍只存在于类型与 `KIND_LABEL`、从不产出（`#9` 决定保留，删它属纯清理）。→ 已转入 `T5`。

- [x] **T5 清理 `detect` 的 `kind:'urls'` 死代码**
  - 描述：`DetectKind` 联合里的 `'urls'` 从未被 `detect()` 产出（多网址输入走 `'url'`），却留在类型、`KIND_LABEL` 与测试夹具里。按 `#9` 的后续可选清理项执行：从 `DetectKind` 与 `KIND_LABEL` 删除该成员，并把以它为夹具的测试改用真实 kind；**保留** `tool.detect.format.urls`（那是 `FORMAT_PRESETS` 的预设标签，与解析类型无关）。
  - 验收标准：全仓不再有「解析类型 `urls`」的语义残留；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：`detect.ts` 删除联合成员；`DetectResultView.tsx` 删除 `urls: 'URLs'`；夹具改用真实 kind——`DetectResultView.dom.test.tsx` 类型标签表 9 种收为 8 种、`url.N` 用例改用 `kind:'url'`，`handoff.test.ts` 删除 `urls` 映射断言、纯度用例换 `hex`，`detect.test.ts` 把「从不产出 urls」改名为「多个网址各自产出独立的 url 项」（断言不变）。`FORMAT_PRESETS` 的 `urls` 预设与其 i18n 标签**保留**。门禁 `format / lint / type-check / test(76 files / 1856) / build` 全绿；用例数与改动前一致（删的是表内数据行，不是 `it`）。

- [x] **T6 补强 A6 / A8 的失败分支单测（验证债闭环）**
  - 描述：`A6`（`toast` 非法 duration 回落 + 定时器清理）与 `A8`（裁剪导出失败提示）当前仅由单测覆盖、缺真实浏览器实测。在无浏览器环境里把**可达的逻辑分支**用单测钉死：新增断言必须在「故意破坏实现」时变红，否则不算闭环。
  - 验收标准：新增用例在对应实现被改坏时变红；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：新增 3 例，测试 1856 → **1859**。
    - `toast.test.ts` +2：①「非法 duration 回落值**真的用于排期**」——只改快照字段、仍拿原始 `-100` 去 `setTimeout`（会被当成 0）时立刻消失，用例变红；②「被挤出 / 被 dismiss 的条目到点后**不再产生推送**」——把 `getTimerCount()` 这种实现邻近断言升级为行为级断言（漏 `clearTimeout` 时 `dismiss(id)` 会多推一次，`frames` 变长）。
    - `QrLogoCropModal.dom.test.tsx` +1：「导出失败后环境恢复可重试」——覆盖此前无用例的 `setExportError(false)` 复位分支，并断言失败不关弹窗、按钮仍可用。
  - 变异验证（改坏实现后确认变红，随后还原）：A6a 原始值排期 → 2 例红（含既有 1 例）；A6b `dismiss(id)` 不 `clearTimeout` → 2 例红；A8 删 `setExportError(false)` → 1 例红。
  - 门禁 `format / lint:check / type-check / test(76 files / 1859) / build` 全绿。
  - 未闭环（环境限制，见「遗留复验」）：真实浏览器里的 toast 动画/消失观感、DevTools 注入 `getContext` 失败的实测——本机无任何浏览器（Chrome/Chromium/Playwright 均不存在），只能人工。

- [x] **T8 修复：内联编辑本地存储值按 Escape 会关掉抽屉（应为退出编辑）**
  - 描述：双击存储值进入 `.tw-store__edit` 编辑器后按 Escape，**预期退出编辑，实际整个抽屉被关掉**。根因：抽屉的 Escape 关闭监听在 `document` **捕获阶段**（`content/Drawer.tsx`，T4 `#11` 引入），只对 `.tk-modal / .tk-select-popup / .tek-detect-panel` 让行；内联编辑器既不在名单里、本身也没有 Escape 处理，于是捕获阶段先关抽屉。同类缺陷：搜索框「Escape 复位筛选」在真实抽屉里永远轮不到（同样被捕获阶段抢先）。修法：给「自己处理 Escape 的内层」加**焦点感知**的让行契约（`data-tk-escape`），并按存在与否判断改为按焦点判断——搜索框在有数据时长期存在，按存在判断会让抽屉永远关不掉；同时给内联编辑器补 Escape = 取消编辑。
  - 验收标准：红→绿用例覆盖「编辑器 Escape 取消且不写存储」「抽屉守卫对聚焦的 `data-tk-escape` 让行、编辑结束后恢复关闭」「普通输入不过度让行」；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：**红→绿**（修复前 3 例红，修复后全绿）。改动两处——
    - `content/Drawer.tsx`：让行判定从 `hasInnerPopup()` 扩为 `innerHandlesEscape()`。内层浮层仍按**存在**判定（本身就是模态 / 瞬态）；新增按 **`root.activeElement` 是否落在 `[data-tk-escape]`** 判定「内层正在处理 Escape」。用 `root.activeElement` 而非 `document.activeElement`：影子 DOM 里后者只返回宿主。
    - `tools/StorageTool.tsx`：`.tw-store__edit` 容器加 `data-tk-escape` + `onKeyDown` Escape → `onCancel()`（与「取消」按钮同义：丢弃草稿、不落盘；新增与编辑共用 `EditorForm`，两种形态一并生效）；搜索框改为**仅在有筛选词时**才带 `data-tk-escape`，原有的「Escape 复位筛选」由此才真正生效，且不会让抽屉从此关不掉。
  - 用例：`StorageTool.dom.test.tsx` +2（Escape 取消编辑且 `setStorageValue` 未被调用、草稿丢弃、标记存在；搜索框标记随筛选词出现/消失）；`ToolkitOverlay.dom.test.tsx` +2（焦点在 `[data-tk-escape]` 内时不关抽屉且不 `preventDefault`、编辑结束后恢复关闭；焦点在普通输入里时仍关闭抽屉，防过度让行）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1863) / build` 全绿。
  - 未闭环：真实浏览器未实测（见「遗留复验」）。

- [x] **T9 修复：按 Esc 关闭内联编辑器后条目下方残留一条横线（Chrome 绘制残留）**
  - 描述：点 session 条目的「编辑」→ 按 Esc 后，行从编辑态（高约 190px）骤降到展示态（97px），旧底边位置的 1px 阴影像素未被一起失效，表现为条目下方一条横线，几秒后随下一次重绘自行消失。定位过程：以 25ms 轮询 20 秒，DOM 里**没有任何细长元素**、**没有任何伪元素**、**没有任何新的横向溢出**（唯一溢出的 `.tw-nav` 其滚动条被 `scrollbar-width: none` + `::-webkit-scrollbar{display:none}` 显式隐藏），也没有 ≥1s 的动画/过渡 —— 因此排除「元素 / 滚动条」两类，判定为 `box-shadow: 0 0 0 1px`（独立阴影层）在盒子骤缩时的绘制残留。这也解释了「元素选择器选不中」和「过几秒自己消失」。
  - 验收标准：浏览器里重复「点编辑 → Esc」不再出现横线；编辑态行的强调观感（2px 环形高亮）不变；门禁全绿。
  - 依赖：需真实浏览器复验（本会话环境无浏览器）
  - 结果：`tools.css` 的 `.tw-store__row--editing` 由 `box-shadow: 0 0 0 1px var(--tk-ring)` 改为 `outline: 1px solid var(--tk-ring); outline-offset: 0`（1px 边框 + 1px outline 仍是 2px 强调，视觉等价）。门禁见下。
  - ⚠️ **未验证**：这是机制推断下的修复，**尚未在真实浏览器确认有效**。若仍复现，按序再试：① 去掉外圈只保留 `border-color` 变化；② 关闭编辑器时强制一次重绘（给 `.tw-store` 挂 `contain: paint` 或切换 `will-change`）。

- [x] **T10 修复：工具选项卡条隐藏滚动条后看不出两端还有内容**
  - 描述：`.tw-nav`（9 个工具 tab）在默认抽屉宽度下就横向溢出 24px，而滚动条被 `scrollbar-width: none` + `::-webkit-scrollbar{display:none}` 隐藏，用户看不出两端还有内容。`.tw-tabs`（工具内层 tab）与 `.tw-detect__tabs`（多结果 tab）是**同一模式**（同样隐藏滚动条，且都已实现「激活项自动居中」+「滚轮横向滑动」），窄抽屉 / 英文长文案下同样会溢出。修法：三个条带共用一套**纯 CSS**「滚动阴影」提示（四层背景——两个 `local` 遮罩层随内容滚动、到端点即盖住阴影，两个 `scroll` 阴影层固定在可视区两侧），无 JS、无 DOM 改动；`--tw-scrollhint-bg` 取各自底色、`--tw-scrollhint-pad` 等于各自左右 padding（保证遮罩与阴影对齐，否则起点也会误显示阴影）；另加 `overscroll-behavior-x: contain`，滑到端点不再连带滚动外层。
  - 验收标准：溢出时两端出现渐变提示、滚到端点该侧提示消失、不溢出时无提示；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：需真实浏览器复验（CSS 绘制无法在 happy-dom 断言）
  - 结果：`tools.css` 新增共享块（`.tw-nav, .tw-tabs, .tw-detect__tabs` 的四层背景 + `overscroll-behavior-x: contain`）；`.tw-nav` / `.tw-tabs` 各自声明 `--tw-scrollhint-bg` 与 `--tw-scrollhint-pad`（14px / 4px，等于各自左右 padding），并把 `background:` 简写改为 `background-color:`（否则简写会重置共享的 `background-image`）。`.tw-detect__tabs` 是透明底、水平 padding 为 0，正好命中共享默认值，无需改动。「激活项自动居中」与「滚轮横向滑动」原本已实现（`ToolsApp.tsx` / `DetectResultView.tsx`），本次只补可视提示。
  - 用例：`ToolsApp.dom.test.tsx` +1——「切换工具时把激活 tab 滚到容器中心」（桩出水平几何，断言 `scrollBy({ left: 300, behavior: 'smooth' })`）；**变异验证**：注掉 `nav.scrollBy(...)` 该用例即变红（说明它真能捕获回归）。测试 1863 → **1864**。
  - 门禁 `format / lint:check / type-check / test(76 files / 1864) / build` 全绿。
  - 未闭环：纯 CSS 提示无法在 happy-dom 断言（无排版/绘制），需浏览器复验（见「遗留复验」）。
  - ⚠️ **已撤回**：真机观感不达预期（两端各压着一个灰块），见 `T13`。

- [x] **T11 统一：各工具内层 tab 的「记忆」行为**
  - 描述：内层 tab（生成/解析、local/session/cookie、文本/文件、解析/编解码…）在"切到别的工具再回来"时应保持上次选择。现状不一致：Base64 / Hash（草稿对象内 `tab`）与 URL（独立 `url.tab`）会记住，而 QrCode（`useState('generate')`）与 Storage（`useState('local')`）每次挂载都跳回第一项。修法沿用既有模式：各加一个独立草稿键（`qrcode.tab` / `storage.area`，与 `url.tab` 同构），读取方按 AGENTS §5 自行容错（脏值回落默认项）。
  - 验收标准：QrCode 与 Storage 的 tab 跨挂载保留（与既有三个工具一致）；草稿脏值回落默认项；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 说明：Cookie 编辑弹窗的「表单 / Raw」页签属对话框内部状态，每次打开重置是预期行为，不在本次统一范围内。
  - 结果：**红→绿**。QrCode 与 Storage 的内层 tab 改用独立草稿键（与 `url.tab` 同构）：`QrCodeTool` 用 `qrcode.tab`（`'generate' | 'decode'`）、`StorageTool` 用 `storage.area`（`'local' | 'session' | 'cookie'`），读取方按 AGENTS §5 自行容错（脏值回落默认项）；两个键已登记进 AGENTS.md §5 的草稿表。用例：`QrCodeTool.dom.test.tsx` / `StorageTool.dom.test.tsx` 各 +2（跨挂载保留 + 脏值回落；修复前「跨挂载保留」2 例红、修完后绿）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1870) / build` 全绿。

- [x] **T12 修复：草稿改动在防抖窗口内切走工具会丢失（做 T11 时发现的底层缺陷）**
  - 描述：`useToolDraft` 的写入有 200ms 防抖，但**卸载会 `clearTimeout` 掉这次写入**，改动只留在内存缓存里；而重新挂载时的异步读取又会用会话存储里的旧值把它覆盖回去。于是「改完立刻切走工具再回来」会看到改动被还原 —— T11 的两条新用例最初正是卡在这里（改用草稿了却仍然记不住）。影响面不止 tab：所有走 `useToolDraft` 的输入（各工具输入框 / JSON 工作台…）都可能在「输入后立刻切走」时丢内容。
  - 修法：`utils/draft.ts` 三处 —— ①卸载时把防抖窗口里的改动**立即落盘**（不是只清定时器）；②新增模块级 `locallyDirty` 标记，挂载读取**避开「本页面已改、但还没确认落盘」的键**，旧值不得覆盖新值；③`clearDraft` 同步清掉定时器句柄与脏标记。
  - 用例：`utils/draft.dom.test.tsx` +2（防抖窗口内卸载 → 立即落盘；落盘尚未完成时重挂载 → 旧值不覆盖新值）。**变异验证**：把该修复整体 stash 掉后，2 例红 / 3 例绿；恢复后全绿。
  - 门禁 `format / lint:check / type-check / test(76 files / 1870) / build` 全绿。

- [x] **T13 按产品决定撤回 T10 的「两端还有内容」提示**
  - 描述：T10 用四层背景（两个 `local` 遮罩 + 两个 `scroll` 阴影）在 tab 条两端画渐变提示。真机效果不达预期：**背景永远绘制在子元素（tab 文字）之后**，所以它没法把文字一起淡出，只能在文字背后铺一层灰 —— 表现为两端各压着一个灰块，观感像渲染缺陷（截图确认）。经确认选择撤回：回到「隐藏滚动条、无提示」的原状；tab 仍可用滚轮/触控板横向滚动，`revealActiveTab` 负责把激活项滚进视野。
  - 验收标准：`tools.css` 中 T10 的三处改动全部回退、无 `scrollhint` 残留；门禁全绿。
  - 结果：已完整回退（共享块、两条带上的 `--tw-scrollhint-*` 变量、`background-color:` 还原为 `background:`），`tools.css` 现在只剩 T9 的 `outline` 修复。**保留** T10 附带补的 `ToolsApp` 用例「切换工具时把激活 tab 滚到容器中心」——它测的是既有行为（溢出条带可用性），与提示样式无关。
  - 门禁 `format / lint:check / type-check / test(76 files / 1870) / build` 全绿。
  - 备注：若以后仍要解决「看不出两端还有内容」，可行的替代是**tab 条换行**（`flex-wrap: wrap`，全部可见）或**加左右箭头按钮**（需 DOM + JS + i18n）；**纯 CSS 背景方案已证伪**（背景压在文字后面，做不到「淡出」）。

- [x] **T14 Base64 空白语义收紧：只有折行透明，Unicode 空白不再被当「胶水」**
  - 描述：现状 `base64.ts` / `detect.ts` 都用 `/\s+/` 剥空白，而 `\s` 包含 NBSP(`\u00a0`)、全角空格(`\u3000`)、行分隔符(`\u2028`) 等 Unicode 空白；解析入口只拒绝 `[ \t]`。结果是**半角空格算分隔符、全角空格/NBSP 反而算"看不见的胶水"**：两段相邻 Base64 会被静默拼成一段（内容相同时解出重复文本，正是这次报告的现象）。修法：把"可忽略空白"收紧为 **ASCII 空白**（与浏览器 `atob()` 的 forgiving-base64 对齐）：`base64.ts` 用 `[\t\n\f\r ]`；`detect.ts` 的整段判定只放行 **CR/LF**（MIME 折行），其余空白一律当分隔符，交给逐块挖掘出多项。
  - 顺带修复：`base64.ts` 的两条错误文案原本是**硬编码中文**，而 `Base64Tool` 直接展示 `e.message` —— 本次改动让"非法字符"这条错误更容易触发（粘贴含全角空格的密文），因此同一改动里改为 `i18n.t()` 取 key，zh/en 两套都补。
  - 验收标准：折行（LF/CRLF）Base64 仍按一段解码；NBSP/全角空格分隔的两段各自成项；含 Unicode 空白的密文报错而不是静默拼接；错误文案跟随语言；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：**红→绿**（修复前 4 例红、230 例绿）。
    - `base64.ts`：新增 `IGNORABLE_WS_RE = /[\t\n\f\r ]+/g`（与 `atob()` 的 forgiving-base64 对齐），`isLikelyBase64` / `decodeBase64` 都改用它；两条错误文案由硬编码中文改为 `i18n.t('tool.base64.errInvalidBase64')` / `i18n.t('tool.base64.errDecodeFailed')` —— `Base64Tool` 本来就展示 `e.message`，所以文案直接跟随当前语言。
    - `detect.ts` 的 `detectBase64`：闸门由 `/[ \t]/` 改为 `/[^\S\n\r]/`（只放行 CR/LF），剥离改为 `replace(/[\n\r]+/g, '')` → 半角空格 / 制表符 / NBSP / 全角空格 / `\f` 等一律当分隔符，交给逐块挖掘产出多项。
    - i18n：`zh.json` / `en.json` 各补 `errInvalidBase64` / `errDecodeFailed` 两个 key。
  - 用例：`base64.test.ts` +3（Unicode 空白不再被当透明胶水、错误文案跟随语言、`isLikelyBase64` 只剥 ASCII 空白）；`detect.test.ts` +2（全角空格 / NBSP 分隔的两段各自成项、两行内容相同仍按一段折行处理），并把旧用例标题改为「只有 CR/LF 是透明空白」。测试 1870 → **1875**。
  - 语义边界（有意保留）：**LF / CRLF 仍然透明** —— 两行内容相同的输入仍会合成一段（MIME 折行语义，也是本次报告现象的直接原因）；本次修的是「Unicode 空白被当隐形胶水」这条不一致。组件层未新增用例：`Base64Tool.dom.test.tsx` 已有「非法 Base64 报错并清空结果；中文包中文、英文包英文」覆盖同一交互流。
  - 门禁 `format / lint:check / type-check / test(76 files / 1875) / build` 全绿。

- [x] **T15 智能解析：多行 Base64 按行成项 + 折行护栏 + 结果区显性标注**
  - 描述：T14 之后仍有"两行相同的 Base64 被整段合成一段（解出重复文本）"的现象 —— 文本层面「一段折行」与「两段相邻」本就等价。按人体工学取舍：在**智能解析**里默认「一行一项」（符合"一行一项"的普遍直觉，且合并错误是**静默**的、拆分错误是**可见**的），同时加护栏保住折行场景，并把解释方式显性标注，避免任一方静默胜出。
  - 规则：至少 2 个非空行、且**每行**都能独立通过 Base64 校验 → 按行成项；**折行护栏**：任一行长度恰为 64/76 列（`openssl base64` / MIME / `base64 -w`）→ 仍按「一段折行」整段解析；**反向护栏**：非末行出现 padding(`=`) → 必然是列表（折行的 padding 只可能在最末字符）。
  - 显性标注：`DetectResult.hint`（`'base64-lines'` / `'base64-wrapped'`）→ 结果区一行小字说明本次的解释方式。Base64 解码工具保持宽容合并不动（用户明确说"解这段"，且对齐 `atob`）。
  - 验收标准：两行相同/多行 Base64 → 多项 + `base64-lines` 提示；76 列折行 → 一段 + `base64-wrapped` 提示；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：**红→绿**（修复前 4 例 detect + 1 例 view 红、235 例绿）。
    - `detect.ts`：新增 `DetectHint` 类型与 `DetectResult.hint`；新增 `base64LineCandidates()`（≥2 个非空行、每行独立通过 Base64 校验、64/76 折行护栏、非末行 padding 反向护栏）；`detect()` 在多行列表时**跳过「整段即目标」分支**，把每行作为最高优先级候选（`priority: 3`）接入既有候选机制（复用去重/排序/items 聚合，不另起一套）；整段被解出的折行场景打 `hint: 'base64-wrapped'`。
    - `DetectResultView.tsx`：`hint` 渲染为 `.tw-note` 一行小字（无 hint 不留空占位）。
    - i18n：`tool.detect.hintBase64Lines` / `hintBase64Wrapped`（zh/en 各补）。
  - 用例：`detect.test.ts`（多行 → 两项 + `base64-lines`、76 列折行 → 一段 + `base64-wrapped`、非末行 padding 的反向护栏、手工折行短串按行成项）+ `DetectResultView.dom.test.tsx`（hint 渲染 / 无 hint 不占位）；原「换行分隔的 Base64 仍按一段解码」用例按新语义改写为「手工折行的短串按行成项」。测试 1875 → **1879**。
  - 语义变化（有意）：**智能解析**里多行 Base64 默认「一行一项」，不再静默合并；折行场景由 64/76 护栏 + 反向 padding 护栏保住，并把解释显性标注。**Base64 解码工具不受影响**（仍按一段宽松解码，对齐 `atob`）。
  - 已知代价：非标准宽度的手工折行短串（如把 `Hello World` 折成 8 列的两行）现在会拆成两项 —— 每项都会解出片段，属于**可见**的误判，用户一眼能看出并改回。
  - 门禁 `format / lint:check / type-check / test(76 files / 1879) / build` 全绿。

- [x] **T16 视觉：工具选项卡条左侧多出一段空白（与面板标题不对齐）**
  - 描述：首个 tab 的文字距抽屉左缘 = 8px(把手) + `.tw-nav` 的 `padding-left: 14px` + 按钮自身 `padding: 10px 16px` ≈ 38px，而头部标题只有 8 + 18 = 26px、内容区 8 + 16 = 24px —— 所以看着像凭空多出一截空白（截图已确认）。
  - 修法：`.tw-nav` 左右内边距 `14px → 4px`，`.tw-nav__btn` 内边距 `10px 16px → 10px 14px`，使 tab 文字左缘与头部标题对齐（26px）。
  - 顺带收益：每个 tab 窄 4px、nav 左右各少 10px → 默认抽屉宽度下 9 个 tab 不再横向溢出（原先溢出 24px）。
  - 验收标准：浏览器里首个 tab 文字与「Panda Dock」标题左缘对齐；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：真实浏览器目测（间距无法在 happy-dom 断言）
  - 结果：`tools.css` 两处 —— `.tw-nav` 左右内边距 `14px → 4px`、`.tw-nav__btn` `10px 16px → 10px 14px`（两处都写了推导注释）。首个 tab 文字左缘 38px → **26px**，与头部标题（8 + 18）对齐；内容区为 8 + 16 = 24px，相差 2px，目视一致。
  - 附带收益：每个 tab 窄 4px、nav 左右各少 10px → 默认抽屉宽度（400px）下 9 个 tab **不再横向溢出**（此前溢出 24px，正是 T10 那段讨论的由来）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1879) / build` 全绿。
  - 未闭环：纯间距改动无法在 happy-dom 断言，需浏览器目测对齐与拥挤度（归入 `T7`）。

- [x] **T17 划选解析面板：输入框最大高度不该随「是否有解析结果」变化**
  - 描述：`SelectionDetectPanel` 传的是 `maxHeight={currentResult ? 220 : 320}` —— 有结果时输入框最高 220px，**解析失败时却能长到 320px**，于是"失败"比"成功"占得还多、面板也被撑大，与预期（一个固定最大高度）不符。
  - 修法：抽成常量 `INPUT_MAX_HEIGHT = 220`，两种状态一致；输入框内部本就可滚动，压低上限不会让内容不可见。
  - 验收标准：有结果与无结果时输入框 wrapper 的 `max-height` 相同；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：真实浏览器目测高度观感（面板尺寸属视觉，happy-dom 无排版）
  - 结果：`content/SelectionDetectPanel.tsx` 新增 `INPUT_MAX_HEIGHT` 常量（带推导注释），并以它替代条件传值。用例：`SelectionDetectPanel.dom.test.tsx` +1（比较两种状态下 `.tw-area-wrapper` 的内联 `max-height`）——**变异验证**：把传值改回 `currentResult ? 220 : 320`，该用例立刻变红。测试 1879 → **1880**。
  - 未闭环：数值 220 是否合适需浏览器目测；想更矮/更高只改这一个常量。

- [x] **T18 划选解析面板：结果较长时出现「面板外层 + 输入框 + 结果块」三条滚动条**
  - 描述：`.tek-detect-panel__body` 是滚动容器（`overflow-y: auto`），而输入框（≤220px）与结果块（≤260px）各自也有滚动；面板被 `max-height: min(620px, 100vh - 24px)` 限制时内容超出 → 外层再滚一条，三条叠在一起（截图已确认，其中外层那条是用户抱怨的对象）。
  - 修法：不砍内层滚动（T17 刚统一过输入框上限），改为让面板内部**按优先级让步** —— `.tek-detect__editor { min-height: 0 }`（允许被压缩：此前 flex 自动最小尺寸 = 内容高度，必然把外层撑出滚动条）+ 结果区外包一层 `.tek-detect__result { flex: 0 0 auto }`（结果块是 JS 定高 + 内部滚动，压扁会裁内容）。空间不足时由**输入框**让步：它自带滚动，并有 96px 下限兜底。
  - 验收标准：结果较长时不再出现最外层滚动条；输入框与结果块各自的滚动保持可用；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：**需真实浏览器复验**（布局压缩无法在 happy-dom 断言）
  - 结果：`content/SelectionDetectPanel.tsx` 用 `.tek-detect__result` 包裹结果视图；`content/content.css` 给 `.tek-detect__editor` 加 `min-height: 0`、新增 `.tek-detect__result { flex: 0 0 auto }`（两处都写了推导注释）。用例：`SelectionDetectPanel.dom.test.tsx` +1（断言结果区挂点存在 —— 去掉它就等于把外层滚动条放回来）；该用例在改动前必然失败。测试 1880 → **1881**。
  - 未闭环：压缩后的实际观感（输入框可能从 220 略降到 ~200，极端情况下到 96 下限）需浏览器目测；**极矮视口**下外层滚动条仍会出现，这是正确兜底（否则内容不可达）。

- [x] **T19 智能解析：补「正文夹带的 JSON」这一类候选**
  - 描述：`detectCore` 只在「整段即纯 JSON」「被引号/`atob` 外壳包裹」时认 JSON，而候选挖掘（`extractEmbeddedCandidates`）只扫 JWT / 中文日期 / 标准日期 / 数字时间戳 / Base64 —— **没有 JSON**。于是 `{"a":1}\n\n2020年1月1日` 这种「数据 + 一句说明」只能解析出时间；`看这个 {"a":1} 怎么样` 更是完全识别不出。
  - 修法：新增第 5 类扫描 —— 字符串感知的括号配平取出 `{...}` / `[...]` 区间（跳过字符串内部与 `\"` 转义），再用现有 `formatJson` 严格校验，只有真能解析成 JSON 的才作为候选；沿用既有候选机制（兜底 `detectCore` 认成 `json`），自动复用去重/高亮/分项 Tab。病态输入（`[[[[[…`）用尝试次数上限兜住 O(n²)。
  - 已拍板的取舍：候选区间重叠时**保留 JSON**（其内部的 URL/Base64 不再单独成项），与「整段是 JSON」时的现有行为一致。
  - 验收标准：JSON + 日期混排 → 两项；JSON 夹在中文里 → 一项；代码块 / 非 JSON 花括号不误判；字符串里的括号不影响配对；`pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无
  - 结果：**红→绿**（修复前 4 例红、210 例绿）。
    - `detect.ts` 新增 `matchJsonBracket()`（字符串与 `\"` 转义感知的括号配平，未配平返回 -1）、`MAX_JSON_SCAN_ATTEMPTS = 64`（防 `[[[[[…` 这类病态输入退化成 O(n²)）、`extractEmbeddedJsonCandidates()`（配平取区间 + `formatJson` 严格校验；命中整块后跳过内部，避免嵌套重复）；作为**第 5 类扫描**接入 `extractEmbeddedCandidates`（沿用 `seen` 与包含关系去重），后续由 `detectCore` 兜底认成 `json`。
    - URL 那条抽取路径（`extractUrls`）原本不参与候选去重，因此额外在 `detect()` 里记录被识别为 JSON 的区间（`jsonRanges`），**跳过落在其中的 URL** —— 落实「JSON 内部不再单独成项」这条已拍板的取舍。
  - 用例：`detect.test.ts` 新增「正文夹带的 JSON」整组 5 条（数据+说明两项、夹在中文里、数组与转义括号、非 JSON 花括号不误判、JSON 内 URL 不单独成项）+ 病态输入 1 条；两条旧用例按新行为改写：`'{"a":1} extra'` 移出「整体不可解析」列表并单独立例（现在会拆出 JSON 项）、「前置注释 JSONC 不识别（现状记录）」改为回归断言（现在能识别）。
  - 正向副作用：`// 注释\n{"a":1}` 这类「JSON 前有注释」的输入现在也能识别（原先整段不识别）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1887) / build` 全绿。
  - ⚠️ 实现细节随后由 `T20` 优化：改为**单遍 O(n) 括号栈扫描**（不再有 `matchJsonBracket` 与尝试次数上限），校验改用 `isJsonText`，并去掉 `detectJson` 的重复解析。

- [x] **T20 性能与健壮性：给嵌入 JSON 扫描提速，并兜住深嵌套爆栈**
  - 背景：评审提醒注意性能。用一次性 vitest 探针（跑完即删）对 T19 首版实现做实测，撞到两处真实问题：
    1. 首版是「逐个 `{` 向后配平 + `formatJson` 校验」：既有 O(n²) 隐患（靠 64 次尝试上限兜底），又让每个候选先完整 `formatJson`（解析 + 序列化）一次、随后 `detectJson` 再解析两次；
    2. 顺带撞到一个**既有**缺陷：`'['.repeat(20000)` 会让 `jsonc-parser` 递归爆栈抛 `RangeError`，而 `parseJsonc` 没有兜底 —— 异常会穿透 `detect()`（悬浮面板没有错误边界）与 `JsonTool`。
  - 修法：
    - `extractEmbeddedJsonCandidates` 改为**单遍 O(n) 遍历 + 括号栈**：只在栈回到空时产出「顶层配平块」，内部嵌套不重复挖、不重复解析；删除 `matchJsonBracket` 与 `MAX_JSON_SCAN_ATTEMPTS`。
    - 新增近乎零成本的 `looksLikeJsonStart()` 首 token 预筛（对象只能是 `"` / `}` / JSONC 注释，数组只能是值起始字符或 `]`）—— 代码块在新版里连切片与解析都省掉。
    - `json.ts` 新增 `isJsonText()`（只做布尔解析，不拼错误文案/行列）供预筛校验；新增 `formatAndMinifyJson()`（一次解析给出格式化 + 压缩两份文本），`detectJson` 改用它，去掉重复解析。
    - `parseJsonc` / `isJsonText` 的 `parse()` 包 try/catch：极深嵌套按「不可解析」返回，不再把 `RangeError` 抛给调用方。
  - 实测（各 20 次平均）：16KB JSON 整段 **0.90ms**、同 JSON 夹在中文里 **2.22ms**、80 个代码块 + JSON **0.14ms**、20K 未配平括号 **1.36ms**、17KB 普通中文 **0.37ms**、300 行多行 Base64 **2.06ms** —— 均远小于一帧；`detect()` 在两个宿主里都走 `useDeferredValue`，不会阻塞输入。
  - 用例：`detect.test.ts`（多个顶层 JSON 各自成项、80 个非 JSON 花括号后仍能找到 JSON、两万层括号返回 null 不抛错）；`json.test.ts`（`isJsonText` 合法/非法/深嵌套，`formatAndMinifyJson` 两份文本与非法输入）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1894) / build` 全绿。

- [x] **T21 结果集嵌套结果：JSON 内「像时间的字段」可读化并入该 JSON 结果（方案 C）**
  - 描述：只要外层 JSON 成立，内部的时间/日期/URL/base64 都不再单独成项（T19 的区间占位去重 + URL 过滤），于是出现不一致：「两个时间戳并列写在正文里 → 2 项；套进 `{}` → 1 项，且时间不可读」。按拍板选择**方案 C**：不把内部目标变成独立 tab（会刷屏，且把 `{"port":1700000000}` 这类数字误报成时间），而是把**字段名像时间**且值真能解析成日期的项，作为**该 JSON 结果的字段**展示 —— 复用现有 fields 区，零 UI 改动，与 JWT 展示 `iat`/`exp` 的体验一致。
  - 实现：
    - `timestamp.ts` 抽出 `parseTimeValue()`（原先内联在 `detectTimestamp` 的数字位数 / `parseCustomDate` / 年份 1900~2200 判定），`detectTimestamp` 改用它 —— 「什么算时间值」单一来源，两处口径不会漂移。
    - 新增 `jsonTimeHints.ts`：`collectJsonTimeHints(value, max)`。字段名判定 = 精确名单（`iat` / `exp` / `nbf` / `timestamp` / `date` / `time` / `*_at` …）+ 下划线后缀 + 小驼峰后缀（`createdAt`，大小写敏感以免把 `format` 认成 `at`）；值判定走 `parseTimeValue`；路径带层级（`meta.created_at` / `items.0.iat`），数组元素没有字段名故天然不提示；上限 5 条 + 深度 6 + 节点 2000 兜住超大对象。
    - `json.ts`：`formatAndMinifyJson` → `parseJsonWithFormats`（额外返回解析结果供遍历挑字段，仍是**单次解析**）；`detect.ts` 的 `detectJson` 用它生成 `fields`（key = `jsonTime.<path>`）。
    - `DetectResultView.tsx`：`jsonTime.` 前缀的字段标签**原样展示路径**（用户数据，不走 i18n，也不会漏出裸 key）。
    - i18n：`tool.detect.jsonTimeHint` = `{{time}}（{{relative}}）` / `{{time}} ({{relative}})`。
  - 用例：新增 `jsonTimeHints.test.ts` 7 条（名单与 camelCase、值与独立时间戳候选口径一致、字段名不像时间不提示、嵌套路径与数组、条数上限、非对象不抛错、i18n 模板）；`detect.test.ts` +3（纯 JSON 带出时间字段且不新增 tab、无时间字段时 fields 为空、正文里的 JSON 同样带出提示）；`DetectResultView.dom.test.tsx` +1（标签是路径本身、不漏裸 key）；`timestamp.test.ts` +2（`parseTimeValue` 口径）。
  - 门禁 `format / lint:check / type-check / test(77 files / 1906) / build` 全绿。
  - ⚠️ **已回滚**：经产品判断，连窄版本也会给用户增加心智负担（同一份 JSON 里有的字段冒时间、有的不冒，用户得先理解"工具在猜"），见 `T22`。

- [x] **T22 按产品决定回滚 T21：不做「JSON 内时间字段可读化」**
  - 决定依据：**连窄版本也没必要**。理由有三 ——
    1. **心智负担**：同一份 JSON 里，命名字段的旁边冒出可读时间、其余不冒；用户必须先理解"工具在猜字段名"才知道该信哪一行，反而不如不做。
    2. **要覆盖自定义名（`sssssss`）就只能"只看值"**，而 10~16 位数字在文本层面**分不清**时间戳与 ID / 金额 / 手机号 —— 那是**错报**，比漏报更糟；窄版本唯一的失败模式是漏报（安全）。
    3. **收益面窄**：真实场景的高频字段名（`iat` / `exp` / `*_at` / `createdAt` / `timestamp`）本来就那几种，为长尾名字长期维护一套启发式不划算。
  - 回滚内容：删除 `jsonTimeHints.ts` 与其 7 条测试；`detectJson` 的 `fields` 回到 `[]`；`DetectResultView` 去掉 `jsonTime.` 标签分支；zh/en 删掉 `tool.detect.jsonTimeHint`；`detect.test.ts` 删掉 3 条 T21 用例、`DetectResultView.dom.test.tsx` 删掉 1 条。
  - **保留**（与"猜时间"无关的独立收益）：`timestamp.ts` 抽出的 `parseTimeValue()`（`detectTimestamp` 改用，值口径单一来源）+ 其 2 条测试；`json.ts` 的 `formatAndMinifyJson()` 单次解析（T20 性能优化）；`parseJsonc` / `isJsonText` 的深嵌套 try/catch（T20 健壮性）。
  - 结论：JSON 结果只做它该做的事（格式化 / 压缩展示），不替用户判断哪个数字是时间；若将来确有强需求，更诚实的做法是**按需动作**（选中数字 → "按时间解释"），而不是自动猜。
  - 门禁 `format / lint:check / type-check / test(76 files / 1896) / build` 全绿。

- [x] **T23 视觉：智能解析的「待切换选项」改扁平样式（去边框 / 去圆角 + 次级背景色）**
  - ⚠️ **已回滚**：改错了对象 —— 产品要改的是输入框里的**高亮标记**（`.tw-area-mark`），不是这排小胶囊。本项已完整退回原样式，实际改动见 `T24`。
  - 描述：格式预设 chips（`.tw-detect__format-chip`）与结果 Tab（`.tw-detect__tab`）原本都是「有边框 + 圆角」的小胶囊。按产品要求改扁平：**无边框、无圆角**，默认/未选中态用**次级背景色**（`--tk-secondary`）表达"可点、可切换"，hover 用 `--tk-accent`，结果 Tab 选中态仍用主色（`--tk-primary`）。
  - 变化：chips 背景 `--tk-muted` → `--tk-secondary`、`border: 1px solid var(--tk-border)` → `none`、`border-radius: var(--tk-radius-sm)` → `0`；结果 Tab 背景 `--tk-card` → `--tk-secondary`，同样去边框去圆角；两处 hover/active 规则里的 `border-color` 与选中态的 `box-shadow` 一并删掉（无边框无圆角后已无意义），transition 同步只留 color/background。全部走设计令牌（AGENTS §4.12）。
  - 范围：只动 `tw-detect__*`，不影响其它工具与划选面板。
  - 未闭环：纯视觉改动，需浏览器目测；**未**改输入框（`.tw-area-wrapper`）与结果块（`.tw-detect__block .tw-area--result`）—— 若"去掉边框和弧度"也包含它们，各是一处 CSS，按需再加。
  - 门禁 `format / lint:check / type-check / test(76 files / 1896) / build` 全绿。

- [x] **T24 视觉：高亮标记扁平化 + 「待切换」匹配用次级背景标出**
  - 描述：要改的是**输入框里那块黄色高亮**（匹配结果标记 `.tw-area-mark`）：① 去掉「圆角 + 描边」—— 原本是 `border-radius: 3px` 加 `box-shadow: 0 0 0 1px var(--tk-highlight-border)` 画的一圈描边；② **非当前（待切换）的匹配项原本完全不画**（`HighlightArea` 直接 push 纯文本，注释写着"不涂任何浅色背景"），于是用户看不出文本里还有别的匹配可以切过去 —— 现在用**次级背景色**（`--tk-secondary`）画出来。
  - 变化：`.tw-area-mark` 去掉 `border-radius` 与 `box-shadow`（transition 同步只留 `background-color`）；新增 `.tw-area-mark--idle { background: var(--tk-secondary) }`；`HighlightArea` 把非激活项渲染为 `<mark class="tw-area-mark tw-area-mark--idle">`（原先渲染纯文本）；`theme.css` 删掉随之失去唯一使用者的 `--tk-highlight-border`（浅色 / 深色各一处）。
  - 对齐不变：idle 与 active 共用同一套 `padding: 1px 2px` / `margin: 0 -1px` 与 `box-decoration-break: clone`，涂层与 textarea 仍逐字对齐（错位重影的守卫用例继续覆盖）。
  - 用例：`HighlightArea.dom.test.tsx` 改 2 条 —— 原断言「非 active 项保持纯文本」「`markTexts()` 只含激活项」改为「两个匹配都画出来，并用 `tw-area-mark--idle` 区分」；**测试先行跑红**（2 例），实现后 22 例全绿。
  - 未闭环：纯视觉，需浏览器目测（荧光黄与次级灰的对比度、深色主题下的可见度）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1896) / build` 全绿。

- [x] **T25 深色主题：高亮标记（`.tw-area-mark`）的文字看不清**
  - ⚠️ **方案已被 T27 取代**：T25 只把深色底色压暗（浅底浅字 → 深底浅字），没修「深色令牌根本到不了 Shadow DOM」这条根因，用户复测**仍然看不清**（截图里量到的高亮底色是浅色主题的 `#fef9c3`）。最终方案见 T27。
  - 现象：深色主题下，输入框里被高亮的那段文字看不清。
  - 根因：高亮是**纯背景层** —— `.tw-area-backdrop` 的 `color: transparent`，可见文字由上层 textarea 用 `--tk-foreground` 画（`tools.css` 的 `.tw-area-backdrop` / `.tw-area-input`）。所以高亮底色**必须比文字暗**；而深色主题的 `--tk-highlight` 原本是 `color-mix(in srgb, #fef9c3 30%, transparent)` —— 一层 30% 的浅黄罩在近黑卡片（`--tk-card`）上，合成出来是发灰的橄榄色（约 `rgb(89 87 72)`），近白文字压上去只剩 **≈6.9:1**，且已经完全看不出"黄色高亮"。
  - 修法：深色 `--tk-highlight` 改为**不透明的深琥珀** `hsl(45 70% 18%)`（合成后 `rgb(78 62 14)`）：文字对比度 **6.9:1 → 9.96:1**，同时保留"琥珀/黄"的语义色相；浅色主题（`#fef9c3` 浅底 + 深字，16.97:1）不动，待切换项（`--tk-secondary`）在深色下本来就是深底浅字（16.04:1）也不动。
  - 为什么不能在深色下继续用"亮黄底"：字色由 textarea 整块统一下发（一个元素一个颜色），**没法只给高亮范围内的字换成深色** —— 只能把底色压暗。反过来把输入框文字整体改深色更不行（非高亮处会变成深字压深底）。
  - 用例：`theme.dom.test.ts` 新增 `describe('高亮标记的可读性')` 4 条，配一组 WCAG 小工具（读 `theme.css` → 剥注释 → 按 `:root[data-theme='dark']` 切分取令牌 → `#rrggbb` / `hsl()` 解析 → 相对亮度 → 对比度），断言浅 / 深两套主题下 `--tk-foreground` 压在 `--tk-highlight`（当前项）与 `--tk-secondary`（待切换项）上都 ≥ 4.5:1。
    - 选择**读 theme.css 文件**而不是断言一组写死的色值：令牌唯一出处仍在 `theme.css`（AGENTS §3），不在用例里再复制一份；Vitest 里 CSS 导入会被置空（`?inline` 与 `?raw` 实测都是空串），所以走 `import.meta.dirname` + `readFileSync`。
    - **变异验证**：还原成 `color-mix(...)` → 红（解析器明确拒绝半透明写法，10/20 之外的 1 条失败）；换成"不透明但过亮"的 `hsl(45 70% 80%)` → 红（1.28:1）；改回后 20 例全绿。
  - 未闭环：纯视觉，仍需浏览器目测确认「深琥珀底 + 近白字」在高亮语义上是否够醒目（本会话环境没有浏览器，无法目测）。若希望更醒目，可再调深浅（会同步影响上面的对比度用例）。
  - 门禁 `format / lint:check / type-check / test(76 files / 1900) / build` 全绿。

- [x] **T26 工程：验证分级写进 AGENTS.md，过程调试不再跑全量门禁**
  - 描述：AGENTS.md 原先是「改完必须全绿」，于是改一个颜色也要跑满 76 files / 1900 例单测 + 构建：等待时间长，整个测试树的输出还会灌进上下文（token 开销主要在这里）。实测对比：定向单测 ~1s，全量链 ≈ 35s。
  - 修法：`AGENTS.md` §2 补齐命令的真实语义与实测耗时（`pnpm test <文件名片段>` / `pnpm test:changed` / `pnpm test:watch` 各一行；`build` 注明内含 `tsc -b`；`test:watch` 标注代理禁用），§7 重写为**过程验证（默认）**与**交付门禁（收尾才跑）**两级——§7.1 给「改了什么 → 跑哪条命令」对照表，§7.2 列清触发条件、把 `type-check` 从全量链移除（`build` 已含它）、并补输出卫生与报告纪律；§6.1 收尾步骤改为引用 §7。本文件约定第 5 条同步改为引用 AGENTS §7，避免两处规则打架。
  - 依据（本机实测）：`pnpm test theme` 1.2s（1 file / 22 例）、`pnpm test i18n` ~1s（3 files）、全量 `pnpm test` 10.8s（76 files / 1902 例）、`pnpm test:changed` 11.1s（工作区改了 20+ 文件时 ≈ 全量）、`type-check` 5.0s、`lint:check` 6.7s、`build` 14.4s。另用临时探针验证：`--changed` **会**选中未跟踪的新测试文件（77 files），筛不到任何文件时 vitest 非 0 退出。
  - 验收标准：AGENTS.md / TASKS.md 描述的命令都真实存在、耗时与实测相符；AGENTS.md 与 TASKS.md 不再有冲突规则。
  - 依赖：无
  - 结果：纯文档改动，按新 §7.1「纯文档不跑命令」未跑代码门禁（文档验证 = 逐条比对 `package.json` / `vitest.config.ts` / `ci.yml` 与实测耗时）。

- [x] **T27 深色主题高亮仍看不清：修根因（深色令牌到不了 Shadow DOM）+ 高亮改「浅黄底 + 深色字」**
  - 现象：T25 改了深色 `--tk-highlight` 的值之后，用户复测**依旧看不清**。直接从截图取样量出高亮底色是 `rgb(254 249 195)` = 浅色主题的 `#fef9c3`，压在近白文字下 —— 说明深色主题那一套令牌**根本没送到**。
  - 根因（两处，缺一不可）：
    1. `theme.css` 深色块的选择器写成 `:host[data-theme='dark']`（非函数式 `:host` 与属性选择器组成 compound）。按 css-scoping，非函数式 `:host` 必须是 compound 里唯一的简单选择器，因此这条**永远不匹配** —— 抽屉 / 悬浮球 / 划选面板里的深色令牌整块失效，只剩 `theme.ts` 的 `THEME_PALETTES` 内联兜底在生效。扩展页面走的是 `:root[data-theme]`，不受影响，所以**只在页面上看根本发现不了**。
    2. 那份内联兜底里没有高亮令牌，于是 `--tk-highlight` 退回浅色块的 `#fef9c3`：浅黄底 + 近白字，正是截图里的形态。
  - 修法：
    - **选择器**：深色块改为 `:root[data-theme='dark'], :host([data-theme='dark'])`（函数式），并清掉 `tools.css` 里 8 处同样的非法写法（那 8 处各自另有一份函数式选择器顶着，所以此前没暴露）。
    - **配色结构**：改成与既有 JSON 高亮编辑器（`.json-editor__hl` / `.json-editor__input`）一致的「可见文字由涂层画、textarea 文字透明」双层模式 —— 只有这样才能让**每个匹配项各带成对配色**。新增 4 个令牌：`--tk-highlight` / `-foreground`（激活项：明暗通用浅黄底 + 深色字）、`--tk-highlight-secondary` / `-foreground`（待切换项：浅色主题 `#fef9c3` + 深字，深色主题暖暗金 + 近白字）。扁平样式沿用 T24（无圆角、无描边）。
    - **兜底补全**：`THEME_PALETTES` 补上 4 个高亮令牌 + 漏掉的 `--tk-shadow-xs`（它同样是「深色块改过值但兜底里没有」）；`--tk-highlight-border` 随旧描边一并作废（已无引用）。textarea 的选区补 `color: transparent`，与 `.json-editor__input::selection` 对齐，避免 UA 的选区文字色压上来与涂层叠成重影。
  - 用例（`theme.dom.test.ts` 22 → 29，全量 1902 → 1909）：
    - **可读性**：明暗两套下 `--tk-highlight-foreground` / `--tk-highlight-secondary-foreground` 压各自底色 ≥ 4.5:1（实测 15.7:1 / 17.0:1 / 6.8:1）。
    - **内联兜底完整性**（新增）：theme.css 深色块里改过值的令牌，必须每一个都被 `applyTheme` 内联到宿主上 —— 漏一个就退回浅色值，正是本次 bug 的形态；另加一条前提断言，防止守卫退化成空转。
    - **Shadow DOM 主题选择器**（新增）：递归扫描全仓 CSS，禁止「非函数式 `:host` + 其它简单选择器」的 compound；并断言深色块用的是函数式写法。
    - **高亮文字层契约**（新增）：按声明原文钉住「涂层画字 + textarea 文字透明 + 标记底色/文字色成对取自令牌」—— 这三条一起才构成可读性，少一条就复现原 bug。
    - **三条守卫都做了变异验证**：删掉 `--tk-shadow-xs` 内联 / 把非法 `:host` 复合写回去 / 把 textarea 文字改回不透明，各自都让对应用例变红；复原后 29 例全绿。
  - 未闭环：**必须浏览器目测**（happy-dom 无排版引擎，本次只能证明令牌、选择器与声明的结构正确，证明不了观感）。重点看：① 深色抽屉 / 侧边栏里浅黄底 + 深色字是否够醒目；② 中文输入法组合期的文字与光标（textarea 文字透明后，组合文本靠 `value` 同步到涂层，但输入法自带的下划线不再绘制）；③ 选中一段文字时选区与涂层是否叠加正常；④ 浅色主题下激活项 `#fef08a` 与待切换项 `#fef9c3` 同色系深浅是否区分得开（若嫌弱，把 idle 改成中性底即可，只动一个令牌）。
  - 门禁 `format / lint / test(76 files / 1909) / build` 全绿（本机）；`lint:check` 由 CI 兜底。

- [ ] **T7 人工浏览器实测（需人在装了 Chrome 的机器上执行）**
  - 描述：TASKS.md「遗留复验」中无法自动化的部分：T4 `#11`/`#12`、T4 `#15`、A6/A8 的真实浏览器行为。可先由 `pnpm build` + 加载 `dist/` 后按清单逐条核对。
  - 验收标准：逐条记录「操作步骤 → 观测结果」，通过者从「遗留复验」移除，异常者开新任务。
  - 依赖：人工 + 真实浏览器环境（本会话环境不具备）
  - 结果：（待填）
