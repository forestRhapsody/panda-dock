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

- [ ] **T7 人工浏览器实测（需人在装了 Chrome 的机器上执行）**
  - 描述：TASKS.md「遗留复验」中无法自动化的部分：T4 `#11`/`#12`、T4 `#15`、A6/A8 的真实浏览器行为。可先由 `pnpm build` + 加载 `dist/` 后按清单逐条核对。
  - 验收标准：逐条记录「操作步骤 → 观测结果」，通过者从「遗留复验」移除，异常者开新任务。
  - 依赖：人工 + 真实浏览器环境（本会话环境不具备）
  - 结果：（待填）
