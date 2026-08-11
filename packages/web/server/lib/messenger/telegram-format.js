/**
 * Convert Discord-flavored / common markdown into Telegram HTML.
 *
 * Bridge renderers emit Discord markdown (`**bold**`, `` `code` ``, fenced
 * blocks, etc.). Telegram's legacy Markdown mode rejects or mangles that
 * dialect, so outbound Bot API messages previously went out as plain text —
 * markup characters stayed visible and agent replies looked messy.
 *
 * HTML parse mode is the reliable target: escape user text, map the subset
 * we actually emit, and let send/edit fall back to plain text if Telegram
 * still rejects a pathological payload.
 */

const PLACEHOLDER_RE = /\u0000TPH(\d+)\u0000/g;

function placeholder(index) {
  return `\u0000TPH${index}\u0000`;
}

/** Escape `<`, `>`, `&` for Telegram HTML text nodes. */
export function escapeTelegramHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHref(url) {
  // Telegram only allows http/https/(tg:) links in practice for agent content.
  const href = String(url ?? '').trim();
  if (!/^(https?:\/\/|tg:\/\/)/i.test(href)) return null;
  return escapeTelegramHtml(href).replace(/"/g, '&quot;');
}

/**
 * Turn markdown into Telegram HTML. Safe for plain text too (escapes only).
 * Never throws — unknown markup is left readable after escaping.
 */
export function markdownToTelegramHtml(input) {
  const raw = String(input ?? '');
  if (!raw) return '';

  const stash = [];
  const park = (html) => {
    const idx = stash.length;
    stash.push(html);
    return placeholder(idx);
  };

  // 1. Fenced code blocks — protect before any other markdown rewrite.
  //    Accept ```lang\n...\n``` and ```\n...\n``` (closing fence optional EOF).
  let text = raw.replace(/```([^\n`]*)\r?\n?([\s\S]*?)(?:```|$)/g, (_m, lang, code) => {
    const language = String(lang ?? '').trim();
    const body = escapeTelegramHtml(String(code ?? '').replace(/\r?\n$/, ''));
    if (language && /^[a-zA-Z0-9_+.-]+$/.test(language)) {
      return park(`<pre><code class="language-${language}">${body}</code></pre>`);
    }
    return park(`<pre>${body}</pre>`);
  });

  // 2. Inline code (single line).
  text = text.replace(/`([^`\n]+)`/g, (_m, code) => park(`<code>${escapeTelegramHtml(code)}</code>`));

  // 3. Blockquotes: runs of lines starting with `>`.
  text = text.replace(/(^|\n)((?:> ?[^\n]*(?:\n|$))+)/g, (match, lead, block) => {
    const trimmed = block.replace(/\n$/, '');
    if (!trimmed.trim()) return match;
    const inner = trimmed
      .split('\n')
      .map((line) => line.replace(/^> ?/, ''))
      .join('\n');
    // Inline formatting inside the quote, then escape leftovers.
    return `${lead}${park(`<blockquote>${formatInline(inner, park)}</blockquote>`)}`;
  });

  // 4. ATX headers → bold line.
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _hashes, title) =>
    park(`<b>${escapeTelegramHtml(String(title).trim())}</b>`),
  );

  // 5. Horizontal rules.
  text = text.replace(/^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/gm, () => park('────'));

  // 6. Remaining inline markdown on the whole string.
  text = formatInline(text, park);

  // 7. Restore parked HTML segments (may nest via blockquote → inline parks).
  for (let pass = 0; pass < 8; pass += 1) {
    if (!text.includes('\u0000TPH')) break;
    text = text.replace(PLACEHOLDER_RE, (_m, idx) => stash[Number(idx)] ?? '');
  }
  return text;
}

/**
 * Inline markdown → HTML placeholders + escaped plain text.
 * `park` comes from the outer converter so indices stay in one stash.
 */
function formatInline(input, park) {
  let text = String(input ?? '');

  // Park escaped markdown markers first so \* \_ etc. never become emphasis.
  text = text.replace(/\\([*_~`\\[\]()#>])/g, (_m, ch) => park(escapeTelegramHtml(ch)));

  // Discord auto-link form used by tool summaries: <https://…>
  text = text.replace(/<(https?:\/\/[^>\s]+)>/gi, (_m, url) => {
    const href = escapeHref(url);
    if (!href) return park(escapeTelegramHtml(url));
    return park(`<a href="${href}">${escapeTelegramHtml(url)}</a>`);
  });

  // Markdown links [label](url) — labels may contain escaped markup chars.
  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const href = escapeHref(url);
    const safeLabel = escapeTelegramHtml(label);
    if (!href) return park(safeLabel);
    return park(`<a href="${href}">${safeLabel}</a>`);
  });

  // Images ![alt](url) → linked alt text (Telegram has no inline images in text).
  text = text.replace(/!\[([^\]]*)]\(([^)\s]+)\)/g, (_m, alt, url) => {
    const href = escapeHref(url);
    const label = escapeTelegramHtml(alt || url);
    if (!href) return park(label);
    return park(`<a href="${href}">${label}</a>`);
  });

  // Bold **…** (before single *). Do not map `__…__` — that collides with
  // Python dunders (`__init__`) that agents mention outside code fences.
  text = text.replace(/\*\*(.+?)\*\*/gs, (_m, body) => park(`<b>${escapeTelegramHtml(body)}</b>`));

  // Strikethrough ~~…~~
  text = text.replace(/~~(.+?)~~/gs, (_m, body) => park(`<s>${escapeTelegramHtml(body)}</s>`));

  // Italic *…* (single asterisks, single line, non-empty)
  text = text.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, (_m, body) =>
    park(`<i>${escapeTelegramHtml(body)}</i>`),
  );

  // Italic _…_ with word boundaries so snake_case / __dunder__ stay intact.
  text = text.replace(/(?<!\w)_(?!_)([^_\n]+?)(?<!_)_(?!\w)/g, (_m, body) =>
    park(`<i>${escapeTelegramHtml(body)}</i>`),
  );

  return escapeTelegramHtml(text);
}

/**
 * Prepare outbound Bot API text: always HTML when conversion succeeds.
 * Callers may still fall back to plain text if Telegram rejects entities.
 */
export function prepareTelegramHtml(text) {
  return {
    text: markdownToTelegramHtml(text),
    parseMode: 'HTML',
  };
}

/** True when Telegram rejected the payload for bad entities / parse mode. */
export function isTelegramParseError(body) {
  const description = typeof body?.description === 'string' ? body.description : '';
  return /parse entities|can't parse|unsupported start tag|unexpected end tag|wrong.*entity/i.test(
    description,
  );
}
