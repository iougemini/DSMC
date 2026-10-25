// 后台米表管理页的视图测试。
//
// 这里最值得钉的不是「表格长什么样」，而是**保存时会不会丢数据**：
// 表格行是「域名列表 ∪ 米表已有条目」的并集。只要渲染时少了一行，
// 前端保存就只提交剩下的行，那个域名的报价会被静默清空 ——
// 页面不报错、保存提示成功，用户过两天才发现价格没了。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marketView } from '../src/ui/views.js';

const domain = (name, extra = {}) => ({
  name,
  expirationDate: '2027-03-15',
  status: { key: 'ok', label: '正常', tone: 'ok', days: 300, group: 'active' },
  ...extra
});

const entry = (name, extra = {}) => ({
  name,
  priceType: 'fixed',
  price: 1200,
  category: '品牌',
  description: '两字双拼',
  note: '',
  featured: false,
  order: 0,
  ...extra
});

const rowOf = (html, name) => {
  // 每行是 <tr data-market-row data-name="xxx" ...>…</tr>
  const start = html.indexOf('data-name="' + name + '"');
  if (start < 0) return null;
  const end = html.indexOf('</tr>', start);
  return html.slice(start, end);
};

describe('marketView 行集合', () => {
  it('域名列表里的域名即使没进米表也出现，且未勾选', () => {
    const html = marketView({
      domains: [domain('alpha.com'), domain('beta.com')],
      market: { enabled: true, entries: [entry('alpha.com')] }
    });
    assert.ok(rowOf(html, 'alpha.com'), '已选域名应在表格里');
    assert.ok(rowOf(html, 'beta.com'), '未选域名也要出现，否则没法勾选');
    assert.ok(rowOf(html, 'alpha.com').includes('data-on="1"'));
    assert.ok(!rowOf(html, 'beta.com').includes('data-on="1"'));
  });

  it('米表里有、域名列表里没有的条目保留，并标记「不在域名列表」', () => {
    const html = marketView({
      domains: [domain('alpha.com')],
      market: { entries: [entry('alpha.com'), entry('ghost.com')] }
    });
    const ghost = rowOf(html, 'ghost.com');
    assert.ok(ghost, '这类条目必须保留，否则保存时会被静默丢掉');
    assert.ok(ghost.includes('不在域名列表'));
    assert.ok(ghost.includes('data-on="1"'), '保留的条目仍应是已勾选状态');
  });

  it('已选计数按「有米表条目」算，不按域名总数算', () => {
    const html = marketView({
      domains: [domain('a.com'), domain('b.com'), domain('c.com')],
      market: { entries: [entry('a.com'), entry('b.com')] }
    });
    assert.ok(html.includes('<b id="mkCount">2</b>'));
    assert.ok(html.includes('/ 3 个'));
  });

  it('米表为空但域名很多时，表格照常渲染', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: { entries: [] }
    });
    assert.ok(html.includes('data-market-row'));
    assert.ok(!html.includes('还没有可展示的域名'));
  });

  it('域名与米表都为空时走空状态，不渲染表格', () => {
    const html = marketView({ domains: [], market: { entries: [] } });
    assert.ok(html.includes('还没有可展示的域名'));
    assert.ok(!html.includes('data-market-row'));
  });

  it('缺 market 字段时退化为空配置，不抛异常', () => {
    const html = marketView({ domains: [domain('a.com')] });
    assert.ok(html.includes('data-market-row'));
    assert.ok(html.includes('id="mkCount"'));
  });

  it('行按域名排序，渲染顺序稳定', () => {
    const html = marketView({
      domains: [domain('zeta.com'), domain('alpha.com'), domain('mid.com')],
      market: { entries: [] }
    });
    const order = ['alpha.com', 'mid.com', 'zeta.com']
      .map(n => html.indexOf('data-name="' + n + '"'));
    assert.ok(order.every(i => i > 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
});

describe('marketView 表单回填', () => {
  it('回填价格、分类、卖点、备注、排序', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: {
        entries: [entry('a.com', { price: 8888, category: '工具', description: '好记的工具米', note: '含商标', order: 3 })]
      }
    });
    const row = rowOf(html, 'a.com');
    assert.ok(row.includes('value="8888"'));
    assert.ok(row.includes('value="工具"'));
    assert.ok(row.includes('value="好记的工具米"'));
    assert.ok(row.includes('value="含商标"'));
    assert.ok(row.includes('value="3"'));
  });

  it('面议条目回填时选中「面议」，价格留空', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: { entries: [entry('a.com', { priceType: 'inquire', price: 0 })] }
    });
    const row = rowOf(html, 'a.com');
    assert.ok(row.includes('<option value="inquire" selected>面议</option>'));
    assert.ok(row.includes('value=""'), '面议不该带出一个 0 价格');
  });

  it('精品标记与开关状态一起回填', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: { entries: [entry('a.com', { featured: true })] }
    });
    const row = rowOf(html, 'a.com');
    assert.ok(row.includes('class="switch on" data-action="mk-featured"'));
    assert.ok(row.includes('aria-checked="true"'));
  });

  it('未入表的域名行里各输入框为空，不残留别的条目的值', () => {
    const html = marketView({
      domains: [domain('a.com'), domain('b.com')],
      market: { entries: [entry('a.com', { price: 999, description: '只属于 a' })] }
    });
    const row = rowOf(html, 'b.com');
    assert.ok(!row.includes('999'));
    assert.ok(!row.includes('只属于 a'));
    assert.ok(row.includes('value=""'));
  });

  it('标题、介绍与四项联系方式回填', () => {
    const html = marketView({
      domains: [],
      market: {
        enabled: true,
        title: '精品短域名',
        intro: '支持过户，先款后转。',
        contact: {
          wechat: 'dsmc_wx',
          email: 'sell@example.com',
          telegram: 'dsmc_tg',
          community: 'https://example.com/community'
        },
        entries: []
      }
    });
    assert.ok(html.includes('value="精品短域名"'));
    assert.ok(html.includes('支持过户，先款后转。'));

    // 四个 input 的 id 必须和 client.js 里 saveMarket 取值用的 id 一一对应。
    // 对不上不会报错，只是"填了但存不进去"—— 最难查的那种
    for (const id of ['mkWechat', 'mkEmail', 'mkTelegram', 'mkCommunity']) {
      assert.ok(html.includes('id="' + id + '"'), '缺少输入框 ' + id);
    }
    assert.ok(html.includes('value="dsmc_wx"'));
    assert.ok(html.includes('value="sell@example.com"'));
    assert.ok(html.includes('value="dsmc_tg"'));
    assert.ok(html.includes('value="https://example.com/community"'));
  });

  it('未启用时开关不带 on，且提示会说明关闭后的表现', () => {
    const html = marketView({ domains: [], market: { enabled: false, entries: [] } });
    assert.ok(html.includes('aria-checked="false"'));
    assert.ok(html.includes('暂未开放'));
  });

  it('标题为空时回退成默认值，输入框不会是空的', () => {
    const html = marketView({ domains: [], market: { title: '', entries: [] } });
    assert.ok(html.includes('value="域名精选"'));
  });
});

describe('marketView 转义', () => {
  it('域名与卖点里的 HTML 被转义', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: { entries: [entry('a.com', { description: '<img src=x onerror=alert(1)>' })] }
    });
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img src=x'));
  });

  it('介绍里的脚本标签被转义', () => {
    const html = marketView({
      domains: [],
      market: { intro: '<script>alert(1)</script>', entries: [] }
    });
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('备注里的引号不会截断属性', () => {
    const html = marketView({
      domains: [domain('a.com')],
      market: { entries: [entry('a.com', { note: '带"引号"的备注' })] }
    });
    const row = rowOf(html, 'a.com');
    assert.ok(row.includes('&quot;引号&quot;'));
  });
});

describe('marketView 自定义导航', () => {
  it('已有导航项按名称与链接回填', () => {
    const html = marketView({
      domains: [],
      market: {
        nav: [{ label: '全部域名', url: '/market' }, { label: '仓库', url: 'https://github.com/x/y' }],
        entries: []
      }
    });

    assert.ok(html.includes('value="全部域名"'));
    assert.ok(html.includes('value="/market"'));
    assert.ok(html.includes('value="仓库"'));
    assert.ok(html.includes('value="https://github.com/x/y"'));
  });

  it('没有导航时也给一个空模板行，供「添加」按钮克隆', () => {
    const html = marketView({ domains: [], market: { nav: [], entries: [] } });

    assert.ok(html.includes('id="mkNav"'));
    assert.ok(html.includes('id="mkNavTpl"'), '模板行必须存在，否则加不了导航');
    // template 里的行不算真实行，只用来克隆
    assert.equal((html.match(/data-nav-row/g) || []).length, 1);
  });

  it('导航容器带上数量上限，前端据此拦住超额添加', () => {
    const html = marketView({ domains: [], market: { nav: [], entries: [] } });
    assert.match(html, /id="mkNav" data-max="\d+"/);
  });

  it('导航名称里的引号不会截断属性', () => {
    const html = marketView({
      domains: [],
      market: { nav: [{ label: '带"引号"', url: '/a' }], entries: [] }
    });
    assert.ok(html.includes('&quot;引号&quot;'));
  });
});

describe('marketView 友情链接', () => {
  it('已有友情链接按名称与链接回填', () => {
    const html = marketView({
      domains: [],
      market: {
        friends: [
          { label: '域名导航', url: 'https://dn.example.com' },
          { label: '博客', url: 'https://blog.example.com' }
        ],
        entries: []
      }
    });

    assert.ok(html.includes('id="mkFriends"'), '缺友情链接容器');
    assert.ok(html.includes('value="域名导航"'));
    assert.ok(html.includes('value="https://dn.example.com"'));
    assert.ok(html.includes('value="博客"'));
  });

  it('没有友情链接时也给一个空模板行，供「添加」按钮克隆', () => {
    const html = marketView({ domains: [], market: { friends: [], entries: [] } });

    assert.ok(html.includes('id="mkFriendsTpl"'), '模板行必须存在，否则加不了友链');
    // template 里的行不算真实行，只用来克隆
    assert.equal((html.match(/data-friend-row/g) || []).length, 1);
  });

  it('友情链接容器带上数量上限，前端据此拦住超额添加', () => {
    const html = marketView({ domains: [], market: { friends: [], entries: [] } });
    assert.match(html, /id="mkFriends" data-max="\d+"/);
  });

  it('导航与友情链接用不同的 data 属性，收集时不会互相串味', () => {
    // 共用 data-nav-row 会让「保存米表」把友链也写进顶栏导航
    const html = marketView({
      domains: [],
      market: {
        nav: [{ label: '全部域名', url: '/market' }],
        friends: [{ label: '域名导航', url: 'https://dn.example.com' }],
        entries: []
      }
    });

    // 各 1 条真实行 + 1 条模板行
    assert.equal((html.match(/data-nav-row/g) || []).length, 2);
    assert.equal((html.match(/data-friend-row/g) || []).length, 2);
    assert.ok(html.includes('data-action="mk-nav-add"'));
    assert.ok(html.includes('data-action="mk-friend-add"'));
    assert.ok(html.includes('data-action="mk-friend-del"'));
  });

  it('友情链接名称里的引号不会截断属性', () => {
    const html = marketView({
      domains: [],
      market: { friends: [{ label: '带"引号"的站', url: 'https://q.example.com' }], entries: [] }
    });
    assert.ok(html.includes('&quot;引号&quot;'));
  });
});
