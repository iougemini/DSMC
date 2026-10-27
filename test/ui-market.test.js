// 米表公开页
//
// 这是整个项目里唯一一张**不需要任何凭证**就能打开的页面，所以测试的重点
// 不是"好不好看"，而是：
// 1. 转义有没有漏 —— 卖点、备注都是管理员手输的，会被原样放进 HTML
// 2. 会不会带出内部字段 —— 日期之外的东西都不该出现

import test from 'node:test';
import assert from 'node:assert/strict';
import { marketHtml, marketEmptyHtml, splitDomain, isQrUrl, MARKET_CSS, toneOf } from '../src/ui/market.js';
import { icon } from '../src/ui/icons.js';

const PROJECT = {
  NAME: 'DSMC',
  FULL_NAME: 'Domain Status Manager for Cloudflare',
  DESCRIPTION: '域名状态管理',
  GITHUB: 'https://github.com/iougemini/DSMC',
  COMMUNITY: 'https://niege.app',
  LICENSE: 'MIT'
};

const CONFIG = {
  enabled: true,
  title: '域名精选',
  intro: '欢迎询价',
  currency: 'CNY',
  contact: {
    wechat: 'wx_demo',
    email: 'a@b.com',
    telegram: 'tg_demo',
    community: 'https://example.com/community'
  },
  entries: []
};

function render(items, config = CONFIG) {
  return marketHtml({ project: PROJECT, version: '2.8.0', config, items });
}

/**
 * 取「联系方式」整块：胶囊列表 + 压在最后的登录按钮。
 * 登录按钮是胶囊列表的兄弟节点（分开才能保证换行时不被挤走），
 * 所以不能按第一个 </div> 切 —— 那样正好把它切在外面。
 */
function contactsBlock(html) {
  const start = html.indexOf('class="contacts"');
  const login = html.indexOf('class="contact login"');
  return html.slice(start, html.indexOf('</a>', login) + 4);
}

const ITEM = {
  name: 'abc.com',
  priceType: 'fixed',
  price: 699,
  description: '三字母，好记',
  category: '品牌',
  note: '含一年续费',
  featured: true,
  registrationDate: '2021-03-04',
  expirationDate: '2028-03-04'
};

test('域名拆成关键词与后缀，多级后缀整体弱化', () => {
  assert.deepEqual(splitDomain('abc.com'), { keyword: 'abc', suffix: '.com' });
  assert.deepEqual(splitDomain('abc.com.cn'), { keyword: 'abc', suffix: '.com.cn' });
  assert.deepEqual(splitDomain('nodot'), { keyword: 'nodot', suffix: '' });
});

test('卡片展示域名、注册日、到期日与价格', () => {
  const html = render([ITEM]);

  assert.match(html, /abc/);
  assert.match(html, /\.com/);
  assert.match(html, /2021-03-04/);
  assert.match(html, /2028-03-04/);
  assert.match(html, /¥ 699|699/);
  assert.match(html, /三字母，好记/);
  assert.match(html, /精品/);
});

test('面议条目显示「价格面议」而不是 ¥ 0', () => {
  const html = render([{ ...ITEM, priceType: 'inquire', price: 0 }]);

  assert.match(html, /价格面议/);
  assert.ok(!html.includes('¥ 0'), '面议条目不该出现 ¥ 0');
});

test('日期查不到时显示 —，而不是 Unknown 或 Error', () => {
  const html = render([{ ...ITEM, registrationDate: 'Unknown', expirationDate: 'Error' }]);

  assert.match(html, /—/);
  assert.ok(!html.includes('Unknown'), '页面不该出现 Unknown');
  assert.ok(!html.includes('>Error<'), '页面不该出现 Error');
});

test('卖点与备注里的 HTML 会被转义', () => {
  const html = render([{
    ...ITEM,
    description: '<script>alert(1)</script>',
    note: '"><img src=x onerror=alert(2)>',
    category: '<b>x</b>'
  }]);

  assert.ok(!html.includes('<script>alert(1)</script>'), '卖点未转义');
  assert.ok(!html.includes('<img src=x'), '备注未转义');
  assert.ok(!html.includes('<b>x</b>'), '分类未转义');
  assert.match(html, /&lt;script&gt;/);
});

test('标题与介绍同样转义', () => {
  const html = render([ITEM], { ...CONFIG, title: '<svg onload=1>', intro: '<iframe>' });

  assert.ok(!html.includes('<svg onload=1>'));
  assert.ok(!html.includes('<iframe>'));
});

test('只渲染白名单字段 —— 多传的 registrar / account 不会出现在页面上', () => {
  const html = render([{
    ...ITEM,
    registrar: 'Cloudflare, Inc.',
    account: '主账户',
    notes: '内部备注：这个域名别卖',
    whoisError: 'boom'
  }]);

  for (const leak of ['Cloudflare, Inc.', '主账户', '内部备注', 'boom']) {
    assert.ok(!html.includes(leak), '页面出现了非白名单字段：' + leak);
  }
});

test('四项固定联系方式按需渲染，没配就不出 chip —— 但查看详情的入口始终在', () => {
  const withContact = render([ITEM]);
  assert.match(withContact, /微信 <b>wx_demo<\/b>/, '缺少微信');
  assert.match(withContact, /mailto:a@b\.com/, '缺少邮箱');
  assert.match(withContact, /@tg_demo/, '缺少 Telegram');
  assert.match(withContact, /交流社区/, '缺少交流社区');

  const noContact = render([ITEM], {
    ...CONFIG,
    contact: { wechat: '', email: '', telegram: '', community: '' }
  });
  assert.ok(!noContact.includes('mailto:'), '没配邮箱不该渲染邮箱 chip');
  assert.ok(!noContact.includes('wx_demo'), '没配微信不该渲染微信 chip');
  assert.ok(!noContact.includes('tg_demo'), '没配 Telegram 不该渲染 Telegram chip');
  assert.ok(!noContact.includes('交流社区'), '没配社区不该渲染社区 chip');
  // 买家要能登录看详情，联系方式全空时这个入口也得在
  assert.match(noContact, /href="\/login"/);
});

test('四项的顺序固定：微信 → 邮箱 → Telegram → 交流社区，链接在后，查看详情压尾', () => {
  // 顺序写死而不是"哪个有值就往前排"：位置固定，买家扫一眼就知道去哪找
  const html = render([ITEM], {
    ...CONFIG,
    nav: [{ label: '全部域名', url: '/market' }]
  });
  const bar = contactsBlock(html);

  const at = s => bar.indexOf(s);
  assert.ok(at('微信') < at('mailto:'), '微信应在邮箱之前');
  assert.ok(at('mailto:') < at('t.me/'), '邮箱应在 Telegram 之前');
  assert.ok(at('t.me/') < at('交流社区'), 'Telegram 应在交流社区之前');
  assert.ok(at('交流社区') < at('全部域名'), '交流社区应在自定义链接之前');
  assert.ok(at('全部域名') < at('/login'), '查看详情应压在最后');
});

test('四项各自带自己的图标，不是统一一个', () => {
  const html = render([ITEM]);
  const bar = contactsBlock(html);

  // 每项的图标路径各不相同 —— 用微信的圆气泡 + 双眼和社区的双人剪影做特征
  assert.match(bar, /M20\.2 11\.2c0-4\.1-3\.7-7\.4-8\.2-7\.4/, '微信图标不对');
  assert.match(bar, /<circle cx="9\.4" cy="10\.6" r="1\.15" fill="currentColor"/, '微信图标缺眼睛');
  assert.match(bar, /<circle cx="9" cy="8" r="3\.2"\/>/, '社区图标不对');
});

test('微信图标是一条闭合路径，不能留下没接上的缺口', () => {
  // 旧版画了两个气泡，左边那个停在 (10.3,14.2) 没闭合，
  // 14px 下就是一个被切掉一半的缺口，放大截图一眼能看出来
  const svg = icon('wechat', 14);
  const path = svg.match(/<path d="([^"]+)"/)[1];

  assert.ok(path.endsWith('z'), '气泡路径必须以 z 闭合');
  assert.equal((path.match(/M/g) || []).length, 1, '一个气泡只该有一个起笔');
  assert.equal((svg.match(/<circle/g) || []).length, 2, '两只眼睛');
});

test('Telegram 填的是图片地址时渲染成二维码按钮，不是一串 URL', () => {
  const qr = 'https://img.example.com/tg-qr.png';
  const html = render([ITEM], { ...CONFIG, contact: { telegram: qr, email: '', wechat: '', community: '' } });

  assert.match(html, /data-qr="https:\/\/img\.example\.com\/tg-qr\.png"/, '应把地址放进 data-qr');
  assert.match(html, /Telegram <b>扫码<\/b>/, '二维码模式显示「扫码」');
  assert.ok(!html.includes('>' + qr + '<'), '不该把裸 URL 当文字显示出来');
  assert.match(html, /id="qrbox"/, '页面要有二维码弹层容器');
  assert.match(html, /id="qrimg"/);
});

test('Telegram 填的是用户名时直接链到 t.me，显示规范化后的 @用户名', () => {
  const html = render([ITEM], { ...CONFIG, contact: { telegram: '@dsmc_tg', email: '', wechat: '', community: '' } });

  assert.match(html, /href="https:\/\/t\.me\/dsmc_tg"/, '认得出用户名就该链到 t.me');
  assert.match(html, /<b>@dsmc_tg<\/b>/, '应显示 @用户名');
  assert.ok(!html.includes('data-qr="'), '用户名不该出现二维码按钮');
});

test('Telegram 填的不是用户名时退化成纯文本，不硬编链接', () => {
  // 中文名、带空格的邀请文案都算"认不出"，这时候编一个 t.me 地址只会 404
  const html = render([ITEM], { ...CONFIG, contact: { telegram: '我的电报', email: '', wechat: '', community: '' } });

  assert.match(html, /我的电报/);
  assert.ok(!html.includes('t.me'), '认不出用户名就不该编一个链接出来');
});

test('Telegram 的各种写法都认成同一个用户名，且不会被当成二维码', () => {
  // 用户实际填过 @//niepanxiaomibot/（从地址栏粘下来的），也填过完整链接。
  // 这几种都该指向同一个 t.me 地址 —— 尤其完整链接不能被 isQrUrl 当图片
  const cases = [
    '@dsmc_tg',
    '@//dsmc_tg/',
    't.me/dsmc_tg',
    'https://t.me/dsmc_tg',
    'https://www.t.me/dsmc_tg'
  ];

  for (const tg of cases) {
    const html = render([ITEM], { ...CONFIG, contact: { telegram: tg, email: '', wechat: '', community: '' } });
    assert.match(html, /href="https:\/\/t\.me\/dsmc_tg"/, '没认出用户名：' + tg);
    assert.ok(!html.includes('data-qr="'), '被当成二维码图片了：' + tg);
  }
});

test('t.me 链接不当作二维码，普通图片地址仍然当二维码', () => {
  // 两者都是 https:// 开头，区别只在"是不是 t.me 的联系人页"
  assert.equal(isQrUrl('https://t.me/dsmc_tg'), false);
  assert.equal(isQrUrl('https://www.t.me/dsmc_tg'), false);
  assert.equal(isQrUrl('https://img.example.com/qr.png'), true);
  assert.equal(isQrUrl('dsmc_tg'), false);
});

test('查看域名详情指向 /login，且在联系方式行的最后', () => {
  const html = render([ITEM]);
  const row = contactsBlock(html);

  assert.match(row, /href="\/login"/);
  // 公开页只服务买家。管理员入口在登录页里，不该直接挂在公网上
  assert.ok(!row.includes('href="/admin"'), '公开页不该直接挂管理员登录');
  assert.ok(row.lastIndexOf('/login') > row.lastIndexOf('mailto:'), '入口应排在联系方式之后');
});

test('精品域名单独成区，全部域名另起一区', () => {
  const items = [
    { ...ITEM, name: 'star.com', featured: true },
    { ...ITEM, name: 'plain.com', featured: false }
  ];
  const html = render(items);

  const featuredAt = html.indexOf('<div class="mgrid" data-block="featured"');
  const allAt = html.indexOf('<div class="mgrid" data-block="all"');
  assert.ok(featuredAt > 0, '精品区应存在');
  assert.ok(allAt > featuredAt, '精品区要在全部区之前');

  const featuredSection = html.slice(html.lastIndexOf('<section', featuredAt), allAt);
  assert.match(featuredSection, /精品域名/);
  assert.match(featuredSection, /star<span>/);
  assert.ok(!featuredSection.includes('plain<span>'), '非精品不该出现在精品区');

  // 标题在 data-block 之前，切片要从它所属的 <section> 起，否则漏掉标题
  const allSection = html.slice(html.lastIndexOf('<section', allAt));
  assert.match(allSection, /全部域名/);
  assert.match(allSection, /star<span>/, '精品也要出现在全部区，买家要能在一处看全');
  assert.match(allSection, /plain<span>/);
});

test('没有精品时不出精品区，全部区标题退回「在售域名」', () => {
  const html = render([{ ...ITEM, featured: false }]);

  assert.ok(!html.includes('<div class="mgrid" data-block="featured"'), '没有精品不该渲染空区块');
  assert.ok(!html.includes('精品域名'));
  assert.match(html, /在售域名/);
});

test('页面带主题切换按钮，三套主题都在 CSS 里定义', () => {
  const html = render([ITEM]);

  assert.match(html, /id="themebtn"/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /data-theme="light"/, '浅色主题的变量要预先定义好');
  assert.match(html, /\[data-theme="neo"\]\{--bg:/, 'neo 主题要有自己的一套变量');
});

test('主题按钮按 深色 → 浅色 → 米表 三态循环', () => {
  const html = render([ITEM]);

  assert.match(html, /var order=\["dark","light","neo"\]/);
  assert.match(html, /order\[\(i\+1\)%order\.length\]/, '点到最后一套要回到第一套，不能卡在 neo');
});

test('米表用自己的主题存储键，不把 neo 写进面板共用的 dsmc-theme', () => {
  const html = render([ITEM]);

  // 面板只有深/浅两套 CSS，把 neo 写进共用键会让后台拿到一个没有变量的主题
  assert.match(html, /localStorage\.setItem\("dsmc-market-theme"/);
  assert.ok(!/setItem\("dsmc-theme"/.test(html), '写入必须落在米表自己的键上');
  // 但没设置过时要回落到共用键，老用户升级上来看到的样子不变
  assert.match(html, /getItem\("dsmc-market-theme"\)\|\|localStorage\.getItem\("dsmc-theme"\)/);
});

test('「查看域名详情」和联系方式分两组，按钮不会被胶囊挤到下一行', () => {
  const html = render([ITEM]);

  assert.match(html, /<div class="contacts"><div class="contact-list">/);
  // 登录按钮是 contact-list 的兄弟节点，不在胶囊列表里面
  const listEnd = html.indexOf('</div><a class="contact login"');
  assert.ok(listEnd > 0, '登录按钮要落在胶囊容器外面，否则换行时会跟着一起被挤');
});

test('neo 主题靠逐条覆盖做出描边和硬投影，不是只换变量', () => {
  assert.match(MARKET_CSS, /\[data-theme="neo"\] \.mcard\{border:2px solid var\(--edge\)/);
  assert.match(MARKET_CSS, /box-shadow:4px 4px 0 var\(--edge\)/, '硬投影是这套主题的骨架，掉了就变成普通浅色');
  assert.match(MARKET_CSS, /--hl:#F7E85B/, '荧光笔色要单独定义，价格和精品标签都靠它');
});

test('neo 的色板落在变量里，色块本身仍是奶油底', () => {
  // 卡片底色不能跟着分类变，否则一屏十几张就是调色盘
  assert.match(MARKET_CSS, /\[data-theme="neo"\]\{[^}]*--lime:#C8F169/);
  assert.match(MARKET_CSS, /--panel:#EDE6FF/);
  assert.ok(!/\[data-theme="neo"\] \.mcard\[data-tone/.test(MARKET_CSS), '卡片本身不按分类上色');
});

test('分类色号按分类名算，同分类全页同色且可复现', () => {
  assert.equal(toneOf('品牌'), toneOf('品牌'), '同一个分类必须算出同一个色号');
  for (const name of ['品牌', '生活', '工具', '数字', '', 'a'.repeat(40), '🎯']) {
    const t = toneOf(name);
    assert.ok(Number.isInteger(t) && t >= 0 && t < 5, '色号要落在 0..4');
  }
  // 至少有几个常见分类落在不同色号上，否则"多彩"是假的
  const used = new Set(['品牌', '生活', '工具', '数字'].map(toneOf));
  assert.ok(used.size >= 3, '四个常见分类应分散到至少三种颜色');
});

test('分类标签带 data-tone，四个固定联系方式带 data-kind', () => {
  const html = render([ITEM, { ...ITEM, name: 'xyz.net', category: '工具', featured: false }], {
    ...CONFIG,
    nav: [{ label: 'Blog', url: 'https://example.com/blog' }]
  });

  assert.match(html, /<span class="cat" data-tone="\d">品牌<\/span>/);
  assert.match(html, /data-kind="wechat"/);
  assert.match(html, /data-kind="mail"/);
  assert.match(html, /data-kind="telegram"/);
  assert.match(html, /data-kind="community"/);
  assert.match(html, /data-kind="nav"/);

  // 没有分类的域名不该硬塞一个空标签
  const noCat = render([{ ...ITEM, category: '' }]);
  assert.ok(!noCat.includes('class="cat"'), '没有分类不该渲染分类标签');
});

test('精品区整块标了 mblock-featured，neo 才能给它铺色', () => {
  const html = render([ITEM, { ...ITEM, name: 'plain.com', featured: false }]);

  assert.match(html, /<section class="mblock mblock-featured">/);
  assert.match(MARKET_CSS, /\[data-theme="neo"\] \.mblock-featured\{background:var\(--panel\)/);
});

test('分类多于一个时出现筛选条，只有一个时不出现', () => {
  const two = render([ITEM, { ...ITEM, name: 'xyz.net', category: '工具' }]);
  assert.match(two, /class="mfilters"/);
  assert.match(two, /data-cat="工具"/);

  const one = render([ITEM]);
  assert.ok(!one.includes('class="mfilters"'), '单一分类不该出筛选条');
});

test('未启用时是落地页，不是白屏也不是空白卡片区', () => {
  const html = marketEmptyHtml({ project: PROJECT, version: '2.8.0', reason: '本站暂未开放域名出售' });

  assert.match(html, /本站暂未开放域名出售/);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /DSMC/);
  assert.ok(!html.includes('class="mcard"'), '落地页不该有域名卡片');
});

test('页面自带页脚与 favicon，且不引用任何外部资源', () => {
  const html = render([ITEM]);

  assert.match(html, /site-foot/);
  assert.match(html, /rel="icon"/);
  assert.ok(!/https?:\/\/(?!github\.com|niege\.app|example\.com)[^"']+\.(css|js)/.test(html),
    '页面不该加载外部 CSS/JS');
});

test('二维码地址识别：只认 http/https，别的都当微信号', () => {
  assert.equal(isQrUrl('https://a.com/q.png'), true);
  assert.equal(isQrUrl('HTTP://A.COM/Q.PNG'), true, '协议大小写不该影响判断');
  assert.equal(isQrUrl('  https://a.com/q.png  '), true, '前后空格要能容忍');
  assert.equal(isQrUrl('dsmc_wx'), false);
  assert.equal(isQrUrl('wxid_abc123'), false);
  assert.equal(isQrUrl('ftp://a.com/q.png'), false, '非 http 协议当微信号处理');
  assert.equal(isQrUrl(''), false);
  assert.equal(isQrUrl(null), false);
});

test('内联脚本语法正确 —— 引号写错页面照样 200，但交互全废', () => {
  const html = render([ITEM]);
  const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(m => m[1]);

  assert.ok(scripts.length >= 2, '主题初始化和交互脚本都应该在');
  for (const code of scripts) {
    assert.doesNotThrow(() => new Function(code), '内联脚本存在语法错误');
  }
});

test('样式表大括号配平', () => {
  const open = (MARKET_CSS.match(/\{/g) || []).length;
  const close = (MARKET_CSS.match(/\}/g) || []).length;
  assert.equal(open, close, `大括号不配平：{ ${open} 个，} ${close} 个`);
});

test('头部：左边品牌，右边标题与介绍成组', () => {
  const html = render([ITEM]);
  const row = html.slice(html.indexOf('class="mhrow"'), html.indexOf('class="contacts"'));

  assert.match(row, /class="mbrand"/);
  assert.match(row, /class="mhtext"/, '标题和介绍要包在一起，才好在右侧上下排列');
  assert.ok(row.indexOf('mbrand') < row.indexOf('mhtext'), '品牌在左，文字在右');
  assert.match(row, /<h1>域名精选<\/h1>/);
  assert.match(row, /class="intro"/);
});

test('自定义导航渲染在联系方式之后、查看详情之前，且每项都带图标', () => {
  const html = render([ITEM], {
    ...CONFIG,
    nav: [{ label: '全部域名', url: '/market' }, { label: '关于本站', url: '/about' }]
  });
  const bar = contactsBlock(html);

  assert.match(bar, /全部域名/);
  assert.match(bar, /关于本站/);
  assert.ok(bar.indexOf('mailto:') < bar.indexOf('全部域名'), '导航排在联系方式后面');
  assert.ok(bar.indexOf('全部域名') < bar.lastIndexOf('/login'), '查看详情仍然压在最后');

  // 一列纯文字胶囊看着像面包屑，分不出哪个是可点的外链 —— 每项都要有图标
  const navLinks = bar.match(/<a class="contact nav"[^>]*>[\s\S]*?<\/a>/g) || [];
  assert.equal(navLinks.length, 2, '应渲染两个导航项');
  for (const a of navLinks) {
    assert.match(a, /<svg/, '导航项缺图标：' + a);
  }
});

test('GitHub 链接用 GitHub 图标，其余用通用链接图标', () => {
  const html = render([ITEM], {
    ...CONFIG,
    nav: [
      { label: 'Github', url: 'https://github.com/someone' },
      { label: 'Blog', url: 'https://blog.example.org' }
    ]
  });
  const pick = label => {
    const i = html.indexOf('>' + label + '</a>');
    return html.slice(html.lastIndexOf('<a', i), i + 4);
  };
  // GitHub 图标里那段"尾巴"是标志性的，用它区分两个图标
  assert.match(pick('Github'), /M9 19c-4 1\.4-4-2\.2-6-2\.8/);
  assert.ok(!/M9 19c-4 1\.4/.test(pick('Blog')), 'Blog 不该用 GitHub 图标');
});

test('导航外链新开窗口，站内路径不新开', () => {
  const html = render([ITEM], {
    ...CONFIG,
    nav: [
      { label: '站内', url: '/about' },
      { label: '外链', url: 'https://example.org/x' }
    ]
  });
  const link = label => {
    const i = html.indexOf('>' + label + '</a>');
    return html.slice(html.lastIndexOf('<a', i), i + 4);
  };

  assert.match(link('站内'), /href="\/about"/);
  assert.ok(!link('站内').includes('target='), '站内链接不该新开窗口');
  assert.match(link('外链'), /target="_blank"/);
  assert.match(link('外链'), /rel="noopener noreferrer"/);
});

test('导航名称会被转义', () => {
  const html = render([ITEM], {
    ...CONFIG,
    nav: [{ label: '<img src=x>', url: '/a' }]
  });
  assert.ok(!html.includes('<img src=x>'));
  assert.match(html, /&lt;img src=x&gt;/);
});

test('背景有光晕与网格两层，不是纯色', () => {
  // 纯色大留白看着单调，这两层是这版的主要观感改动
  assert.match(MARKET_CSS, /body::before/);
  assert.match(MARKET_CSS, /radial-gradient/);
  assert.match(MARKET_CSS, /--grid:/);
  assert.match(MARKET_CSS, /--glow:/);
  assert.match(MARKET_CSS, /mask-image/, '网格要能渐隐，否则整页都是格子');
});

/* ---------------- 页脚友情链接 ---------------- */

test('公开页把友情链接渲染到页脚，位置在版权信息上方', () => {
  const html = render([ITEM], {
    ...CONFIG,
    friends: [{ label: '域名导航', url: 'https://dn.example.com' }]
  });

  assert.ok(html.includes('class="site-friends"'), '缺友情链接一排');
  assert.ok(html.includes('https://dn.example.com'));
  assert.ok(html.includes('>域名导航</a>'));

  const friendsAt = html.indexOf('class="site-friends"');
  const lineAt = html.indexOf('class="sf-line"');
  assert.ok(friendsAt > 0 && friendsAt < lineAt, '友链要排在版权信息上方');
});

test('公开页没有友情链接时不渲染空容器', () => {
  const html = render([ITEM], { ...CONFIG, friends: [] });
  // 断言要带元素形态：`.site-friends{` 这段 CSS 也在同一个响应里，
  // 只搜 site-friends 会一直命中样式表，等于永远通过
  assert.ok(!html.includes('class="site-friends"'));
});

test('落地页（未开放）也带友情链接', () => {
  // 这一页是直接分享出去的地址，页脚空着会显得没做完
  const html = marketEmptyHtml({
    project: PROJECT,
    version: '2.8.0',
    reason: '本站暂未开放域名出售',
    friends: [{ label: '域名导航', url: 'https://dn.example.com' }]
  });
  assert.ok(html.includes('class="site-friends"'));
  assert.ok(html.includes('https://dn.example.com'));
});

test('友情链接样式与页脚样式一起下发', () => {
  const html = render([ITEM], {
    ...CONFIG,
    friends: [{ label: 'A', url: 'https://a.example.com' }]
  });
  assert.ok(html.includes('.site-friends{'), '缺 .site-friends 样式');
  assert.ok(html.includes('.site-foot{'), '页脚样式丢了');
});
