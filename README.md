<p align="center">
  <img src="docs/assets/icon128.png" width="96" height="96" alt="Panda Dock" />
</p>

<h1 align="center">Panda Dock</h1>

<p align="center">
  一款高效的开发者工具箱，完全本地运行，免费且开源。
</p>

## 使用教程

1. 从谷歌商店安装拓展。

2. 点击网页内悬浮球，或按 `Alt + Shift + D`，按已配置的方式打开工具箱（网页内抽屉或浏览器原生侧边栏）。

3. 选中文本后，用右键菜单或按 `Alt + Shift + S` 唤起智能解析面板。

## 开发

开发环境：Node `^22.12.0 || ^24.0.0 || >=26.0.0`、pnpm 10.17.0。

```bash
git clone https://github.com/forestRhapsody/panda-dock.git
cd panda-dock
pnpm install
pnpm dev      # 浏览器预览 UI（无 chrome.*，自动降级）
pnpm build    # 构建到 dist/
```

构建完成后，打开 `chrome://extensions`，开启右上角「开发者模式」，点「加载已解压的扩展程序」并选择 `dist/` 目录。

## 隐私声明

本扩展基于浏览器本地环境，不联网、不收集数据。代码开源可审计。

查看隐私政策：[隐私政策](https://forestRhapsody.github.io/panda-dock/zh-CN/privacy.html)

## 离线安装

1. **开启开发者模式**：地址栏输入 `chrome://extensions`，打开页面右上角的「开发者模式」。

2. **下载并解压**：在 [Releases](https://github.com/forestRhapsody/panda-dock/releases/latest) 下载最新版压缩包，解压到一个固定目录（如 `D:\PandaDock`）。升级时会覆盖这个目录，所以不要删除或移动它。

3. **加载扩展**：点击页面左上角的「加载已解压的扩展程序」，选择第 2 步解压出的目录。

> **安全提示**：请从本仓库的 Releases 页面下载，不要安装来历不明的扩展包；下载后建议先校验 SHA-256 再解压使用。

## 许可

[MIT](LICENSE) © forest rhapsody。
