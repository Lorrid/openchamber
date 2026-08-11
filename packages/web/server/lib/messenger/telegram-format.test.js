import { describe, expect, it } from 'vitest';
import {
  escapeTelegramHtml,
  markdownToTelegramHtml,
  prepareTelegramHtml,
  isTelegramParseError,
} from './telegram-format.js';

describe('escapeTelegramHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeTelegramHtml('a <b> & c > d')).toBe('a &lt;b&gt; &amp; c &gt; d');
  });
});

describe('markdownToTelegramHtml', () => {
  it('converts bold, italic, strike, and inline code', () => {
    const html = markdownToTelegramHtml('**bold** and *italic* and ~~old~~ and `code`');
    expect(html).toBe('<b>bold</b> and <i>italic</i> and <s>old</s> and <code>code</code>');
  });

  it('converts underscore italic without mangling snake_case or dunders', () => {
    expect(markdownToTelegramHtml('_thinking…_')).toBe('<i>thinking…</i>');
    expect(markdownToTelegramHtml('use snake_case and __init__ please')).toBe(
      'use snake_case and __init__ please',
    );
  });

  it('renders fenced code blocks as pre/code with optional language', () => {
    expect(markdownToTelegramHtml('```js\nconst x = 1\n```')).toBe(
      '<pre><code class="language-js">const x = 1</code></pre>',
    );
    expect(markdownToTelegramHtml('```\nplain\n```')).toBe('<pre>plain</pre>');
  });

  it('escapes HTML inside code and text', () => {
    expect(markdownToTelegramHtml('use <script> & more')).toBe(
      'use &lt;script&gt; &amp; more',
    );
    expect(markdownToTelegramHtml('`a <b> & c`')).toBe('<code>a &lt;b&gt; &amp; c</code>');
  });

  it('converts Discord tool one-liners and permission prompts', () => {
    const tool = markdownToTelegramHtml('⬦ **bash** `ls -la`');
    expect(tool).toBe('⬦ <b>bash</b> <code>ls -la</code>');

    const perm = markdownToTelegramHtml('**⚠️ Permission Required**\n**Type:** `bash`');
    expect(perm).toContain('<b>⚠️ Permission Required</b>');
    expect(perm).toContain('<b>Type:</b> <code>bash</code>');
  });

  it('converts markdown and Discord auto-links', () => {
    expect(markdownToTelegramHtml('[docs](https://example.com/a)')).toBe(
      '<a href="https://example.com/a">docs</a>',
    );
    expect(markdownToTelegramHtml('<https://example.com/x>')).toBe(
      '<a href="https://example.com/x">https://example.com/x</a>',
    );
  });

  it('converts blockquotes and ATX headers', () => {
    expect(markdownToTelegramHtml('> line one\n> line two')).toBe(
      '<blockquote>line one\nline two</blockquote>',
    );
    expect(markdownToTelegramHtml('## Hello')).toBe('<b>Hello</b>');
  });

  it('converts todo / plan checklist markup', () => {
    const html = markdownToTelegramHtml(
      '📋 **Plan** — 1/2 done  `▰▱▱▱▱` 20%\n\n✅ ~~Ship it~~\n🔄 **Next task**',
    );
    expect(html).toContain('<b>Plan</b>');
    expect(html).toContain('<code>▰▱▱▱▱</code>');
    expect(html).toContain('<s>Ship it</s>');
    expect(html).toContain('<b>Next task</b>');
  });

  it('leaves escaped markdown markers as literals', () => {
    expect(markdownToTelegramHtml('\\*not bold\\*')).toBe('*not bold*');
  });

  it('handles empty input', () => {
    expect(markdownToTelegramHtml('')).toBe('');
    expect(markdownToTelegramHtml(null)).toBe('');
  });
});

describe('prepareTelegramHtml', () => {
  it('returns HTML parse mode', () => {
    expect(prepareTelegramHtml('**hi**')).toEqual({ text: '<b>hi</b>', parseMode: 'HTML' });
  });
});

describe('isTelegramParseError', () => {
  it('detects entity parse failures', () => {
    expect(isTelegramParseError({ description: "Bad Request: can't parse entities" })).toBe(true);
    expect(isTelegramParseError({ description: 'Forbidden' })).toBe(false);
  });
});
