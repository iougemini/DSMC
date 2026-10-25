// 安全审计：在真实路由上跑攻击性请求，检查「没有凭证能拿到什么」。
//
// 和冒烟的区别：冒烟验证「功能对不对」，这里只验证「不该给的给了没有」。
// 每一条都是一个具体的攻击动作，不是"应该安全"这种空话：
//
//   - 不带 cookie 直接打 11 个 API
//   - 伪造 / 篡改 / 越级的 token
//   - 用访客 cookie 打管理员接口
//   - 抓页面 HTML 里有没有 Token、账户名、内部备注
//   - 试伪协议、路径遍历、开放重定向
//
// 用法：npm run security

import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeKV } from '../test/_fake-kv.js';
import { marketHtml } from '../src/ui/market.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(root, 'dist', '_audit-worker.mjs');

// ── 审计用的假环境 ───────────────────────────────────────────
// 这些值刻意取得足够特殊：在响应体里一出现就能认出来是泄漏
const ADMIN_PW = 'audit-admin-9f2c';
const ACCESS_PW = 'audit-access-4b71';
const CF_TOKEN = 'audit-cf-token-7d3e91';
const DNSHE_KEY = 'audit-dnshe-key-2a8f';
const ACCOUNT_NAME = '审计账户甲';
const INTERNAL_NOTE = '内部备注不该出现在公开页';

const INITIAL = {
  'config:accounts': JSON.stringify([
    { label: ACCOUNT_NAME, username: 'audit-user', token: CF_TOKEN, note: INTERNAL_NOTE, enabled: true }
  ]),
  'config:settings': JSON.stringify({}),
  'config:market': JSON.stringify({
    enabled: true,
    title: '审计米表',
    intro: '审计用',
    contact: { wechat: 'audit_wx', email: 'a@b.com', url: 'https://example.com' },
    nav: [{ label: '站内', url: '/about' }],
    entries: [
      { name: 'demo.com', priceType: 'fixed', price: 100, category: '品牌', description: '演示', featured: true },
      { name: 'demo.net', priceType: 'inquire', price: 0, category: '工具', description: '演示2' }
    ]
  }),
  'config:dnshe': JSON.stringify({ credentials: [{ key: DNSHE_KEY, secret: 'audit-secret', enabled: true }] }),
  'config:notify': JSON.stringify({}),
  'config:free-domains': JSON.stringify({})
};

const kv = fakeKV(INITIAL);

const env = { DOMAIN_INFO: kv, ADMIN_PASSWORD: ADMIN_PW, ACCESS_PASSWORD: ACCESS_PW };
// 完全没有密码的部署：验证不会因此变成"谁都能进"
const envNoPw = { DOMAIN_INFO: kv };
const ctx = { waitUntil() {}, passThroughOnException() {} };

// ── 打包并加载 worker ───────────────────────────────────────
mkdirSync(join(root, 'dist'), { recursive: true });
await build({
  entryPoints: [join(root, 'src/index.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: tmp,
  // 唯一能在 Node 里加载 src/index.js 的办法：把 sockets 换成桩
  alias: { 'cloudflare:sockets': join(root, 'test/_sockets-stub.js') },
  logLevel: 'error'
});

const { default: worker } = await import(pathToFileURL(tmp).href);
const BASE = 'https://audit.example.com';

async function req(path, { method = 'GET', cookie, body, headers = {}, useEnv } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  const res = await worker.fetch(new Request(BASE + path, { method, headers: h, body }), useEnv || env, ctx);
  return res;
}

function cookiesOf(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return all.map(c => String(c).split(';')[0]).join('; ');
}

async function login(path, password, useEnv) {
  const res = await req(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=' + encodeURIComponent(password),
    useEnv
  });
  return { res, cookie: cookiesOf(res) };
}

// ── 检查框架 ────────────────────────────────────────────────
const results = [];
function check(name, fn) { results.push({ name, fn }); }

function assert(cond, msg) { if (!cond) throw new Error(msg); }

/** 未授权时应该拿不到东西：401/403，或跳去登录页 */
function isDenied(res) {
  return [401, 403].includes(res.status) ||
    ([302, 303, 307].includes(res.status) && /login/i.test(res.headers.get('location') || ''));
}

// ── 先拿到合法凭证 ──────────────────────────────────────────
const admin = await login('/admin-login', ADMIN_PW);
const access = await login('/login', ACCESS_PW);
const ADMIN_COOKIE = admin.cookie;
const ACCESS_COOKIE = access.cookie;

// ══════════════════════════════════════════════════════════
// 一、未授权访问所有 API
// ══════════════════════════════════════════════════════════
const ADMIN_APIS = [
  ['GET', '/api/accounts'],
  ['GET', '/api/cf-keys'],
  ['GET', '/api/settings'],
  ['GET', '/api/dnshe'],
  ['GET', '/api/notify'],
  ['GET', '/api/custom-domains'],
  ['GET', '/api/free-domains'],
  ['GET', '/api/market'],
  ['GET', '/api/audit-logs'],
  ['POST', '/api/update'],
  ['POST', '/api/manual-query']
];

for (const [method, path] of ADMIN_APIS) {
  check(`无凭证 ${method} ${path} 被拒绝`, async () => {
    const res = await req(path, { method, body: method === 'POST' ? '{}' : undefined });
    assert(isDenied(res), `实际 ${res.status}，没有被拒绝`);
    // 被拒绝时不能顺带把数据吐出来
    const text = await res.text();
    for (const secret of [CF_TOKEN, DNSHE_KEY, ACCOUNT_NAME, INTERNAL_NOTE]) {
      assert(!text.includes(secret), `拒绝响应里泄漏了：${secret}`);
    }
  });
}

// ══════════════════════════════════════════════════════════
// 二、伪造与越级 token
// ══════════════════════════════════════════════════════════
check('随便编一个 admin_token 进不去', async () => {
  const res = await req('/api/accounts', { cookie: 'admin_token=forged-token-abc123' });
  assert(isDenied(res), `实际 ${res.status}`);
});

check('把合法 token 改一个字符就失效', async () => {
  const real = ADMIN_COOKIE.split('=').slice(1).join('=');
  const tampered = real.slice(0, -1) + (real.slice(-1) === 'a' ? 'b' : 'a');
  const res = await req('/api/accounts', { cookie: 'admin_token=' + tampered });
  assert(isDenied(res), `篡改后的 token 仍然可用，实际 ${res.status}`);
});

check('空的 admin_token 进不去', async () => {
  const res = await req('/api/accounts', { cookie: 'admin_token=' });
  assert(isDenied(res), `实际 ${res.status}`);
});

check('访客 token 不能当管理员用', async () => {
  const res = await req('/api/accounts', { cookie: ACCESS_COOKIE });
  assert(isDenied(res), `访客 cookie 打开了管理员接口，实际 ${res.status}`);
});

check('访客 token 不能进 /admin 页面', async () => {
  const res = await req('/admin', { cookie: ACCESS_COOKIE });
  assert(![200].includes(res.status), `访客打开了 /admin，实际 ${res.status}`);
  const html = await res.text();
  assert(!html.includes(CF_TOKEN), '/admin 响应里带出了 CF Token');
});

// ══════════════════════════════════════════════════════════
// 三、无鉴权的接口（重点：这两个原来谁都能打）
// ══════════════════════════════════════════════════════════
check('无凭证 /whois/:domain 被拒绝', async () => {
  const res = await req('/whois/not-a-valid-domain');
  assert(isDenied(res), `实际 ${res.status}，说明没鉴权就进了业务逻辑`);
});

check('无凭证 /api/manual-query 被拒绝', async () => {
  const res = await req('/api/manual-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'example.com' })
  });
  assert(isDenied(res), `实际 ${res.status}，说明没鉴权就进了业务逻辑`);
});

check('访客 token 可以用 /whois（域名页的刷新按钮）', async () => {
  const res = await req('/whois/not-a-valid-domain', { cookie: ACCESS_COOKIE });
  // 这个接口是访客也能点的，所以不该要求 admin；只要不是 401/403 即可
  assert(![401, 403].includes(res.status), `访客被拦了，实际 ${res.status}`);
});

// ══════════════════════════════════════════════════════════
// 四、页面 HTML 泄漏
// ══════════════════════════════════════════════════════════
const SECRETS = [
  ['CF Token', CF_TOKEN],
  ['DNSHE Key', DNSHE_KEY],
  ['账户名', ACCOUNT_NAME],
  ['内部备注', INTERNAL_NOTE],
  ['管理员密码', ADMIN_PW],
  ['访问密码', ACCESS_PW]
];

// 凭证字段名（JSON 键的形态）。查值只能证明"这一份数据这次没漏"；
// 查键名能抓住"结构里带了但此刻恰好为空"的情况——空字符串不含任何凭证值，
// 值断言永远通过，可字段一旦存在，换个时机就有内容了
const SECRET_KEYS = [
  '"token"', '"tokenMasked"', '"secret"', '"apiKey"', '"api_key"',
  '"accessPassword"', '"adminPassword"', '"cfToken"', '"dnsheKey"', '"sendKey"'
];

// 匿名身份打得到、且期望有响应体的路由。401/404 也要查：
// 拒绝响应里回显请求参数或内部错误信息，是另一条常见的泄漏路径
const ANON_REACHABLE = ['/', '/market', '/login', '/admin-login', '/logout', '/nope', '/whois/example.com'];

check('匿名可达的每个路由都不含凭证值', async () => {
  for (const path of ANON_REACHABLE) {
    const res = await req(path);
    const text = await res.text();
    for (const [label, value] of SECRETS) {
      assert(!text.includes(value), `${path} 泄漏了${label}（状态 ${res.status}）`);
    }
  }
});

check('匿名可达的每个路由都不含凭证字段名', async () => {
  for (const path of ANON_REACHABLE) {
    const res = await req(path);
    const text = await res.text();
    for (const key of SECRET_KEYS) {
      assert(!text.includes(key), `${path} 出现了凭证字段 ${key}`);
    }
  }
});

check('被拒绝的管理员接口不把凭证回显在错误体里', async () => {
  for (const [method, path] of ADMIN_APIS) {
    const res = await req(path, { method });
    const text = await res.text();
    for (const [label, value] of SECRETS) {
      assert(!text.includes(value), `${method} ${path} 的拒绝响应里带出了${label}`);
    }
  }
});

check('访客页面不含任何凭证与内部字段', async () => {
  const res = await req('/', { cookie: ACCESS_COOKIE });
  assert(res.status === 200, `访客首页状态 ${res.status}`);
  const html = await res.text();
  for (const [label, value] of SECRETS) {
    assert(!html.includes(value), `访客页面泄漏了${label}`);
  }
});

check('访客页面不下发账户数据', async () => {
  const res = await req('/', { cookie: ACCESS_COOKIE });
  const html = await res.text();
  // shell.js 把数据序列化进 <script id="dsmc-data">，访客那份里 accounts 必须是空的
  const m = html.match(/<script[^>]*id="dsmc-data"[^>]*>([\s\S]*?)<\/script>/);
  assert(m, '没找到数据块，测试本身失效了');
  const data = JSON.parse(m[1]);
  assert(Array.isArray(data.accounts) && data.accounts.length === 0,
    '访客的数据块里仍然带着账户，实际 ' + JSON.stringify(data.accounts).slice(0, 80));
  assert(!data.market, '访客不该拿到米表配置');
});

check('公开米表页不含任何凭证与内部字段', async () => {
  const res = await req('/market');
  assert(res.status === 200, `状态 ${res.status}`);
  const html = await res.text();
  for (const [label, value] of SECRETS) {
    assert(!html.includes(value), `米表页泄漏了${label}`);
  }
  for (const leak of ['whoisError', 'registrar', 'autoUpdateWhois']) {
    assert(!html.includes(leak), `米表页出现了内部字段名：${leak}`);
  }
});

check('管理员页面确实能拿到数据（对照组，证明上面的断言不是空转）', async () => {
  const res = await req('/admin', { cookie: ADMIN_COOKIE });
  assert(res.status === 200, '/admin 状态 ' + res.status);
  const html = await res.text();
  const m = html.match(/<script[^>]*id="dsmc-data"[^>]*>([\s\S]*?)<\/script>/);
  assert(m, '管理员页面没有数据块');
  const data = JSON.parse(m[1]);
  assert(Array.isArray(data.accounts) && data.accounts.length > 0, '管理员页面拿不到账户，对照失效');
  // 但 Token 只能是掩码形式
  assert(!html.includes(CF_TOKEN), '管理员页面出现了 Token 明文');
});

// ══════════════════════════════════════════════════════════
// 五、注入
// ══════════════════════════════════════════════════════════
check('米表字段里的脚本标签被转义', async () => {
  // 直接测视图层：这是转义真正发生的地方，绕开 KV 缓存才测得准
  const html = marketHtml({
    project: { NAME: 'DSMC', FULL_NAME: 'x', DESCRIPTION: 'y' },
    version: '2.8.5',
    config: {
      enabled: true,
      title: '<script>alert(1)</script>',
      intro: '"><img src=x onerror=alert(2)>',
      contact: { wechat: '<b>x</b>', email: '', url: '' },
      nav: [{ label: '<svg onload=alert(3)>', url: '/a' }],
      entries: []
    },
    items: [{
      name: 'demo.com', priceType: 'fixed', price: 1,
      description: '<iframe src=javascript:alert(4)>',
      category: '"><script>alert(5)</script>',
      note: '<img src=y>'
    }]
  });

  for (const payload of ['<script>alert(1)</script>', '<img src=x', '<svg onload=', '<iframe src=', '<b>x</b>', '<img src=y>']) {
    assert(!html.includes(payload), `未转义的注入点：${payload}`);
  }
  assert(html.includes('&lt;script&gt;'), '转义后应该能看到实体');
});

check('米表导航的伪协议被丢弃', async () => {
  // 归一化在 market-store 里，这里通过视图看最终 HTML 有没有被塞进 href
  const { normalizeMarketConfig } = await import('../src/managers/market-store.js');
  const config = normalizeMarketConfig({
    enabled: true,
    nav: [
      { label: 'xss', url: 'javascript:alert(1)' },
      { label: 'data', url: 'data:text/html,<script>alert(1)</script>' },
      { label: 'proto', url: '//evil.example.org' },
      { label: 'ok', url: '/about' }
    ],
    entries: []
  });

  assert(config.nav.length === 1, '只该留下合法的那一条，实际 ' + JSON.stringify(config.nav));

  const html = marketHtml({
    project: { NAME: 'DSMC', FULL_NAME: 'x', DESCRIPTION: 'y' },
    version: '2.8.5',
    config,
    items: []
  });
  assert(!html.includes('javascript:alert'), 'javascript: 协议没被拦掉');
  assert(!html.includes('data:text/html'), 'data: 协议没被拦掉');
  assert(!html.includes('//evil.example.org'), '协议相对 URL 没被拦掉');
});

check('米表友情链接的伪协议被丢弃', async () => {
  // 页脚这一排同样会原样进 href，安全边界与顶栏导航一致
  const { normalizeMarketConfig } = await import('../src/managers/market-store.js');
  const config = normalizeMarketConfig({
    enabled: true,
    friends: [
      { label: 'xss', url: 'javascript:alert(1)' },
      { label: 'data', url: 'data:text/html,<script>alert(1)</script>' },
      { label: 'proto', url: '//evil.example.org' },
      { label: 'ok', url: 'https://friend.example.com' }
    ],
    entries: []
  });

  assert(config.friends.length === 1, '只该留下合法的那一条，实际 ' + JSON.stringify(config.friends));

  const html = marketHtml({
    project: { NAME: 'DSMC', FULL_NAME: 'x', DESCRIPTION: 'y' },
    version: '2.8.5',
    config,
    items: []
  });
  assert(!html.includes('javascript:alert'), 'javascript: 协议没被拦掉');
  assert(!html.includes('data:text/html'), 'data: 协议没被拦掉');
  assert(!html.includes('//evil.example.org'), '协议相对 URL 没被拦掉');
  assert(html.includes('https://friend.example.com'), '合法友链被误杀');
});

check('WHOIS 域名参数不能路径遍历', async () => {
  const res = await req('/whois/..%2f..%2f..%2fetc%2fpasswd', { cookie: ADMIN_COOKIE });
  const text = await res.text();
  assert(!text.includes('root:x:'), '路径遍历读到了系统文件');
});

check('不存在的路径不会回落到面板', async () => {
  const res = await req('/api/../admin');
  assert(![200].includes(res.status) || !(await res.text()).includes('dsmc-data'),
    '路径归一化后意外打开了面板');
});

// ══════════════════════════════════════════════════════════
// 六、缓存与 Cookie 属性
// ══════════════════════════════════════════════════════════
check('公开米表页可被 CDN 缓存，且不带 Vary: Cookie', async () => {
  const res = await req('/market');
  const cc = res.headers.get('cache-control') || '';
  assert(/public/.test(cc), 'Cache-Control 不是 public：' + cc);
  assert(!/Vary/i.test(res.headers.get('vary') || '') || !/cookie/i.test(res.headers.get('vary') || ''),
    '公开页带了 Vary: Cookie，CDN 缓存会失效');
});

check('登录后的页面是 private，且带 Vary: Cookie', async () => {
  const res = await req('/', { cookie: ACCESS_COOKIE });
  const cc = res.headers.get('cache-control') || '';
  assert(/private/.test(cc), 'Cache-Control 不是 private：' + cc);
  assert(/cookie/i.test(res.headers.get('vary') || ''), '缺少 Vary: Cookie，缓存会把别人的页面发出去');
});

check('登录 Cookie 带 HttpOnly / SameSite', async () => {
  const raw = typeof admin.res.headers.getSetCookie === 'function'
    ? admin.res.headers.getSetCookie().join('; ')
    : (admin.res.headers.get('set-cookie') || '');
  assert(/httponly/i.test(raw), 'Cookie 没有 HttpOnly，JS 能读到 token');
  assert(/samesite/i.test(raw), 'Cookie 没有 SameSite');
});

// ══════════════════════════════════════════════════════════
// 七、完全没配置密码的部署
// ══════════════════════════════════════════════════════════
check('没配置密码时，空密码登录不通过', async () => {
  const { res } = await login('/login', '', envNoPw);
  assert(res.status !== 302, '空密码登录成功了下发了 cookie，实际状态 ' + res.status);
});

check('没配置密码时，管理员接口仍然进不去', async () => {
  const res = await req('/api/accounts', { useEnv: envNoPw });
  assert(isDenied(res), `实际 ${res.status}`);
});

check('没配置密码时，首页给米表而不是面板', async () => {
  const res = await req('/', { useEnv: envNoPw });
  assert([302, 303, 307].includes(res.status) && /\/market$/.test(res.headers.get('location') || ''),
    `实际 ${res.status} ${res.headers.get('location') || ''}`);
});

check('没配置密码时，伪造 access_token 进不去', async () => {
  // 密码为空时签名密钥也是空的，这里确认它不会退化成"随便签都算数"
  for (const forged of ['access', 'eyJ0eXBlIjoiYWNjZXNzIn0', 'x.y.z']) {
    const res = await req('/', { cookie: 'access_token=' + forged, useEnv: envNoPw });
    assert([302, 303, 307].includes(res.status), `伪造 token 被当成了登录态：${forged}`);
  }
});

// ══════════════════════════════════════════════════════════
// 跑
// ══════════════════════════════════════════════════════════
let pass = 0;
const failures = [];
for (const { name, fn } of results) {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log('  FAIL ' + name + '\n         → ' + error.message);
  }
}

rmSync(tmp, { force: true });

console.log(`\n${pass}/${results.length} 项通过`);
if (failures.length) {
  console.log('\n未通过：');
  for (const f of failures) console.log('  - ' + f.name + '：' + f.message);
  process.exit(1);
}
