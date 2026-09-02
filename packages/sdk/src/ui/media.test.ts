import { describe, expect, test } from 'bun:test';

import { isIssueCardHttpUrl, splitIssueCardMedia, splitIssueCardRich } from './media.ts';

describe('splitIssueCardRich', () => {
  test('keeps plain text', () => {
    expect(splitIssueCardRich('Ship the picker.')).toEqual([
      { kind: 'text', text: 'Ship the picker.' },
    ]);
  });

  test('lifts markdown images and links in order', () => {
    expect(splitIssueCardRich('See ![login](https://uploads.linear.app/a.png) and [docs](https://linear.app/docs).')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'image', src: 'https://uploads.linear.app/a.png', alt: 'login' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', href: 'https://linear.app/docs', label: 'docs' },
      { kind: 'text', text: '.' },
    ]);
  });

  test('lifts an OpenChamber session comment as a link', () => {
    const body = '[OpenChamber session completed: OPE-296 Add Linear integration](http://127.0.0.1:3901/?session=ses_1)';
    expect(splitIssueCardRich(body)).toEqual([
      {
        kind: 'link',
        href: 'http://127.0.0.1:3901/?session=ses_1',
        label: 'OpenChamber session completed: OPE-296 Add Linear integration',
      },
    ]);
  });

  test('leaves a javascript URL as text', () => {
    expect(splitIssueCardRich('![x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '![x](javascript:alert(1))' },
    ]);
    expect(splitIssueCardRich('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1))' },
    ]);
  });
});

describe('splitIssueCardMedia', () => {
  test('keeps plain text', () => {
    expect(splitIssueCardMedia('Ship the picker.')).toEqual({
      body: 'Ship the picker.',
      images: [],
      links: [],
    });
  });

  test('lifts markdown images and leaves the caption', () => {
    expect(splitIssueCardMedia('See this:\n\n![login](https://uploads.linear.app/a.png)\n\nDone.')).toEqual({
      body: 'See this:\n\nDone.',
      images: [{ src: 'https://uploads.linear.app/a.png', alt: 'login' }],
      links: [],
    });
  });

  test('leaves a javascript URL as text', () => {
    expect(splitIssueCardMedia('![x](javascript:alert(1))')).toEqual({
      body: '![x](javascript:alert(1))',
      images: [],
      links: [],
    });
  });
});

describe('isIssueCardHttpUrl', () => {
  test('keeps http(s) only', () => {
    expect(isIssueCardHttpUrl('https://uploads.linear.app/a.png')).toBe(true);
    expect(isIssueCardHttpUrl('http://example.com/a.png')).toBe(true);
    expect(isIssueCardHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
