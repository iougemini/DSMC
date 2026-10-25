import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { appState } from '../src/app-state.js';
import { secureCompare, createAuthToken, verifyAuthToken, createCookieHeader } from '../src/auth.js';
import { verifyAdminPassword } from '../src/managers/settings-store.js';

describe('secureCompare', () => {
  it('相同字符串返回 true', () => {
    assert.equal(secureCompare('abc', 'abc'), true);
  });

  it('不同字符串返回 false', () => {
    assert.equal(secureCompare('abc', 'abd'), false);
  });

  it('长度不同返回 false', () => {
    assert.equal(secureCompare('abc', 'abcd'), false);
  });

  it('空值返回 false', () => {
    assert.equal(secureCompare(null, 'abc'), false);
    assert.equal(secureCompare('', ''), false);
  });
});

describe('createAuthToken / verifyAuthToken', () => {
  before(() => {
    appState.TOKEN_SECRET = 'test-token-secret';
    appState.ADMIN_PASSWORD = 'admin-pass';
    appState.ACCESS_PASSWORD = 'access-pass';
  });

  it('签发并校验 access token', async () => {
    const token = await createAuthToken('access', 3600);
    assert.equal(typeof token, 'string');
    const payload = await verifyAuthToken(token, 'access');
    assert.notEqual(payload, null);
    assert.equal(payload.type, 'access');
    assert.ok(payload.exp > payload.iat);
  });

  it('类型不匹配返回 null', async () => {
    const token = await createAuthToken('access', 3600);
    assert.equal(await verifyAuthToken(token, 'admin'), null);
  });

  it('篡改签名返回 null', async () => {
    const token = await createAuthToken('admin', 3600);
    const [payloadB64] = token.split('.');
    assert.equal(await verifyAuthToken(`${payloadB64}.deadbeef`, 'admin'), null);
  });

  it('非法 token 返回 null', async () => {
    assert.equal(await verifyAuthToken('not-a-token', 'admin'), null);
    assert.equal(await verifyAuthToken(null, 'admin'), null);
  });
});

describe('createCookieHeader', () => {
  it('包含 HttpOnly 和 SameSite=Strict', () => {
    const h = createCookieHeader('access_token', 'abc');
    assert.ok(h.includes('access_token=abc'));
    assert.ok(h.includes('HttpOnly'));
    assert.ok(h.includes('SameSite=Strict'));
  });

  it('secure=true 时包含 Secure', () => {
    assert.ok(createCookieHeader('a', 'b', 3600, true).includes('Secure'));
    assert.ok(!createCookieHeader('a', 'b', 3600, false).includes('Secure'));
  });
});
describe('空密码部署的密钥兜底', () => {
  // 未配置 TOKEN_SECRET 时，签名密钥回退到密码（auth.js 的 getTokenSecret）。
  // 于是「什么都没配」的部署里，密钥就是空串。WebCrypto 拒绝零长度 key，
  // 所以「攻击者自己签一个 admin_token」这条路是封死的。
  //
  // 但这是**靠底层实现兜住的**，不是显式判断。哪天换成手搓 sha256，
  // 空密钥照样能算出签名、也照样能验过，漏洞就悄悄回来了。所以要盯着。
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');

  function fakePayload(type) {
    const now = Math.floor(Date.now() / 1000);
    return b64(JSON.stringify({ type, iat: now, exp: now + 86400 }));
  }

  function resetAuth(secret, password) {
    appState.TOKEN_SECRET = secret;
    appState.ADMIN_PASSWORD = password;
    appState.ADMIN_PASSWORD_HASH = '';
    appState.ACCESS_PASSWORD = password;
    appState.ACCESS_PASSWORD_HASH = '';
  }

  it('完全没配置时，拿不到能用的 admin token', async () => {
    resetAuth('', '');

    // 不关心是抛异常还是签出个验不过的串，只关心「拿不到能用的」
    let token = null;
    try {
      token = await createAuthToken('admin', 60);
    } catch {
      token = null;
    }

    if (token) {
      assert.equal(await verifyAuthToken(token, 'admin'), null,
        '空密钥竟然签出了能用的 token');
    }
  });

  it('完全没配置时，拼出来的 admin_token 一律被拒', async () => {
    resetAuth('', '');
    // 攻击者能从源码看到 payload 结构，但算不出签名，只能瞎填
    const forged = fakePayload('admin') + '.' + 'deadbeef'.repeat(8);
    assert.equal(await verifyAuthToken(forged, 'admin'), null);
  });

  it('配了密码但没配 TOKEN_SECRET 时，伪造 token 仍然被拒', async () => {
    resetAuth('', 'only-a-password-no-secret');

    const forged = fakePayload('admin') + '.' + 'deadbeef'.repeat(8);
    assert.equal(await verifyAuthToken(forged, 'admin'), null);

    // 对照组：用真实密钥签发的能通过，证明上面的拒绝不是「校验坏了」
    const real = await createAuthToken('admin', 60);
    assert.ok(await verifyAuthToken(real, 'admin'), '对照组失效：合法 token 也验不过');
  });

  it('空密码时 verifyAdminPassword 恒为 false', async () => {
    resetAuth('', '');
    // 密码校验是「空密码登录」的第一道闸；它失效的话，
    // 后面 createAuthToken 会抛异常变成 500，登录页就废了
    assert.equal(await verifyAdminPassword(''), false);
    assert.equal(await verifyAdminPassword('anything'), false);
  });
});
