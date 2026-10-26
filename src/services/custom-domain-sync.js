// 把一次实时查询结果回写到自定义域名记录
//
// 单独成模块的原因：这套规则出错的后果是**静默的** —— 接口照样回 200、
// 前端照样提示「已更新」，只是 KV 里那条记录一动不动。用户只能靠
// 「标记已续费」绕过，而他不该需要知道那条路是唯一生效的路。
// 所以规则要能直接单测。

import { appState } from '../app-state.js';
import { mergeCustomDomainRecord } from './domain-merge.js';

/** 只有这些来源算"真的查到了"，注册表兜底值不写回数据库 */
export const LIVE_SOURCES = new Set(['rdap', 'dnshe', 'whois', 'whois-proxy']);

/** 没写进库、且值得让用户知道的原因。not-custom / saved 都是正常情况 */
export const SYNC_PROBLEMS = new Set(['no-live-data', 'missing', 'manual-frozen']);

/**
 * 把同步结果翻译成一句人话。
 *
 * 以前不管有没有写进库，接口一律回「信息已更新」——手动维护的域名被静默跳过时，
 * 用户点十次刷新也只会看到十次「已更新」，查不出问题在哪。
 */
export function syncNote(domain, sync) {
  switch (sync && sync.reason) {
    // 冻结的记录刷完数据仍然标着「手动维护」，用户会以为没生效 —— 说清楚
    case 'saved':
      return sync.frozen
        ? `域名 ${domain} 信息已更新（该域名设为手动维护，自动更新仍关闭）`
        : `域名 ${domain} 信息已更新`;
    // Cloudflare 域名 / 免费域名：结果只进缓存，本来就没有"落库"这一步
    case 'not-custom': return `域名 ${domain} 信息已更新`;
    case 'no-live-data': return `已查询 ${domain}，但没拿到可用的注册信息（检查 WHOIS 代理）`;
    case 'missing': return `已查询 ${domain}，但没有到期信息，请在编辑里补填`;
    case 'manual-frozen': return `${domain} 设为手动维护，查询结果未写入`;
    default: return `域名 ${domain} 已查询`;
  }
}

/**
 * 回写实时查询结果。
 *
 * 只在"确实查到了"时写：注册表兜底值（Auto-Renewal / 永久）拿来回写，
 * 会把用户手上真实的到期日覆盖成一句占位文本——v2.3.1 踩过这个坑。
 *
 * @param {string} domain
 * @param {object} info 实时查询结果
 * @param {{explicit?: boolean}} [options]
 *        explicit=true 表示用户自己点了「刷新」/「刷新 WHOIS」。这条路径
 *        **无视 autoUpdateWhois 冻结**：冻结针对的是自动更新（页面后台补全、
 *        Cron），不该拦住用户的明确要求。反过来，用户手工改过的日期也不会
 *        因为一次刷新就被"解冻"，自动更新仍然保持关闭。
 * @returns {Promise<{saved: boolean, reason: string}>}
 */
export async function syncCustomDomainFromLookup(domain, info, options = {}) {
  const explicit = options.explicit === true;

  // 先认记录再看数据：不是自定义域名（Cloudflare zone / 免费域名）时，
  // 查询结果本来就只进缓存，这不算"没写进库"，不该报成问题
  await appState.customDomainManager.loadFromKV();
  const existing = appState.customDomainManager.getDomain(domain);
  if (!existing) return { saved: false, reason: 'not-custom' };

  if (!info || !LIVE_SOURCES.has(info.dataSource)) {
    return { saved: false, reason: 'no-live-data' };
  }

  if (!explicit && existing.autoUpdateWhois === false) {
    return { saved: false, reason: 'manual-frozen' };
  }

  // 显式刷新以实时数据为准：传一个把 autoUpdateWhois 置真的影子记录给 merge，
  // 让它按「非手动」的规则取值。否则 dataSource 会被写成 manual、lookupStatus
  // 写成 manual，刚从 WHOIS 拿到的数据在界面上还标着「手动维护」。
  // 只影响这一次合并 —— KV 里的 autoUpdateWhois 不动，用户的手动维护意图保留
  const source = explicit ? { ...existing, autoUpdateWhois: true } : existing;
  const merged = mergeCustomDomainRecord(source, info);
  if (merged.lookupStatus === 'missing') return { saved: false, reason: 'missing' };

  await appState.customDomainManager.updateDomain(domain, {
    registrar: merged.registrar,
    registrationDate: merged.registrationDate,
    expirationDate: merged.expirationDate,
    nameServers: merged.nameServers,
    dataSource: merged.dataSource,
    isPermanent: merged.isPermanent,
    lookupStatus: 'ok',
    lookupError: null,
    lastWhoisUpdate: new Date().toISOString()
  });
  // frozen 只用来拼提示文案：数据写了，但自动更新仍然是关的
  return { saved: true, reason: 'saved', frozen: existing.autoUpdateWhois === false };
}
