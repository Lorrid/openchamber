import fs from 'node:fs/promises';

const siblingTypeScript = (jsPath) => {
  if (!jsPath.endsWith('.js')) {
    return null;
  }
  return `${jsPath.slice(0, -3)}.ts`;
};

/** When a sibling `.ts` exists and this process is Bun, compile it to a classic IIFE. */
export const compileGuestScript = async (jsPath) => {
  const tsPath = siblingTypeScript(jsPath);
  if (!tsPath) {
    return null;
  }
  try {
    await fs.stat(tsPath);
    const bun = globalThis.Bun;
    if (!bun?.build) {
      return null;
    }
    const result = await bun.build({
      entrypoints: [tsPath],
      format: 'iife',
      target: 'browser',
      minify: true,
      write: false,
    });
    if (!result.success) {
      const message = result.logs.map((log) => log.message).join('\n');
      throw new Error(message || 'Guest script build failed');
    }
    const artifact = result.outputs[0];
    if (!artifact) {
      throw new Error('Guest script build produced no output');
    }
    return Buffer.from(await artifact.text());
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};
