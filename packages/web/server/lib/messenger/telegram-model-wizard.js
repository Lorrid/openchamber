import crypto from 'node:crypto';
import {
  modelsOf,
  formatModelMeta,
  variantsOf,
} from './discord-model-wizard.js';
import {
  sendTelegramMessage,
  editTelegramMessageText,
  answerTelegramCallbackQuery,
  buildTelegramInlineKeyboard,
} from './telegram-api.js';
import {
  PREV_VALUE,
  NEXT_VALUE,
  TELEGRAM_PAGE_SIZE,
  createWizardStore,
  botHashFor,
  renderTelegramOptionPage,
  parseTelegramPickCallback,
  parseTelegramHashCallback,
  resolvePageValue,
} from './telegram-wizard-ui.js';

/**
 * Interactive `/model` wizard for Telegram — same flow as Discord's
 * `createDiscordModelWizard`, rendered with inline keyboards instead of
 * string-select menus.
 *
 *   /model → provider → model (+ page) → optional effort → scope → resend
 */

const PROVIDER_PREFIX = 'oc-mp:';
const MODEL_PREFIX = 'oc-mm:';
const EFFORT_PREFIX = 'oc-me:';
const SCOPE_PREFIX = 'oc-ms:';
const RESEND_PREFIX = 'oc-mr:';
const BACK_PREFIX = 'oc-mb:';
const MODEL_PAGE_PREV_PREFIX = 'oc-mpp:';
const MODEL_PAGE_NEXT_PREFIX = 'oc-mpn:';

const FAVORITES_ID = '__openchamber_agent_favorites';
const EFFORT_NONE = '__openchamber_agent_effort_none';

const STAGE_PROVIDER = 'provider';
const STAGE_MODEL = 'model';
const STAGE_EFFORT = 'effort';
const STAGE_SCOPE = 'scope';

const ALL_PREFIXES = [
  PROVIDER_PREFIX,
  MODEL_PREFIX,
  EFFORT_PREFIX,
  SCOPE_PREFIX,
  RESEND_PREFIX,
  BACK_PREFIX,
  MODEL_PAGE_PREV_PREFIX,
  MODEL_PAGE_NEXT_PREFIX,
];

function modelKey(providerId, model) {
  const id = model?.id ?? model?.name;
  return id ? `${providerId}/${id}` : null;
}

function visibleModelsOf(provider, hiddenSet) {
  const all = modelsOf(provider);
  if (!hiddenSet || hiddenSet.size === 0) return all;
  return all.filter((m) => !hiddenSet.has(modelKey(provider.id, m)));
}

function findModel(providersById, providerId, modelId) {
  const provider = providersById?.get(providerId);
  if (!provider) return null;
  return modelsOf(provider).find((m) => (m.id ?? m.name) === modelId) ?? null;
}

function currentLine(info) {
  if (!info?.model) return 'Current model: _OpenCode default_';
  const effort = info.variant ? ` · effort \`${info.variant}\`` : '';
  const src = info.source ? ` _(${info.source})_` : '';
  return `Current model: \`${info.model}\`${effort}${src}`;
}

export function createTelegramModelWizard({ bridge }) {
  const wizards = createWizardStore();

  function ownsCallback(data) {
    return typeof data === 'string' && ALL_PREFIXES.some((p) => data.startsWith(p));
  }

  async function answer(token, callbackQueryId, text = null, showAlert = false) {
    await answerTelegramCallbackQuery({ token, callbackQueryId, text, showAlert }).catch(() => {});
  }

  async function sendOrEdit(wizard, { text, replyMarkup, edit }) {
    if (edit && wizard.messageId != null) {
      const r = await editTelegramMessageText({
        token: wizard.token,
        chatId: wizard.chatId,
        messageId: wizard.messageId,
        text,
        replyMarkup: replyMarkup ?? { inline_keyboard: [] },
      });
      return r;
    }
    const r = await sendTelegramMessage({
      token: wizard.token,
      chatId: wizard.chatId,
      text,
      messageThreadId: wizard.threadId,
      replyMarkup,
    });
    if (r.ok && r.messageId != null) {
      wizard.messageId = r.messageId;
      wizards.set(wizard.hash, wizard);
    }
    return r;
  }

  function modelVariants(wizard, providerId, modelId) {
    const provider = wizard.providersById?.get(providerId);
    if (!provider) return [];
    const model = modelsOf(provider).find((m) => (m.id ?? m.name) === modelId);
    return variantsOf(model);
  }

  function providerItems(entries) {
    return entries.map((e) => ({
      label: (e.name ?? e.id).slice(0, 40),
      value: e.id,
      description: `${e.count} model${e.count === 1 ? '' : 's'}`.slice(0, 20),
    }));
  }

  function modelItems(models) {
    return models.map((m) => ({
      label: (m.label ?? m.name ?? m.id ?? String(m)).slice(0, 40),
      value: m.value ?? m.id ?? m.name ?? String(m),
      description: ((m.description || formatModelMeta(m)) || '').slice(0, 20),
    }));
  }

  function renderProviderMarkup(hash, wizard) {
    return renderTelegramOptionPage(
      PROVIDER_PREFIX,
      hash,
      providerItems(wizard.entries),
      wizard.providerPage ?? 0,
      wizard,
      { pageSize: TELEGRAM_PAGE_SIZE, includeInSelectNav: true },
    );
  }

  function renderModelMarkup(hash, wizard) {
    return renderTelegramOptionPage(
      MODEL_PREFIX,
      hash,
      modelItems(wizard.models ?? []),
      wizard.modelPage ?? 0,
      wizard,
      {
        pageSize: TELEGRAM_PAGE_SIZE,
        includeInSelectNav: false,
        backPrefix: BACK_PREFIX,
        pagePrevPrefix: MODEL_PAGE_PREV_PREFIX,
        pageNextPrefix: MODEL_PAGE_NEXT_PREFIX,
      },
    );
  }

  function renderEffortMarkup(hash, wizard) {
    const variants = modelVariants(wizard, wizard.selectedProviderId, wizard.selectedModelLocal);
    const items = [
      { label: 'Default (no thinking effort)', value: EFFORT_NONE, description: 'Let the model decide' },
      ...variants.map((v) => ({ label: v, value: v, description: `Effort: ${v}` })),
    ];
    return renderTelegramOptionPage(EFFORT_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: false,
      backPrefix: BACK_PREFIX,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
  }

  function renderScopeMarkup(hash, wizard) {
    const items = [
      { label: 'This conversation', value: 'conversation', description: 'Override here only' },
      { label: 'This project', value: 'project', description: "Project default" },
      { label: 'Whole system (default)', value: 'global', description: 'Everywhere' },
    ];
    return renderTelegramOptionPage(SCOPE_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: false,
      backPrefix: BACK_PREFIX,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
  }

  /**
   * Start the wizard from a Telegram `/model` message.
   * @param {object} state listener state
   * @param {{ chatId: string, threadId?: string|number|null, from?: object, messageId?: number }} ctx
   */
  async function start(state, ctx) {
    const hash = crypto.randomBytes(6).toString('hex');
    const chatId = String(ctx.chatId);
    const threadId = ctx.threadId != null ? ctx.threadId : null;

    let providerData;
    try {
      providerData = await bridge?.fetchProviders?.();
    } catch {
      providerData = null;
    }

    if (!providerData || !Array.isArray(providerData.all) || providerData.all.length === 0) {
      const result = await bridge?.runCommand?.({
        type: 'telegram',
        token: state.token,
        channelId: chatId,
        threadId,
        commandName: 'model',
      });
      await sendTelegramMessage({
        token: state.token,
        chatId,
        text: result?.reply?.slice(0, 4096) ?? '_(no providers configured)_',
        messageThreadId: threadId,
      });
      return { ok: true, fallbackText: true };
    }

    const all = providerData.all;
    const providersById = new Map(all.map((p) => [p.id, p]));
    const connectedSet = new Set(Array.isArray(providerData.connected) ? providerData.connected : []);
    const connected = all.filter((p) => connectedSet.has(p.id));
    const realProviders = connected.length > 0 ? connected : all;

    const rawFavorites = (await bridge?.getFavoriteModels?.().catch(() => [])) ?? [];
    const hiddenList = (await bridge?.getHiddenModels?.().catch(() => [])) ?? [];
    const hiddenSet = new Set(
      hiddenList.map(({ providerID, modelID }) => `${providerID}/${modelID}`),
    );
    const favorites = rawFavorites.filter(({ providerID, modelID }) => {
      if (hiddenSet.has(`${providerID}/${modelID}`)) return false;
      return Boolean(findModel(providersById, providerID, modelID));
    });

    const entries = [];
    if (favorites.length > 0) {
      entries.push({ id: FAVORITES_ID, name: '⭐ Favourites', count: favorites.length });
    }
    for (const p of realProviders) {
      const count = visibleModelsOf(p, hiddenSet).length;
      if (count === 0) continue;
      entries.push({ id: p.id, name: p.name ?? p.id, count });
    }

    const current =
      (await bridge
        ?.getSurfaceModelInfo?.({
          type: 'telegram',
          token: state.token,
          channelId: chatId,
          threadId,
        })
        .catch(() => null)) ?? null;

    const wizard = {
      hash,
      token: state.token,
      chatId,
      threadId,
      from: ctx.from ?? null,
      providersById,
      favorites,
      hiddenSet,
      entries,
      providerPage: 0,
      modelPage: 0,
      stage: STAGE_PROVIDER,
      hadEffortStep: false,
      messageId: null,
    };
    wizards.set(hash, wizard);

    const markup = renderProviderMarkup(hash, wizard);
    const text = `*Set model*\n${currentLine(current)}\n\nSelect a provider:`;
    const sent = await sendTelegramMessage({
      token: state.token,
      chatId,
      text,
      messageThreadId: threadId,
      replyMarkup: markup,
    });
    if (sent.ok) {
      wizard.messageId = sent.messageId;
      wizards.set(hash, wizard);
    }
    return { ok: true };
  }

  async function handleCallback(state, callbackQuery) {
    const data = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
    const token = state.token;
    const callbackQueryId = callbackQuery.id;

    const pickProvider = parseTelegramPickCallback(data, PROVIDER_PREFIX);
    if (pickProvider) {
      await answer(token, callbackQueryId);
      return onProviderSelect(pickProvider.hash, pickProvider.index);
    }
    const pickModel = parseTelegramPickCallback(data, MODEL_PREFIX);
    if (pickModel) {
      await answer(token, callbackQueryId);
      return onModelSelect(pickModel.hash, pickModel.index);
    }
    const pickEffort = parseTelegramPickCallback(data, EFFORT_PREFIX);
    if (pickEffort) {
      await answer(token, callbackQueryId);
      return onEffortSelect(pickEffort.hash, pickEffort.index);
    }
    const pickScope = parseTelegramPickCallback(data, SCOPE_PREFIX);
    if (pickScope) {
      await answer(token, callbackQueryId);
      return onScopeSelect(pickScope.hash, pickScope.index);
    }
    const back = parseTelegramHashCallback(data, BACK_PREFIX);
    if (back) {
      await answer(token, callbackQueryId);
      return onBack(back.hash);
    }
    const prev = parseTelegramHashCallback(data, MODEL_PAGE_PREV_PREFIX);
    if (prev) {
      await answer(token, callbackQueryId);
      return onModelPage(prev.hash, -1);
    }
    const next = parseTelegramHashCallback(data, MODEL_PAGE_NEXT_PREFIX);
    if (next) {
      await answer(token, callbackQueryId);
      return onModelPage(next.hash, 1);
    }
    const resend = parseTelegramHashCallback(data, RESEND_PREFIX);
    if (resend) {
      await answer(token, callbackQueryId);
      return onResend(resend.hash);
    }
  }

  async function onBack(hash) {
    const wizard = wizards.get(hash);
    if (!wizard) return;

    if (wizard.stage === STAGE_SCOPE) {
      if (wizard.hadEffortStep) {
        wizard.stage = STAGE_EFFORT;
        wizard.selectedVariant = null;
        wizards.set(hash, wizard);
        await sendOrEdit(wizard, {
          text: `*Set model*\nModel: \`${wizard.selectedModelId}\`\nSelect thinking effort:`,
          replyMarkup: renderEffortMarkup(hash, wizard),
          edit: true,
        });
        return;
      }
      wizard.stage = STAGE_MODEL;
      wizard.selectedModelId = null;
      wizard.selectedProviderId = null;
      wizard.selectedModelLocal = null;
      wizard.selectedVariant = null;
      wizards.set(hash, wizard);
      await sendOrEdit(wizard, {
        text: `*Set model*\nProvider: *${wizard.providerName}*\nSelect a model:`,
        replyMarkup: renderModelMarkup(hash, wizard),
        edit: true,
      });
      return;
    }

    if (wizard.stage === STAGE_EFFORT) {
      wizard.stage = STAGE_MODEL;
      wizard.selectedModelId = null;
      wizard.selectedProviderId = null;
      wizard.selectedModelLocal = null;
      wizard.selectedVariant = null;
      wizard.hadEffortStep = false;
      wizards.set(hash, wizard);
      await sendOrEdit(wizard, {
        text: `*Set model*\nProvider: *${wizard.providerName}*\nSelect a model:`,
        replyMarkup: renderModelMarkup(hash, wizard),
        edit: true,
      });
      return;
    }

    wizard.stage = STAGE_PROVIDER;
    wizard.isFavorites = false;
    wizard.providerId = null;
    wizard.providerName = null;
    wizard.models = null;
    wizard.modelPage = 0;
    wizard.selectedModelId = null;
    wizard.selectedProviderId = null;
    wizard.selectedModelLocal = null;
    wizard.selectedVariant = null;
    wizard.hadEffortStep = false;
    wizards.set(hash, wizard);
    await sendOrEdit(wizard, {
      text: '*Set model*\nSelect a provider:',
      replyMarkup: renderProviderMarkup(hash, wizard),
      edit: true,
    });
  }

  async function onModelPage(hash, delta) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    wizard.modelPage = Math.max(0, (wizard.modelPage ?? 0) + delta);
    wizard.stage = STAGE_MODEL;
    wizards.set(hash, wizard);
    await sendOrEdit(wizard, {
      text: `*Set model*\nProvider: *${wizard.providerName}*\nSelect a model:`,
      replyMarkup: renderModelMarkup(hash, wizard),
      edit: true,
    });
  }

  async function onProviderSelect(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;

    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.providerPage = (wizard.providerPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      wizard.stage = STAGE_PROVIDER;
      wizards.set(hash, wizard);
      await sendOrEdit(wizard, {
        text: '*Set model*\nSelect a provider:',
        replyMarkup: renderProviderMarkup(hash, wizard),
        edit: true,
      });
      return;
    }

    let models;
    if (value === FAVORITES_ID) {
      wizard.isFavorites = true;
      wizard.providerId = FAVORITES_ID;
      wizard.providerName = '⭐ Favourites';
      models = wizard.favorites.map(({ providerID, modelID }) => {
        const model = findModel(wizard.providersById, providerID, modelID);
        const meta = model ? formatModelMeta(model) : '';
        return {
          value: `${providerID}/${modelID}`,
          label: modelID,
          description: meta || providerID,
        };
      });
    } else {
      const provider = wizard.providersById?.get(value);
      if (!provider) return;
      wizard.isFavorites = false;
      wizard.providerId = provider.id;
      wizard.providerName = provider.name ?? provider.id;
      models = visibleModelsOf(provider, wizard.hiddenSet);
    }

    if (!models || models.length === 0) {
      await sendOrEdit(wizard, {
        text: `Provider *${wizard.providerName}* has no models available.`,
        replyMarkup: null,
        edit: true,
      });
      return;
    }

    wizard.models = models;
    wizard.modelPage = 0;
    wizard.stage = STAGE_MODEL;
    wizard.hadEffortStep = false;
    wizards.set(hash, wizard);
    await sendOrEdit(wizard, {
      text: `*Set model*\nProvider: *${wizard.providerName}*\nSelect a model:`,
      replyMarkup: renderModelMarkup(hash, wizard),
      edit: true,
    });
  }

  async function onModelSelect(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;

    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.modelPage = (wizard.modelPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      wizard.stage = STAGE_MODEL;
      wizards.set(hash, wizard);
      await sendOrEdit(wizard, {
        text: `*Set model*\nProvider: *${wizard.providerName}*\nSelect a model:`,
        replyMarkup: renderModelMarkup(hash, wizard),
        edit: true,
      });
      return;
    }

    const modelId = wizard.isFavorites ? value : `${wizard.providerId}/${value}`;
    const slash = modelId.indexOf('/');
    const providerId = modelId.slice(0, slash);
    const localId = modelId.slice(slash + 1);
    wizard.selectedModelId = modelId;
    wizard.selectedProviderId = providerId;
    wizard.selectedModelLocal = localId;
    wizards.set(hash, wizard);

    const variants = modelVariants(wizard, providerId, localId);
    if (variants.length > 0) {
      wizard.stage = STAGE_EFFORT;
      wizard.hadEffortStep = true;
      wizards.set(hash, wizard);
      await sendOrEdit(wizard, {
        text: `*Set model*\nModel: \`${wizard.selectedModelId}\`\nSelect thinking effort:`,
        replyMarkup: renderEffortMarkup(hash, wizard),
        edit: true,
      });
      return;
    }

    wizard.selectedVariant = null;
    wizard.hadEffortStep = false;
    await promptScope(wizard, hash);
  }

  async function onEffortSelect(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    wizard.selectedVariant = value === EFFORT_NONE ? null : value;
    wizard.hadEffortStep = true;
    await promptScope(wizard, hash);
  }

  async function promptScope(wizard, hash) {
    wizard.stage = STAGE_SCOPE;
    wizards.set(hash, wizard);
    const effortLine = wizard.selectedVariant ? ` · effort \`${wizard.selectedVariant}\`` : '';
    await sendOrEdit(wizard, {
      text: `*Set model*\nModel: \`${wizard.selectedModelId}\`${effortLine}\nApply to:`,
      replyMarkup: renderScopeMarkup(hash, wizard),
      edit: true,
    });
  }

  async function onScopeSelect(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const scope = resolvePageValue(wizard, index);
    if (!scope) return;

    const model = wizard.selectedModelId;
    const variant = wizard.selectedVariant ?? null;
    const surface = {
      type: 'telegram',
      token: wizard.token,
      channelId: wizard.chatId,
      threadId: wizard.threadId,
    };
    const targetKey =
      wizard.threadId != null ? `${wizard.chatId}:${wizard.threadId}` : String(wizard.chatId);
    let scopeLabel = 'this conversation';

    try {
      if (scope === 'global') {
        const r = await bridge?.setGlobalDefaultModel?.({ model, variant });
        scopeLabel = r?.ok === false ? 'this conversation (system default is read-only)' : 'the whole system';
        if (r?.ok === false) {
          bridge?.setSurfaceModel?.({ ...surface, model, variant });
        }
      } else if (scope === 'project') {
        const binding = bridge?.store?.lookup?.({
          type: 'telegram',
          botTokenHash: botHashFor(wizard.token),
          targetKey,
        });
        if (binding?.projectPath) {
          bridge?.store?.setProjectDefaults?.({
            projectPath: binding.projectPath,
            projectLabel: binding.projectLabel,
            modelDefault: model,
            variantDefault: variant,
          });
          scopeLabel = `project *${binding.projectLabel ?? binding.projectPath}*`;
        } else {
          bridge?.setSurfaceModel?.({ ...surface, model, variant });
          scopeLabel = 'this conversation (no project bound yet)';
        }
      } else {
        bridge?.setSurfaceModel?.({ ...surface, model, variant });
        scopeLabel = 'this conversation';
      }
    } catch {
      // best-effort
    }

    wizard.modelDisplay = model;
    wizards.set(hash, wizard);
    const effortLine = variant ? `\nThinking effort: \`${variant}\`` : '';
    await sendOrEdit(wizard, {
      text:
        `✓ Model for ${scopeLabel}:\n\`${model}\`${effortLine}\n\n` +
        'Press *Send last message* to re-run your previous message with this model.',
      replyMarkup: buildTelegramInlineKeyboard([
        [{ text: '▶ Send last message', callbackData: `${RESEND_PREFIX}${hash}` }],
      ]),
      edit: true,
    });
  }

  async function onResend(hash) {
    const wizard = wizards.get(hash);
    if (!wizard) return;

    await sendOrEdit(wizard, {
      text: `▶ Re-sending your last message under \`${wizard.modelDisplay}\`…`,
      replyMarkup: null,
      edit: true,
    });
    wizards.del(hash);

    let result = null;
    try {
      result = await bridge?.resendLastMessage?.({
        type: 'telegram',
        token: wizard.token,
        channelId: wizard.chatId,
        threadId: wizard.threadId,
        from: wizard.from,
      });
    } catch (err) {
      result = { ok: false, error: err?.message ?? 'send failed' };
    }

    if (!result?.ok) {
      await editTelegramMessageText({
        token: wizard.token,
        chatId: wizard.chatId,
        messageId: wizard.messageId,
        text: `⚠ Could not re-send: ${result?.error ?? 'no previous message found'}.`,
        replyMarkup: { inline_keyboard: [] },
      }).catch(() => {});
    }
  }

  return { start, handleCallback, ownsCallback };
}
