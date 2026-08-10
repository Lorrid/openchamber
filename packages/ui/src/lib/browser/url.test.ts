import { describe, expect, test } from 'bun:test';

import { BLANK_URL, browserUrlLabel, isLoopbackUrl, normalizeBrowserUrl } from './url';

describe('normalizeBrowserUrl', () => {
  test('keeps an explicit scheme', () => {
    expect(normalizeBrowserUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(normalizeBrowserUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  test('defaults a public host to https', () => {
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com/');
  });

  test('defaults a loopback authority to http, since dev servers speak plain http', () => {
    expect(normalizeBrowserUrl('localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeBrowserUrl('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app');
    expect(normalizeBrowserUrl('localhost')).toBe('http://localhost/');
  });

  test('does not mistake a public host that merely starts with a loopback-looking label', () => {
    expect(normalizeBrowserUrl('localhost.example.com')).toBe('https://localhost.example.com/');
  });

  test('rejects non-http schemes rather than handing them to the browser', () => {
    expect(normalizeBrowserUrl('file:///etc/passwd')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('javascript://alert(1)')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('data://text/html,x')).toBe(BLANK_URL);
  });

  test('treats empty and unparseable input as blank', () => {
    expect(normalizeBrowserUrl('')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('   ')).toBe(BLANK_URL);
    expect(normalizeBrowserUrl('http://')).toBe(BLANK_URL);
  });
});

describe('isLoopbackUrl', () => {
  test('recognizes loopback hosts', () => {
    expect(isLoopbackUrl('http://localhost:5173/')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1/')).toBe(true);
  });

  test('rejects remote hosts and garbage', () => {
    expect(isLoopbackUrl('https://example.com/')).toBe(false);
    expect(isLoopbackUrl('nonsense')).toBe(false);
  });
});

describe('browserUrlLabel', () => {
  test('shows host and port', () => {
    expect(browserUrlLabel('http://localhost:5173/a/b')).toBe('localhost:5173');
  });

  test('is empty for a blank page', () => {
    expect(browserUrlLabel(BLANK_URL)).toBe('');
    expect(browserUrlLabel('')).toBe('');
  });
});
