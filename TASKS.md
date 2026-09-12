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
- `A6` `toast` 的非法 duration 回落与定时器清理：可观测性有限，仅由 `toast.test.ts` 覆盖。
- `A8` 裁剪导出的失败提示：正常路径已实测；失败路径需 DevTools 覆盖 `getContext` 才能触发，仅由单测覆盖。
- T4 `#11`（抽屉 Escape 与内层浮层让行）、`#12`（划选面板 resize/scroll 重定位）：机制由 happy-dom 覆盖，真实浏览器里「划选面板与抽屉同开时 Escape 只关面板」「滚动时浮层跟随」未实测。
- T4 `#15`（live region 改动）：读屏实际播报行为需在真实辅助技术下确认。
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
    4. `detect` 的 `kind:'urls'` 仍只存在于类型与 `KIND_LABEL`、从不产出（`#9` 决定保留，删它属纯清理）。
