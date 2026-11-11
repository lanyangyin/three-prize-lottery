# 三人抽奖器 · 静态网页版

> 只有 **3 个奖品**、**5~50 人** 的现场抽奖页。三等奖 → 二等奖 → 一等奖逐个揭晓，中奖不重复，人不到场可重抽。纯静态，离线可用。

![界面截图](docs/screenshot.png)

**在线地址：** https://lanyangyin.github.io/three-prize-lottery/

## 使用

直接用浏览器打开 `index.html`，或者用任意静态服务器：

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

1. 左侧填参与者名单（一行一个，逗号/顿号分隔也认）；
2. 点 **开始抽奖** 或按 `空格`，从三等奖抽到一等奖；
3. 每抽出一个先确认中奖者在不在场，不在就点 **此人不到场 · 重抽**；
4. 三个奖抽完自动记入「历史记录」，点 **导出记录** 可下载 TXT。

## 功能

- 公平抽取：每个奖从剩余名单等概率随机，中奖者立即移出，绝不重复；
- 滚动揭晓动画 + 彩带，`F11` 或右上角 ⛶ 全屏投屏；
- 名单自动保存在浏览器，刷新不丢；抽奖中途刷新也能恢复进度；
- 历史记录保存在 `localStorage`，可导出 TXT 或复制文本；
- 响应式布局，手机也能用；支持 `prefers-reduced-motion`。

## 公平性

每人中奖概率 = 3 ÷ 总人数（5 人 60%，10 人 30%，50 人 6%）。抽奖结果在动画开始前就已确定，动画只是表现。随机数使用 `crypto.getRandomValues` 做无偏采样。

## 开发

```bash
node --test tests/core.test.js
```

测试覆盖名单解析、4~50 人不重复中奖、中奖分布、重抽、状态恢复与记录格式。

## 文件结构

```text
index.html          页面
assets/styles.css   样式
assets/core.js      抽奖核心逻辑（浏览器 / Node 通用）
assets/app.js       界面交互、动画、本地存储
assets/favicon.svg  图标
tests/core.test.js  Node 单元测试
```

数据只保存在浏览器本地，不会上传到任何服务器。
