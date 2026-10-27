# DSMC v2.9.0 变更说明

> 起因：希望米表能换成 `ip.fs.kg` 那种风格 —— 奶油色底、黑描边、硬投影、
> 荧光笔高亮，像一张印出来的纸。要求**能和现有的深色 / 浅色主题互相切换**，
> 不是把原来那套替换掉。

## 一、为什么是"第三套主题"而不是"改配色"

米表原来的明暗两套主题靠 `html[data-theme]` 上的一组 CSS 变量区分：换掉
`--bg` / `--surface` / `--text` 就换了一套皮。这套办法在 neo 上不成立：

| 观感要素 | 原来的做法 | neo 需要的 |
| --- | --- | --- |
| 投影 | `0 18px 50px rgba(0,0,0,.55)` 柔和阴影 | `4px 4px 0 #141210` 硬偏移纯色块 |
| 边界 | `1px solid rgba(255,255,255,.08)` 半透明 | `2px solid #141210` 实线 |
| 高亮 | 无 | `linear-gradient` 荧光笔划过标题和价格 |
| 背景 | 顶部柔光 + 网格 + 中段渐隐 | 1px 点阵平铺 |
| 圆角 | 10–16px 圆润 | 14px 但配描边，观感偏"贴纸" |

硬投影不是阴影，是一个错位的色块；描边不是"更明显的边框"，而是撑起整个
版面的骨架。这些都得逐条写规则，只改变量做不出来。

所以 `MARKET_CSS` 里加了一整段 `[data-theme="neo"]` 覆盖，变量先落一遍
（保证没被逐条覆盖到的元素不至于变成黑底黑字），再按组件覆盖：

```css
[data-theme="neo"]{--bg:#F4EFE3;--surface:#FFFCF3;--border:#141210;
  --text:#141210;--accent:#6B4EE6;--edge:#141210;--hl:#F7E85B;...}
[data-theme="neo"] .mcard{border:2px solid var(--edge);box-shadow:4px 4px 0 var(--edge)}
[data-theme="neo"] .mcard:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--edge)}
```

悬停改成"往左上挪 2px、投影加长到 6px"，模拟贴纸被掀起来一点。

### 荧光笔为什么必须 `display:inline`

标题和价格的高亮是 `linear-gradient(transparent 16%,var(--hl) 16%,...)`。
铺在块级元素上会盖住整块矩形，只有 `display:inline` +
`box-decoration-break:clone` 才能让长标题换行时**每一行**都各自带上高亮，
且上下各留一点空白，看着像笔划过去。

背景也换了做法：原来的"柔光 + 网格 + 中段渐隐"是为深色底设计的，铺到奶油色
上会糊成一片脏色。neo 用 1px 圆点、16px 间距、13% 不透明度，远看是纸的纹理。

## 二、按钮从两态变三态

```js
const THEMES = ['dark', 'light', 'neo'];
// 点击：取当前主题的下标，+1 取模 → 末尾回到深色
```

图标跟着换：深色显示月亮、浅色显示太阳、neo 显示四角星（`icons.js` 新增
`spark`）。三个 `span` 都在 DOM 里，靠 `[data-theme]` 控制显隐，不重新渲染。

### 存储键必须拆开

这是本轮唯一的"坑点"决定。米表原来和后台面板共用 `dsmc-theme`：

```js
// 改前
localStorage.setItem('dsmc-theme', t)
```

如果把 `neo` 也写进这个键，用户在米表点了第三套主题，再回后台，面板会拿到
`data-theme="neo"` —— 而**面板只有深色和浅色两套 CSS，没有 `neo` 的变量**，
整页会塌成默认的黑字白底。

所以米表改用**自己的**键：

```js
localStorage.getItem('dsmc-market-theme') || localStorage.getItem('dsmc-theme')
```

- 写入只写 `dsmc-market-theme`，面板永远看不到 `neo`
- 读取时回落到共用键 —— 老用户升级上来，看到的是自己原来选的那套，不跳变

首屏脚本仍然放在 `<head>` 里执行（`themeBootScript()`），否则会先闪一帧深色
再跳到奶油色。

## 三、顺手修的两处布局

### 1. 窄屏主题按钮压在卡片描边上

按钮原来是 `position:fixed` 贴视口右上角。深色主题的头部没有卡片、只有一圈
很淡的 1px 边，按钮压上去看不出来；neo 的头部是 2px 黑描边 + 硬投影的卡片，
按钮正好把右上角那条描边切断，看着像缺了个角。

改法：按钮移进 `<header class="mhead">`，`.mhead` 加 `position:relative`，
窄屏下按钮改成 `position:absolute`，落在卡片**内侧**的右上角。桌面端仍是
`fixed`（滚动时跟着走），不受影响。

放在 header **外面**不行：`.wrap` 自己有 `position:relative`，按钮会相对它
定位，还是在卡片描边上。

### 2. 「查看域名详情」被胶囊挤到下一行

neo 的头部有 22px 内边距，容器内宽从 1080 缩到 1032；胶囊因为描边变粗、字重
变重，一排八颗加起来 961px，再加登录按钮 121px 就超了 —— 按钮被挤到第二行，
左边空出六百多像素。

试过两条路：

- **收窄胶囊**（字号 12.5→12、内边距 12→9）：刚好塞进 1032。但这是踩线通过，
  `--force-device-scale-factor=2` 下字宽有 1–2px 差异，截图就翻成两行了。
  同一份 CSS 在不同缩放比下排版不同，不能这么干。留 14px 余量后两种倍率都稳定。
- **两列网格**（胶囊左列换行、按钮右列居中）：更"稳"，但八颗胶囊在左列会
  变成 7+1，`GitHub` 孤零零挂在第二行，比原来更难看。

最终方案是改结构而不是调数值：胶囊包进 `.contact-list`，登录按钮是它的
**兄弟节点**：

```html
<div class="contacts">
  <div class="contact-list">…胶囊…</div>
  <a class="contact login">查看域名详情</a>
</div>
```

`.contact-list{flex:1 1 auto}` 只让胶囊自己换行，按钮 `flex:none` 永远不跟着
走。用户配了 12 条导航链接时，胶囊排成三行，按钮仍然稳在右侧垂直居中 ——
这是调数值调不出来的稳定性。窄屏下 `.contact-list{flex:1 1 100%}`，按钮自然
落到下一行右侧，和改版前观感一致。

## 四、验证

- 截图：1400px 桌面（深色 / neo 各一张）、390px 移动（iframe 精确模拟，
  `--window-size` 在 Windows 上有最小宽度，直接设 390 拿到的是 485px 视口）
- 断言（`test/ui-market.test.js`）：
  - 三套主题都在 CSS 里定义，neo 有自己的变量组
  - 循环顺序是 `["dark","light","neo"]`，取模回到第一套
  - 写入只落在 `dsmc-market-theme`，读取时回落到 `dsmc-theme`
  - 登录按钮是 `.contact-list` 的兄弟节点（换行时不被挤走）
  - 硬投影、荧光笔色写进了 CSS（不是只改变量）
- 旧断言改了 3 处：原来按第一个 `</div>` 切联系方式块，现在按钮在列表外面，
  会被切掉 —— 抽了个 `contactsBlock()` 辅助函数，切到登录按钮结束

## 五、没有改的东西

- `CACHE_VERSION` 不动：这次只动 UI，改缓存版本会打掉全库的 WHOIS 缓存
- 面板（后台）不引入 neo：它是工作台，不需要"印刷品"观感，也不该为了一个
  展示主题去维护第三套变量
- `VERSION` 升到 2.9.0：新增主题算功能，不是补丁
