/**
 * obsidian-mind bootstrap hook.
 *
 * Runs on first install + adopt, and on update whenever `hooks.bootstrap.fingerprint`
 * in shard.yaml changes (see ShardMind docs/AUTHORING.md §Hook lifecycle). Writes
 * *unmanaged* path only (`.git/`) — the engine warns
 * (`HOOK_BOOTSTRAP_MANAGED_WRITE`) if a bootstrap hook touches a managed file, so
 * this hook never edits vault content. Non-fatal: throwing surfaces as a warning in
 * the install summary, never rolls back the install.
 *
 * Responsibility (idempotent, skippable): initialize a git repo at the vault
 * root if one doesn't already exist. Creates an *unmanaged* `.git/` directory.
 *
 * Unlike the legacy `post-install` hook, bootstrap carries no North Star
 * personalization — that moved to `personalize.ts`, which the engine gates on
 * non-default values (Invariant 2 is now engine-enforced, not hook-checked).
 *
 * `ensureGitRepo` is exported by name so the test suite can drive it with
 * synthetic vault layouts.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

// Local mirror of ShardMind's BootstrapContext shape. Inlined (rather than
// imported from `shardmind/runtime`) so obsidian-mind has no shardmind
// dependency — the engine's hook runner spawns this file via tsx and the types
// are erased at runtime. Kept in sync with `source/runtime/types.ts::BootstrapContext`
// in the shardmind repo. Bootstrap always runs, so it receives no
// `valuesAreDefaults` flag and no `newFiles`/`removedFiles` (those are
// update-only). See ShardMind docs/AUTHORING.md §Per-slot context shapes.
interface BootstrapContext {
  slot: 'bootstrap';
  vaultRoot: string;
  values: Record<string, unknown>;
  modules: Record<string, 'included' | 'excluded'>;
  shard: { name: string; version: string };
  previousVersion?: string;
}

export default async function bootstrap(ctx: BootstrapContext): Promise<void> {
  await ensureGitRepo(ctx.vaultRoot);
}

export async function ensureGitRepo(vaultRoot: string): Promise<void> {
  try {
    await access(join(vaultRoot, '.git'));
    console.log('git: repository already present — skipping git init');
    return;
  } catch (err) {
    // ENOENT — the expected case — falls through to `git init`. Any
    // other code (EACCES on a permission-restricted .git/, EBUSY, …)
    // means a `.git/` exists but we can't see it; running `git init`
    // would either silently re-init an existing repo or fail with a
    // less obvious follow-on error. Surface the original errno so the
    // user knows why init didn't run.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      console.error(`git: cannot inspect ${join(vaultRoot, '.git')} (${code}) — skipping git init. Run \`git init\` manually if needed.`);
      return;
    }
  }

  const ok = await run('git', ['init', '--quiet'], vaultRoot);
  if (ok) {
    console.log('git: initialized repository at vault root');
  } else {
    console.error('git: init failed — install succeeded but the vault is not version-controlled. Run `git init` manually.');
  }
}

function run(command: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell: false });
    child.on('error', () => resolve(false));
    child.on('exit', code => resolve(code === 0));
  });
}
