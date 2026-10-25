# DSMC v2.8.6 变更说明

> 起因：米表页的版式又调了一轮，同时把「登录」的语义拆清楚了 —— 公开页只服务
> 买家，站主进后台的入口不该摆在公网上。另外概览页终于能看到米表里挂了什么，
> 不用为了核对报价再开一次公开页。
>
> 这一版动了数据结构（`contact` 字段改名），所以没沿用 2.8.5 的「只调版式」定位。

## 一、米表页：七处改动

### 1. 标题与介绍居右

```
改前                          改后
┌──────────────────────┐      ┌──────────────────────┐
│ [盾] DSMC  域名精选   │      │ [盾] DSMC      域名精选 │
│            介绍……     │      │                介绍…… │
└──────────────────────┘      └──────────────────────┘
      ↑ 文字贴着 LOGO               ↑ 两端分开，中间留白
```

原来是 `.mhtext{flex:1 1 260px}` 左对齐，文字紧贴 LOGO，右侧一整片空着，
视觉上一头沉。改成 `text-align:right` 后，LOGO 与文字块分据两端。

**窄屏要退回去**：`@media (max-width:560px)` 里 `.mhtext` 改成 `flex-basis:100%`
独占一行，这时如果还右对齐，标题会孤零零飘在右边、离 LOGO 很远。所以那里补了
`text-align:left`。

### 2. 联系方式：微信 → Telegram

字段从 `contact.wechat` 改成 `contact.telegram`，图标换成小飞机。

三种填法，三种渲染：

```
@dsmc_tg                             → [✈] @dsmc_tg        （链到 t.me/dsmc_tg）
https://img.example.com/tg-qr.png    → [✈] Telegram 扫码   （点开弹层）
我的电报                              → [✈] Telegram 我的电报（纯文本，不编链接）
```

**为什么认不出用户名就退化成纯文本**：`telegramHandle()` 只放行 `[A-Za-z0-9_]`
且长度 3–32。认不出时如果还硬拼一个 `https://t.me/我的电报`，点过去必然 404，
比不可点更糟。

**老配置兼容**：归一化里写的是 `str(contact.telegram || contact.wechat, 40)`。
升级后旧值自动读成新字段，用户不用回去重填；保存一次就会被写成 `telegram`。

### 3. 友情链接全部带图标

原来导航项是纯文字胶囊，一列排开像面包屑，分不出哪个是可点的外链。

```
[🔗 Blog] [🔗 Link] [🔗 Imgbd] [🐙 GitHub]
```

`navIcon(url, label)` 在 url 和 label 里找 `github`，命中用 GitHub 图标，
其余统一用链接图标。只做一个特判是因为导航里 GitHub 出现的频率远高于其它。

### 4. 「登录」→「查看域名详情」

```
改前：<a href="/admin">登录</a>          ← 公网上直接挂管理员入口
改后：<a href="/login">查看域名详情</a>   ← 普通用户登录页
```

管理员入口留在登录页里（那里本来就有）。公开页的定位是给买家看的，
不该出现「管理员登录」这种入口 —— 既是信息噪音，也等于把后台地址写在门口。

### 5. 卡片圆角 16px → 10px

`.mcard` 单独改成 10px，没动 `--radius`（`.mempty` 还在用 16px）。
圆角 16px 时卡片接近胶囊，域名本身反而不突出。

## 二、概览页：新增「精选域名」

米表里勾选展示的域名，全部在概览页列出来：域名（后缀弱化）/ 分类 / 卖点 /
报价 / 到期，精品排前面，右侧一个「查看米表 →」。

**数据从哪来**：`model.market`（米表配置的归一化结果）。到期日不在米表里存，
按域名名字从域名列表匹配 —— 米表只存报价，日期始终以域名数据为准。

**访客也给**：原来 `handleFrontend` 只给管理员传 `market`，这一版加上了。
米表内容本来就对所有人公开，不多给任何字段。所以访客概览页也能看到这块。

**条件渲染**：米表未启用、或条目为空时整块不出现。一块空的曝光位比没有更碍眼。

## 三、顶栏：查看米表

放在「添加域名」右边，`target="_blank"`。新开窗口是有意的 —— 点一下不该把
面板的筛选和滚动位置丢掉。

管理员和访客都有这个按钮：买家登录进来就是为了看报价。

## 四、踩到的坑

### 主题切换按钮压住标题

标题改右对齐后会一路顶到容器右边缘，而 `.themebtn` 是 `position:fixed;
top:16px;right:16px`。两者在视口宽度不到 1180px 时就重叠了。

算一下：`.wrap` 是 `max-width:1120px` + `padding:0 20px`，标题右边缘距视口右侧
`(W-1120)/2 + 20`；按钮左边缘距右侧 `16+34=50`。解 `(W-1120)/2 + 20 < 50` 得
`W < 1180`。

修复是给 `.mhtext` 加 `padding-right:44px`，所有宽度都避开。这个只有在
700px 的截图里才看得出来 —— 1400px 时两者隔得很远，看桌面截图完全正常。

**教训：右对齐的元素一定要检查它会不会撞上 fixed 定位的东西。**

### 测试断言写错了一次

`Telegram 填的是用户名时直接链到 t.me` 那条，我先写的是
`/Telegram <b>@dsmc_tg<\/b>/`，实际渲染是 `<b>@dsmc_tg</b>`（用户名模式不带
「Telegram」前缀，前缀只在二维码模式的「Telegram 扫码」里出现）。

断言失败时不要急着改代码 —— 先把渲染结果打印出来看一眼，这次是测试错了。

## 五、验证

```
▶ 单元测试 … 540/540 通过
▶ 端到端冒烟 … 32/32 项通过
▶ 安全审计 … 37/37 项通过
▶ esbuild 打包 … 通过
```

新增 `test/ui-overview.test.js`（12 项）：概览精选模块 8 项 + 顶栏入口 4 项。

版式靠截图确认：1400px（桌面）、700px（中等宽度，验证折行与按钮重叠）、
390px iframe（手机端，验证标题退回左对齐与精品区横滑）。

## 六、同版本内的修正

第一轮做完后用户报了三个问题，都在 2.8.6 内修掉，没有另起版本号。

### 1. LOGO 放大到与标题块同高

`30px` 图标 + `15px` 字 → `50px` 圆角方块 + `22px` 字，`border-radius` 10 → 15。
原来和右侧 26px 的标题摆在一起，像个小角标。

### 2. Telegram 认不出用户填的写法

用户填的是 `@//niepanxiaomibot/`（从地址栏粘下来的），期望指向
`https://t.me/niepanxiaomibot`。

原来的 `telegramHandle()` 其实能处理这一种（去掉 `@` 再过滤非字母数字），
但**另外两种写法是坏的**：

| 填的内容 | 修前 | 修后 |
|---|---|---|
| `@//niepanxiaomibot/` | `t.me/niepanxiaomibot` ✓ | 同左 |
| `t.me/niepanxiaomibot` | `t.me/tmeniepanxiaomibot` ❌ | `t.me/niepanxiaomibot` |
| `https://t.me/niepanxiaomibot` | 被当二维码图片 ❌ | `t.me/niepanxiaomibot` |

第二个是拼接问题（`t.me/` 前缀没剥掉，直接拼上去了）。第三个更隐蔽：
`isQrUrl()` 只看 `^https?://`，于是**联系人页被当成二维码图片**，渲染成一个
点开必然加载失败的「扫码」按钮。

修法：

```js
// isQrUrl：t.me 是联系人页，不是图片
if (/^https?:\/\/(www\.)?t\.me\//i.test(s)) return false;

// telegramHandle：先找 t.me/xxx，找不到再按用户名清洗
const linked = raw.match(/t\.me\/([A-Za-z0-9_]+)/i);
```

**顺带改了显示**：公开页显示规范化后的 `@name`，不再回显用户输入的原文。
原文可能是 `@//xxx/`，摆在公开页上很难看。

### 3. 联系链接没有校验（安全）

`contact.url` 原样进 `href`，此前一个字符都没校验。三种坏法：

```
javascript:alert(1)          → XSS
@niepanxiaomibot             → 浏览器当相对路径，跳到 /@niepanxiaomibot（404）
/about                       → 看着像站内路径，公开页其实没有这个路由
```

用户遇到的「链接指向 workers.dev/@niepanxiaomibot」就是第二种 —— 他把
Telegram 用户名填进了「联系链接」那一栏。

修法：归一化时只放行 `^https?://`，其余置空。校验放在 `normalizeMarketConfig`
里，所有写入路径（后台保存、API 写入、导入）自动覆盖。

> 这条是安全审计没抓到的：`security-audit.mjs` 的注入用例只打了米表的
> `title` / `description` / `nav`，没打 `contact.url`。补测试时一并加上了
> `javascript:` / `data:` / `@xxx` / `/about` 四个用例。

### 4. 背景铺到整个项目

米表的背景（柔光 + 72px 网格 + 中段渐隐）搬到 `styles.js`，面板也用上。

**不能直接把两段 background 合进一个伪元素**：`mask` 作用于整个元素，
合在一起会把右上角那团柔光一起裁掉。所以拆成：

```css
body::before{background:var(--glow)}          /* 柔光，不遮 */
body::after {background:网格两层; mask-image:...}  /* 网格，顶部椭圆遮罩 */
```

`.app` 本来就有 `position:relative;z-index:1`，内容自然压在伪元素之上，不用改。

> 截图时踩了个坑：后台主题是**跟随系统**的（`client.js` 里有 `matchMedia` 分支），
> headless Chrome 默认 `prefers-color-scheme: light`，所以截出来一直是浅色。
> `--blink-settings=preferredColorScheme=0` 不生效（截出来的文件字节数完全一样），
> 最后靠在 `<head>` 最前面注入 `localStorage.setItem('dsmc-theme','dark')` 才截到深色。

### 验证（修正后）

```
▶ 单元测试 … 543/543 通过
▶ 端到端冒烟 … 32/32 项通过
▶ 安全审计 … 37/37 项通过
▶ esbuild 打包 … 通过
```

单测 540 → 543：新增「Telegram 各种写法」「t.me 不当二维码」「联系链接只认 http(s)」。

冒烟挂过一次：假数据里还是 `wechat: 'demo-wx'`，`demo-wx` 的连字符被规范化掉，
断言 `/demo-wx/` 匹配不上。改成 `telegram: 'demo_tg'` + 断言 `/@demo_tg/`。

## 七、联系方式重排为四项固定

第二轮反馈：`v2.8.6` 把微信换成 Telegram 之后，微信联系方式整个消失了。用户要的是
**两者并存**，而且联系方式区要有固定结构。

### 结构

```
[微信] [邮箱] [Telegram] [交流社区] │ [链接1] … [链接6]      [查看域名详情]
└──────── 四项固定，顺序写死 ────────┘ └─ 自定义，最多 6 项 ─┘  └─ 压尾 ─┘
```

顺序写死而不是「哪个有值就往前排」：位置固定，买家扫一眼就知道去哪找。

### 图标

四项各自一个，不是统一的气泡：

| 项 | 图标 | 说明 |
|---|---|---|
| 微信 | `wechat` | 两个叠在一起的气泡，比通用 `chat` 好认 |
| 邮箱 | `mail` | 信封 |
| Telegram | `telegram` | 纸飞机，比 `send` 多一条内折线 |
| 交流社区 | `community` | 两个人，区别于"一对一聊天" |

### 字段

```
contact: { wechat, email, telegram, community }
```

- `wechat` —— 微信号，或二维码图片地址
- `telegram` —— `@用户名` / `t.me/链接` / 二维码图片地址，三种都由渲染层认
- `community` —— 交流社区链接，只认 `http(s)://`（老字段 `url` 兼容读一次）

### 一个必须去掉的回退

`v2.8.6` 中途（把微信改名成 Telegram 那一步）写过：

```js
telegram: str(contact.telegram || contact.wechat, 40)   // ← 现在必须删掉
```

两者并存之后再留着这个回退，填过的微信号会**同时出现在微信和 Telegram 两栏**。
所以这一版把它删了，并加了测试盯着：

```js
const onlyWx = normalizeMarketConfig({ contact: { wechat: 'wx_id' } });
assert.equal(onlyWx.contact.telegram, '', '只有微信号时 Telegram 必须为空');
```

代价是老配置里 `wechat` 有值、`telegram` 空的人，需要去后台补一次 Telegram。
CHANGELOG 的「兼容」小节里写明了。

### 渲染层的第二次校验

`community` 在归一化里已经过滤过 `javascript:` / `@xxx` / `/路径`，渲染层又判了一次：

```js
if (c.community && /^https?:\/\//i.test(String(c.community))) { ... }
```

因为渲染层也可能被直接调用（测试、预览脚本传的是原始 config，不走归一化）。
纵深防御比"相信上游"便宜 —— 这层判断成本是一次正则。

### 验证

```
▶ 单元测试 … 545/545 通过
▶ 端到端冒烟 … 32/32 项通过
▶ 安全审计 … 37/37 项通过
▶ esbuild 打包 … 通过
```

新增/改写的测试：

- 「四项固定联系方式按需渲染，没配就不出 chip」—— 四项逐个断言存在与缺失
- 「四项的顺序固定」—— 用 `indexOf` 比位置，微信 < 邮箱 < Telegram < 社区 < 链接 < 查看详情
- 「四项各自带自己的图标」—— 用微信双气泡和社区双人剪影的路径特征区分，防止哪天
  被统一成一个图标
- 「微信和 Telegram 是两个独立字段，不会互相串值」
- 「老配置的 url 读成 community」

后台表单的四个 input id（`mkWechat` / `mkEmail` / `mkTelegram` / `mkCommunity`）
和 `client.js` 里 `saveMarket` 取值用的 id 必须一一对应 —— 对不上不会报错，
只是"填了但存不进去"。测试里用循环逐个断言。
