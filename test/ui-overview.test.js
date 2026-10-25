// 概览页的「精选域名」模块 + 顶栏的「查看米表」入口。
//
// 这两处都容易出「看起来有、其实没数据」的错：模块读的是米表配置，
// 入口是纯静态链接。所以断言要落在"内容真的渲染出来了"上，而不是
// "标题字面出现过"。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomains, buildStats } from '../src/ui/data.js';
import { overviewView } from '../src/ui/views.js';
import { renderPage } from '../src/ui/shell.js';

const PROJECT = {
  NAME: 'DSMC',
  FULL_NAME: 'Domain Status Manager for Cloudflare',
  DESCRIPTION: '域名状态管理',
  GITHUB: '',
  COMMUNITY: '',
  LICENSE: 'MIT'
};

function domainsOf() {
  return normalizeDomains([
    { name: 'abc.com', registrationDate: '2021-03-04', expirationDate: '2028-03-04' },
    { name: 'xyz.net', registrationDate: '2022-01-01', expirationDate: '2027-01-01' }
  ]);
}

function makeModel(market, isAdmin = true) {
  const domains = domainsOf();
  return { domains, stats: buildStats(domains), isAdmin, market };
}

const MARKET = {
  enabled: true,
  entries: [
    { name: 'abc.com', priceType: 'fixed', price: 699, category: '品牌', description: '三字母', featured: false, order: 0 },
    { name: 'xyz.net', priceType: 'inquire', price: 0, category: '工具', description: '好记又短', featured: true, order: 0 }
  ]
};

describe('overviewView 精选域名', () => {
  it('米表启用了就列出勾选的域名，精品排在前面', () => {
    const html = overviewView(makeModel(MARKET));

    assert.ok(html.includes('精选域名'));
    assert.ok(html.includes('abc') && html.includes('xyz'));
    assert.ok(html.indexOf('xyz') < html.indexOf('abc'), '精品应排在普通条目之前');
  });

  it('报价与卖点都在，面议不会显示成 ¥ 0', () => {
    const html = overviewView(makeModel(MARKET));

    assert.ok(html.includes('¥ 699'));
    assert.ok(html.includes('价格面议'));
    assert.ok(!html.includes('¥ 0'), '面议不该渲染成 ¥ 0');
    assert.ok(html.includes('三字母'));
    assert.ok(html.includes('好记又短'));
  });

  it('到期日从域名列表里取，不是米表自己存一份', () => {
    const html = overviewView(makeModel(MARKET));
    assert.ok(html.includes('2028-03-04'));
  });

  it('模块里带一个去公开米表的入口', () => {
    const html = overviewView(makeModel(MARKET));
    assert.ok(html.includes('href="/market"'));
  });

  it('米表没启用时整块不出现', () => {
    const html = overviewView(makeModel({ enabled: false, entries: MARKET.entries }));
    assert.ok(!html.includes('精选域名'));
  });

  it('条目为空时不渲染一个空模块', () => {
    const html = overviewView(makeModel({ enabled: true, entries: [] }));
    assert.ok(!html.includes('精选域名'));
  });

  it('没有 market 数据时也不崩（访客与未配置两种情况都会走到）', () => {
    const html = overviewView(makeModel(null));
    assert.ok(!html.includes('精选域名'));
    assert.ok(html.includes('需要关注'), '其余模块应照常渲染');
  });

  it('访客也能看到精选域名 —— 米表本来就对所有人公开', () => {
    const html = overviewView(makeModel(MARKET, false));
    assert.ok(html.includes('精选域名'));
  });
});

describe('顶栏的米表入口', () => {
  const page = isAdmin => renderPage({
    ...makeModel(MARKET, isAdmin),
    version: '2.8.5',
    project: PROJECT,
    freeDomains: [],
    accounts: [],
    accountSource: 'none',
    dnsheCredentials: [],
    dnsheEnv: { hasKey: false, hasSecret: false },
    settings: {},
    notify: { enabled: false, rules: {}, channels: [] },
    notifyState: null,
    notifyTypes: [],
    authEnabled: true
  });

  it('管理员看得到「查看米表」，且指向 /market', () => {
    const html = page(true);
    assert.ok(html.includes('查看米表'));
    assert.ok(html.includes('href="/market"'));
  });

  it('访客也看得到 —— 买家登录进来就是为了看报价', () => {
    const html = page(false);
    assert.ok(html.includes('查看米表'));
  });

  it('入口在「添加域名」之后，不是挤在搜索那一堆图标里', () => {
    const html = page(true);
    assert.ok(html.indexOf('添加域名') < html.indexOf('查看米表'));
  });

  it('新开窗口：点一下不该把面板丢掉', () => {
    const html = page(true);
    const i = html.indexOf('查看米表');
    const tag = html.slice(html.lastIndexOf('<a', i), i);
    assert.ok(tag.includes('target="_blank"'), '缺少 target=_blank：' + tag);
  });
});
