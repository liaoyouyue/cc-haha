// Parse only CCHH v0.7.4 "Settings > H5 Access" QR links.
// Never send or log the embedded bearer credential before the user confirms their own desktop.
export function parsePrivatePairingQr(input) {
  if (typeof input !== 'string' || input.length > 8192) {
    throw new Error('二维码内容过长或格式不正确');
  }
  let url;
  try { url = new URL(input.trim()); }
  catch { throw new Error('请扫描自己电脑 CCHH 的 H5 访问二维码'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.hash) {
    throw new Error('不是受支持的 CCHH H5 二维码');
  }
  // Reject public plaintext HTTP before reading the token.
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase();
    const octets = host.split('.').map(Number);
    const ipv4 = octets.length === 4 && octets.every((n, i) =>
      /^\d{1,3}$/.test(host.split('.')[i]) && Number.isInteger(n) && n >= 0 && n <= 255);
    const local = host === 'localhost' || (ipv4 && (
      octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      octets[0] === 127
    ));
    if (!local) throw new Error('不允许将 H5 令牌通过公网 HTTP 发送');
  }
  const keys = [...url.searchParams.keys()].sort();
  if (keys.join(',') !== 'h5Token,serverUrl') {
    throw new Error('请扫描电脑生成的完整 H5 二维码，不要使用普通网页链接');
  }
  const token = url.searchParams.get('h5Token');
  const serverUrl = url.searchParams.get('serverUrl');
  if (!token || !/^[\x21-\x7e]{16,512}$/.test(token) || !serverUrl) {
    throw new Error('H5 二维码中的连接凭据无效，请在电脑重新生成');
  }
  let claimed;
  try { claimed = new URL(serverUrl); }
  catch { throw new Error('二维码中服务器地址无效'); }
  if (claimed.origin !== url.origin || claimed.pathname !== '/' || claimed.search ||
      claimed.hash || claimed.username || claimed.password) {
    throw new Error('二维码地址不一致，已拒绝自动导入');
  }
  return { baseUrl: url.origin, token };
}
