// Unit tests for server/client-ip.mjs (issue #1784): the per-IP login limits
// must key on the client behind the fleet's proxies, and never on anything the
// client itself can choose.

import { describe, expect, test } from 'bun:test';
import { normalizeIp, parseForwardedFor, parsePeerList, peerMatches, resolveClientIp, resolveTrustedProxyHops } from './client-ip.mjs';

const headers = (map = {}) => ({ get: (name) => map[name.toLowerCase()] ?? null });

describe('resolveTrustedProxyHops', () => {
  test('0 unless a small non-negative integer; junk never widens trust', () => {
    expect(resolveTrustedProxyHops(undefined)).toBe(0);
    expect(resolveTrustedProxyHops('')).toBe(0);
    expect(resolveTrustedProxyHops('1')).toBe(1);
    expect(resolveTrustedProxyHops(' 2 ')).toBe(2);
    expect(resolveTrustedProxyHops('-1')).toBe(0);
    expect(resolveTrustedProxyHops('1.5')).toBe(0);
    expect(resolveTrustedProxyHops('true')).toBe(0);
    expect(resolveTrustedProxyHops('99')).toBe(0);
  });
});

describe('normalizeIp / parseForwardedFor', () => {
  test('bare literals only: ports and brackets stripped, IPv4-mapped folded, junk dropped', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(normalizeIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:10.0.0.9')).toBe('10.0.0.9');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
    for (const junk of ['', '   ', 'unknown', '999.1.1.1', '01.2.3.4', 'evil.example', '1.2.3', '2001:::1', 'a'.repeat(50)]) {
      expect(normalizeIp(junk)).toBeNull();
    }
    expect(parseForwardedFor('spoofed, 198.51.100.4 , unknown, [2001:db8::2]:1, 203.0.113.9')).toEqual([
      '198.51.100.4', '2001:db8::2', '203.0.113.9',
    ]);
    expect(parseForwardedFor(null)).toEqual([]);
  });
});

describe('parsePeerList / peerMatches', () => {
  test('IPs and CIDRs, v4 and v6; unparseable entries are dropped', () => {
    const peers = parsePeerList('173.245.48.0/20, 2400:cb00::/32, 198.51.100.7, nonsense, 10.0.0.0/33, 1.2.3.4/8/9');
    expect(peers).toHaveLength(3);
    expect(peerMatches('173.245.63.250', peers)).toBe(true);
    expect(peerMatches('173.245.64.1', peers)).toBe(false);
    expect(peerMatches('2400:cb00:2049:1::a29f:1804', peers)).toBe(true);
    expect(peerMatches('2400:cb01::1', peers)).toBe(false);
    expect(peerMatches('198.51.100.7', peers)).toBe(true);
    expect(peerMatches('198.51.100.8', peers)).toBe(false);
    expect(peerMatches('junk', peers)).toBe(false);
    expect(peerMatches('198.51.100.7', [])).toBe(false);
    expect(parsePeerList(undefined)).toEqual([]);
    expect(peerMatches('0.0.0.0', parsePeerList('0.0.0.0/0'))).toBe(true);
    expect(peerMatches('255.255.255.255', parsePeerList('0.0.0.0/0'))).toBe(true);
  });
});

describe('resolveClientIp', () => {
  test('hops 0 (default): forwarding headers are ignored, the socket peer is the key', () => {
    const h = headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.8' });
    expect(resolveClientIp({ headers: h, socketAddress: '10.0.5.1' })).toBe('10.0.5.1');
    expect(resolveClientIp({ headers: h, socketAddress: '::ffff:10.0.5.1', hops: 0 })).toBe('10.0.5.1');
    expect(resolveClientIp({ headers: h, socketAddress: '' })).toBeNull();
  });

  test('ALB case (hops 1): the LAST x-forwarded-for entry is the client, not the balancer peer (#1784)', () => {
    const alb = '10.0.5.1';
    const a = resolveClientIp({ headers: headers({ 'x-forwarded-for': '203.0.113.7' }), socketAddress: alb, hops: 1 });
    const b = resolveClientIp({ headers: headers({ 'x-forwarded-for': '198.51.100.4' }), socketAddress: alb, hops: 1 });
    expect(a).toBe('203.0.113.7');
    expect(b).toBe('198.51.100.4');
    expect(a).not.toBe(b);
  });

  test('a client-supplied chain on the left is ignored: the proxy-appended entry wins', () => {
    const h = headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.7' });
    expect(resolveClientIp({ headers: h, socketAddress: '10.0.5.1', hops: 1 })).toBe('203.0.113.7');
    expect(resolveClientIp({ headers: h, socketAddress: '10.0.5.1', hops: 2 })).toBe('2.2.2.2');
  });

  test('a header with fewer entries than the trusted chain did not traverse it: socket peer', () => {
    expect(resolveClientIp({ headers: headers({}), socketAddress: '10.0.5.1', hops: 1 })).toBe('10.0.5.1');
    expect(resolveClientIp({ headers: headers({ 'x-forwarded-for': 'garbage' }), socketAddress: '10.0.5.1', hops: 1 })).toBe('10.0.5.1');
    expect(resolveClientIp({ headers: headers({ 'x-forwarded-for': '203.0.113.7' }), socketAddress: '10.0.5.1', hops: 2 })).toBe('10.0.5.1');
  });

  test('x-real-ip is honoured only when the trusted hop is an allowlisted gateway peer', () => {
    const gatewayPeers = parsePeerList('173.245.48.0/20');
    const viaGateway = headers({ 'x-forwarded-for': '203.0.113.7, 173.245.50.9', 'x-real-ip': '203.0.113.7' });
    expect(resolveClientIp({ headers: viaGateway, socketAddress: '10.0.5.1', hops: 1, gatewayPeers })).toBe('203.0.113.7');
    // The same headers straight at the ALB from a non-gateway peer: x-real-ip is a lie.
    const direct = headers({ 'x-forwarded-for': '198.51.100.4', 'x-real-ip': '203.0.113.7' });
    expect(resolveClientIp({ headers: direct, socketAddress: '10.0.5.1', hops: 1, gatewayPeers })).toBe('198.51.100.4');
    // No allowlist: gateway traffic keys on the gateway's egress, never on x-real-ip.
    expect(resolveClientIp({ headers: viaGateway, socketAddress: '10.0.5.1', hops: 1 })).toBe('173.245.50.9');
    // A gateway peer with a junk x-real-ip falls back to the gateway's egress.
    const junkReal = headers({ 'x-forwarded-for': '173.245.50.9', 'x-real-ip': 'nope' });
    expect(resolveClientIp({ headers: junkReal, socketAddress: '10.0.5.1', hops: 1, gatewayPeers })).toBe('173.245.50.9');
  });
});
