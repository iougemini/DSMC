// 米表（域名出售展示）配置
//
// 存储：config:market
//   {
//     enabled, title, intro, currency,
//     contact: { wechat, email, telegram, community },
//     nav: [{ label, url }],
//     friends: [{ label, url }],
//     entries: [{ name, priceType, price, description, category, note, featured, order }]
//   }
//
// 三个刻意的取舍：
//
// 1. **只存域名与报价，不存注册日 / 到期日**。日期从域名数据里实时取 ——
//    存两份必然漂移，改一次 WHOIS 就要同步两处，漏一次米表上的日期就是错的。
// 2. **这个页面的所有字段都是公开的**。没有"内部备注"这种字段：一个字段只要
//    进了 entries 就会出现在公网页面上。真要记内部信息，写进域名的 notes。
// 3. **读取不抛异常**。KV 没绑定、配置损坏，都退回默认值（未启用），
//    不能让一个坏掉的配置把公开页打成 500。

import { readConfig, writeConfig } from './kv-config.js';
import { validateDomain } from '../validators.js';

export const MARKET_KEY = 'config:market';

/** 单次展示上限。再多就不是"精选"而是域名列表了，页面也会变慢 */
const MAX_ENTRIES = 200;

/** 自定义导航的条数上限。再多一行放不下，窄屏会折成两三行 */
export const MAX_NAV = 6;

/** 友情链接的条数上限。页脚是一整排，超过这个数窄屏会折成三行 */
export const MAX_FRIENDS = 8;

/** 分类是自由文本，但给一组预设，避免同义分类散成七八个 */
export const MARKET_CATEGORIES = ['品牌', '工具', '数字', '生活', '其他'];

export const DEFAULT_MARKET = {
  enabled: false,
  title: '域名精选',
  intro: '',
  currency: 'CNY',
  contact: { wechat: '', email: '', telegram: '', community: '' },
  nav: [],
  friends: [],
  entries: []
};

const PRICE_TYPES = new Set(['fixed', 'inquire']);

function str(value, max) {
  if (value === null || value === undefined) return '';
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function toPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  // 上限拦住手滑输入的天文数字（也会把 1e21 这类序列化成科学计数法）
  return Math.min(Math.round(n * 100) / 100, 1e8);
}

/**
 * 归一化一条米表记录。域名不合法直接丢弃（返回 null），其余字段一律截断，
 * 因为这些东西最终会原样进 HTML。
 */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;

  let name;
  try {
    name = validateDomain(raw.name);
  } catch {
    return null;
  }

  const priceType = PRICE_TYPES.has(raw.priceType) ? raw.priceType : 'fixed';

  return {
    name,
    priceType,
    // 面议时价格没有意义，一律归零，免得后台改回一口价时冒出一个旧数字
    price: priceType === 'fixed' ? toPrice(raw.price) : 0,
    description: str(raw.description, 60),
    category: str(raw.category, 12),
    note: str(raw.note, 80),
    featured: raw.featured === true,
    order: Number.isFinite(Number(raw.order)) ? Math.trunc(Number(raw.order)) : 0
  };
}

/**
 * 链接项的公共归一化。
 *
 * URL 只允许两种形态：`http(s)://` 外链，或 `/` 开头的站内路径。
 * 这条限制是安全边界 —— 配置是管理员填的，但 `javascript:` / `data:` 会原样进
 * `href`，一旦哪天配置从别处来（导入、API 写入），就是一条现成的 XSS。
 * 顺手拦掉 `//host` 这种协议相对写法：它看着像站内路径，其实跳到别人的域名。
 */
function normalizeLink(raw, labelMax) {
  if (!raw || typeof raw !== 'object') return null;
  const label = str(raw.label, labelMax);
  const url = str(raw.url, 200);
  if (!label || !url) return null;
  if (!/^(https?:\/\/[^\s]+|\/(?!\/)[^\s]*)$/i.test(url)) return null;
  return { label, url };
}

/** 归一化一条自定义导航（顶栏那一排，标签要短） */
export function normalizeNavItem(raw) {
  return normalizeLink(raw, 12);
}

/** 归一化一条友情链接（页脚那一排，对方站点名通常比导航词长） */
export function normalizeFriendItem(raw) {
  return normalizeLink(raw, 20);
}

/** 归一化整个配置：去重（同名取第一条）、截断、兜底默认值 */
export function normalizeMarketConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const contact = source.contact && typeof source.contact === 'object' ? source.contact : {};

  const nav = [];
  for (const item of Array.isArray(source.nav) ? source.nav : []) {
    const link = normalizeNavItem(item);
    if (link) nav.push(link);
    if (nav.length >= MAX_NAV) break;
  }

  // 友情链接与导航同构，但独立成字段：导航挂在顶栏（站内导航语义），
  // 友情链接挂在页脚。混用一个字段会导致「加一个友链，顶栏也多一项」
  const friends = [];
  for (const item of Array.isArray(source.friends) ? source.friends : []) {
    const link = normalizeFriendItem(item);
    if (link) friends.push(link);
    if (friends.length >= MAX_FRIENDS) break;
  }

  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(source.entries) ? source.entries : []) {
    const entry = normalizeEntry(item);
    if (!entry || seen.has(entry.name)) continue;
    seen.add(entry.name);
    entries.push(entry);
    if (entries.length >= MAX_ENTRIES) break;
  }

  // 交流社区只认 http(s) 开头。这一栏会原样进 href：
  //   javascript:alert(1)   → 一条现成的 XSS
  //   @niepanxiaomibot      → 被浏览器当相对路径，跳到 /@niepanxiaomibot（404）
  // 两种都不是填的人想要的，直接丢掉比留着强。
  // 老配置里这一栏叫 url（「联系链接」），语义没变，沿用同一个值
  const rawUrl = str(contact.community || contact.url, 200);
  const community = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';

  return {
    enabled: source.enabled === true,
    title: str(source.title, 40) || DEFAULT_MARKET.title,
    intro: str(source.intro, 200),
    currency: 'CNY',
    contact: {
      // 微信：微信号，或者一张二维码图片的地址
      wechat: str(contact.wechat, 40),
      email: str(contact.email, 80),
      // Telegram：@用户名 / t.me 链接 / 二维码图片地址，三种都由渲染层认
      telegram: str(contact.telegram, 40),
      community
    },
    nav,
    friends,
    entries
  };
}

export async function loadMarketConfig(kv) {
  const stored = await readConfig(kv, MARKET_KEY, null);
  if (!stored || typeof stored !== 'object') {
    return normalizeMarketConfig(null);
  }
  return normalizeMarketConfig(stored);
}

export async function saveMarketConfig(kv, input) {
  const next = normalizeMarketConfig(input);
  await writeConfig(kv, MARKET_KEY, next);
  return next;
}

/**
 * 展示顺序：精品在前 → 手排的 order 小的在前 → 域名短的在前面。
 * 最后一条不是随手加的：域名越短越值钱，长度相同再按字母排，保证结果稳定。
 */
export function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    if (a.name.length !== b.name.length) return a.name.length - b.name.length;
    return a.name.localeCompare(b.name);
  });
}

/** 价格展示文案：一口价带千分位，面议就写「价格面议」 */
export function formatPrice(entry) {
  if (!entry || entry.priceType !== 'fixed') return '价格面议';
  const amount = Number(entry.price) || 0;
  if (amount <= 0) return '价格面议';
  return '¥ ' + amount.toLocaleString('zh-CN');
}
