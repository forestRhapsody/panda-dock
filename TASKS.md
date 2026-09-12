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

## 遗留复验（来自已完成任务，均已在提交 `6edba37` 中落地，但**未做真实浏览器实测**）

- `A5` 入口缺 `#root` 的兜底：已通过反混淆构建产物确认 `console.error` 分支进入 `dist`；浏览器无法自然触发（入口 HTML 必然带 `#root`）。
- `A6` `toast` 的非法 duration 回落与定时器清理：可观测性有限，仅由 `toast.test.ts` 覆盖。
- `A8` 裁剪导出的失败提示：正常路径已实测；失败路径需 DevTools 覆盖 `getContext` 才能触发（当时未能作用于应用 realm），仅由单测覆盖。
- `A13` handoff 自动格式化：仅单测覆盖。复核方式：智能解析粘贴 `{"b":2,"a":1}` →「在 JSON 工具中打开」→ 结果区应直接显示格式化好的 JSON。
- 测试侧限制（happy-dom 无排版）：真实像素高度/滚动条、dnd-kit 真实拖拽序列、真实文件选择与 `FileReader.onerror`、canvas 真实栅格；相关用例只断言可确定的分支。

## 任务列表

- [~] **T4 B 类疑点：需产品/交互拍板（17 条，已完成 4 条）**
  - 描述：这些改动的「修法」取决于产品语义或交互策略，没有唯一正确答案。每条给出「建议」供直接采纳或覆盖；决定后按既有纪律执行（改源码 + 同步被锁定的断言 + 补会在旧代码上变红的回归用例 + 满门禁）。
  - 验收标准：每条先记录决定，再改代码；改完 `pnpm format && pnpm lint && pnpm type-check && pnpm test && pnpm build` 全绿。
  - 依赖：无（前置的测试补齐与 A 类修复已完成并提交）
  - 决定记录：**进行中**——首批按用户决定「先做前 3 条大的」执行完毕（原第 1 / 3 / 7 条），第 7 条顺带解决了原第 8 条；其余 13 条待拍板
  - 已完成（首批）：

    | 原编号 | 文件 | 决定与实现 | 测试变更 |
    | --- | --- | --- | --- |
    | 1 | `src/tools/timestamp.ts` | date-only（`YYYY-MM-DD`）按**本地零点**解析：新增 4a 分支，用 `new Date(0)` + `setHours(0,0,0,0)` + `setFullYear(y, m, d)` 构造，并保留本地字段比对（仍拒绝 2 月 31 日）。修复负 UTC 偏移时区把 `2025-01-01` 误判为非法的问题 | `timestamp.test.ts` 改为断言本地日历字段且与 `new Date(2025,0,1)` 等时；`detect.test.ts` 两个 date-only 用例由「UTC 零点 / 时区相关分支」改为本地零点 |
    | 3 | `src/tools/cookieRaw.ts`（原清单误写为 `src/utils/`，已纠正） | 新增 `splitCookieSegments()`：按 `;` 切分但**跳过双引号内**的分号；`parseSetCookieLine` 与 `parseRawCookie` 的文本分支都改用它。引号原样保留在值里，Raw 模式可原样往返 | `cookieRaw.test.ts`：新增 3 例（截断回归、带属性的完整行、序列化↔解析往返），并把原「引号内的分号会被误切（现状限制）」改为断言完整值 |
    | 7 | `src/tools/detect.ts` | 新增 `KNOWN_TLDS` 白名单 + `isKnownBareDomain()`，在**两条**裸域名路径上生效：`extractUrls` 的裸域名循环、以及 `detectUrl` 的纯输入分支（后者是关键——只改前者时 `README.md` 仍会被判成网址） | `detect.test.ts`：新增「常见文件名不再被当成网址」（同时断言 `example.com` 仍识别），并更新两段式 token / payload 非 JSON 两个用例 |
    | 8（顺带解决） | `src/tools/detect.ts` | 原「自由文本中的 JWT 会额外产出重叠的伪 URL 项」被第 7 条一并解决：base64 片段不再被当成 TLD，伪 URL 消失 | 「句子中的 JWT 不再额外产生重叠的伪 URL 项」断言不再出现 url 项、且 jwt 项仍在 |

    - 验证：上述 11 条新增/改写的断言在**旧代码上全部变红**（实测确认），新代码全绿；门禁 `format / lint / type-check / test(76 files / 1841 tests) / build` 全绿。
    - 浏览器复验（维护者实测）：✅ 三条均符合预期——`2025-01-01` 正常识别为时间戳；Cookie Raw 模式输入 `note="a;b"; theme=dark` 解析出**两个** Cookie 且 `note` 的值为 `"a;b"`（修复前被截成 `"a`）；`README.md` 不再识别为网址，`example.com` 仍识别。
    - 取舍备注（第 7 条）：白名单意味着**漏报冷门后缀**（如 `example.zip`、`example.md` 不再识别为网址）。这是刻意选择——宁可漏报，也不把 `README.md` 这类文件名当网址；需要新后缀时在 `KNOWN_TLDS` 补充。
  - 待拍板（13 条，编号沿用原清单以便追溯）：
    2. `src/tools/timestamp.ts:199` — 中文 / US / 英文月份分支不校验滚动（`2025年2月31日`→3月3日、`Feb 30, 2025`→3月2日），而 `YYYY-MM-DD` 分支会拒绝。（建议：**统一为拒绝**，静默进位是数据错误）
    4. `src/tools/cookieRaw.ts` 序列化 — `expirationDate === 0` 被省略、空 name 输出 `=1`（parse 端拒绝），序列化↔解析不闭环。（建议：**`0` 视为合法时间戳照常输出 Expires；空 name 返回空串表示不可序列化**）
    5. `src/tools/QrCodeTool.tsx:216` vs `232-243` — 应用 Logo 时强制 `ecLevel='H'`，移除 Logo 后不回落。（建议：**回落到用户原等级**，用 ref 记住强制 H 之前的值）
    6. `src/tools/QrCodeTool.tsx:211-218` — `handleCropConfirm` 不清理 `cropSourceUrl`（为支持「重新裁剪」复用同一 objectURL）。（建议：**保持现状**，属有界驻留且会在下次上传/移除/卸载时回收；只补注释）
    9. `src/tools/detect.ts` — UUID 只认 v1–v5（v6/v7 退化为 hex 候选）；`kind:'urls'` 只存在于类型与 `KIND_LABEL`、`detect` 从不产出。（建议：**补 v6/v7 正则**；`kind:'urls'` **保留**，删它属纯清理、收益低）
    10. `src/tools/DetectResultView.tsx:16` — `KIND_LABEL` 是 `Record<DetectResult['kind'], string>`，运行时脏 kind 渲染成「解析为：」+ 空白。（建议：**加兜底文案**，新增 `tool.detect.unknown`）
    11. `src/content/Drawer.tsx` / `src/content/ToolkitOverlay.tsx` — 抽屉无 Escape / 遮罩关闭，目前只有关闭按钮、消息、`Alt+Shift+D`。（建议：**加 Escape 关闭，但仅当没有 `.tk-modal` 内层弹窗时**；不加遮罩）
    12. `src/content/SelectionDetectPanel.tsx` — 定位只在挂载/选区变化时执行，resize/滚动不重定位，面板可能被挤出视口。（建议：**加 resize/scroll 重定位**，带节流）
    13. `src/content/Drawer.tsx` `onResizeEnd` — 用闭包 `width` 持久化，同批次事件下可能写旧值。（建议：**改 ref 读取**）
    14. `src/options/OptionsPage.tsx` `persist` — 每次改动立即 `saveSettings(完整 Settings)`，未用 §5「脏标记 + useEffect」。（建议：**保持立即写入**，并给 AGENTS §5 补一句「设置页表单控件可直接写入」）
    15. `src/ui/Toaster.tsx`（空列表 `return null`，live region 随内容销毁）+ `src/tools/StatusText.tsx`（无 `role="status"`/`aria-live`）。（建议：**补**——Toaster 改为常驻 live region，StatusText 加 `role="status"`）
    16. `src/utils/env.ts` `extVersion` — 用 `??`，`version === ''` 时返回空串而非占位 `0.2.0`。（建议：**改**，空串也回退占位值）
    17. `src/utils/shortcuts.ts` `formatShortcutForDisplay` — 非 mac 分支不改大小写（`alt+shift+d`），mac 分支会大写。（建议：**非 mac 统一大写**为 `Alt + Shift + D`）
