// URL safety: http/https only, and no loopback / private-network targets unless explicitly allowed (SSRF protection).
import dns from "node:dns/promises";
import net from "node:net";

export class UrlBlocked extends Error {}

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // unparseable: treat as unsafe
}

export async function checkUrl(url, { allowLocal = false } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new UrlBlocked("That is not a valid web address."); }
  if (url === "about:blank") return;
  if (!["http:", "https:"].includes(u.protocol)) throw new UrlBlocked(`Only http and https pages can be opened (got '${u.protocol.replace(":", "") || "none"}').`);
  if (allowLocal) return;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const blocked = new UrlBlocked("Pages on this computer or local network are blocked.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw blocked;
  if (net.isIP(host)) { if (isPrivateIp(host)) throw blocked; return; }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { return; } // unresolvable: navigation will fail clearly
  if (addrs.some((a) => isPrivateIp(a.address))) throw blocked;
}
