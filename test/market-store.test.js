// 米表配置
//
// 重点不在"能不能存"，而在两件事：
// 1. 非法/超长输入会不会被原样带到公网页面上（所有字段都会公开）
// 2. 排序是不是稳定的 —— 首页列表每次刷新顺序都不一样会很难受

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_KEY,
  DEFAULT_MARKET,
  MAX_NAV,
  MAX_FRIENDS,
  normalizeNavItem,
  normalizeFriendItem,
  normalizeEntry,
  normalizeMarketConfig,
  loadMarketConfig,
  saveMarketConfig,
  sortEntries,
  formatPrice
} from '../src/managers/market-store.js';
import { fakeKV, readJSON } from './_fake-kv.js';

test('没有配置时返回未启用的默认值', async () => {
  const kv = fakeKV();
  const config = await loadMarketConfig(kv);

  assert.equal(config.enabled, false);
  assert.deepEqual(config.entries, []);
  assert.equal(config.title, DEFAULT_MARKET.title);
  assert.equal(config.currency, 'CNY');
});

test('KV 里是坏 JSON 时退回默认值而不是抛异常', async () => {
  const kv = fakeKV({ [MARKET_KEY]: '{ 不是 json' });
  const config = await loadMarketConfig(kv);

  assert.equal(config.enabled, false);
  assert.deepEqual(config.entries, []);
});

test('非法域名被丢弃，合法域名保留', () => {
  assert.equal(normalizeEntry({ name: '不是域名' }), null);
  assert.equal(normalizeEntry({ name: '' }), null);
  assert.equal(normalizeEntry({ name: 'a..b.com' }), null);
  assert.equal(normalizeEntry(null), null);

  const ok = normalizeEntry({ name: '  ABC.com  ', price: 100 });
  assert.equal(ok.name, 'abc.com', '域名应转小写并去空格');
});

test('面议条目不带价格 —— 免得改回一口价时冒出旧数字', () => {
  const entry = normalizeEntry({ name: 'a.com', priceType: 'inquire', price: 999 });
  assert.equal(entry.priceType, 'inquire');
  assert.equal(entry.price, 0);
});

test('未知价格类型按一口价处理', () => {
  const entry = normalizeEntry({ name: 'a.com', priceType: 'whatever', price: 50 });
  assert.equal(entry.priceType, 'fixed');
  assert.equal(entry.price, 50);
});

test('价格保留两位小数，负数归零，超大值封顶', () => {
  assert.equal(normalizeEntry({ name: 'a.com', price: '199.456' }).price, 199.46);
  assert.equal(normalizeEntry({ name: 'a.com', price: -5 }).price, 0);
  assert.equal(normalizeEntry({ name: 'a.com', price: 'abc' }).price, 0);
  assert.equal(normalizeEntry({ name: 'a.com', price: 1e12 }).price, 1e8);
});

test('文本字段按上限截断，控制字符被清掉', () => {
  const entry = normalizeEntry({
    name: 'a.com',
    description: 'x'.repeat(200),
    category: 'y'.repeat(50),
    note: 'z\u0000'.repeat(100)
  });

  assert.equal(entry.description.length, 60);
  assert.equal(entry.category.length, 12);
  assert.equal(entry.note.length, 80);
  assert.ok(!entry.note.includes('\u0000'), '控制字符应被替换');
});

test('同名域名只保留第一条', () => {
  const config = normalizeMarketConfig({
    entries: [
      { name: 'a.com', price: 100 },
      { name: 'A.com', price: 200 }
    ]
  });

  assert.equal(config.entries.length, 1);
  assert.equal(config.entries[0].price, 100, '应保留第一条而不是覆盖');
});

test('条目数超过上限时截断', () => {
  const entries = Array.from({ length: 260 }, (_, i) => ({ name: 'd' + i + '.com', price: i }));
  const config = normalizeMarketConfig({ entries });

  assert.equal(config.entries.length, 200);
});

test('enabled 只认布尔 true —— 字符串 "true" 不算开启', () => {
  assert.equal(normalizeMarketConfig({ enabled: 'true' }).enabled, false);
  assert.equal(normalizeMarketConfig({ enabled: 1 }).enabled, false);
  assert.equal(normalizeMarketConfig({ enabled: true }).enabled, true);
});

test('标题为空时用默认标题，避免公开页出现空 h1', () => {
  assert.equal(normalizeMarketConfig({ title: '   ' }).title, DEFAULT_MARKET.title);
  assert.equal(normalizeMarketConfig({ title: '我的米表' }).title, '我的米表');
});

test('联系方式缺失时是空字符串，不是 undefined', () => {
  const config = normalizeMarketConfig({});
  assert.deepEqual(config.contact, { wechat: '', email: '', telegram: '', community: '' });
});

test('微信和 Telegram 是两个独立字段，不会互相串值', () => {
  // v2.8.6 一度让 telegram 回退读 wechat（那时是把微信改名成 Telegram）。
  // 现在两者并存，再留着回退就会出现「填了微信号，Telegram 那栏也显示同一个值」
  const both = normalizeMarketConfig({ contact: { wechat: 'wx_id', telegram: '@tg_id' } });
  assert.equal(both.contact.wechat, 'wx_id');
  assert.equal(both.contact.telegram, '@tg_id');

  const onlyWx = normalizeMarketConfig({ contact: { wechat: 'wx_id' } });
  assert.equal(onlyWx.contact.telegram, '', '只有微信号时 Telegram 必须为空');
});

test('老配置的 url 读成 community（「联系链接」改名为「交流社区」）', () => {
  const config = normalizeMarketConfig({ contact: { url: 'https://t.me/somegroup' } });
  assert.equal(config.contact.community, 'https://t.me/somegroup');
});

test('交流社区只认 http(s)，其它一律丢掉', () => {
  // 这一栏会原样进 href，三种填法各有各的坏法：
  //   javascript: → 现成的 XSS
  //   @xxx        → 被浏览器当相对路径，跳到 /@xxx（404）
  //   /about      → 看着像站内路径，其实公开页没有这个路由
  const ok = v => normalizeMarketConfig({ contact: { community: v } }).contact.community;

  assert.equal(ok('https://example.com'), 'https://example.com');
  assert.equal(ok('http://example.com'), 'http://example.com');
  assert.equal(ok('javascript:alert(1)'), '');
  assert.equal(ok('@niepanxiaomibot'), '');
  assert.equal(ok('/about'), '');
  assert.equal(ok('data:text/html,<script>alert(1)</script>'), '');
});

test('排序：精品优先 → order → 域名长度 → 字母', () => {
  const entries = [
    { name: 'bbbb.com', featured: false, order: 0 },
    { name: 'aa.com', featured: false, order: 0 },
    { name: 'zz.com', featured: true, order: 5 },
    { name: 'cc.com', featured: false, order: -1 }
  ];

  assert.deepEqual(sortEntries(entries).map(e => e.name), [
    'zz.com',   // 精品，即使 order 更大也排第一
    'cc.com',   // order -1
    'aa.com',   // 长度相同，字母序
    'bbbb.com'  // 更长
  ]);
});

test('价格文案：一口价带千分位，面议与 0 都显示「价格面议」', () => {
  assert.equal(formatPrice({ priceType: 'fixed', price: 12800 }), '¥ 12,800');
  assert.equal(formatPrice({ priceType: 'fixed', price: 0 }), '价格面议');
  assert.equal(formatPrice({ priceType: 'inquire', price: 999 }), '价格面议');
  assert.equal(formatPrice(null), '价格面议');
});

test('保存后再读回：字段一致，且写进的是 config:market', async () => {
  const kv = fakeKV();
  const saved = await saveMarketConfig(kv, {
    enabled: true,
    title: '我的米表',
    intro: '欢迎询价',
    contact: { telegram: 'abc', email: 'a@b.com', url: 'https://example.com' },
    entries: [{ name: 'abc.com', price: 699, description: '三字母', category: '品牌', featured: true }]
  });

  assert.equal(saved.enabled, true);
  assert.equal(kv.store.has(MARKET_KEY), true);

  const stored = readJSON(kv, MARKET_KEY);
  assert.equal(stored.entries[0].name, 'abc.com');

  const loaded = await loadMarketConfig(kv);
  assert.deepEqual(loaded, saved);
});

test('保存时也做归一化 —— 前端传什么都不能绕过校验', async () => {
  const kv = fakeKV();
  const saved = await saveMarketConfig(kv, {
    enabled: true,
    entries: [{ name: 'bad name', price: 1 }, { name: 'ok.com', price: 1 }]
  });

  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].name, 'ok.com');
});

test('自定义导航：默认是空数组，不是 undefined', () => {
  const config = normalizeMarketConfig(null);
  assert.deepEqual(config.nav, []);
});

test('自定义导航：名称和链接都齐了才保留', () => {
  const config = normalizeMarketConfig({
    nav: [
      { label: '全部域名', url: '/market' },
      { label: '只有名称' },
      { url: 'https://example.com' },
      { label: '', url: '' }
    ]
  });
  assert.equal(config.nav.length, 1);
  assert.deepEqual(config.nav[0], { label: '全部域名', url: '/market' });
});

test('自定义导航：拦掉 javascript: 与 data: 这类伪协议', () => {
  // 这些会原样进 href，配置一旦从别处来就是现成的 XSS
  assert.equal(normalizeNavItem({ label: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeNavItem({ label: 'x', url: 'JavaScript:alert(1)' }), null);
  assert.equal(normalizeNavItem({ label: 'x', url: 'data:text/html,<script>1</script>' }), null);
  assert.equal(normalizeNavItem({ label: 'x', url: 'vbscript:msgbox(1)' }), null);
});

test('自定义导航：协议相对写法 //host 也要拦掉', () => {
  // 看着像站内路径，其实跳到别人的域名
  assert.equal(normalizeNavItem({ label: 'x', url: '//evil.example.com' }), null);
});

test('自定义导航：站内路径与 http(s) 外链都保留', () => {
  assert.deepEqual(normalizeNavItem({ label: '首页', url: '/' }), { label: '首页', url: '/' });
  assert.deepEqual(normalizeNavItem({ label: '关于', url: '/about' }), { label: '关于', url: '/about' });
  assert.deepEqual(
    normalizeNavItem({ label: '仓库', url: 'https://github.com/iougemini/DSMC' }),
    { label: '仓库', url: 'https://github.com/iougemini/DSMC' }
  );
});

test('自定义导航：名称超长截断到 12 字', () => {
  const item = normalizeNavItem({ label: '一二三四五六七八九十一二三四五', url: '/' });
  assert.equal(item.label.length, 12);
});

test('自定义导航：最多 MAX_NAV 项，多出来的丢掉', () => {
  const many = Array.from({ length: MAX_NAV + 4 }, (_, i) => ({ label: 'n' + i, url: '/p' + i }));
  const config = normalizeMarketConfig({ nav: many });
  assert.equal(config.nav.length, MAX_NAV);
  assert.equal(config.nav[0].label, 'n0');
});

test('自定义导航：不是数组时退回空数组，不抛异常', () => {
  assert.deepEqual(normalizeMarketConfig({ nav: 'oops' }).nav, []);
  assert.deepEqual(normalizeMarketConfig({ nav: { label: 'x', url: '/' } }).nav, []);
});

/* ---------------- 友情链接 ---------------- */

test('友情链接：默认是空数组，不是 undefined', () => {
  // 视图层直接 .map 它，undefined 会抛异常
  assert.deepEqual(normalizeMarketConfig(null).friends, []);
});

test('友情链接：与自定义导航是两个独立字段，互不串味', () => {
  // 混用一个字段的后果是「加一条友链，顶栏也多一项」
  const config = normalizeMarketConfig({
    nav: [{ label: '全部域名', url: '/market' }],
    friends: [{ label: '域名导航', url: 'https://dn.example.com' }]
  });
  assert.equal(config.nav.length, 1);
  assert.equal(config.friends.length, 1);
  assert.deepEqual(config.friends[0], { label: '域名导航', url: 'https://dn.example.com' });
});

test('友情链接：名称和链接都齐了才保留', () => {
  const config = normalizeMarketConfig({
    friends: [
      { label: '有', url: 'https://a.example.com' },
      { label: '只有名称' },
      { url: 'https://b.example.com' }
    ]
  });
  assert.equal(config.friends.length, 1);
});

test('友情链接：拦掉伪协议与协议相对写法', () => {
  // 这一排最终会原样进 href，和导航是同一条安全边界
  assert.equal(normalizeFriendItem({ label: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeFriendItem({ label: 'x', url: 'JavaScript:alert(1)' }), null);
  assert.equal(normalizeFriendItem({ label: 'x', url: 'data:text/html,<script>1</script>' }), null);
  assert.equal(normalizeFriendItem({ label: 'x', url: '//evil.example.com' }), null);
});

test('友情链接：名称上限比导航宽（20 字），对方站点名通常更长', () => {
  const item = normalizeFriendItem({ label: '一二三四五六七八九十一二三四五六七八九十多余', url: 'https://a.com' });
  assert.equal(item.label.length, 20);
  // 导航仍是 12，两者不能互相放宽
  assert.equal(normalizeNavItem({ label: '一二三四五六七八九十一二三四五六七八九十', url: '/' }).label.length, 12);
});

test('友情链接：最多 MAX_FRIENDS 项，多出来的丢掉', () => {
  const many = Array.from({ length: MAX_FRIENDS + 3 }, (_, i) => ({ label: 'f' + i, url: 'https://f' + i + '.example.com' }));
  const config = normalizeMarketConfig({ friends: many });
  assert.equal(config.friends.length, MAX_FRIENDS);
  assert.equal(config.friends[0].label, 'f0');
});

test('友情链接：不是数组时退回空数组，不抛异常', () => {
  assert.deepEqual(normalizeMarketConfig({ friends: 'oops' }).friends, []);
  assert.deepEqual(normalizeMarketConfig({ friends: { label: 'x', url: '/' } }).friends, []);
});

test('友情链接：随配置一起存进 KV 并读得回来', async () => {
  const kv = fakeKV();
  await saveMarketConfig(kv, { friends: [{ label: '友链', url: 'https://friend.example.com' }] });
  const loaded = await loadMarketConfig(kv);
  assert.equal(loaded.friends.length, 1);
  assert.equal(loaded.friends[0].label, '友链');
});
