import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ConnectorClient } from './client';
import { DomainsApi } from './domains';
import { DnsApi } from './dns';
import { Connector } from './index';
import { ConnectorApiError } from '../types';
import {
  extractTag,
  extractAttribute,
  extractAllTags,
  extractAttributeFromElement,
  checkApiError,
  splitDomain,
} from '../utils/xml';

// ============================================
// XML Utility Tests
// ============================================

describe('XML Utilities', () => {
  describe('extractTag', () => {
    test('extracts text content from a tag', () => {
      const xml = '<Root><Name>example.com</Name></Root>';
      expect(extractTag(xml, 'Name')).toBe('example.com');
    });

    test('returns null for missing tag', () => {
      const xml = '<Root><Name>example.com</Name></Root>';
      expect(extractTag(xml, 'Missing')).toBeNull();
    });

    test('trims whitespace', () => {
      const xml = '<Root><Name>  example.com  </Name></Root>';
      expect(extractTag(xml, 'Name')).toBe('example.com');
    });
  });

  describe('extractAttribute', () => {
    test('extracts attribute from tag', () => {
      const xml = '<ApiResponse Status="OK"><DomainCheckResult Available="true" /></ApiResponse>';
      expect(extractAttribute(xml, 'ApiResponse', 'Status')).toBe('OK');
      expect(extractAttribute(xml, 'DomainCheckResult', 'Available')).toBe('true');
    });

    test('returns null for missing attribute', () => {
      const xml = '<ApiResponse Status="OK" />';
      expect(extractAttribute(xml, 'ApiResponse', 'Missing')).toBeNull();
    });

    test('returns null for missing tag', () => {
      const xml = '<ApiResponse Status="OK" />';
      expect(extractAttribute(xml, 'MissingTag', 'Status')).toBeNull();
    });
  });

  describe('extractAllTags', () => {
    test('extracts all occurrences of a tag', () => {
      const xml = '<Root><Domain Name="a.com" /><Domain Name="b.com" /><Domain Name="c.com" /></Root>';
      const results = extractAllTags(xml, 'Domain');
      expect(results).toHaveLength(3);
    });

    test('returns empty array when no tags found', () => {
      const xml = '<Root><Other /></Root>';
      expect(extractAllTags(xml, 'Domain')).toHaveLength(0);
    });

    test('does not match partial tag names', () => {
      const xml = '<Root><DomainListResult><Domain Name="a.com" /></DomainListResult></Root>';
      const results = extractAllTags(xml, 'Domain');
      expect(results).toHaveLength(1);
      expect(results[0]).toContain('Name="a.com"');
    });
  });

  describe('extractAttributeFromElement', () => {
    test('extracts attribute from element string', () => {
      const el = '<Domain Name="example.com" Expires="2025-12-31" AutoRenew="true" />';
      expect(extractAttributeFromElement(el, 'Name')).toBe('example.com');
      expect(extractAttributeFromElement(el, 'Expires')).toBe('2025-12-31');
      expect(extractAttributeFromElement(el, 'AutoRenew')).toBe('true');
    });

    test('returns null for missing attribute', () => {
      const el = '<Domain Name="example.com" />';
      expect(extractAttributeFromElement(el, 'Missing')).toBeNull();
    });
  });

  describe('checkApiError', () => {
    test('does not throw for OK status', () => {
      const xml = '<ApiResponse Status="OK"><CommandResponse /></ApiResponse>';
      expect(() => checkApiError(xml)).not.toThrow();
    });

    test('throws for ERROR status with message', () => {
      const xml = '<ApiResponse Status="ERROR"><Errors><Error Number="1010"><Message>Invalid API key</Message></Error></Errors></ApiResponse>';
      expect(() => checkApiError(xml)).toThrow('Namecheap API error');
    });

    test('throws for ERROR status with Err tag', () => {
      const xml = '<ApiResponse Status="ERROR"><Errors><Err Number="2030">Domain not found</Err></Errors></ApiResponse>';
      expect(() => checkApiError(xml)).toThrow('Namecheap API error');
    });
  });

  describe('splitDomain', () => {
    test('splits simple domain', () => {
      expect(splitDomain('example.com')).toEqual({ sld: 'example', tld: 'com' });
    });

    test('splits domain with subdomain', () => {
      expect(splitDomain('sub.example.com')).toEqual({ sld: 'sub.example', tld: 'com' });
    });

    test('splits .co.uk domain', () => {
      expect(splitDomain('example.co.uk')).toEqual({ sld: 'example', tld: 'co.uk' });
    });

    test('splits .com.au domain', () => {
      expect(splitDomain('example.com.au')).toEqual({ sld: 'example', tld: 'com.au' });
    });

    test('throws for invalid domain', () => {
      expect(() => splitDomain('example')).toThrow('Invalid domain');
    });
  });
});

// ============================================
// Client Tests
// ============================================

describe('ConnectorClient', () => {
  test('requires apiKey', () => {
    expect(() => new ConnectorClient({ apiKey: '', username: 'user', clientIp: '1.2.3.4' })).toThrow('API key is required');
  });

  test('requires username', () => {
    expect(() => new ConnectorClient({ apiKey: 'key', username: '', clientIp: '1.2.3.4' })).toThrow('Username is required');
  });

  test('requires clientIp', () => {
    expect(() => new ConnectorClient({ apiKey: 'key', username: 'user', clientIp: '' })).toThrow('Client IP is required');
  });

  test('creates client with valid config', () => {
    const client = new ConnectorClient({ apiKey: 'test-key-1234567890', username: 'testuser', clientIp: '1.2.3.4' });
    expect(client).toBeDefined();
    expect(client.getApiKeyPreview()).toBe('test-k...7890');
  });

  test('builds correct URL', () => {
    const client = new ConnectorClient({ apiKey: 'key', username: 'user', clientIp: '1.2.3.4' });
    const url = client.buildUrl('namecheap.domains.getList', { PageSize: '100' });
    expect(url).toContain('https://api.namecheap.com/xml.response');
    expect(url).toContain('ApiUser=user');
    expect(url).toContain('ApiKey=key');
    expect(url).toContain('UserName=user');
    expect(url).toContain('ClientIp=1.2.3.4');
    expect(url).toContain('Command=namecheap.domains.getList');
    expect(url).toContain('PageSize=100');
  });

  test('uses sandbox URL when configured', () => {
    const client = new ConnectorClient({ apiKey: 'key', username: 'user', clientIp: '1.2.3.4', sandbox: true });
    const url = client.buildUrl('namecheap.domains.getList');
    expect(url).toContain('https://api.sandbox.namecheap.com/xml.response');
  });

  test('getApiKeyPreview masks key', () => {
    const client = new ConnectorClient({ apiKey: 'abcdef1234567890', username: 'user', clientIp: '1.2.3.4' });
    expect(client.getApiKeyPreview()).toBe('abcdef...7890');
  });

  test('getApiKeyPreview returns *** for short key', () => {
    const client = new ConnectorClient({ apiKey: '1234567890', username: 'user', clientIp: '1.2.3.4' });
    expect(client.getApiKeyPreview()).toBe('***');
  });
});

// ============================================
// Connector Tests
// ============================================

describe('Connector', () => {
  test('creates connector with valid config', () => {
    const connector = new Connector({ apiKey: 'key', username: 'user', clientIp: '1.2.3.4' });
    expect(connector.domains).toBeDefined();
    expect(connector.dns).toBeDefined();
  });

  test('fromEnv throws without NAMECHEAP_API_KEY', () => {
    const origKey = process.env.NAMECHEAP_API_KEY;
    const origUser = process.env.NAMECHEAP_USERNAME;
    const origIp = process.env.NAMECHEAP_CLIENT_IP;
    delete process.env.NAMECHEAP_API_KEY;
    delete process.env.NAMECHEAP_USERNAME;
    delete process.env.NAMECHEAP_CLIENT_IP;

    expect(() => Connector.fromEnv()).toThrow('NAMECHEAP_API_KEY environment variable is required');

    // Restore
    if (origKey) process.env.NAMECHEAP_API_KEY = origKey;
    if (origUser) process.env.NAMECHEAP_USERNAME = origUser;
    if (origIp) process.env.NAMECHEAP_CLIENT_IP = origIp;
  });

  test('fromEnv throws without NAMECHEAP_USERNAME', () => {
    const origKey = process.env.NAMECHEAP_API_KEY;
    const origUser = process.env.NAMECHEAP_USERNAME;
    const origIp = process.env.NAMECHEAP_CLIENT_IP;
    process.env.NAMECHEAP_API_KEY = 'test-key';
    delete process.env.NAMECHEAP_USERNAME;
    delete process.env.NAMECHEAP_CLIENT_IP;

    expect(() => Connector.fromEnv()).toThrow('NAMECHEAP_USERNAME environment variable is required');

    // Restore
    if (origKey) process.env.NAMECHEAP_API_KEY = origKey; else delete process.env.NAMECHEAP_API_KEY;
    if (origUser) process.env.NAMECHEAP_USERNAME = origUser;
    if (origIp) process.env.NAMECHEAP_CLIENT_IP = origIp;
  });

  test('fromEnv throws without NAMECHEAP_CLIENT_IP', () => {
    const origKey = process.env.NAMECHEAP_API_KEY;
    const origUser = process.env.NAMECHEAP_USERNAME;
    const origIp = process.env.NAMECHEAP_CLIENT_IP;
    process.env.NAMECHEAP_API_KEY = 'test-key';
    process.env.NAMECHEAP_USERNAME = 'test-user';
    delete process.env.NAMECHEAP_CLIENT_IP;

    expect(() => Connector.fromEnv()).toThrow('NAMECHEAP_CLIENT_IP environment variable is required');

    // Restore
    if (origKey) process.env.NAMECHEAP_API_KEY = origKey; else delete process.env.NAMECHEAP_API_KEY;
    if (origUser) process.env.NAMECHEAP_USERNAME = origUser; else delete process.env.NAMECHEAP_USERNAME;
    if (origIp) process.env.NAMECHEAP_CLIENT_IP = origIp;
  });

  test('fromEnv creates connector with all env vars', () => {
    const origKey = process.env.NAMECHEAP_API_KEY;
    const origUser = process.env.NAMECHEAP_USERNAME;
    const origIp = process.env.NAMECHEAP_CLIENT_IP;
    process.env.NAMECHEAP_API_KEY = 'test-key-12345';
    process.env.NAMECHEAP_USERNAME = 'testuser';
    process.env.NAMECHEAP_CLIENT_IP = '1.2.3.4';

    const connector = Connector.fromEnv();
    expect(connector).toBeDefined();
    expect(connector.getApiKeyPreview()).toBe('test-k...2345');

    // Restore
    if (origKey) process.env.NAMECHEAP_API_KEY = origKey; else delete process.env.NAMECHEAP_API_KEY;
    if (origUser) process.env.NAMECHEAP_USERNAME = origUser; else delete process.env.NAMECHEAP_USERNAME;
    if (origIp) process.env.NAMECHEAP_CLIENT_IP = origIp; else delete process.env.NAMECHEAP_CLIENT_IP;
  });

  test('getClient returns the underlying client', () => {
    const connector = new Connector({ apiKey: 'key', username: 'user', clientIp: '1.2.3.4' });
    const client = connector.getClient();
    expect(client).toBeInstanceOf(ConnectorClient);
  });
});

// ============================================
// DomainsApi Tests (with mocked fetch)
// ============================================

describe('DomainsApi', () => {
  const config = { apiKey: 'test-key', username: 'testuser', clientIp: '1.2.3.4' };
  let client: ConnectorClient;
  let domainsApi: DomainsApi;

  beforeEach(() => {
    client = new ConnectorClient(config);
    domainsApi = new DomainsApi(client);
  });

  test('list parses domain list response', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.getList">
        <DomainListResult>
          <Domain ID="1" Name="example.com" Expires="12/31/2025" AutoRenew="true" IsLocked="false" />
          <Domain ID="2" Name="test.org" Expires="06/15/2026" AutoRenew="false" IsLocked="true" />
        </DomainListResult>
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const domains = await domainsApi.list();
    expect(domains).toHaveLength(2);
    expect(domains[0].domain).toBe('example.com');
    expect(domains[0].expiry).toBe('12/31/2025');
    expect(domains[0].autoRenew).toBe(true);
    expect(domains[0].isLocked).toBe(false);
    expect(domains[1].domain).toBe('test.org');
    expect(domains[1].autoRenew).toBe(false);
    expect(domains[1].isLocked).toBe(true);

    globalThis.fetch = originalFetch;
  });

  test('getInfo parses domain info response', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.getInfo">
        <DomainGetInfoResult Status="Ok" DomainName="example.com">
          <CreatedDate>01/15/2020</CreatedDate>
          <ExpiredDate>01/15/2025</ExpiredDate>
          <DnsDetails ProviderType="CUSTOM">
            <Nameserver>ns1.example.com</Nameserver>
            <Nameserver>ns2.example.com</Nameserver>
          </DnsDetails>
        </DomainGetInfoResult>
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const info = await domainsApi.getInfo('example.com');
    expect(info.domain).toBe('example.com');
    expect(info.registrar).toBe('Namecheap');
    expect(info.created).toBe('01/15/2020');
    expect(info.expires).toBe('01/15/2025');
    expect(info.nameservers).toEqual(['ns1.example.com', 'ns2.example.com']);

    globalThis.fetch = originalFetch;
  });

  test('renew parses renew response', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.renew">
        <DomainRenewResult DomainName="example.com" TransactionID="12345" ChargedAmount="10.87" OrderID="67890" />
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const result = await domainsApi.renew('example.com', 1);
    expect(result.domain).toBe('example.com');
    expect(result.success).toBe(true);
    expect(result.transactionId).toBe('12345');
    expect(result.chargedAmount).toBe('10.87');
    expect(result.orderId).toBe('67890');

    globalThis.fetch = originalFetch;
  });

  test('check parses availability response', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.check">
        <DomainCheckResult Domain="newdomain.com" Available="true" />
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const result = await domainsApi.check('newdomain.com');
    expect(result.domain).toBe('newdomain.com');
    expect(result.available).toBe(true);

    globalThis.fetch = originalFetch;
  });

  test('check returns false for unavailable domain', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.check">
        <DomainCheckResult Domain="google.com" Available="false" />
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const result = await domainsApi.check('google.com');
    expect(result.domain).toBe('google.com');
    expect(result.available).toBe(false);

    globalThis.fetch = originalFetch;
  });

  test('throws on API error response', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="ERROR">
      <Errors>
        <Error Number="2019"><Message>API Key is invalid</Message></Error>
      </Errors>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    await expect(domainsApi.list()).rejects.toThrow('Namecheap API error');

    globalThis.fetch = originalFetch;
  });

  test('throws on HTTP error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }))
    ) as any;

    await expect(domainsApi.list()).rejects.toThrow('Namecheap API HTTP error: 500');

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// DnsApi Tests (with mocked fetch)
// ============================================

describe('DnsApi', () => {
  const config = { apiKey: 'test-key', username: 'testuser', clientIp: '1.2.3.4' };
  let client: ConnectorClient;
  let dnsApi: DnsApi;

  beforeEach(() => {
    client = new ConnectorClient(config);
    dnsApi = new DnsApi(client);
  });

  test('getHosts parses DNS records', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.dns.getHosts">
        <DomainDNSGetHostsResult>
          <host HostId="1" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1800" />
          <host HostId="2" Name="www" Type="CNAME" Address="example.com." TTL="3600" />
          <host HostId="3" Name="@" Type="MX" Address="mail.example.com." MXPref="10" TTL="1800" />
        </DomainDNSGetHostsResult>
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const records = await dnsApi.getHosts('example', 'com');
    expect(records).toHaveLength(3);
    expect(records[0].name).toBe('@');
    expect(records[0].type).toBe('A');
    expect(records[0].address).toBe('1.2.3.4');
    expect(records[0].ttl).toBe(1800);
    expect(records[0].hostId).toBe('1');
    expect(records[1].name).toBe('www');
    expect(records[1].type).toBe('CNAME');
    expect(records[1].ttl).toBe(3600);
    expect(records[2].type).toBe('MX');
    expect(records[2].mxPref).toBe(10);

    globalThis.fetch = originalFetch;
  });

  test('setHosts sends correct parameters', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.dns.setHosts">
        <DomainDNSSetHostsResult IsSuccess="true" />
      </CommandResponse>
    </ApiResponse>`;

    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(mockXml, { status: 200 }));
    }) as any;

    const result = await dnsApi.setHosts('example', 'com', [
      { type: 'A', name: '@', address: '1.2.3.4', ttl: 1800 },
      { type: 'CNAME', name: 'www', address: 'example.com.', ttl: 3600 },
      { type: 'MX', name: '@', address: 'mail.example.com.', ttl: 1800, mxPref: 10 },
    ]);

    expect(result).toBe(true);
    expect(capturedUrl).toContain('SLD=example');
    expect(capturedUrl).toContain('TLD=com');
    expect(capturedUrl).toContain('HostName1=%40');
    expect(capturedUrl).toContain('RecordType1=A');
    expect(capturedUrl).toContain('Address1=1.2.3.4');
    expect(capturedUrl).toContain('HostName2=www');
    expect(capturedUrl).toContain('RecordType2=CNAME');
    expect(capturedUrl).toContain('MXPref3=10');

    globalThis.fetch = originalFetch;
  });

  test('getHosts returns empty array for no records', async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
    <ApiResponse Status="OK">
      <CommandResponse Type="namecheap.domains.dns.getHosts">
        <DomainDNSGetHostsResult />
      </CommandResponse>
    </ApiResponse>`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(mockXml, { status: 200 }))
    ) as any;

    const records = await dnsApi.getHosts('empty', 'com');
    expect(records).toHaveLength(0);

    globalThis.fetch = originalFetch;
  });
});

// ============================================
// ConnectorApiError Tests
// ============================================

describe('ConnectorApiError', () => {
  test('creates error with message and status code', () => {
    const err = new ConnectorApiError('test error', 500);
    expect(err.message).toBe('test error');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('ConnectorApiError');
  });

  test('creates error with error number', () => {
    const err = new ConnectorApiError('invalid key', 401, '2019');
    expect(err.errorNumber).toBe('2019');
  });
});
