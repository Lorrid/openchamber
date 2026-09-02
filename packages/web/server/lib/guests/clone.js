import { spawn } from 'node:child_process';

const CLONE_TIMEOUT_MS = 60_000;

export const isHttpsGitUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const isHttpsZipUrl = (value) => {
  if (!isHttpsGitUrl(value)) {
    return false;
  }
  try {
    return new URL(value).pathname.toLowerCase().endsWith('.zip');
  } catch {
    return false;
  }
};

/** Clone `source` into `dest`. `source` is an https URL in production. Tests pass a local repo path. */
export const cloneGitRepository = (source, dest, timeoutMs = CLONE_TIMEOUT_MS) => (
  new Promise((resolve) => {
    const child = spawn(
      'git',
      ['clone', '--depth', '1', '--', source, dest],
      {
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, code: 'clone-failed' });
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      finish({ ok: false, code: 'clone-failed' });
    });
    child.on('close', (exit) => {
      clearTimeout(timer);
      finish(exit === 0 ? { ok: true } : { ok: false, code: 'clone-failed' });
    });
  })
);
