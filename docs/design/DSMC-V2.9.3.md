# DSMC v2.9.3 变更说明

> 起因：用户截图指出两件事 ——
> 一是头部右侧的标题和介绍，右边缘比下面那排联系方式短一截，希望对齐；
> 二是 neo 主题既然已经调顺，就让它当米表的默认皮肤。

## 一、标题右边缘为什么对不齐

`.mhtext`（标题 + 介绍）一直带着 `padding-right:44px`：

```css
.mhtext{flex:1 1 260px;min-width:0;text-align:right;padding-right:44px}
```

这 44px 是**给右上角那个主题按钮让位**的。当年按钮是 `position:fixed` 贴视口右上角，
而标题右对齐后会一路顶到容器右边缘，视口一窄两者就叠在一起。

问题是按钮其实**只在窄视口才真的和卡片相撞**。卡片最宽 1120px 居中，视口 1400px 时
卡片右缘离视口右缘还有 140px 空当，按钮在视口角落，标题却仍然傻乎乎地让出 44px ——
于是标题、介绍、四条胶囊都停在 1201，而「查看域名详情」停在 1245 之外，
一整列看着像被削掉一块。

### 改法：让「让位」只在真的需要时生效

按钮不再默认 `fixed`：

```css
/* 默认落在卡片右上角内侧，定位基准是 .mhead 的 relative */
.themebtn{position:absolute;top:10px;right:10px}

/* 视口够宽、按钮离卡片足够远，才贴回视口角，标题同时把 44px 收回来 */
@media (min-width:1240px){
  .themebtn{position:fixed;top:16px;right:16px}
  .mhtext{padding-right:0}
}
```

**1240 这个阈值是算出来的，不是拍的**：

- 卡片外缘右坐标 = `视口宽 / 2 + 560`（1120 居中）
- 按钮左坐标 = `视口宽 - 16 - 34`
- 两者不重叠要求 `视口宽 > 1220`

取 1240 留 20px 余量（滚动条、缩放比都会吃掉几个像素）。

实测三档（`getBoundingClientRect().right`）：

| 视口 | 标题 | 介绍 | 查看域名详情 | 按钮定位 |
|---|---|---|---|---|
| 1400 | 1201 | 1201 | **1201** | fixed |
| 1300 | 1151 | 1151 | **1151** | fixed |
| 1100 | 981 | 981 | 1025 | absolute（按钮在卡片内，标题必须让位） |

1100 这一档看起来仍然差 44px，但那是按钮真的占着那块地方 —— 让位是对的，
不让位就是文字压在按钮底下。

顺带修掉一个隐患：按钮 `fixed` 贴视口时，视口窄到卡片顶边（560–1240 之间）会正好
切在 neo 那条 2px 黑描边上，看着像缺了个角。改成默认 `absolute` 落在卡片内侧后
这个区间也安全了，窄屏原来那条单独的 `position:absolute` 覆盖规则就没用了，删掉。

## 二、默认皮肤改成 neo

### 服务端也渲染 neo

```js
'<html lang="zh-CN" data-theme="neo">'
```

不能只改脚本里的默认值。脚本在 `<head>` 里跑，虽然早于首次绘制，但
**禁用 JS、脚本被 CSP 拦、或者解析器先画了一帧** 这三种情况下，页面就是深色。
直接把属性写在服务端输出上，任何情况第一眼都是 neo。

首屏脚本仍然要做，只是职责收窄成「按存储覆盖」：

```js
var t = localStorage.getItem('dsmc-market-theme')
     || localStorage.getItem('dsmc-theme')
     || 'neo';
```

顺序没变：**米表自己的键 → 面板共用的键 → neo**。回落到 `dsmc-theme` 是为了让
升级上来的老用户保持自己选过的明暗；两边都没存过的（绝大多数访客）才落到 neo。

### 地址栏底色跟着走

米表原来和面板共用 `THEME_COLOR_META`，那是两个按 `prefers-color-scheme` 自动切的
`theme-color`。默认换成奶油色的 neo 之后，深色系统的手机上会出现
**奶油色页面配近黑状态栏**。

米表改成自己的一份：

```js
const THEME_COLORS = { dark: '#070A0F', light: '#F6F7F9', neo: '#F4EFE3' };
```

首屏脚本和切换按钮都同步 `meta[name=theme-color]` 的 `content`，切一次主题地址栏跟着变。
`color-scheme` 也从 `dark light` 改成 `light dark`（首选浅色，滚动条、表单控件才不会被
渲染成深色）。

## 三、测试

新增 2 条、改写 1 条（`test/ui-market.test.js`，47 项）：

- **宽屏下标题右边缘与联系方式行对齐** —— 锁住三件事：`.mhtext` 基础规则仍有 44px、
  `@media (min-width:1240px)` 里同时出现 `fixed` 按钮和 `padding-right:0`、
  `.themebtn` 基础定位是 `absolute`（这条防的是描边被切）
- **默认主题是 neo** —— 锁住 `<html data-theme="neo">`、脚本里的 `||"neo"`、
  以及 `content="#F4EFE3"`
- 原来的「三套主题都在 CSS 里定义」不再断言 `data-theme="dark"`（深色变量留在
  `:root` 上，没有这一段选择器），改为断言 `:root{--bg:#070A0F`

## 四、静态预览生成器要跟着改

`design/preview/gen-market.mjs` 靠「把 html 上的 `data-theme` 替换成目标主题」来出三份图。
首屏脚本现在会**无条件**写一次 `data-theme`，而静态预览没有 localStorage，
留着它三份文件都会变成 neo。

生成器改成两步：替换属性 + 把那段首屏脚本整个摘掉（只摘定主题那段，
切换按钮的脚本不动，预览里仍然可以点）。这是预览脚本的事，不影响线上行为。
