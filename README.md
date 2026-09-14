<p align="center">
  <img src="docs/assets/icon128.png" width="96" height="96" alt="Panda Dock" />
</p>

<h1 align="center">Panda Dock</h1>

<p align="center">
  一款高效的开发者工具箱，完全本地运行，免费且开源。
</p>

## 使用

### 唤起方式

1. 点击网页内悬浮球，或按 `Alt + Shift + D`，按已配置的方式打开工具箱（网页内抽屉或浏览器原生侧边栏）。

2. 选中文本后，用右键菜单或按 `Alt + Shift + S` 唤起智能解析面板。

## 隐私

本扩展不联网、不收集数据。代码开源可审计。

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
