import {
  PREV_VALUE,
  NEXT_VALUE,
  buildPagedOptions,
  randomWizardHash,
  createWizardStore,
  botHashFor,
} from './discord-wizard-shared.js';
import { buildTelegramInlineKeyboard } from './telegram-api.js';

/**
 * Telegram UI helpers for interactive wizards that mirror Discord select menus.
 *
 * Discord string-selects put the chosen value in `interaction.data.values`.
 * Telegram inline buttons must pack everything into `callback_data` (≤64 bytes),
 * so each rendered page stores its values on the wizard and buttons send an
 * index (`prefix + hash + ":" + index`). Nav/back/resend use dedicated prefixes.
 */

/** Comfortable page size for Telegram button lists (mobile). */
export const TELEGRAM_PAGE_SIZE = 8;

export {
  PREV_VALUE,
  NEXT_VALUE,
  buildPagedOptions,
  randomWizardHash,
  createWizardStore,
  botHashFor,
};

/**
 * Build one-column inline keyboard rows for the current page of options.
 * Stores `wizard.pageValues` so callback indices resolve to stable values.
 *
 * @param {string} pickPrefix e.g. `oc-mp:`
 * @param {string} hash wizard hash
 * @param {Array<{ label: string, value: string, description?: string }>} items
 * @param {number} page
 * @param {object} wizard mutable wizard state (receives pageValues)
 * @param {{
 *   backPrefix?: string,
 *   pagePrevPrefix?: string,
 *   pageNextPrefix?: string,
 *   includeInSelectNav?: boolean,
 *   pageSize?: number,
 * }} [opts]
 */
export function renderTelegramOptionPage(pickPrefix, hash, items, page, wizard, opts = {}) {
  const includeNav = opts.includeInSelectNav !== false && !opts.pagePrevPrefix;
  const pageSize = opts.pageSize ?? TELEGRAM_PAGE_SIZE;
  const { options, page: safePage, totalPages } = buildPagedOptions(items, page, {
    includeNav,
    pageSize,
  });

  const pickable = [];
  const rows = [];
  for (const opt of options) {
    if (opt.value === PREV_VALUE || opt.value === NEXT_VALUE) {
      // In-select nav values become dedicated nav buttons when button nav is used;
      // when includeNav is true they are already in `options` as pickable rows.
      pickable.push(opt.value);
      rows.push([{ text: opt.label.slice(0, 64), callbackData: `${pickPrefix}${hash}:${pickable.length - 1}` }]);
      continue;
    }
    pickable.push(opt.value);
    const desc = opt.description ? ` — ${opt.description}` : '';
    const label = `${opt.label}${desc}`.slice(0, 64);
    rows.push([{ text: label, callbackData: `${pickPrefix}${hash}:${pickable.length - 1}` }]);
  }

  wizard.pageValues = pickable;
  wizard.page = safePage;
  wizard.totalPages = totalPages;

  const nav = [];
  if (opts.backPrefix) {
    nav.push({ text: '← Back', callbackData: `${opts.backPrefix}${hash}` });
  }
  if (opts.pagePrevPrefix && safePage > 0) {
    nav.push({
      text: `◀ ${safePage}/${totalPages}`,
      callbackData: `${opts.pagePrevPrefix}${hash}`,
    });
  }
  if (opts.pageNextPrefix && safePage < totalPages - 1) {
    nav.push({
      text: `More ▶ (${safePage + 2}/${totalPages})`,
      callbackData: `${opts.pageNextPrefix}${hash}`,
    });
  }
  if (nav.length > 0) rows.push(nav);

  return buildTelegramInlineKeyboard(rows);
}

/** Resolve a pick callback `prefix+hash:index` into `{ hash, value }`. */
export function parseTelegramPickCallback(data, prefix) {
  if (typeof data !== 'string' || !data.startsWith(prefix)) return null;
  const rest = data.slice(prefix.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const hash = rest.slice(0, colon);
  const index = Number(rest.slice(colon + 1));
  if (!hash || !Number.isFinite(index)) return null;
  return { hash, index };
}

/** Resolve a bare `prefix+hash` callback (back / page / resend). */
export function parseTelegramHashCallback(data, prefix) {
  if (typeof data !== 'string' || !data.startsWith(prefix)) return null;
  const hash = data.slice(prefix.length);
  return hash ? { hash } : null;
}

export function resolvePageValue(wizard, index) {
  if (!wizard || !Array.isArray(wizard.pageValues)) return null;
  if (!Number.isFinite(index) || index < 0 || index >= wizard.pageValues.length) return null;
  return wizard.pageValues[index];
}
