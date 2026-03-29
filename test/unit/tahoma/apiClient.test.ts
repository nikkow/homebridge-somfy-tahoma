import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { normalizeGatewayHost, TahomaApiClient } from '../../../src/tahoma/apiClient.js';

type RequestScenario = (context: {
  options: Record<string, unknown>;
  body: string;
  req: MockRequest;
  callback: (response: MockResponse) => void;
}) => void;

type TlsScenario =
  | { type: 'secure'; fingerprint256?: string; hasRaw?: boolean }
  | { type: 'error'; error: Error }
  | { type: 'timeout' };

class MockResponse extends EventEmitter {
  constructor(public readonly statusCode: number) {
    super();
  }
}

class MockRequest extends EventEmitter {
  public readonly write = vi.fn((chunk: string | Buffer) => {
    this.body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
  });

  public readonly setTimeout = vi.fn((_: number, callback: () => void) => {
    this.timeoutHandler = callback;
  });

  public readonly destroy = vi.fn((error?: Error) => {
    if (error) {
      this.emit('error', error);
    }
  });

  public end = vi.fn(() => undefined);

  public body = '';
  public timeoutHandler?: () => void;
}

class MockTlsSocket extends EventEmitter {
  private timeoutHandler?: () => void;

  constructor(private readonly scenario: TlsScenario) {
    super();
  }

  setTimeout(_: number, callback: () => void): void {
    this.timeoutHandler = callback;
  }

  destroy(): void {
    // no-op for tests
  }

  getPeerCertificate(): { raw?: Buffer; fingerprint256?: string } {
    if (this.scenario.type !== 'secure') {
      return {};
    }

    return {
      raw: this.scenario.hasRaw === false ? undefined : Buffer.from('cert-data'),
      fingerprint256: this.scenario.fingerprint256,
    };
  }

  trigger(): void {
    if (this.scenario.type === 'secure') {
      this.emit('secureConnect');
      return;
    }

    if (this.scenario.type === 'error') {
      this.emit('error', this.scenario.error);
      return;
    }

    this.timeoutHandler?.();
  }
}

function createHttpsRequestMock(scenarios: RequestScenario[]) {
  const calls: Array<{ options: Record<string, unknown>; body: string }> = [];

  const httpsRequestMock = vi.fn((options: Record<string, unknown>, callback: (response: MockResponse) => void) => {
    const req = new MockRequest();

    req.end = vi.fn(() => {
      calls.push({ options, body: req.body });
      const scenario = scenarios.shift();

      if (!scenario) {
        throw new Error('Missing HTTPS mock scenario.');
      }

      scenario({
        options,
        body: req.body,
        req,
        callback,
      });
    });

    return req as any;
  });

  return {
    httpsRequestMock,
    calls,
  };
}

function createTlsConnectMock(scenarios: TlsScenario[]) {
  const calls: Array<Record<string, unknown>> = [];

  const tlsConnectMock = vi.fn((options: Record<string, unknown>) => {
    calls.push(options);

    const scenario = scenarios.shift();

    if (!scenario) {
      throw new Error('Missing TLS mock scenario.');
    }

    const socket = new MockTlsSocket(scenario);
    queueMicrotask(() => socket.trigger());

    return socket as any;
  });

  return {
    tlsConnectMock,
    calls,
  };
}

function respondJson(callback: (response: MockResponse) => void, status: number, payload?: string): void {
  const response = new MockResponse(status);
  callback(response);

  if (payload !== undefined) {
    response.emit('data', Buffer.from(payload));
  }

  response.emit('end');
}

describe('normalizeGatewayHost', () => {
  it('normalizes host with default HTTPS port', () => {
    expect(normalizeGatewayHost('192.168.1.10')).toEqual({
      hostname: '192.168.1.10',
      port: 8443,
    });
  });

  it('parses explicit HTTPS URL with custom port', () => {
    expect(normalizeGatewayHost('https://tahoma.local:9443')).toEqual({
      hostname: 'tahoma.local',
      port: 9443,
    });
  });

  it('rejects empty host or non-https protocol', () => {
    expect(() => normalizeGatewayHost('   ')).toThrow('Gateway host is required');
    expect(() => normalizeGatewayHost('http://tahoma.local')).toThrow('Gateway must use HTTPS');
  });
});

describe('TahomaApiClient', () => {
  it('rejects empty token', () => {
    expect(() => new TahomaApiClient({ host: '192.168.1.10', token: '   ' })).toThrow('Gateway token is required');
  });

  it('requests devices and decodes JSON payload', async () => {
    const { httpsRequestMock, calls } = createHttpsRequestMock([
      ({ callback }) => {
        respondJson(callback, 200, '[{"deviceURL":"io://roller/1"}]');
      },
    ]);

    const client = new TahomaApiClient({ host: 'tahoma.local', token: ' token ' }, {
      httpsRequest: httpsRequestMock as any,
      rootCertificates: [],
    });

    const devices = await client.getDevices();

    expect(devices).toEqual([{ deviceURL: 'io://roller/1' }]);
    expect(calls).toHaveLength(1);

    expect(calls[0].options).toMatchObject({
      hostname: 'tahoma.local',
      port: 8443,
      path: '/enduser-mobile-web/1/enduserAPI/setup/devices',
      method: 'GET',
      servername: 'tahoma.local',
      rejectUnauthorized: true,
    });

    const headers = calls[0].options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token');
    expect(headers.Accept).toBe('application/json');

    const ca = calls[0].options.ca as string[];
    expect(ca[0]).toContain('BEGIN CERTIFICATE');
  });

  it('sends apply command payload', async () => {
    const { httpsRequestMock, calls } = createHttpsRequestMock([
      ({ callback }) => {
        respondJson(callback, 200);
      },
    ]);

    const client = new TahomaApiClient({ host: '192.168.1.10', token: 'abc' }, {
      httpsRequest: httpsRequestMock as any,
      rootCertificates: [],
    });

    await client.executeCommand('io://roller/1', 'open');

    expect(calls[0].options).toMatchObject({
      path: '/enduser-mobile-web/1/enduserAPI/exec/apply',
      method: 'POST',
    });

    expect(JSON.parse(calls[0].body)).toEqual({
      actions: [
        {
          deviceURL: 'io://roller/1',
          commands: [{ name: 'open' }],
        },
      ],
    });

    const headers = calls[0].options.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(Number(headers['Content-Length'])).toBeGreaterThan(0);
  });

  it('throws detailed errors for bad status, invalid JSON and timeout', async () => {
    const badStatus = createHttpsRequestMock([
      ({ callback }) => {
        respondJson(callback, 500, 'boom');
      },
    ]);

    const badJson = createHttpsRequestMock([
      ({ callback }) => {
        respondJson(callback, 200, '{"invalid":');
      },
    ]);

    const timeout = createHttpsRequestMock([
      ({ req }) => {
        req.timeoutHandler?.();
      },
    ]);

    const clientBadStatus = new TahomaApiClient({ host: '192.168.1.10', token: 'abc' }, {
      httpsRequest: badStatus.httpsRequestMock as any,
      rootCertificates: [],
    });

    const clientBadJson = new TahomaApiClient({ host: '192.168.1.10', token: 'abc' }, {
      httpsRequest: badJson.httpsRequestMock as any,
      rootCertificates: [],
    });

    const clientTimeout = new TahomaApiClient({ host: '192.168.1.10', token: 'abc', timeoutMs: 250 }, {
      httpsRequest: timeout.httpsRequestMock as any,
      rootCertificates: [],
    });

    await expect(clientBadStatus.getDevices()).rejects.toThrow('TaHoma API request failed with status 500: boom');
    await expect(clientBadJson.getDevices()).rejects.toThrow('TaHoma API returned invalid JSON');
    await expect(clientTimeout.getDevices()).rejects.toThrow('TaHoma API request timeout after 250ms');
  });

  it('retries with pinned certificate when strict TLS fails', async () => {
    const { httpsRequestMock, calls } = createHttpsRequestMock([
      ({ req }) => {
        const error = Object.assign(new Error('self signed certificate'), {
          code: 'SELF_SIGNED_CERT_IN_CHAIN',
        });

        req.emit('error', error);
      },
      ({ callback }) => {
        respondJson(callback, 200, '[]');
      },
    ]);

    const { tlsConnectMock, calls: tlsCalls } = createTlsConnectMock([
      { type: 'secure', fingerprint256: 'AA:BB' },
    ]);

    const client = new TahomaApiClient({ host: 'tahoma.local', token: 'abc' }, {
      httpsRequest: httpsRequestMock as any,
      tlsConnect: tlsConnectMock as any,
      rootCertificates: [],
    });

    await expect(client.getDevices()).resolves.toEqual([]);

    expect(calls).toHaveLength(2);
    expect(tlsCalls).toHaveLength(1);

    expect(calls[1].options).toMatchObject({
      rejectUnauthorized: false,
      expectedPeerFingerprint256: 'AA:BB',
    });
  });

  it('repins certificate and retries when peer fingerprint mismatches', async () => {
    const { httpsRequestMock, calls } = createHttpsRequestMock([
      ({ req }) => {
        const error = Object.assign(new Error('unable to verify certificate'), {
          code: 'CERT_UNTRUSTED',
        });

        req.emit('error', error);
      },
      ({ req }) => {
        const socket = new EventEmitter() as EventEmitter & {
          getPeerCertificate: () => { fingerprint256?: string };
        };

        socket.getPeerCertificate = () => ({ fingerprint256: 'WRONG' });

        req.emit('socket', socket as any);
        socket.emit('secureConnect');
      },
      ({ callback }) => {
        respondJson(callback, 200, '[]');
      },
    ]);

    const { tlsConnectMock, calls: tlsCalls } = createTlsConnectMock([
      { type: 'secure', fingerprint256: 'FP-1' },
      { type: 'secure', fingerprint256: 'FP-2' },
    ]);

    const client = new TahomaApiClient({ host: 'tahoma.local', token: 'abc' }, {
      httpsRequest: httpsRequestMock as any,
      tlsConnect: tlsConnectMock as any,
      rootCertificates: [],
    });

    await expect(client.getDevices()).resolves.toEqual([]);

    expect(calls).toHaveLength(3);
    expect(tlsCalls).toHaveLength(2);

    expect(calls[1].options).toMatchObject({
      expectedPeerFingerprint256: 'FP-1',
    });

    expect(calls[2].options).toMatchObject({
      expectedPeerFingerprint256: 'FP-2',
    });
  });

  it('throws when certificate pinning socket cannot provide certificate material', async () => {
    const { httpsRequestMock } = createHttpsRequestMock([
      ({ req }) => {
        const error = Object.assign(new Error('self signed'), {
          code: 'SELF_SIGNED_CERT_IN_CHAIN',
        });

        req.emit('error', error);
      },
    ]);

    const { tlsConnectMock } = createTlsConnectMock([
      { type: 'secure', fingerprint256: undefined, hasRaw: false },
    ]);

    const client = new TahomaApiClient({ host: 'tahoma.local', token: 'abc' }, {
      httpsRequest: httpsRequestMock as any,
      tlsConnect: tlsConnectMock as any,
      rootCertificates: [],
    });

    await expect(client.getDevices()).rejects.toThrow('Unable to pin TaHoma peer certificate.');
  });
});
