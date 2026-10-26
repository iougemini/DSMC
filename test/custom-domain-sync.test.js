// 实时查询结果回写自定义域名
//
// 这套规则出错是**静默的**：接口回 200、前端提示「已更新」，KV 里那条记录却
// 一动不动。用户只能靠「标记已续费」绕过，而他不该需要知道那条路是唯一生效的路。
// 所以每个分支都要钉住。

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeKV } from './_fake-kv.js';
import { appState } from '../src/app-state.js';
import { CustomDomainManager } from '../src/managers/custom-domain.js';
import {
  syncCustomDomainFromLookup,
  syncNote,
  SYNC_PROBLEMS
} from '../src/services/custom-domain-sync.js';

const LIVE = {
  registrar: 'DNSPod, Inc.',
  registrationDate: '2020-11-11',
  expirationDate: '2027-11-11',
  nameServers: ['ns1.example.com'],
  dataSource: 'whois-proxy'
};

/** 造一个只含一条自定义域名的 KV + 管理器 */
function setup(record = {}) {
  const base = {
    registrar: 'Unknown',
    registrationDate: 'Unknown',
    expirationDate: 'Unknown',
    nameServers: [],
    status: 'Active',
    notes: '',
    lookupStatus: 'missing',
    lookupError: null,
    dataSource: null,
    isPermanent: false,
    addedDate: '2026-01-01T00:00:00.000Z',
    isCustomDomain: true,
    ...record
  };
  const kv = fakeKV({
    custom_domains: JSON.stringify({ domains: [['imgbed.top', base]], lastUpdated: 1 })
  });
  appState.env = { DOMAIN_INFO: kv };
  appState.customDomainManager = new CustomDomainManager();
  return { kv, manager: appState.customDomainManager };
}

const readRecord = async () => {
  await appState.customDomainManager.loadFromKV();
  return appState.customDomainManager.getDomain('imgbed.top');
};

test('冻结的自定义域名：用户点刷新也要写进去', async () => {
  // 这条就是用户报的 bug：手动补填过日期 → autoUpdateWhois=false，
  // 之后点多少次「刷新」都静默跳过，只有「标记已续费」生效
  setup({ autoUpdateWhois: false, expirationDate: '2026-01-01', lookupStatus: 'manual' });

  const sync = await syncCustomDomainFromLookup('imgbed.top', LIVE, { explicit: true });

  assert.equal(sync.saved, true);
  assert.equal(sync.reason, 'saved');
  const record = await readRecord();
  assert.equal(record.expirationDate, '2027-11-11', '到期日应被 WHOIS 结果覆盖');
  assert.equal(record.registrar, 'DNSPod, Inc.');
  assert.equal(record.lookupStatus, 'ok');
});

test('显式刷新不解冻：自动更新开关保持用户原来的设置', async () => {
  // 用户当初手填是因为 WHOIS 给的值不可信。刷一次只覆盖这一次的数据，
  // 不该顺手把「别自动改我的日期」这个意图也改掉
  setup({ autoUpdateWhois: false });

  await syncCustomDomainFromLookup('imgbed.top', LIVE, { explicit: true });

  const record = await readRecord();
  assert.equal(record.autoUpdateWhois, false, '手动维护标记不该被刷新清掉');
});

test('显式刷新后来源写的是真实来源，不是 manual', async () => {
  // merge 对冻结记录会把 dataSource 强制写成 manual，界面上就成了
  // 「刚从 WHOIS 拿到的数据」标着「手动维护」
  setup({ autoUpdateWhois: false });

  await syncCustomDomainFromLookup('imgbed.top', LIVE, { explicit: true });

  const record = await readRecord();
  assert.equal(record.dataSource, 'whois-proxy');
});

test('自动更新路径仍然尊重冻结', async () => {
  // 页面后台补全、Cron 走的是非 explicit 调用，用户手填的日期不能被覆盖
  setup({ autoUpdateWhois: false, expirationDate: '2026-06-01' });

  const sync = await syncCustomDomainFromLookup('imgbed.top', LIVE);

  assert.equal(sync.saved, false);
  assert.equal(sync.reason, 'manual-frozen');
  const record = await readRecord();
  assert.equal(record.expirationDate, '2026-06-01', '自动路径不该动它');
});

test('没冻结的记录：自动路径照常写', async () => {
  setup({ expirationDate: '2026-01-01' });

  const sync = await syncCustomDomainFromLookup('imgbed.top', LIVE);

  assert.equal(sync.saved, true);
  assert.equal((await readRecord()).expirationDate, '2027-11-11');
});

test('不是自定义域名：不写，但也不算问题', async () => {
  // Cloudflare zone 和免费域名本来就没有"落库"这一步，结果只进缓存。
  // 把它们报成失败，每次刷新都会弹一条没意义的警告
  setup();
  const sync = await syncCustomDomainFromLookup('other.com', LIVE);

  assert.equal(sync.saved, false);
  assert.equal(sync.reason, 'not-custom');
  assert.equal(SYNC_PROBLEMS.has(sync.reason), false, 'not-custom 不该标成问题');
});

test('注册表兜底值不写回：会把真实到期日覆盖成占位文本', async () => {
  // v2.3.1 踩过：registry 来源的 Auto-Renewal 覆盖了用户手上的真实日期
  setup({ expirationDate: '2027-11-11' });

  const sync = await syncCustomDomainFromLookup('imgbed.top', {
    registrar: 'Unknown',
    expirationDate: 'Auto-Renewal',
    dataSource: 'registry'
  }, { explicit: true });

  assert.equal(sync.saved, false);
  assert.equal(sync.reason, 'no-live-data');
  assert.equal((await readRecord()).expirationDate, '2027-11-11');
});

test('查询报错（dataSource 为 null）也不写', async () => {
  setup({ expirationDate: '2027-11-11' });

  const sync = await syncCustomDomainFromLookup('imgbed.top', {
    registrar: 'N/A',
    expirationDate: 'N/A',
    whoisError: 'WHOIS proxy not configured',
    dataSource: null
  }, { explicit: true });

  assert.equal(sync.reason, 'no-live-data');
  assert.equal((await readRecord()).expirationDate, '2027-11-11');
});

test('提示文案说实话：写没写进去要能看出来', () => {
  assert.match(syncNote('a.com', { saved: true, reason: 'saved' }), /已更新/);
  assert.match(syncNote('a.com', { saved: false, reason: 'not-custom' }), /已更新/);
  assert.match(syncNote('a.com', { saved: false, reason: 'no-live-data' }), /没拿到/);
  assert.match(syncNote('a.com', { saved: false, reason: 'missing' }), /补填/);
  assert.match(syncNote('a.com', { saved: false, reason: 'manual-frozen' }), /未写入/);
});

test('冻结的记录写成功后要说明自动更新仍关着', () => {
  // 数据写了，但徽标仍然显示「手动维护」—— 不说清楚，用户会以为没生效
  assert.match(syncNote('a.com', { saved: true, reason: 'saved', frozen: true }), /手动维护/);
  assert.ok(!syncNote('a.com', { saved: true, reason: 'saved', frozen: false }).includes('手动维护'));
});

test('只有三种原因算问题，其余都不该弹警告', () => {
  assert.deepEqual([...SYNC_PROBLEMS].sort(), ['manual-frozen', 'missing', 'no-live-data']);
});
