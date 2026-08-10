import { VERBOSITY_LEVELS } from './messenger-verbosity.js';
import {
  PERMISSION_MODES,
  PERMISSION_MODE_DESCRIPTIONS,
  PERMISSION_MODE_LABELS,
} from './messenger-permissions.js';
import {
  sendTelegramMessage,
  editTelegramMessageText,
  answerTelegramCallbackQuery,
} from './telegram-api.js';
import {
  PREV_VALUE,
  NEXT_VALUE,
  TELEGRAM_PAGE_SIZE,
  createWizardStore,
  botHashFor,
  randomWizardHash,
  renderTelegramOptionPage,
  parseTelegramPickCallback,
  parseTelegramHashCallback,
  resolvePageValue,
} from './telegram-wizard-ui.js';

/**
 * Telegram interactive wizards for `/verbosity`, `/agent`, `/skill`,
 * `/yolo`|`/permissions`, and `/login` — same flows as Discord's
 * `createDiscordCommandWizards`, rendered with inline keyboards.
 */

const VERB_LEVEL_PREFIX = 'oc-vl:';
const VERB_SCOPE_PREFIX = 'oc-vs:';
const AGENT_PICK_PREFIX = 'oc-ap:';
const AGENT_SCOPE_PREFIX = 'oc-as:';
const SKILL_PICK_PREFIX = 'oc-sk:';
const PERM_MODE_PREFIX = 'oc-pm:';
const PERM_SCOPE_PREFIX = 'oc-ps:';
const LOGIN_PROVIDER_PREFIX = 'oc-lp:';
const LOGIN_METHOD_PREFIX = 'oc-lm:';

const PREFIXES = [
  VERB_LEVEL_PREFIX,
  VERB_SCOPE_PREFIX,
  AGENT_PICK_PREFIX,
  AGENT_SCOPE_PREFIX,
  SKILL_PICK_PREFIX,
  PERM_MODE_PREFIX,
  PERM_SCOPE_PREFIX,
  LOGIN_PROVIDER_PREFIX,
  LOGIN_METHOD_PREFIX,
];

const VERBOSITY_LABELS = {
  quiet: 'quiet',
  normal: 'default',
  verbose: 'verbose',
};

const VERBOSITY_DESCRIPTIONS = {
  quiet: 'Final answer only — hides reasoning + tool activity',
  normal: 'Compact feed: tool names + thinking marker (default)',
  verbose: 'Full detail: commands, diffs, outputs, reasoning',
};

function normalizeAuthMethodType(method) {
  const raw = typeof method?.type === 'string' ? method.type : '';
  const label = `${method?.name ?? ''} ${method?.label ?? ''}`.toLowerCase();
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
}

function extractOAuthDetails(payload) {
  const record =
    payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
      ? payload.data
      : payload;
  const data = record && typeof record === 'object' ? record : {};
  return {
    url:
      typeof data.url === 'string'
        ? data.url
        : typeof data.verificationUri === 'string'
          ? data.verificationUri
          : null,
    instructions: typeof data.instructions === 'string' ? data.instructions : null,
    userCode:
      typeof data.userCode === 'string' ? data.userCode : typeof data.code === 'string' ? data.code : null,
  };
}

function surfaceKey(wizard) {
  return wizard.threadId != null ? `${wizard.chatId}:${wizard.threadId}` : String(wizard.chatId);
}

function surfaceOf(wizard) {
  return {
    type: 'telegram',
    token: wizard.token,
    channelId: wizard.chatId,
    threadId: wizard.threadId ?? null,
  };
}

export function createTelegramCommandWizards({ bridge }) {
  const wizards = createWizardStore();

  function ownsCallback(data) {
    return typeof data === 'string' && PREFIXES.some((p) => data.startsWith(p));
  }

  async function answer(token, callbackQueryId, text = null, showAlert = false) {
    await answerTelegramCallbackQuery({ token, callbackQueryId, text, showAlert }).catch(() => {});
  }

  async function sendMenu(state, ctx, { hash, text, replyMarkup, wizard }) {
    const sent = await sendTelegramMessage({
      token: state.token,
      chatId: ctx.chatId,
      text,
      messageThreadId: ctx.threadId ?? null,
      replyMarkup,
    });
    if (sent.ok && wizard) {
      wizard.messageId = sent.messageId;
      wizards.set(hash, wizard);
    }
    return sent;
  }

  async function editMenu(wizard, { text, replyMarkup }) {
    if (wizard.messageId == null) return;
    await editTelegramMessageText({
      token: wizard.token,
      chatId: wizard.chatId,
      messageId: wizard.messageId,
      text,
      replyMarkup: replyMarkup ?? { inline_keyboard: [] },
    }).catch(() => {});
  }

  function baseWizard(state, ctx, extra = {}) {
    return {
      token: state.token,
      chatId: String(ctx.chatId),
      threadId: ctx.threadId ?? null,
      from: ctx.from ?? null,
      messageId: null,
      ...extra,
    };
  }

  // ── /verbosity ─────────────────────────────────────────────────────────────
  async function startVerbosity(state, ctx) {
    const hash = randomWizardHash();
    const wizard = baseWizard(state, ctx, { kind: 'verbosity' });
    wizards.set(hash, wizard);
    const items = VERBOSITY_LEVELS.map((level) => ({
      label: VERBOSITY_LABELS[level] ?? level,
      value: level,
      description: VERBOSITY_DESCRIPTIONS[level],
    }));
    const markup = renderTelegramOptionPage(VERB_LEVEL_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await sendMenu(state, ctx, {
      hash,
      wizard,
      text: '*Set output verbosity*\nHow much of each turn should OpenChamber agent stream back here?',
      replyMarkup: markup,
    });
    return { ok: true };
  }

  async function onVerbosityLevel(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    wizard.level = value;
    wizards.set(hash, wizard);
    const scopeItems = [
      { label: 'This conversation', value: 'surface', description: 'Override here only' },
      { label: 'This project', value: 'project', description: "Project default" },
      { label: 'Whole system (default)', value: 'global', description: 'Every Telegram chat' },
    ];
    const markup = renderTelegramOptionPage(VERB_SCOPE_PREFIX, hash, scopeItems, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await editMenu(wizard, {
      text: `*Set output verbosity*\nLevel: *${VERBOSITY_LABELS[value] ?? value}* — ${VERBOSITY_DESCRIPTIONS[value] ?? ''}\nApply to:`,
      replyMarkup: markup,
    });
  }

  async function onVerbosityScope(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const scope = resolvePageValue(wizard, index);
    const level = wizard.level;
    if (!scope || !level) return;

    let scopeLabel = 'this conversation';
    if (bridge?.store) {
      try {
        const botTokenHash = botHashFor(wizard.token);
        const targetKey = surfaceKey(wizard);
        const binding =
          scope === 'project'
            ? bridge.store.lookup?.({ type: 'telegram', botTokenHash, targetKey })
            : null;
        if (scope === 'global') {
          bridge.store.setVerbosityDefault?.('telegram', level);
          scopeLabel = 'every Telegram conversation';
        } else if (scope === 'project' && binding?.projectPath) {
          bridge.store.setProjectDefaults?.({
            projectPath: binding.projectPath,
            projectLabel: binding.projectLabel,
            verbosityDefault: level,
          });
          scopeLabel = `project *${binding.projectLabel ?? binding.projectPath}*`;
        } else {
          bridge.store.setOverrides?.({
            type: 'telegram',
            botTokenHash,
            targetKey,
            verbosityOverride: level,
          });
          scopeLabel = scope === 'project' ? 'this conversation (no project bound yet)' : 'this conversation';
        }
      } catch {
        // best-effort
      }
    }
    try {
      bridge?.applyPreferencesToActiveTurn?.(surfaceOf(wizard));
    } catch {
      // best-effort
    }
    wizards.del(hash);
    await editMenu(wizard, {
      text: `✓ Verbosity set to *${VERBOSITY_LABELS[level] ?? level}* for ${scopeLabel}.\n_${VERBOSITY_DESCRIPTIONS[level] ?? ''}_`,
      replyMarkup: null,
    });
  }

  // ── /yolo|/permissions ─────────────────────────────────────────────────────
  async function startPermissions(state, ctx) {
    const hash = randomWizardHash();
    const wizard = baseWizard(state, ctx, { kind: 'permissions' });
    wizards.set(hash, wizard);
    const items = PERMISSION_MODES.map((mode) => ({
      label: PERMISSION_MODE_LABELS[mode] ?? mode,
      value: mode,
      description: (PERMISSION_MODE_DESCRIPTIONS[mode] ?? '').slice(0, 40),
    }));
    const markup = renderTelegramOptionPage(PERM_MODE_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await sendMenu(state, ctx, {
      hash,
      wizard,
      text:
        '*Set tool permission mode*\nHow should OpenChamber agent handle approval requests (shell, edits, …)?\nYou can still stop any run with `/abort`.',
      replyMarkup: markup,
    });
    return { ok: true };
  }

  async function onPermissionsMode(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    wizard.mode = value;
    wizards.set(hash, wizard);
    const scopeItems = [
      { label: 'This conversation', value: 'surface', description: 'Override here only' },
      { label: 'This project', value: 'project', description: "Project default" },
      { label: 'Whole system (default)', value: 'global', description: 'Every Telegram chat' },
    ];
    const markup = renderTelegramOptionPage(PERM_SCOPE_PREFIX, hash, scopeItems, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await editMenu(wizard, {
      text: `*Set tool permission mode*\nMode: *${PERMISSION_MODE_LABELS[value] ?? value}* — ${PERMISSION_MODE_DESCRIPTIONS[value] ?? ''}\nApply to:`,
      replyMarkup: markup,
    });
  }

  async function onPermissionsScope(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const scope = resolvePageValue(wizard, index);
    const mode = wizard.mode;
    if (!scope || !mode) return;

    let scopeLabel = 'this conversation';
    if (bridge?.store) {
      try {
        const botTokenHash = botHashFor(wizard.token);
        const targetKey = surfaceKey(wizard);
        const binding =
          scope === 'project'
            ? bridge.store.lookup?.({ type: 'telegram', botTokenHash, targetKey })
            : null;
        if (scope === 'global') {
          bridge.store.setPermissionModeDefault?.('telegram', mode);
          scopeLabel = 'every Telegram conversation';
        } else if (scope === 'project' && binding?.projectPath) {
          bridge.store.setProjectDefaults?.({
            projectPath: binding.projectPath,
            projectLabel: binding.projectLabel,
            permissionModeDefault: mode,
          });
          scopeLabel = `project *${binding.projectLabel ?? binding.projectPath}*`;
        } else {
          bridge.store.setOverrides?.({
            type: 'telegram',
            botTokenHash,
            targetKey,
            permissionModeOverride: mode,
          });
          scopeLabel = scope === 'project' ? 'this conversation (no project bound yet)' : 'this conversation';
        }
      } catch {
        // best-effort
      }
    }
    wizards.del(hash);
    await editMenu(wizard, {
      text: `✓ Permission mode set to *${PERMISSION_MODE_LABELS[mode] ?? mode}* for ${scopeLabel}.\n_${PERMISSION_MODE_DESCRIPTIONS[mode] ?? ''}_`,
      replyMarkup: null,
    });
  }

  // ── /agent ─────────────────────────────────────────────────────────────────
  async function startAgent(state, ctx) {
    let agents = [];
    try {
      agents = (await bridge?.listAgents?.()) ?? [];
    } catch {
      agents = [];
    }
    const visible = agents.filter((a) => a && !a.hidden && a.name);
    if (visible.length === 0) {
      await sendTelegramMessage({
        token: state.token,
        chatId: ctx.chatId,
        text: '_(no agents configured — see Settings → Agents in the web UI.)_',
        messageThreadId: ctx.threadId ?? null,
      });
      return { ok: true, fallbackText: true };
    }
    const hash = randomWizardHash();
    const wizard = baseWizard(state, ctx, { kind: 'agent', agents: visible, agentPage: 0 });
    wizards.set(hash, wizard);
    const items = visible.map((a) => ({
      label: (a.name ?? 'agent').slice(0, 40),
      value: a.name ?? 'agent',
      description: (a.description || (a.model ? `model ${a.model}` : '')).slice(0, 40),
    }));
    const markup = renderTelegramOptionPage(AGENT_PICK_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: true,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await sendMenu(state, ctx, {
      hash,
      wizard,
      text: '*Set agent*\nSelect an agent for this conversation:',
      replyMarkup: markup,
    });
    return { ok: true };
  }

  async function onAgentPick(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.agentPage = (wizard.agentPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      wizards.set(hash, wizard);
      const items = wizard.agents.map((a) => ({
        label: (a.name ?? 'agent').slice(0, 40),
        value: a.name ?? 'agent',
        description: (a.description || (a.model ? `model ${a.model}` : '')).slice(0, 40),
      }));
      const markup = renderTelegramOptionPage(
        AGENT_PICK_PREFIX,
        hash,
        items,
        wizard.agentPage,
        wizard,
        { includeInSelectNav: true, pageSize: TELEGRAM_PAGE_SIZE },
      );
      await editMenu(wizard, {
        text: '*Set agent*\nSelect an agent for this conversation:',
        replyMarkup: markup,
      });
      return;
    }
    wizard.agentName = value;
    wizards.set(hash, wizard);
    const scopeItems = [
      { label: 'This conversation', value: 'surface', description: 'Override here only' },
      { label: 'This project', value: 'project', description: 'Project default' },
    ];
    const markup = renderTelegramOptionPage(AGENT_SCOPE_PREFIX, hash, scopeItems, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await editMenu(wizard, {
      text: `*Set agent*\nAgent: *${value}*\nApply to:`,
      replyMarkup: markup,
    });
  }

  async function onAgentScope(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const scope = resolvePageValue(wizard, index);
    const agentName = wizard.agentName;
    if (!scope || !agentName) return;

    let scopeLabel = 'this conversation';
    if (bridge?.store) {
      try {
        const botTokenHash = botHashFor(wizard.token);
        const targetKey = surfaceKey(wizard);
        const binding =
          scope === 'project'
            ? bridge.store.lookup?.({ type: 'telegram', botTokenHash, targetKey })
            : null;
        if (scope === 'project' && binding?.projectPath) {
          bridge.store.setProjectDefaults?.({
            projectPath: binding.projectPath,
            projectLabel: binding.projectLabel,
            agentDefault: agentName,
          });
          scopeLabel = `project *${binding.projectLabel ?? binding.projectPath}*`;
        } else {
          bridge.store.setOverrides?.({
            type: 'telegram',
            botTokenHash,
            targetKey,
            agentOverride: agentName,
          });
          scopeLabel = scope === 'project' ? 'this conversation (no project bound yet)' : 'this conversation';
        }
      } catch {
        // best-effort
      }
    }
    wizards.del(hash);
    await editMenu(wizard, {
      text: `✓ Agent set to *${agentName}* for ${scopeLabel}.`,
      replyMarkup: null,
    });
  }

  // ── /skill ─────────────────────────────────────────────────────────────────
  async function startSkill(state, ctx) {
    let skills = [];
    try {
      skills = (await bridge?.listSurfaceSkills?.(surfaceOf(baseWizard(state, ctx)))) ?? [];
    } catch {
      skills = [];
    }
    const list = Array.isArray(skills) ? skills.filter((s) => s?.name) : [];
    if (list.length === 0) {
      await sendTelegramMessage({
        token: state.token,
        chatId: ctx.chatId,
        text: '_(no skills available for this conversation.)_',
        messageThreadId: ctx.threadId ?? null,
      });
      return { ok: true, fallbackText: true };
    }
    const hash = randomWizardHash();
    const wizard = baseWizard(state, ctx, { kind: 'skill', skills: list, skillPage: 0 });
    wizards.set(hash, wizard);
    const items = list.map((s) => ({
      label: (s.name ?? 'skill').slice(0, 40),
      value: s.name ?? 'skill',
      description: (s.description ?? '').slice(0, 40),
    }));
    const markup = renderTelegramOptionPage(SKILL_PICK_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: true,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await sendMenu(state, ctx, {
      hash,
      wizard,
      text: '*Run a skill*\nSelect a skill to hand to the agent:',
      replyMarkup: markup,
    });
    return { ok: true };
  }

  async function onSkillPick(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.skillPage = (wizard.skillPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      wizards.set(hash, wizard);
      const items = wizard.skills.map((s) => ({
        label: (s.name ?? 'skill').slice(0, 40),
        value: s.name ?? 'skill',
        description: (s.description ?? '').slice(0, 40),
      }));
      const markup = renderTelegramOptionPage(
        SKILL_PICK_PREFIX,
        hash,
        items,
        wizard.skillPage,
        wizard,
        { includeInSelectNav: true, pageSize: TELEGRAM_PAGE_SIZE },
      );
      await editMenu(wizard, {
        text: '*Run a skill*\nSelect a skill to hand to the agent:',
        replyMarkup: markup,
      });
      return;
    }

    await editMenu(wizard, {
      text: `▶ Running skill *${value}*…`,
      replyMarkup: null,
    });
    wizards.del(hash);

    try {
      await bridge?.routeInbound?.({
        type: 'telegram',
        token: wizard.token,
        channelId: wizard.chatId,
        threadId: wizard.threadId,
        text: `/skill ${value}`,
        from: wizard.from,
      });
    } catch {
      await editMenu(wizard, {
        text: `⚠ Could not run skill *${value}*.`,
        replyMarkup: null,
      });
    }
  }

  // ── /login ─────────────────────────────────────────────────────────────────
  async function startLogin(state, ctx) {
    let payload = null;
    let authMethods = {};
    try {
      payload = await bridge?.fetchProviders?.();
      authMethods = (await bridge?.listProviderAuthMethods?.()) ?? {};
    } catch {
      payload = null;
      authMethods = {};
    }
    const providers = (payload?.all ?? [])
      .map((provider) => ({
        id: provider?.id ?? provider?.name,
        name: provider?.name ?? provider?.id,
      }))
      .filter((provider) => provider.id);
    if (providers.length === 0) {
      await sendTelegramMessage({
        token: state.token,
        chatId: ctx.chatId,
        text: '_(no providers returned by OpenCode — open Settings → Providers in OpenChamber.)_',
        messageThreadId: ctx.threadId ?? null,
      });
      return { ok: true, fallbackText: true };
    }
    const hash = randomWizardHash();
    const wizard = baseWizard(state, ctx, {
      kind: 'login',
      providers,
      authMethods,
      providerPage: 0,
    });
    wizards.set(hash, wizard);
    const items = providers.map((p) => ({
      label: (p.name ?? p.id ?? 'provider').slice(0, 40),
      value: p.id ?? p.name,
      description: (p.name && p.id && p.name !== p.id ? p.id : 'Provider').slice(0, 40),
    }));
    const markup = renderTelegramOptionPage(LOGIN_PROVIDER_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: true,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await sendMenu(state, ctx, {
      hash,
      wizard,
      text: '*Provider login*\nPick a provider to authenticate through OpenCode.',
      replyMarkup: markup,
    });
    return { ok: true };
  }

  async function onLoginProvider(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    if (!value) return;
    if (value === PREV_VALUE || value === NEXT_VALUE) {
      wizard.providerPage = (wizard.providerPage ?? 0) + (value === NEXT_VALUE ? 1 : -1);
      wizards.set(hash, wizard);
      const items = wizard.providers.map((p) => ({
        label: (p.name ?? p.id ?? 'provider').slice(0, 40),
        value: p.id ?? p.name,
        description: (p.name && p.id && p.name !== p.id ? p.id : 'Provider').slice(0, 40),
      }));
      const markup = renderTelegramOptionPage(
        LOGIN_PROVIDER_PREFIX,
        hash,
        items,
        wizard.providerPage,
        wizard,
        { includeInSelectNav: true, pageSize: TELEGRAM_PAGE_SIZE },
      );
      await editMenu(wizard, {
        text: '*Provider login*\nPick a provider to authenticate through OpenCode.',
        replyMarkup: markup,
      });
      return;
    }
    wizard.providerId = value;
    wizards.set(hash, wizard);
    const methods = wizard.authMethods?.[value] ?? [];
    const items = [];
    const oauthMethods = methods
      .map((method, i) => ({ method, index: i }))
      .filter(({ method }) => normalizeAuthMethodType(method) === 'oauth');
    for (const { method, index: i } of oauthMethods) {
      items.push({
        label: (method.label ?? method.name ?? `OAuth ${i + 1}`).slice(0, 40),
        value: `oauth:${i}`,
        description: (method.description ?? method.help ?? 'OpenCode OAuth').slice(0, 40),
      });
    }
    items.push({
      label: 'API key',
      value: 'api',
      description: 'Use Settings → Providers',
    });
    const markup = renderTelegramOptionPage(LOGIN_METHOD_PREFIX, hash, items, 0, wizard, {
      includeInSelectNav: false,
      pageSize: TELEGRAM_PAGE_SIZE,
    });
    await editMenu(wizard, {
      text: `*Provider login*\nProvider: \`${value}\`\nChoose an authentication method.`,
      replyMarkup: markup,
    });
  }

  async function onLoginMethod(hash, index) {
    const wizard = wizards.get(hash);
    if (!wizard) return;
    const value = resolvePageValue(wizard, index);
    const providerId = wizard.providerId;
    if (!value || !providerId) return;

    if (value === 'api') {
      wizards.del(hash);
      await editMenu(wizard, {
        text: [
          `*Provider login: \`${providerId}\`*`,
          'Use OpenChamber Settings → Providers to save the API key.',
          '_Telegram never asks you to paste provider secrets into chat._',
        ].join('\n'),
        replyMarkup: null,
      });
      return;
    }

    const methodIndex = Number.parseInt(value.split(':')[1] ?? '0', 10);
    const started = await bridge?.startProviderOAuth?.(
      providerId,
      Number.isFinite(methodIndex) ? methodIndex : 0,
    );
    wizards.del(hash);
    if (!started?.ok) {
      await editMenu(wizard, {
        text: `✗ OAuth start failed: ${started?.error ?? 'unknown error'}`,
        replyMarkup: null,
      });
      return;
    }
    const details = extractOAuthDetails(started.data);
    const lines = [`*Provider login: \`${providerId}\`*`];
    if (details.url) lines.push(`Open this URL: ${details.url}`);
    if (details.userCode) lines.push(`Code: \`${details.userCode}\``);
    if (details.instructions) lines.push(details.instructions);
    lines.push('_After OAuth completes, OpenCode persists the credential in its existing auth storage._');
    await editMenu(wizard, { text: lines.join('\n'), replyMarkup: null });
  }

  async function handleCallback(state, callbackQuery) {
    const data = typeof callbackQuery?.data === 'string' ? callbackQuery.data : '';
    const token = state.token;
    const id = callbackQuery.id;

    const handlers = [
      [VERB_LEVEL_PREFIX, onVerbosityLevel],
      [VERB_SCOPE_PREFIX, onVerbosityScope],
      [PERM_MODE_PREFIX, onPermissionsMode],
      [PERM_SCOPE_PREFIX, onPermissionsScope],
      [AGENT_PICK_PREFIX, onAgentPick],
      [AGENT_SCOPE_PREFIX, onAgentScope],
      [SKILL_PICK_PREFIX, onSkillPick],
      [LOGIN_PROVIDER_PREFIX, onLoginProvider],
      [LOGIN_METHOD_PREFIX, onLoginMethod],
    ];
    for (const [prefix, fn] of handlers) {
      const parsed = parseTelegramPickCallback(data, prefix);
      if (parsed) {
        await answer(token, id);
        return fn(parsed.hash, parsed.index);
      }
    }
    // Hash-only callbacks unused for command wizards today.
    void parseTelegramHashCallback;
  }

  return {
    ownsCallback,
    handleCallback,
    startVerbosity,
    startAgent,
    startSkill,
    startPermissions,
    startLogin,
  };
}
