// CCHH v0.7.4 native public access flow. No credentials in URLs or logs.
export function publicBaseUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash)
    throw new Error('公网地址必须是无路径、无参数的 HTTPS 域名');
  return url.origin;
}
export function parsePairingText(input) {
  const value = input.trim();
  if (!value) throw new Error('请输入电脑生成的一次性配对密钥');
  if (value.startsWith('https://')) {
    const url = new URL(value);
    // Only CCHH v0.7.4 official /remote#pair=... URLs are accepted.
    // Never confuse the separate LAN H5 token link with a public pairing code.
    if (url.pathname !== '/remote' || url.search) throw new Error('请扫描 CCHH 公网配对二维码，不是局域网 H5 二维码');
    const fragment = new URLSearchParams(url.hash.replace(/^#/,''));
    const secret = fragment.get('pair');
    if (!secret) throw new Error('二维码链接未包含可识别配对参数，请复制一次性密钥');
    return {baseUrl: publicBaseUrl(url.origin), secret};
  }
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(value)) throw new Error('一次性配对密钥格式错误');
  return {baseUrl: null, secret: value};
}
export async function remoteJson(baseUrl,route,body,fetcher=globalThis.fetch) {
  const base = publicBaseUrl(baseUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetcher(base + '/api/public-access/' + route, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: {'Origin':base,'Accept':'application/json',
        ...(body === undefined ? {} : {'Content-Type':'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal
    });
    if (!res.ok) throw new Error(res.status === 401 ? '配对码失效或授权被拒绝' : '配对请求失败 HTTP '+res.status);
    return await res.json();
  } finally {clearTimeout(timer);}
}
export async function createPublicPairing(baseUrl,secret,name,fetcher) {
  const parsed = parsePairingText(secret);
  if (parsed.baseUrl && parsed.baseUrl !== publicBaseUrl(baseUrl)) throw new Error('配对链接与公网服务器地址不一致');
  const out = await remoteJson(baseUrl,'pair',{secret:parsed.secret,name},fetcher);
  if (typeof out.id !== 'string' || typeof out.claimSecret !== 'string') throw new Error('服务器未返回配对信息');
  return {id:out.id,claimSecret:out.claimSecret};
}
export async function claimPublicPairing(baseUrl,pairing,fetcher) {
  if(!pairing?.id || !pairing?.claimSecret) throw new Error('配对申请缺失或已过期');
  const out=await remoteJson(baseUrl,'claim',{id:pairing.id,claimSecret:pairing.claimSecret},fetcher);
  if(!['pending','approved','rejected'].includes(out.status)) throw new Error('无法识别服务器配对状态');
  return out;
}
export async function publicSessionActive(baseUrl,fetcher) {
  const out=await remoteJson(baseUrl,'session',undefined,fetcher);
  return out?.authenticated===true;
}
