<p align="center">
  <img src="docs/assets/icon128.png" width="96" height="96" alt="Panda Dock" />
</p>

<h1 align="center">Panda Dock</h1>

<p align="center">
  一款高效的开发者工具箱，完全本地运行，免费且开源。
</p>

## 离线安装

不经过 Chrome 应用商店，直接加载本地扩展包即可安装（Chrome、Edge 等 Chromium 内核浏览器通用）：

1. 打开 [Releases](https://github.com/forestRhapsody/panda-dock/releases/latest)，下载最新的 `panda-dock-v<版本号>.zip`。

2. 把压缩包解压到一个**固定、不会被清理的目录**（例如 `D:\PandaDock`）。Chrome 每次启动都会从这个目录读取扩展，解压后不要删除或移动。

3. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启右上角的「开发者模式」，点击「加载已解压的扩展程序」，选择第 2 步解压出的目录——该目录下应该能直接看到 `manifest.json`。

4. 建议点击工具栏的扩展图标 → 「固定」，把 Panda Dock 固定在工具栏；之后按 `Alt + Shift + D` 即可唤起工具箱。

**升级**：下载新版压缩包覆盖原目录，回到 `chrome://extensions` 点击该扩展卡片上的刷新按钮。

> 以这种方式安装的扩展不是来自应用商店，Chrome 启动时可能提示「停用以开发者模式运行的扩展程序」，忽略即可。
>
> 也可以自行构建后加载：见 [开发](#开发)。

## 使用

### 唤起方式

1. 点击网页内悬浮球，或按 `Alt + Shift + D`，按已配置的方式打开工具箱（网页内抽屉或浏览器原生侧边栏）。

2. 选中文本后，用右键菜单或按 `Alt + Shift + S` 唤起智能解析面板。

## 隐私声明

本扩展基于浏览器本地环境，不联网、不收集数据。代码开源可审计。

查看隐私政策：[隐私政策](https://forestRhapsody.github.io/panda-dock/zh-CN/privacy.html)

## 开发

开发环境：Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm 10.17.0（仅支持 pnpm，`npm` / `yarn` 会被拦截）。

```bash
git clone https://github.com/forestRhapsody/panda-dock.git
cd panda-dock
pnpm install
pnpm dev      # 浏览器预览 UI（无 chrome.*，自动降级）
pnpm build    # 构建到 dist/
```

构建完成后，打开 `chrome://extensions`，开启右上角「开发者模式」，点「加载已解压的扩展程序」并选择 `dist/` 目录。

## 许可

[MIT](LICENSE) © forest rhapsody。
