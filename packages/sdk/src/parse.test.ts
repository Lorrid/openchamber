import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { OPENCHAMBER_SDK_API_VERSION } from './api-version.ts';
import { parseManifest, parseManifestJson, resolveAttachMode } from './parse.ts';

const validBlock = {
  apiVersion: OPENCHAMBER_SDK_API_VERSION,
  contributes: {
    panel: {
      id: 'acme-hello',
      name: 'Hello',
      icon: 'window',
      entry: 'panel/index.html',
    },
  },
};

describe('parseManifest', () => {
  test('reads a bare manifest block', () => {
    const result = parseManifest(validBlock);
    expect(result).toEqual({
      ok: true,
      manifest: {
        apiVersion: 1,
        contributes: {
          panel: {
            id: 'acme-hello',
            name: 'Hello',
            icon: 'window',
            entry: 'panel/index.html',
          },
        },
      },
    });
  });

  test('reads package.json openchamber', () => {
    const result = parseManifest({
      openchamber: validBlock,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.panel.id).toBe('acme-hello');
    }
  });

  test('trims strings and drops extra keys', () => {
    const result = parseManifestJson(JSON.stringify({
      name: '@acme/hello-panel',
      extra: true,
      openchamber: {
        apiVersion: 1,
        extra: true,
        contributes: {
          panel: {
            id: '  acme-hello  ',
            name: ' Hello ',
            icon: ' window ',
            entry: ' panel/index.html ',
            color: 'red',
          },
        },
      },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.panel).toEqual({
        id: 'acme-hello',
        name: 'Hello',
        icon: 'window',
        entry: 'panel/index.html',
      });
    }
  });

  test('rejects a non-object JSON value', () => {
    expect(parseManifestJson('null')).toEqual({
      ok: false,
      code: 'not-object',
      message: 'Manifest must be a plain object.',
    });
    expect(parseManifestJson('"nope"')).toMatchObject({ ok: false, code: 'not-object' });
  });

  test('rejects a missing or non-object openchamber key', () => {
    const missing = parseManifestJson('{"name":"@acme/hello-panel","openchamber":null}');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('missing-openchamber');
  });

  test('rejects an unknown apiVersion', () => {
    const result = parseManifestJson(JSON.stringify({ ...validBlock, apiVersion: 2 }));
    expect(result).toMatchObject({ ok: false, code: 'unsupported-api-version' });
  });

  test('keeps attach when it is true', () => {
    const result = parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        attach: true,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.attach).toBe(true);
    }
  });

  test('keeps attach when it is dialog', () => {
    const result = parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        attach: 'dialog',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.attach).toBe('dialog');
    }
  });

  test('rejects a junk attach value', () => {
    expect(parseManifestJson(JSON.stringify({
      ...validBlock,
      contributes: { ...validBlock.contributes, attach: 'yes' },
    }))).toMatchObject({ ok: false, code: 'invalid-attach' });
  });

  test('resolves attach modes', () => {
    expect(resolveAttachMode(undefined)).toBeNull();
    expect(resolveAttachMode(false)).toBeNull();
    expect(resolveAttachMode(true)).toBe('panel');
    expect(resolveAttachMode('panel')).toBe('panel');
    expect(resolveAttachMode('dialog')).toBe('dialog');
  });

  test('rejects a missing panel', () => {
    expect(parseManifestJson('{"apiVersion":1,"contributes":{}}')).toMatchObject({
      ok: false,
      code: 'missing-panel',
    });
  });

  test('rejects a bad panel id', () => {
    const result = parseManifestJson(JSON.stringify({
      ...validBlock,
      contributes: { panel: { ...validBlock.contributes.panel, id: 'Acme Hello' } },
    }));
    expect(result).toMatchObject({ ok: false, code: 'invalid-panel-id' });
  });

  test('keeps a valid integration block', () => {
    const result = parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks from a ClickUp list',
          oauth: {
            authorizeUrl: 'https://app.clickup.com/api',
            tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
            apiOrigin: 'https://api.clickup.com',
            scopes: ['task:read'],
            account: { path: '/api/v2/user', name: 'user.username' },
          },
          settings: [{ id: 'list-id', label: 'List ID' }],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.integration).toEqual({
        name: 'ClickUp',
        description: 'Tasks from a ClickUp list',
        oauth: {
          authorizeUrl: 'https://app.clickup.com/api',
          tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
          apiOrigin: 'https://api.clickup.com',
          scopes: ['task:read'],
          account: { path: '/api/v2/user', name: 'user.username' },
        },
        settings: [{ id: 'list-id', label: 'List ID' }],
      });
    }
  });

  test('keeps a token integration block', () => {
    const result = parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks from a ClickUp list',
          token: {
            apiOrigin: 'https://api.clickup.com',
            account: { path: '/api/v2/user', name: 'user.username' },
          },
          settings: [{ id: 'list-id', label: 'List ID' }],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.integration).toEqual({
        name: 'ClickUp',
        description: 'Tasks from a ClickUp list',
        token: {
          apiOrigin: 'https://api.clickup.com',
          account: { path: '/api/v2/user', name: 'user.username' },
        },
        settings: [{ id: 'list-id', label: 'List ID' }],
      });
    }
  });

  test('keeps a host Linear integration block', () => {
    const result = parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'Linear',
          description: 'Issues from Linear',
          host: { provider: 'linear' },
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.integration).toEqual({
        name: 'Linear',
        description: 'Issues from Linear',
        host: { provider: 'linear' },
      });
    }
  });

  test('rejects an integration with both oauth and token, or neither', () => {
    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks',
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });

    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks',
          oauth: {
            authorizeUrl: 'https://app.clickup.com/api',
            tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
            apiOrigin: 'https://api.clickup.com',
          },
          token: { apiOrigin: 'https://api.clickup.com' },
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });

    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'Linear',
          description: 'Issues',
          host: { provider: 'linear' },
          token: { apiOrigin: 'https://api.linear.app' },
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });
  });

  test('rejects http oauth URLs and credentials in the URL', () => {
    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks',
          oauth: {
            authorizeUrl: 'http://app.clickup.com/api',
            tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
            apiOrigin: 'https://api.clickup.com',
          },
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });

    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks',
          oauth: {
            authorizeUrl: 'https://user:pass@app.clickup.com/api',
            tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
            apiOrigin: 'https://api.clickup.com',
          },
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });

    expect(parseManifest({
      ...validBlock,
      contributes: {
        ...validBlock.contributes,
        integration: {
          name: 'ClickUp',
          description: 'Tasks',
          oauth: {
            authorizeUrl: 'https://app.clickup.com/api',
            tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
            apiOrigin: 'https://api.clickup.com/v2',
          },
        },
      },
    })).toMatchObject({ ok: false, code: 'invalid-integration' });
  });

  test('rejects a path that escapes the package', () => {
    const traversal = parseManifestJson(JSON.stringify({
      ...validBlock,
      contributes: { panel: { ...validBlock.contributes.panel, entry: '../secret.html' } },
    }));
    expect(traversal).toMatchObject({ ok: false, code: 'invalid-panel-entry' });

    const absolute = parseManifestJson(JSON.stringify({
      ...validBlock,
      contributes: { panel: { ...validBlock.contributes.panel, icon: '/etc/passwd' } },
    }));
    expect(absolute).toMatchObject({ ok: false, code: 'invalid-panel-icon' });

    const packagedSvg = parseManifestJson(JSON.stringify({
      ...validBlock,
      contributes: { panel: { ...validBlock.contributes.panel, icon: 'icon.svg' } },
    }));
    expect(packagedSvg).toMatchObject({
      ok: false,
      code: 'invalid-panel-icon',
      message: 'panel.icon must be a Remixicon name.',
    });
  });

  test('reads the ClickUp example package', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/clickup/package.json');
    const result = parseManifestJson(readFileSync(file, 'utf8'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.panel.id).toBe('clickup');
      expect(result.manifest.contributes.integration?.token?.apiOrigin).toBe('https://api.clickup.com');
      expect(result.manifest.contributes.integration?.oauth).toBeUndefined();
      expect(result.manifest.contributes.integration?.settings).toEqual([
        { id: 'list-id', label: 'List ID' },
      ]);
    }
  });

  test('reads the Linear example package', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/linear/package.json');
    const result = parseManifestJson(readFileSync(file, 'utf8'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.panel.id).toBe('linear-issues');
      expect(result.manifest.contributes.integration?.host).toEqual({ provider: 'linear' });
      expect(result.manifest.contributes.integration?.oauth).toBeUndefined();
      expect(result.manifest.contributes.integration?.token).toBeUndefined();
    }
  });

  test('reads the GitLab example package', () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), '../../../examples/gitlab/package.json');
    const result = parseManifestJson(readFileSync(file, 'utf8'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.panel.id).toBe('gitlab');
      expect(result.manifest.contributes.integration?.oauth).toMatchObject({
        authorizeUrl: 'https://gitlab.com/oauth/authorize',
        tokenUrl: 'https://gitlab.com/oauth/token',
        apiOrigin: 'https://gitlab.com',
        scopes: ['api'],
      });
      expect(result.manifest.contributes.integration?.settings).toEqual([
        { id: 'project-path', label: 'Project path' },
      ]);
    }
  });
});
