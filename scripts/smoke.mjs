#!/usr/bin/env node
/**
 * Release smoke test: build the bundle, then run the built CLI end to end —
 * init against a bare remote, sync a change, read status back, check the
 * version. Seconds, not the minute-plus of the full suite: an npm OTP
 * supplied to the release script expires in ~30 seconds, and the full suite
 * is what `bun run test` is for.
 *
 * Isolation mirrors the integration tests: SIDECAR_STATE_DIR keeps the
 * registry in the temp dir (it rides through every child spawn), and
 * SIDECAR_SKIP_SERVICE keeps hands off the real daemon.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PKG_DIR = join(ROOT, 'packages/sidecar')
const CLI = join(PKG_DIR, 'dist/cli.js')

const die = (msg) => {
  console.error(`\n  smoke: ${msg}\n`)
  process.exit(1)
}

execFileSync('bun', ['run', 'build'], { cwd: PKG_DIR, stdio: 'inherit' })

const tmp = mkdtempSync(join(tmpdir(), 'sidecar-smoke-'))
const env = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  SIDECAR_STATE_DIR: join(tmp, 'state'),
  SIDECAR_SKIP_SERVICE: '1',
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
const sidecar = (cwd, args) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env })
  if (result.status !== 0) die(`sidecar ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout
}

try {
  const remote = join(tmp, 'remote.git')
  const repo = join(tmp, 'repo')
  git(tmp, ['init', '--bare', remote])
  git(tmp, ['init', '-b', 'main', repo])
  git(repo, ['config', 'user.name', 'smoke'])
  git(repo, ['config', 'user.email', 'smoke@test.local'])
  writeFileSync(join(repo, 'README.md'), '# smoke\n')
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', 'init'])

  sidecar(repo, ['init', remote, '--redaction', 'none'])
  writeFileSync(join(repo, 'sidecar', 'note.md'), 'smoke note\n')
  sidecar(repo, ['sync'])

  const files = git(tmp, ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main'])
  if (!files.includes('note.md')) die('synced file missing from the remote main branch')

  const status = JSON.parse(sidecar(repo, ['status', '--json']))
  if (status.remote !== remote) die(`status reports remote ${status.remote}; expected ${remote}`)

  const version = sidecar(repo, ['version']).trim()
  const expected = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')).version
  if (version !== expected) die(`cli reports ${version}; package.json says ${expected}`)

  console.log(`  smoke ok: init, sync, status, version ${version}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
