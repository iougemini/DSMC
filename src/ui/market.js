// 米表公开页（/market）
//
// 这是一张**完全公开**的页面：任何人打开都能看到域名、注册日、到期日与报价。
// 因此这里有一条铁律 ——
//
//   页面上的每一个字段都必须来自 market-store 的归一化结果 + 域名日期，
//   不允许把域名对象整个透传进来。registrar / account / notes / whoisError
//   这些字段一旦漏进来，就会出现在公网上，而且不会有任何报错提醒你。
//
// 页面不依赖客户端脚本也能读完（卡片是服务端渲染的），JS 只负责分类筛选、
// 明暗切换和二维码弹层。这样即使 JS 被拦，买家仍然能看到全部信息。

import { escapeHtml as esc } from './data.js';
import { icon } from './icons.js';
import { FAVICON_LINK, THEME_COLOR_META } from './favicon.js';
import { FOOTER_CSS, footerHtml } from './footer.js';
import { formatPrice, sortEntries } from '../managers/market-store.js';

export const MARKET_CSS = `
*{box-sizing:border-box}
:root{--bg:#070A0F;--surface:#0E131B;--surface-2:#141B26;--border:rgba(255,255,255,.08);
--text:#E7ECF3;--text-2:#9AA6B8;--text-3:#6B7789;--accent:#5F9BFF;--accent-2:#8FB8FF;
--ok:#34D399;--warn:#FBBF24;--radius:16px;--shadow:0 18px 50px rgba(0,0,0,.55);
--grid:rgba(255,255,255,.07);--glow:rgba(116,166,255,.4)}
[data-theme="light"]{--bg:#F6F7F9;--surface:#FFFFFF;--surface-2:#F0F3F8;--border:rgba(15,23,42,.09);
--text:#0F172A;--text-2:#4A5568;--text-3:#8A94A6;--accent:#2F6BE8;--accent-2:#1E4FBF;
--shadow:0 18px 50px rgba(15,23,42,.18);--grid:rgba(15,23,42,.07);--glow:rgba(255,255,255,1)}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
/* 背景不是纯色：顶部一团柔光，往下压一层极淡的网格并在中段渐隐。
   纯色大留白看着单调，加这两层又不该抢内容 —— 网格不透明度 7% 是看截图定的
   （4.5% 在深色背景上截出来和纯色一模一样） */
body::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
background:
radial-gradient(1100px 560px at 50% -4%,var(--glow),transparent 72%),
repeating-linear-gradient(to right,var(--grid) 0 1px,transparent 1px 72px),
repeating-linear-gradient(to bottom,var(--grid) 0 1px,transparent 1px 72px);
-webkit-mask-image:radial-gradient(ellipse 82% 64% at 50% 0%,#000 28%,transparent 82%);
mask-image:radial-gradient(ellipse 82% 64% at 50% 0%,#000 28%,transparent 82%)}
a{color:inherit;text-decoration:none}
.wrap{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:34px 20px 60px}

/* 头部：左边 LOGO，右边标题在上、介绍在下；联系方式另起一行 */
/* position:relative 是给窄屏下的主题按钮用的：手机上按钮改成 absolute，
   定位基准就是这个头部卡片，落在卡片右上角内侧而不是压在描边上 */
.mhead{position:relative;margin-bottom:22px}
.mhrow{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.mbrand{display:inline-flex;align-items:center;gap:11px;flex:none}
.mbrand .mark{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;
background:linear-gradient(180deg,#5F9BFF,#2F6BE8);color:#fff;flex:none}
.mbrand b{font-size:22px;font-weight:650;letter-spacing:.2px}
/* 右内边距是给右上角那个明暗切换按钮留的位置。
   标题改成右对齐后会一路顶到容器右边缘，而按钮是 fixed 定位，
   视口宽度不到 1180px 时两者就会重叠 —— 截图里能看到按钮压在标题上 */
.mhtext{flex:1 1 260px;min-width:0;text-align:right;padding-right:44px}
.mhead h1{margin:0;font-size:26px;line-height:1.25;letter-spacing:-.4px;font-weight:650}
.mhead .intro{margin:4px 0 0;color:var(--text-2);font-size:13.5px;line-height:1.55}

.contacts{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:14px}
.contact-list{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:1 1 auto;min-width:0}
.contact{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;
border:1px solid var(--border);background:var(--surface);color:var(--text-2);font-size:12.5px;
font-family:inherit;line-height:1}
.contact:hover{color:var(--text);border-color:rgba(95,155,255,.45)}
.contact b{color:var(--text);font-weight:600}
button.contact{cursor:pointer}
.contact.login{flex:none;margin-left:auto;color:var(--text-3)}

/* 明暗切换 */
.themebtn{position:fixed;top:16px;right:16px;z-index:40;width:34px;height:34px;display:grid;place-items:center;
border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;
transition:color .16s,border-color .16s}
.themebtn:hover{color:var(--text);border-color:rgba(95,155,255,.45)}
.themebtn .sun{display:none}
[data-theme="light"] .themebtn .sun{display:block}
[data-theme="light"] .themebtn .moon{display:none}
.themebtn .spark{display:none}
[data-theme="neo"] .themebtn .spark{display:block}
[data-theme="neo"] .themebtn .moon{display:none}

/* 分区 */
.mblock{margin-bottom:30px}
.mblock[hidden]{display:none}
.mblock-head{display:flex;align-items:baseline;gap:9px;margin-bottom:12px}
.mblock-head h2{margin:0;font-size:16px;font-weight:650;letter-spacing:-.2px}
.mblock-head .mcount{font-size:12px;color:var(--text-3);font-variant-numeric:tabular-nums}

.mfilters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 22px}
.mfilter{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--border);background:transparent;
color:var(--text-2);font-size:12.5px;cursor:pointer;font-family:inherit;transition:all .16s}
.mfilter:hover{background:var(--surface-2);color:var(--text)}
.mfilter.on{background:var(--text);color:var(--bg);border-color:var(--text)}

.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(288px,1fr));gap:12px}
.mcard{position:relative;display:flex;flex-direction:column;gap:10px;padding:16px 16px 14px;
border:1px solid var(--border);border-radius:10px;background:var(--surface);transition:transform .18s,border-color .18s}
.mcard:hover{transform:translateY(-2px);border-color:rgba(95,155,255,.4)}
[data-theme="light"] .mcard{box-shadow:0 1px 2px rgba(15,23,42,.05)}
.mcard[hidden]{display:none}
.mtop{display:flex;align-items:center;gap:6px;min-height:20px}
.badge{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:6px;
background:rgba(251,191,36,.14);color:var(--warn);letter-spacing:.3px}
.cat{font-size:10.5px;padding:2px 7px;border-radius:6px;background:var(--surface-2);color:var(--text-3)}
.mname{margin:0;font-size:20px;font-weight:640;letter-spacing:-.3px;word-break:break-all;line-height:1.3}
.mname span{color:var(--text-3);font-weight:500}
.mdesc{margin:0;color:var(--text-2);font-size:12.5px;min-height:19px}
.mmeta{display:flex;gap:14px;margin:2px 0 0;padding:0;flex-wrap:wrap}
.mmeta div{display:flex;gap:5px;align-items:baseline}
.mmeta dt{font-size:11px;color:var(--text-3)}
.mmeta dd{margin:0;font-size:12px;color:var(--text-2);font-variant-numeric:tabular-nums}
.mfoot{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:auto;padding-top:8px;
border-top:1px solid var(--border)}
.price{font-size:17px;font-weight:650;letter-spacing:-.2px}
.price.inquire{font-size:13px;font-weight:500;color:var(--text-2)}
.mnote{font-size:11.5px;color:var(--text-3);text-align:right;max-width:50%}

.mempty{margin:40px 0;padding:44px 20px;text-align:center;border:1px dashed var(--border);border-radius:var(--radius);background:var(--surface)}
.mempty .ico{display:grid;place-items:center;width:44px;height:44px;margin:0 auto 12px;border-radius:14px;
background:var(--surface-2);color:var(--text-3)}
.mempty b{display:block;font-size:15px;margin-bottom:6px}
.mempty p{margin:0;color:var(--text-3);font-size:12.5px}
.site-foot{margin-top:44px;padding-top:18px;border-top:1px solid var(--border)}

/* Telegram 二维码弹层 */
.qrbox{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:20px;
background:rgba(3,6,12,.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.qrbox[hidden]{display:none}
.qrcard{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:14px 14px 12px;
box-shadow:var(--shadow);text-align:center;max-width:min(300px,86vw)}
.qrcard img{display:block;width:228px;height:228px;max-width:100%;object-fit:contain;border-radius:10px;background:#fff}
.qrcard small{display:block;margin-top:9px;font-size:12px;color:var(--text-3)}
.qrcard .qrid{margin:9px 0 0;font-size:13px;color:var(--text-2)}
.qrcard .qrid b{color:var(--text)}

/* ────────────────────────────────────────────────────────────
   第三套主题：neo（奶油底 + 黑描边 + 硬投影 + 荧光笔 + 多彩点缀）
   灵感是 ip.fs.kg 那种"印刷品"观感：没有柔和阴影、没有半透明，
   所有边界都是 1.5–2px 实线，投影是硬偏移的纯色块。
   变量先落一遍，细节再逐条覆盖 —— 只改变量做不出硬投影和描边。

   颜色策略：黑描边是骨架，颜色只做"贴纸"——面积小、饱和度中等偏上，
   靠数量出活泼感。所以徽标、分类、胶囊、按钮各占一种色，卡片本身仍是奶油色；
   如果反过来给卡片上色，一屏十几张就会变成调色盘。
   ──────────────────────────────────────────────────────────── */
[data-theme="neo"]{--bg:#F4EFE3;--surface:#FFFCF3;--surface-2:#F7F1E3;--border:#141210;
--text:#141210;--text-2:#4C463C;--text-3:#8B8375;--accent:#6B4EE6;--accent-2:#141210;
--ok:#1F9D55;--warn:#C2410C;--radius:14px;--shadow:4px 4px 0 #141210;
--grid:transparent;--glow:transparent;--hl:#F7E85B;--edge:#141210;
--lime:#C8F169;--sky:#8FD8F2;--pink:#FFA9C9;--sand:#FFD166;--lilac:#C3B4FF;--mint:#7FE3B0;
--panel:#EDE6FF}
/* 背景换成点阵：原先是"柔光 + 网格 + 中段渐隐"，那套在浅色奶油底上
   会糊成一片脏色。点阵用 1px 圆点 + 13% 不透明度，远看是纸的纹理 */
[data-theme="neo"] body::before{background:radial-gradient(var(--edge) 1px,transparent 1.4px) 0 0/16px 16px;
opacity:.13;-webkit-mask-image:none;mask-image:none}

[data-theme="neo"] .mhead{background:var(--surface);border:2px solid var(--edge);border-radius:16px;
box-shadow:5px 5px 0 var(--edge);padding:18px 22px 16px;margin-bottom:20px}
[data-theme="neo"] .mbrand .mark{background:var(--accent);color:#fff;border:2px solid var(--edge);
border-radius:12px;box-shadow:3px 3px 0 var(--edge)}
[data-theme="neo"] .mbrand b{font-size:23px;font-weight:800;letter-spacing:-.6px}
/* 标题做成荧光笔划过的样子：display:inline + box-decoration-break 才能让
   长标题换行时每一行都带上高亮，用 background 铺在块级元素上只会盖住整块 */
[data-theme="neo"] .mhead h1{display:inline;font-size:27px;font-weight:800;letter-spacing:-.7px;
background:linear-gradient(transparent 16%,var(--hl) 16%,var(--hl) 92%,transparent 92%);
box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 3px}
[data-theme="neo"] .mhead .intro{margin-top:7px;font-size:13px;color:var(--text-2)}

/* 卡片内边距比原版宽，一排胶囊加登录按钮差 50px 放不下，会多占一行。
   字号收 0.5px、内边距收 2px 正好补回来；用户配更多链接时仍然会换行，
   那时登录按钮独占一行靠右，也是能看的 */
[data-theme="neo"] .contact{border:1.5px solid var(--edge);background:var(--surface);color:var(--text-2);
box-shadow:2px 2px 0 var(--edge);font-weight:500;font-size:12px;padding:0 9px}
/* 四个固定联系方式各给一层浅色底：一眼能分出"这是微信、那是邮箱"，
   比四个一模一样的白胶囊好扫。底色都压得很浅，黑描边仍然压得住 */
[data-theme="neo"] .contact[data-kind="wechat"]{background:#DDF7C6}
[data-theme="neo"] .contact[data-kind="mail"]{background:#D9EBFF}
[data-theme="neo"] .contact[data-kind="telegram"]{background:#D3F0FA}
[data-theme="neo"] .contact[data-kind="community"]{background:#E8DDFF}
[data-theme="neo"] .contact:hover{background:var(--hl);color:var(--text);border-color:var(--edge);
transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--edge)}
[data-theme="neo"] .contact b{color:var(--text);font-weight:700}
/* 「查看域名详情」做成实心紫胶囊：参考站里最重的那个按钮是紫底白字的，
   黑色留给文字和描边，主按钮再黑下去整页就没有"行动点"了 */
[data-theme="neo"] .contact.login{background:var(--accent);color:#fff;border-color:var(--edge)}
[data-theme="neo"] .contact.login:hover{background:#5A3ED6;color:#fff;box-shadow:3px 3px 0 var(--edge)}

[data-theme="neo"] .themebtn{border:2px solid var(--edge);background:var(--surface);color:var(--edge);
border-radius:10px;box-shadow:3px 3px 0 var(--edge)}
[data-theme="neo"] .themebtn:hover{background:var(--hl);border-color:var(--edge)}

[data-theme="neo"] .mblock-head h2{font-weight:800;letter-spacing:0}
[data-theme="neo"] .mblock-head h2::before{content:'';display:inline-block;width:10px;height:10px;
margin-right:8px;border:1.5px solid var(--edge);border-radius:3px;background:var(--lime)}
[data-theme="neo"] .mblock-head .mcount{font-weight:600;color:var(--text-3)}
/* 精品区整块铺淡紫，是整页面积最大的一处颜色 —— 参考站的右栏就是一块紫。
   卡片在里面仍然是奶油色，对比之下"挑出来的"这件事一眼就能看到 */
[data-theme="neo"] .mblock-featured{background:var(--panel);border:2px solid var(--edge);
border-radius:18px;box-shadow:5px 5px 0 var(--edge);padding:16px 16px 12px;margin-bottom:26px}
[data-theme="neo"] .mblock-featured .mblock-head h2::before{background:var(--accent)}
[data-theme="neo"] .mblock-featured .mgrid{gap:14px}

[data-theme="neo"] .mfilter{border:1.5px solid var(--edge);background:var(--surface);color:var(--text-2);
box-shadow:2px 2px 0 var(--edge);font-weight:600}
[data-theme="neo"] .mfilter:hover{background:var(--hl);color:var(--text)}
/* 选中的筛选用柠檬绿而不是黑：黑色已经是描边和正文的颜色，
   再拿它当选中态，一排按钮里看不出哪个是当前的 */
[data-theme="neo"] .mfilter.on{background:var(--lime);color:var(--edge);box-shadow:2px 2px 0 var(--edge)}

[data-theme="neo"] .mcard{border:2px solid var(--edge);border-radius:14px;background:var(--surface);
box-shadow:4px 4px 0 var(--edge);transform:none}
[data-theme="neo"] .mcard:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--edge);border-color:var(--edge)}
[data-theme="neo"] .badge{background:var(--lime);color:var(--edge);border:1.5px solid var(--edge);
border-radius:6px;font-weight:700}
/* 分类标签按分类名散列到 5 种色（见 toneOf）：同一个分类全页同色，
   不同分类彼此区分。黑色描边保证再浅的底也不会糊进卡片背景 */
[data-theme="neo"] .cat{border:1.5px solid var(--edge);background:transparent;color:var(--edge);font-weight:600}
[data-theme="neo"] .cat[data-tone="0"]{background:var(--lime)}
[data-theme="neo"] .cat[data-tone="1"]{background:var(--sky)}
[data-theme="neo"] .cat[data-tone="2"]{background:var(--pink)}
[data-theme="neo"] .cat[data-tone="3"]{background:var(--sand)}
[data-theme="neo"] .cat[data-tone="4"]{background:var(--lilac)}
[data-theme="neo"] .mname{font-size:21px;font-weight:800;letter-spacing:-.6px}
[data-theme="neo"] .mname span{color:var(--text-3);font-weight:600}
[data-theme="neo"] .mdesc{color:var(--text-2);font-size:12.5px}
[data-theme="neo"] .mmeta dt{font-size:10px;letter-spacing:.09em;text-transform:uppercase}
[data-theme="neo"] .mmeta dd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:600;color:var(--text-2)}
[data-theme="neo"] .mfoot{border-top:1.5px solid rgba(20,18,16,.18)}
/* 价格用荧光笔划一道，而不是加边框：每张卡都套个黄框太吵，
   划一道既醒目又只占一行文字的高度 */
[data-theme="neo"] .price{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
font-weight:800;letter-spacing:-.3px;padding:0 2px;
background:linear-gradient(transparent 56%,var(--hl) 56%,var(--hl) 94%,transparent 94%)}
[data-theme="neo"] .price.inquire{background:none;font-weight:600;color:var(--accent)}

[data-theme="neo"] .mempty{border:2px dashed var(--edge);background:var(--surface)}
[data-theme="neo"] .mempty .ico{border:1.5px solid var(--edge);background:var(--hl);color:var(--edge);border-radius:10px}
[data-theme="neo"] .qrbox{background:rgba(20,18,16,.5)}
[data-theme="neo"] .qrcard{border:2px solid var(--edge);border-radius:16px;box-shadow:6px 6px 0 var(--edge)}

@media (max-width:560px){
  .wrap{padding:22px 14px 44px}
  .mhrow{gap:10px}
  .mhrow{gap:10px}
  .mhtext{flex-basis:100%;text-align:left}
  .mhead h1{font-size:21px}
  .mgrid{grid-template-columns:1fr;gap:10px}
  /* 精品区在手机上改横向滑动：它和全部区内容重复，纵向铺开会把页面拉长一倍 */
  .mgrid[data-block="featured"]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;
    margin:0 -14px;padding:2px 14px 6px;-webkit-overflow-scrolling:touch}
  .mgrid[data-block="featured"] .mcard{flex:0 0 76%;scroll-snap-align:start}
  .mgrid[data-block="featured"] .mcard:hover{transform:none}
  /* 精品区是块带内边距的卡片，横向滑动不能再往视口外出血，否则会溢出面板描边 */
  [data-theme="neo"] .mblock-featured{padding:14px 12px 2px;margin-bottom:22px}
  [data-theme="neo"] .mblock-featured .mgrid[data-block="featured"]{margin:0;padding:2px 0 8px}
  .mcard{padding:14px}
  .mname{font-size:18px}
  /* 手机上胶囊独占一行，登录按钮自然落到下一行右侧 —— 和改版前观感一致 */
  .contact-list{flex:1 1 100%}
  /* 窄屏不再 fixed 贴视口：头部卡片是满宽的，按钮压在卡片右上角的描边上，
     neo 主题下那条 2px 黑边被切断，看着像缺了个角。
     改成卡片内 absolute，位置一样但不再破坏轮廓 */
  .themebtn{position:absolute;top:10px;right:10px}
  .mhtext{padding-right:0}
  .mbrand{padding-right:42px}
}
`;

/** 域名拆成「关键词 + 后缀」，让后缀弱化显示 —— 一眼能读出名字本身 */
export function splitDomain(name) {
  const s = String(name || '');
  const i = s.indexOf('.');
  if (i <= 0) return { keyword: s, suffix: '' };
  return { keyword: s.slice(0, i), suffix: s.slice(i) };
}

function dateText(value) {
  if (!value || value === 'Unknown' || value === 'Error') return '—';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '—';
}

/**
 * 微信 / Telegram 这一栏既可能是账号，也可能是一张二维码图片的地址。
 *
 * 但 `https://t.me/xxx` 是个例外：那是**联系人页**，不是图片。填完整链接的人
 * 意思是"点进去聊"，把它当二维码渲染成「扫码」按钮就完全跑偏了 —— 点开是一张
 * 加载失败的图。所以这里要把它排除掉。
 */
export function isQrUrl(value) {
  const s = String(value || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/^https?:\/\/(www\.)?t\.me\//i.test(s)) return false;
  return true;
}

/** 站内路径不加 target，外链才新开窗口 —— 否则点「返回首页」会多一个标签页 */
function isExternalLink(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/** 友情链接的图标：认得出 GitHub 就用它的图标，其余统一用链接图标 */
function navIcon(url, label) {
  const s = String(url || '') + ' ' + String(label || '');
  return /github/i.test(s) ? 'github' : 'link';
}

/**
 * 从填的内容里认出 Telegram 用户名。
 *
 * 用户会填出各种形态，这里统一收成"用户名"：
 *
 *   @niepanxiaomibot              → niepanxiaomibot
 *   @//niepanxiaomibot/           → niepanxiaomibot   （从地址栏粘下来的脏值）
 *   t.me/niepanxiaomibot          → niepanxiaomibot
 *   https://t.me/niepanxiaomibot  → niepanxiaomibot
 *   我的电报                       → ''                （认不出，退化成纯文本）
 *
 * 认不出就返回空串。绝不硬编一个 t.me 地址 —— 那样点过去必然 404，比不可点更糟。
 */
function telegramHandle(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // 带 t.me/ 的直接取那一段，免得 "t.me/abc" 被拼成 "t.me/tmeabc"
  const linked = raw.match(/t\.me\/([A-Za-z0-9_]+)/i);
  const name = linked
    ? linked[1]
    : raw.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '');

  return name.length >= 3 && name.length <= 32 ? name : '';
}

function contactChips(contact, nav) {
  const c = contact || {};
  const chips = [];

  // 四项固定顺序：微信 → 邮箱 → Telegram → 交流社区。
  // 顺序写死，不按"哪个有值就往前排" —— 位置固定，买家扫一眼就知道去哪找
  if (c.wechat) {
    const wx = String(c.wechat).trim();
    if (isQrUrl(wx)) {
      // 二维码图片：点击弹层展示，不直接外链跳走（买家多半在手机上，跳走就回不来了）
      chips.push('<button type="button" class="contact" data-kind="wechat" data-qr="' + esc(wx) + '" ' +
        'aria-label="查看微信二维码">' + icon('wechat', 14) + '微信 <b>扫码</b></button>');
    } else {
      chips.push('<span class="contact" data-kind="wechat">' + icon('wechat', 14) + '微信 <b>' + esc(wx) + '</b></span>');
    }
  }

  if (c.email) {
    chips.push('<a class="contact" data-kind="mail" href="mailto:' + esc(c.email) + '">' + icon('mail', 14) +
      '<b>' + esc(c.email) + '</b></a>');
  }

  if (c.telegram) {
    const tg = String(c.telegram).trim();
    if (isQrUrl(tg)) {
      chips.push('<button type="button" class="contact" data-kind="telegram" data-qr="' + esc(tg) + '" ' +
        'aria-label="查看 Telegram 二维码">' + icon('telegram', 14) + 'Telegram <b>扫码</b></button>');
    } else {
      const handle = telegramHandle(tg);
      // 显示的是**规范化之后**的用户名，不是用户输入的原文。
      // 原文可能是 @//xxx/ 或 https://t.me/xxx，照原样显示在公开页上很难看
      chips.push(handle
        ? '<a class="contact" data-kind="telegram" href="https://t.me/' + handle + '" target="_blank" rel="noopener noreferrer">' +
          icon('telegram', 14) + '<b>@' + esc(handle) + '</b></a>'
        : '<span class="contact" data-kind="telegram">' + icon('telegram', 14) + 'Telegram <b>' + esc(tg) + '</b></span>');
    }
  }

  // 交流社区。归一化里已经过滤过一次，这里再判一次 —— 渲染层也可能被直接调用
  // （测试、预览脚本），纵深防御比"相信上游"便宜
  if (c.community && /^https?:\/\//i.test(String(c.community))) {
    chips.push('<a class="contact" data-kind="community" href="' + esc(c.community) + '" target="_blank" rel="noopener noreferrer">' +
      icon('community', 14) + '交流社区</a>');
  }

  // 友情链接：每个都带图标，否则一列纯文字胶囊看着像面包屑，分不出是可点的外链
  for (const item of Array.isArray(nav) ? nav : []) {
    const ext = isExternalLink(item.url);
    chips.push('<a class="contact nav" data-kind="nav" href="' + esc(item.url) + '"' +
      (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
      icon(navIcon(item.url, item.label), 14) + esc(item.label) + '</a>');
  }

  // 只服务买家：这里去普通用户登录页（管理员入口在登录页里），
  // 不把管理员登录直接摆在公网上
  const login = '<a class="contact login" href="/login" title="登录后查看域名详情">' +
    icon('search', 13) + '查看域名详情</a>';

  // 联系方式和「查看域名详情」分成两组：胶囊自己换行，登录按钮不跟着换。
  // 混在一组里时，导航链接多一条就会把按钮挤到下一行，左边留一大片空白 ——
  // 这跟用户配了几条链接有关，靠调字距是调不稳的
  return '<div class="contacts">' +
      '<div class="contact-list">' + chips.join('') + '</div>' +
      login +
    '</div>';
}

/**
 * 分类名 → 0..4 的色号。
 *
 * 同一个分类在整页永远是同一个颜色（"品牌"不会一会儿绿一会儿粉），
 * 换个分类换一种色，卡片区就有了颜色差。用字符编码求和而不是随机：
 * 渲染两次必须得到同一个结果，否则每次刷新页面颜色都在跳。
 */
export function toneOf(text) {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.codePointAt(0)) % 9973;
  return h % 5;
}

function cardHtml(item) {
  const { keyword, suffix } = splitDomain(item.name);
  const fixed = item.priceType === 'fixed' && Number(item.price) > 0;

  return '<article class="mcard" data-category="' + esc(item.category || '') + '">' +
      '<div class="mtop">' +
        (item.featured ? '<span class="badge">精品</span>' : '') +
        (item.category
          ? '<span class="cat" data-tone="' + toneOf(item.category) + '">' + esc(item.category) + '</span>'
          : '') +
      '</div>' +
      '<h3 class="mname">' + esc(keyword) + '<span>' + esc(suffix) + '</span></h3>' +
      (item.description ? '<p class="mdesc">' + esc(item.description) + '</p>' : '<p class="mdesc"></p>') +
      '<dl class="mmeta">' +
        '<div><dt>注册</dt><dd>' + dateText(item.registrationDate) + '</dd></div>' +
        '<div><dt>到期</dt><dd>' + dateText(item.expirationDate) + '</dd></div>' +
      '</dl>' +
      '<div class="mfoot">' +
        '<span class="price' + (fixed ? '' : ' inquire') + '">' + esc(formatPrice(item)) + '</span>' +
        (item.note ? '<span class="mnote">' + esc(item.note) + '</span>' : '') +
      '</div>' +
    '</article>';
}

/** 三套主题的顺序。按钮点一下往后走一格，到末尾回到深色 */
const THEMES = ['dark', 'light', 'neo'];

function themeButton() {
  return '<button type="button" class="themebtn" id="themebtn" aria-label="切换主题（深色 / 浅色 / 米表主题）">' +
    '<span class="moon">' + icon('moon', 15) + '</span>' +
    '<span class="sun">' + icon('sun', 15) + '</span>' +
    '<span class="spark">' + icon('spark', 15) + '</span>' +
  '</button>';
}

/**
 * 首屏定主题，必须在 <head> 里跑，否则会先看到一帧深色再跳到奶油色。
 *
 * 米表用**自己的**存储键 `dsmc-market-theme`：面板只有深/浅两套 CSS，
 * 把 neo 写进共用的 `dsmc-theme` 会让后台拿到一个没有变量的主题，整页塌掉。
 * 没设置过时回落到 `dsmc-theme`，老用户升级上来看到的样子不变。
 */
function themeBootScript() {
  return '<script>try{var t=localStorage.getItem("dsmc-market-theme")||localStorage.getItem("dsmc-theme");' +
    'if(t)document.documentElement.dataset.theme=t;}catch(e){}</script>';
}

function themeToggleScript() {
  return 'var root=document.documentElement,btn=document.getElementById("themebtn");' +
    'var order=' + JSON.stringify(THEMES) + ';' +
    'if(btn)btn.addEventListener("click",function(){' +
      'var i=order.indexOf(root.dataset.theme);' +
      'var t=order[(i+1)%order.length];' +
      'root.dataset.theme=t;' +
      'try{localStorage.setItem("dsmc-market-theme",t);}catch(e){}});';
}

function qrOverlay() {
  return '<div class="qrbox" id="qrbox" hidden>' +
    '<div class="qrcard" role="dialog" aria-label="Telegram 二维码">' +
      '<img id="qrimg" alt="Telegram 二维码">' +
      '<small>扫码在 Telegram 里添加，或长按识别</small>' +
    '</div>' +
  '</div>';
}

function pageShell({ project, version, title, body, extraCss }) {
  return '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="dark">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<meta name="color-scheme" content="dark light">\n' +
    '<meta name="description" content="' + esc(project.DESCRIPTION || '') + '">\n' +
    '<title>' + esc(title) + '</title>\n' +
    FAVICON_LINK + THEME_COLOR_META +
    // 主题在 <head> 里就定下来，避免亮色用户先看到一帧深色
    themeBootScript() + '\n' +
    '<style>' + MARKET_CSS + FOOTER_CSS + (extraCss || '') + '</style>\n' +
    '</head>\n<body>\n' + body + '\n</body>\n</html>';
}

/**
 * 米表主体。
 * @param {{project: object, version: string, config: object, items: Array}} options
 *        items 里每项只需 name / registrationDate / expirationDate + 米表字段，
 *        由调用方按白名单组装
 */
export function marketHtml({ project, version, config, items }) {
  const list = sortEntries(items || []);
  const featured = list.filter(i => i.featured);
  const categories = Array.from(new Set(list.map(i => i.category).filter(Boolean)));

  const filters = categories.length > 1
    ? '<div class="mfilters">' +
        '<button type="button" class="mfilter on" data-cat="">全部 <span>' + list.length + '</span></button>' +
        categories.map(c => '<button type="button" class="mfilter" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') +
      '</div>'
    : '';

  // 精品区是曝光位，全部区是完整清单（含精品）。两区都服务端渲染，
  // 买家在同一个页面里既能先看到挑出来的，也能翻完整列表
  const featuredBlock = featured.length
    ? '<section class="mblock mblock-featured">' +
        '<div class="mblock-head"><h2>精品域名</h2>' +
          '<span class="mcount">' + featured.length + ' 个</span>' +
          '</div>' +
        '<div class="mgrid" data-block="featured">' + featured.map(cardHtml).join('') + '</div>' +
      '</section>'
    : '';

  const allBlock = '<section class="mblock">' +
      '<div class="mblock-head"><h2>' + (featured.length ? '全部域名' : '在售域名') + '</h2>' +
        '<span class="mcount">' + list.length + ' 个</span></div>' +
      '<div class="mgrid" data-block="all">' + list.map(cardHtml).join('') + '</div>' +
    '</section>';

  const body = '<div class="wrap">' +
      '<header class="mhead">' +
        // 按钮放在 header 内部：桌面端是 fixed 贴视口右上，窄屏下改成 absolute
        // 落在卡片右上角内侧 —— 放在 header 外面就只能相对 .wrap 定位，还是会压到描边
        themeButton() +
        '<div class="mhrow">' +
          '<span class="mbrand"><span class="mark">' + icon('shield', 26) + '</span>' +
            '<b>' + esc(project.NAME || 'DSMC') + '</b></span>' +
          '<div class="mhtext">' +
            '<h1>' + esc(config.title) + '</h1>' +
            (config.intro ? '<p class="intro">' + esc(config.intro) + '</p>' : '') +
          '</div>' +
        '</div>' +
        contactChips(config.contact, config.nav) +
      '</header>' +

      filters +
      featuredBlock +
      allBlock +
      footerHtml({ version, project, friends: config.friends }) +
    '</div>' +

    qrOverlay() +

    '<script>(function(){' +
      // 主题：深色 → 浅色 → 米表主题 → 深色
      themeToggleScript() +

      // 分类筛选：只是显隐，不改 DOM。精品区筛空时整块隐藏，避免留一个空标题
      'var bar=document.querySelector(".mfilters");' +
      'function apply(cat){' +
        'var f=0,a=0;' +
        'Array.prototype.forEach.call(document.querySelectorAll(".mcard"),function(c){' +
          'var ok=!cat||c.getAttribute("data-category")===cat;c.hidden=!ok;if(!ok)return;' +
          'if(c.closest("[data-block=featured]"))f++;else a++;});' +
        'var fs=document.querySelector("[data-block=featured]");' +
        'if(fs){var s=fs.closest(".mblock");s.hidden=f===0;' +
          'var n=s.querySelector(".mcount");if(n)n.textContent=f+" 个";}' +
        'var as=document.querySelector("[data-block=all]");' +
        'if(as){var n2=as.closest(".mblock").querySelector(".mcount");if(n2)n2.textContent=a+" 个";}}' +
      'if(bar)bar.addEventListener("click",function(e){' +
        'var b=e.target.closest("[data-cat]");if(!b)return;' +
        'Array.prototype.forEach.call(bar.querySelectorAll("[data-cat]"),function(x){' +
          'x.classList.toggle("on",x===b);});' +
        'apply(b.getAttribute("data-cat"));});' +

      // Telegram 二维码弹层
      'var box=document.getElementById("qrbox"),img=document.getElementById("qrimg");' +
      'function closeQr(){if(box)box.hidden=true;}' +
      'document.addEventListener("click",function(e){' +
        'var t=e.target.closest("[data-qr]");' +
        'if(t&&img&&box){img.src=t.getAttribute("data-qr");box.hidden=false;return;}' +
        'if(e.target===box)closeQr();});' +
      'document.addEventListener("keydown",function(e){if(e.key==="Escape")closeQr();});' +
    '})();</script>';

  return pageShell({
    project,
    version,
    title: config.title + ' · ' + (project.NAME || 'DSMC'),
    body
  });
}

/** 未启用 / 没有条目时的落地页 —— 不能让公开地址打开是白屏 */
export function marketEmptyHtml({ project, version, reason, friends }) {
  const body = '<div class="wrap">' +
      '<header class="mhead">' +
        themeButton() +
        '<div class="mhrow">' +
          '<span class="mbrand"><span class="mark">' + icon('shield', 26) + '</span>' +
            '<b>' + esc(project.NAME || 'DSMC') + '</b></span>' +
        '</div>' +
        contactChips({}, []) +
      '</header>' +
      '<div class="mempty">' +
        '<span class="ico">' + icon('inbox', 22) + '</span>' +
        '<b>' + esc(reason || '这里还没有开放域名出售') + '</b>' +
        '<p>如果你是本站管理员，登录后台在「米表」页选择要展示的域名。</p>' +
      '</div>' +
      footerHtml({ version, project, friends }) +
    '</div>' +

    '<script>(function(){' + themeToggleScript() + '})();</script>';

  return pageShell({
    project,
    version,
    title: (project.NAME || 'DSMC') + ' · ' + (project.FULL_NAME || ''),
    body
  });
}
