// 客户端脚本与样式的静态校验
//
// client.js 是一个 1200 多行的模板字符串，它不会被 Node 直接执行，
// 也不会被单测覆盖——写错一个引号，页面看起来正常（200、HTML 也对），
// 但所有交互全废。这里用 new Function 做一次语法解析，把这类错误挡在提交前。
// CSS 同理：少一个 } 会让后面所有规则失效，而肉眼极难发现。

import test from 'node:test';
import assert from 'node:assert/strict';
import { clientScript } from '../src/ui/client.js';
import { CSS } from '../src/ui/styles.js';
import { LOGIN_CSS } from '../src/ui/login.js';
import { statusOf, normalizeDomains, buildStats } from '../src/ui/data.js';
import { icon } from '../src/ui/icons.js';
import { renderPage } from '../src/ui/shell.js';
import { renderLogin } from '../src/ui/login.js';
import { FOOTER_CSS, footerHtml } from '../src/ui/footer.js';

test('客户端脚本语法合法', () => {
  const code = clientScript();
  assert.ok(code.length > 10000, '脚本长度异常，可能没拼上');
  assert.doesNotThrow(() => new Function(code), 'clientScript 有语法错误');
});

test('客户端脚本没有引用未定义的全局工具', () => {
  const code = clientScript();
  // 这几个是脚本里最容易"以为有其实没有"的辅助函数
  for (const name of ['esc(', 'toast(', 'syncScrollLock(']) {
    assert.ok(code.includes('function ' + name.slice(0, -1)) || code.includes('var ' + name.slice(0, -1)),
      '缺少函数定义：' + name);
  }
});

test('主样式表大括号配平', () => {
  const open = (CSS.match(/\{/g) || []).length;
  const close = (CSS.match(/\}/g) || []).length;
  assert.equal(open, close, `大括号不配平：{ ${open} 个，} ${close} 个`);
});

test('登录页样式大括号配平', () => {
  const open = (LOGIN_CSS.match(/\{/g) || []).length;
  const close = (LOGIN_CSS.match(/\}/g) || []).length;
  assert.equal(open, close, `大括号不配平：{ ${open} 个，} ${close} 个`);
});

test('登录页头部居中、表单区左对齐', () => {
  assert.match(LOGIN_CSS, /\.hd\{text-align:center\}/);
  assert.match(LOGIN_CSS, /\.mark\{[^}]*margin:0 auto 16px/);
});

test('statusOf 把 pending 与"查不到"分开', () => {
  const pending = statusOf({ pending: true, expirationDate: 'Unknown', registrationDate: 'Unknown' });
  assert.equal(pending.key, 'pending');
  assert.equal(pending.label, '查询中');
  assert.equal(pending.group, 'pending');

  const unknown = statusOf({ expirationDate: 'Unknown', registrationDate: 'Unknown' });
  assert.equal(unknown.key, 'unknown');
});

test('pending 不影响永久域名的判定', () => {
  const st = statusOf({ pending: true, isPermanent: true, expirationDate: '2999-12-31' });
  assert.equal(st.key, 'permanent');
});

test('normalizeDomains 透传 pending', () => {
  const [d] = normalizeDomains([{ name: 'a.com', pending: true, username: '主账户' }]);
  assert.equal(d.pending, true);
  assert.equal(d.status.key, 'pending');
  assert.equal(d.account, '主账户');
});

test('icon 对未知名字返回空 svg 而不是崩', () => {
  const svg = icon('not-exist', 16);
  assert.match(svg, /^<svg/);
  assert.ok(!svg.includes('undefined'));
});

/* ---------------- 后台补全提示条 ---------------- */

function renderWith(pending) {
  const list = normalizeDomains([
    { name: 'a.com', username: '主账户', registrationDate: '2024-01-01', expirationDate: '2027-01-01' }
  ]);
  return renderPage({
    domains: list,
    stats: buildStats(list),
    isAdmin: false,
    version: 'test',
    project: { NAME: 'DSMC', FULL_NAME: 'Domain Status Manager', DESCRIPTION: 'd' },
    freeDomains: [],
    pending
  });
}

test('有域名在后台补全时显示提示条', () => {
  const html = renderWith(3);
  assert.ok(html.includes('id="pendingNote"'), '缺少补全提示条');
  assert.match(html, /3 个域名正在后台查询/);
  assert.ok(html.includes('data-action="reload-page"'), '提示条缺少重新加载按钮');
});

test('没有待补全时不显示提示条', () => {
  assert.ok(!renderWith(0).includes('id="pendingNote"'));
  assert.ok(!renderWith(undefined).includes('id="pendingNote"'));
});

/* ---------------- 页脚与导航标签 ---------------- */

const TEST_PROJECT = {
  NAME: 'DSMC',
  FULL_NAME: 'Domain Status Manager for Cloudflare',
  DESCRIPTION: 'd',
  GITHUB: 'https://github.com/example/dsmc',
  COMMUNITY: 'https://example.com/community',
  LICENSE: 'MIT'
};

test('页脚样式大括号配平', () => {
  const open = (FOOTER_CSS.match(/\{/g) || []).length;
  const close = (FOOTER_CSS.match(/\}/g) || []).length;
  assert.equal(open, close, `大括号不配平：{ ${open} 个，} ${close} 个`);
});

test('页脚含版权、Powered by 与全名，链接指向交流区与仓库', () => {
  const html = footerHtml({ version: '1.2.3', project: TEST_PROJECT });

  assert.match(html, /Copyright by NieGe Meta/);
  assert.match(html, /Powered by DSMC/);
  assert.match(html, /Domain Status Manager for Cloudflare/, '缺少全名（alt 文案）');
  assert.match(html, /v1\.2\.3/);

  // 版权行要链到交流区，Powered by 要链到仓库——两处链错是这类页脚最常见的错误
  const copyright = html.slice(html.indexOf('Copyright by NieGe Meta') - 200, html.indexOf('Copyright by NieGe Meta'));
  assert.ok(copyright.includes(TEST_PROJECT.COMMUNITY), '版权行没有链到交流区');
  const powered = html.slice(html.indexOf('Powered by DSMC') - 200, html.indexOf('Powered by DSMC'));
  assert.ok(powered.includes(TEST_PROJECT.GITHUB), 'Powered by 没有链到仓库');
});

test('页脚外链都带 rel=noopener', () => {
  const html = footerHtml({ project: TEST_PROJECT });
  const anchors = html.match(/<a [^>]*target="_blank"[^>]*>/g) || [];
  assert.equal(anchors.length, 2, '页脚应有 2 个外链');
  for (const a of anchors) assert.match(a, /rel="noopener noreferrer"/);
});

test('管理页与登录页都带同一个页脚', () => {
  assert.ok(renderWith(0).includes('class="site-foot'), '管理页缺页脚');
  assert.ok(renderLogin('登录 DSMC', '/login').includes('class="site-foot'), '登录页缺页脚');
});

test('登录页页脚固定贴底，应用页页脚随内容流式排布', () => {
  assert.ok(renderLogin('登录 DSMC', '/login').includes('class="site-foot fixed"'));
  assert.ok(!renderWith(0).includes('class="site-foot fixed"'));
});

test('访客侧栏不再出现账户与免费两项', () => {
  const html = renderWith(0);
  const rail = html.slice(html.indexOf('<aside class="rail">'), html.indexOf('</aside>'));

  for (const label of ['>域名<', '>续费<']) {
    assert.ok(rail.includes(label), '侧栏缺少导航项 ' + label);
  }
  // 账户页对访客是只读的「账户标签 + Cloudflare 用户名 + Token 掩码」，
  // 没有可用操作，却把账户结构暴露给了访客
  for (const label of ['>账户<', '>免费<']) {
    assert.ok(!rail.includes(label), '访客侧栏不该出现 ' + label);
  }
  for (const old of ['域名库', '续费清单', '免费域名']) {
    assert.ok(!rail.includes(old), '侧栏残留旧标签 ' + old);
  }
});

test('访客页面不再下发账户数据', () => {
  const html = renderWith(0);
  const data = html.slice(html.indexOf('id="dsmc-data"'));
  assert.ok(!/"accounts"\s*:\s*\[\s*\{/.test(data), '访客页面仍带着账户数组');
});

test('免费域名并入关于页，作为子标签', () => {
  const html = renderWith(0);
  assert.ok(html.includes('data-subtab="free"'), '关于页缺少「免费域名」子标签');
  assert.ok(html.includes('data-subpanel="free"'), '关于页缺少免费域名的面板容器');
  assert.ok(!html.includes('data-view="freedomains"'), '免费域名仍是独立视图');
});

test('DNSHE 不再是独立页面，凭证管理并入设置页', () => {
  const list = normalizeDomains([
    { name: 'a.com', username: '主账户', registrationDate: '2024-01-01', expirationDate: '2027-01-01' }
  ]);
  const html = renderPage({
    domains: list,
    stats: buildStats(list),
    isAdmin: true,
    version: 'test',
    project: TEST_PROJECT,
    freeDomains: [],
    dnsheCredentials: [{ id: 'd1', label: '主账户', keyMasked: 'cfsd_••••', enabled: true }],
    dnsheEnv: { hasKey: false, hasSecret: false }
  });

  assert.ok(!html.includes('data-view="dnshe"'), 'DNSHE 仍有独立视图');
  assert.ok(!html.includes('data-view-link="dnshe"'), '还有指向 DNSHE 页的导航');
  const settings = html.slice(html.indexOf('data-view="settings"'), html.indexOf('data-view="about"'));
  assert.ok(settings.includes('DNSHE 查询凭证'), '设置页缺 DNSHE 凭证区块');
  assert.ok(settings.includes('data-action="dnshe-add"'), '设置页缺添加凭证按钮');
});

/* ---------------- 页脚友情链接 ---------------- */

test('友情链接：没有配置时整块不渲染，页脚保持原样', () => {
  for (const friends of [undefined, null, [], 'oops']) {
    const html = footerHtml({ project: TEST_PROJECT, friends });
    assert.ok(!html.includes('site-friends'), '不该出现空的友情链接容器');
    assert.ok(!html.includes('友情链接'));
  }
});

test('友情链接排在页脚信息上方，且在 <footer> 内部', () => {
  // 拼在 <footer> 外面会多出一条分割线，看起来像两个区块
  const html = footerHtml({
    project: TEST_PROJECT,
    friends: [{ label: '域名导航', url: 'https://dn.example.com' }]
  });
  const footerAt = html.indexOf('<footer');
  const friendsAt = html.indexOf('class="site-friends"');
  const lineAt = html.indexOf('class="sf-line"');

  assert.ok(footerAt >= 0 && friendsAt > footerAt, '友情链接必须在 <footer> 内部');
  assert.ok(friendsAt < lineAt, '友情链接必须排在版权信息上方');
  assert.ok(html.includes('友情链接</b>'), '缺分组标题');
  assert.ok(html.includes('href="https://dn.example.com"'));
  assert.ok(html.includes('>域名导航</a>'));
});

test('友情链接：伪协议在渲染层再拦一次', () => {
  // 存储层已经校验过，但渲染层也会被预览脚本/测试直接调用
  const html = footerHtml({
    project: TEST_PROJECT,
    friends: [
      { label: '坏链接', url: 'javascript:alert(1)' },
      { label: '协议相对', url: '//evil.example.com' },
      { label: '好链接', url: 'https://ok.example.com' }
    ]
  });
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('//evil.example.com'));
  assert.ok(!html.includes('坏链接'), '被丢掉的项不该渲染出标签');
  assert.ok(html.includes('https://ok.example.com'));
});

test('友情链接：外链都带 target=_blank 与 rel=noopener', () => {
  const html = footerHtml({
    project: TEST_PROJECT,
    friends: [{ label: 'A', url: 'https://a.example.com' }, { label: 'B', url: 'https://b.example.com' }]
  });
  const anchors = html.match(/<a [^>]*href="https:\/\/(?:a|b)\.example\.com"[^>]*>/g) || [];
  assert.equal(anchors.length, 2);
  for (const a of anchors) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
});

test('友情链接：名称里的引号不会截断属性', () => {
  const html = footerHtml({
    project: TEST_PROJECT,
    friends: [{ label: '带"引号"的站', url: 'https://q.example.com' }]
  });
  assert.ok(html.includes('&quot;引号&quot;'));
  assert.ok(!html.includes('带"引号"'));
});
