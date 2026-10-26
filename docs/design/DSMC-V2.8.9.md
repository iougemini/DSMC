# DSMC v2.8.9 变更说明

> 起因：手动添加的域名，在域名列表点「刷新」不落库；点开详情点「刷新 WHOIS」
> 能拿到结果，但关掉再打开还是旧数据。只有「标记已续费」能改。
>
> 用户查了半天没查出原因 —— 因为**界面上每次都提示「已更新」**。

## 一、根因：冻结把「刷新」也拦住了

`autoUpdateWhois: false` 这个标记是 v2.5 加的：用户在编辑弹窗里手填过
注册商 / 注册日 / 到期日，就认为"这些值以我填的为准，别再自动覆盖"。

问题是判断写在了**所有**回写路径上：

```
回写入口
├── 页面渲染时的后台补全 (state.js: resolveCustom)   ← 自动，应该尊重冻结 ✓
├── Cron / 巡检                                     ← 自动，应该尊重冻结 ✓
├── 域名列表「刷新」  → handleRefreshAction          ← 用户点的，被一起拦了 ✗
└── 抽屉「刷新 WHOIS」→ handleWhoisRequest           ← 用户点的，被一起拦了 ✗
```

而"手动添加的域名"恰恰最容易走到冻结：添加时若查询失败（代理没配、第三方
抖动），前端会弹出补填表单，用户填完提交走的是 `update`，`touched` 为真 →
`autoUpdateWhois = false`。从此这个域名就再也刷不动了。

**怎么发现的**：`imgbed.top` 现在 WHOIS 是通的（`dataSource: whois-proxy`），
到期日 2027-11-11，可列表里一直不动。「标记已续费」能改，因为它走的是
`/api/custom-domains` 的 `update`，那条路不经过 `syncCustomDomainFromLookup`。

## 二、修法：显式刷新无视冻结

```js
syncCustomDomainFromLookup(domain, info, { explicit: true })
```

- `explicit: true` —— 用户自己点了按钮。冻结针对的是"自动更新"，不该拦住
  明确的手动要求，所以照写
- 省略 `explicit` —— 自动路径，冻结照旧生效

两个调用点（`handleRefreshAction` 的单域名分支、`handleWhoisRequest`）都传
`explicit: true`。

### 合并时的影子记录

`mergeCustomDomainRecord()` 对冻结记录会把 `dataSource` 强制写成 `manual`、
`lookupStatus` 写成 `manual`（它假设"这条是手填的"）。显式刷新时这个假设不成立：

```js
const source = explicit ? { ...existing, autoUpdateWhois: true } : existing;
const merged = mergeCustomDomainRecord(source, info);
```

传一个把标记置真的影子对象，让 merge 按"非手动"的规则取值，这样写回去的
`dataSource` 是 `whois-proxy`、`lookupStatus` 是 `ok`。**只影响这一次合并** ——
KV 里的 `autoUpdateWhois` 不动。

## 三、为什么不顺手解冻

刷一次就恢复自动更新，看起来更"省事"，但会踩另一个坑：用户手填日期的原因
往往是 WHOIS 给的值不可信（注册商占位、时区错位、代理返回旧快照）。一次刷新
把他保护的那个值覆盖掉还顺带解冻，下次后台补全再覆盖一遍 —— 用户丢的是他自己
纠正过的数据，而且没有任何提示。

所以：**刷一次只覆盖这一次**，自动更新保持关闭。但提示里要说清楚：

```
域名 imgbed.top 信息已更新（该域名设为手动维护，自动更新仍关闭）
```

## 四、提示不再说谎

以前：

```js
// handlers.js
return { success: true, message: `域名 ${domain} 信息已更新` };  // 写没写都这句
// client.js
toast('ok', data.message || ...);                                 // 一律绿条
```

现在接口返回三样东西，前端据此决定：

| 字段 | 含义 |
| --- | --- |
| `saved` | 这次有没有真的写进 KV |
| `problem` | 没写进库、且用户该知道（`no-live-data` / `missing` / `manual-frozen`） |
| `message` | 一句人话，直接显示 |

```
saved      → 域名 x 信息已更新                                    （绿）
not-custom → 域名 x 信息已更新                                    （绿）
             Cloudflare zone 与免费域名本来就没有"落库"这一步
no-live-data → 已查询 x，但没拿到可用的注册信息（检查 WHOIS 代理）  （黄）
missing      → 已查询 x，但没有到期信息，请在编辑里补填            （黄）
manual-frozen→ x 设为手动维护，查询结果未写入                      （黄）
```

`not-custom` 单独拎出来是因为：如果把它也报成失败，每个 Cloudflare 域名、
每个免费域名点刷新都会弹一条没意义的黄条，警告很快就没人看了。

抽屉里的「刷新 WHOIS」同理：结果末尾多一行 `savedNote`，不用关掉抽屉再打开
才知道有没有生效。

## 五、为什么单独拆一个模块

`src/services/custom-domain-sync.js`。

这套规则的失败是**静默的** —— 接口 200、前端绿条、KV 里那条记录一动不动。
放在 `handlers.js` 里没法单测（一 import 就拖进整条依赖链），所以拆出来，
只依赖 `appState` 和 `domain-merge`。

`test/custom-domain-sync.test.js` 11 项，钉住每个分支：

- 冻结的记录，`explicit` 刷新要写进去（就是这次报的 bug）
- 写完之后 `autoUpdateWhois` 仍是 `false`（不解冻）
- 写完之后 `dataSource` 是 `whois-proxy` 而不是 `manual`（影子记录生效）
- 自动路径（不带 `explicit`）仍然被冻结挡住
- 未冻结的记录，自动路径照常写
- 不是自定义域名 → `not-custom`，且**不算 problem**
- `registry` 兜底值与查询报错都不写（v2.3.1 的老坑）
- 五种 reason 的文案，以及 `SYNC_PROBLEMS` 只含三项

## 六、还留了一条日志

```js
logger.info('刷新未写回自定义域名', { domain, reason, dataSource });
```

这类问题在页面上只表现为「刷新了但没变」。没有日志的话，下次只能靠猜是
缓存、是冻结、还是第三方没返回。现在 Worker 日志里能直接看到 reason。
