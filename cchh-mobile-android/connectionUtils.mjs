// Connection validation utilities - extracted from App.js for testing
// These are pure functions without React/JSX dependencies

export function endpoint(raw) {
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw new Error('地址格式不正确：仅填写服务器地址和端口，不带路径、账号或参数');
  if (url.protocol === 'http:') {
    const h = url.hostname.toLowerCase();
    const chunks = h.split('.').map(Number);
    const validIP = chunks.length === 4 && chunks.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
    const privateIp = validIP && (chunks[0] === 10 ||
      (chunks[0] === 172 && chunks[1] >= 16 && chunks[1] <= 31) ||
      (chunks[0] === 192 && chunks[1] === 168) ||
      (chunks[0] === 100 && chunks[1] >= 64 && chunks[1] <= 127) ||
      (chunks[0] === 127));
    if (!privateIp && h !== 'localhost')
      throw new Error('公网地址必须使用 HTTPS；HTTP 仅允许局域网或 Tailscale IP');
  }
  return url.origin;
}

// Re-export from other modules for testing
export {parsePrivatePairingQr} from './privatePairing.mjs';
export {parsePairingText} from './remotePairing.mjs';