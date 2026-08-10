import { describe, expect, test } from 'bun:test';

import {
  isLocallyReachableHost,
  parseLsofListeners,
  parseNetstatListeners,
  selectDevServerCandidates,
} from './parse.js';

describe('lsof listener parsing', () => {
  test('associates every socket with the process record above it', () => {
    const output = [
      'p1234', 'cnode', 'n*:5173',
      'p5678', 'cpython3', 'n127.0.0.1:8000',
    ].join('\n');

    expect(parseLsofListeners(output)).toEqual([
      { port: 5173, pid: 1234, command: 'node' },
      { port: 8000, pid: 5678, command: 'python3' },
    ]);
  });

  test('keeps one entry when a process binds the same port on IPv4 and IPv6', () => {
    const output = ['p1234', 'cnode', 'n*:5173', 'n[::1]:5173'].join('\n');
    expect(parseLsofListeners(output)).toEqual([{ port: 5173, pid: 1234, command: 'node' }]);
  });

  test('unwraps bracketed IPv6 addresses', () => {
    expect(parseLsofListeners(['p1', 'cnode', 'n[::1]:3000'].join('\n')))
      .toEqual([{ port: 3000, pid: 1, command: 'node' }]);
  });

  test('skips sockets bound only to a LAN address, which localhost cannot reach', () => {
    expect(parseLsofListeners(['p1', 'cnode', 'n192.168.1.10:5173'].join('\n'))).toEqual([]);
  });

  test('skips established connections that slipped past the LISTEN filter', () => {
    expect(parseLsofListeners(['p1', 'cnode', 'n127.0.0.1:5173->127.0.0.1:60123'].join('\n')))
      .toEqual([]);
  });

  test('returns sorted results', () => {
    const output = ['p1', 'cnode', 'n*:9000', 'n*:3000', 'n*:5173'].join('\n');
    expect(parseLsofListeners(output).map((entry) => entry.port)).toEqual([3000, 5173, 9000]);
  });

  test('tolerates empty and malformed output rather than throwing', () => {
    expect(parseLsofListeners('')).toEqual([]);
    expect(parseLsofListeners(null)).toEqual([]);
    expect(parseLsofListeners('garbage\nn:\nnnotaport')).toEqual([]);
  });

  test('rejects out-of-range ports', () => {
    expect(parseLsofListeners(['p1', 'cnode', 'n*:70000', 'n*:0'].join('\n'))).toEqual([]);
  });
});

describe('netstat listener parsing', () => {
  const output = [
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:8000         0.0.0.0:0              LISTENING       9001',
    '  TCP    192.168.0.5:9999       0.0.0.0:0              LISTENING       9002',
    '  TCP    127.0.0.1:5173         127.0.0.1:60123        ESTABLISHED     9003',
  ].join('\n');

  test('takes listening loopback and wildcard sockets with their pid', () => {
    expect(parseNetstatListeners(output)).toEqual([
      { port: 5173, pid: 4242, command: '' },
      { port: 8000, pid: 9001, command: '' },
    ]);
  });

  test('ignores established connections and LAN-only binds', () => {
    const ports = parseNetstatListeners(output).map((entry) => entry.port);
    expect(ports).not.toContain(9999);
  });

  test('tolerates empty output', () => {
    expect(parseNetstatListeners('')).toEqual([]);
  });
});

describe('host reachability', () => {
  test('accepts loopback and wildcard binds', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]', '*', '0.0.0.0', '[::]']) {
      expect(isLocallyReachableHost(host)).toBe(true);
    }
  });

  test('rejects a specific LAN address', () => {
    expect(isLocallyReachableHost('192.168.1.4')).toBe(false);
  });
});

describe('candidate selection', () => {
  const listeners = [
    { port: 5173, pid: 10, command: 'node' },
    { port: 5432, pid: 11, command: 'postgres' },
    { port: 4096, pid: 12, command: 'openchamber' },
    { port: 3000, pid: 13, command: 'node' },
  ];

  test('drops OpenChamber own ports so the app never offers itself', () => {
    const ports = selectDevServerCandidates(listeners, { ownPorts: [4096] }).map((entry) => entry.port);
    expect(ports).toEqual([5173, 3000]);
  });

  test('drops sockets owned by our own process', () => {
    const ports = selectDevServerCandidates(listeners, { ownPids: [13] }).map((entry) => entry.port);
    expect(ports).toEqual([5173, 4096]);
  });

  test('drops well-known infrastructure ports that are never previewable', () => {
    const ports = selectDevServerCandidates(listeners).map((entry) => entry.port);
    expect(ports).not.toContain(5432);
  });

  test('keeps everything else, including unusual ports', () => {
    const ports = selectDevServerCandidates([{ port: 12345, pid: 1, command: 'bun' }]).map((entry) => entry.port);
    expect(ports).toEqual([12345]);
  });
});
