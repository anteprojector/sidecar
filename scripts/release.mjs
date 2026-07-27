#!/usr/bin/env node
/**
 * Cut a release: bump, verify, commit, tag, push, then publish.
 *
 *   bun run release patch|minor|major|<version> [--otp <code>] [--skip-tests] [--dry-run]
 *
 * The order is the point. Publishing is last and irreversible — a version can
 * never be re-published — so everything that can fail cheaply fails first, and
 * the commit is tagged and pushed before npm ever sees it. A release on the
 * registry therefore always has a tag behind it, which is the invariant that
 * hand-editing package.json kept breaking.
 *
 * `npm version` would normally do the bump, commit, and tag in one step, but it
 * drives git directly: in this colocated repo jj owns the index and HEAD, and a
 * stray `git commit` desyncs them. So the bump is written by hand and the commit
 * goes through jj.
 *
 * Verification is a smoke test (scripts/smoke.mjs), not the full suite: the
 * suite is timing-flaky, and an npm OTP passed via --otp expires in ~30
 * seconds — everything between preflight and publish has to fit inside that
 * window. Run `bun run test` before releasing; `--skip-tests` skips even the
 * smoke test. A missing npm login is caught in preflight and runs `npm login`
 * right there instead of dying.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ROOT_PKG = join(ROOT, 'package.json')
const PKG_DIR = join(ROOT, 'packages/sidecar')
const PKG = join(PKG_DIR, 'package.json')

// The root manifest carries the version for the whole workspace and every
// package tracks it, so there is one number to reason about rather than one per
// package drifting apart. Only packages/sidecar is published; the rest carry the
// version for the record.
const manifests = [
  ROOT_PKG,
  ...readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, 'packages', entry.name, 'package.json'))
    .filter((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    }),
]

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

function setVersion(path, version) {
  const source = readFileSync(path, 'utf8')
  // A textual splice rather than a JSON round-trip: it leaves key order,
  // indentation, and the trailing newline exactly as the file had them.
  const updated = /"version":\s*"[^"]+"/.test(source)
    ? source.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)
    : source.replace(/^\{\n/, `{\n  "version": "${version}",\n`)
  writeFileSync(path, updated)
}

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const SKIP_TESTS = args.includes('--skip-tests')

// --otp takes a value, so it has to come out of args before the bump is
// found: `--otp 123456` would otherwise read as bump "123456".
let OTP
const otpIndex = args.findIndex((a) => a === '--otp' || a.startsWith('--otp='))
if (otpIndex !== -1) {
  const arg = args[otpIndex]
  OTP = arg.includes('=') ? arg.slice('--otp='.length) : args[otpIndex + 1]
  args.splice(otpIndex, arg.includes('=') ? 1 : 2)
}
const bump = args.find((a) => !a.startsWith('--'))

const die = (msg) => {
  console.error(`\n  release: ${msg}\n`)
  process.exit(1)
}
const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`)
const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', ...opts }).trim()
const runLoud = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: 'inherit', ...opts })

// Guarded so --dry-run can narrate the irreversible half without doing it.
const mutate = (label, fn) => {
  if (DRY) return console.log(`  (dry run) would ${label}`)
  return fn()
}

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+/.test(kind)) return kind
  const [major, minor, patch] = current.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  return die(`unknown bump "${kind}" — expected patch, minor, major, or an explicit version`)
}

if (!bump) die('usage: bun run release patch|minor|major|<version> [--otp <code>] [--skip-tests] [--dry-run]')
if (otpIndex !== -1 && (!OTP || OTP.startsWith('--'))) die('--otp requires a code')

const root = read(ROOT_PKG)
const published = read(PKG)
if (!root.version) die(`${ROOT_PKG} has no version — the workspace version lives there`)
const version = nextVersion(root.version, bump)
const tag = `v${version}`

console.log(`\n  workspace  ${root.version} -> ${version}${DRY ? '  (dry run)' : ''}`)
console.log(`  publishes  ${published.name}@${version}`)

// ---------------------------------------------------------------- preflight
// Everything here is a reason to stop before touching a single file.
step('Preflight')

// A release commit should contain the bump and nothing else, so the working
// copy has to be empty before we start writing to it.
if (run('jj', ['log', '-r', '@', '--no-graph', '-T', 'empty']) !== 'true') {
  die('working copy has uncommitted changes — commit or squash them first')
}

// Release from the tip of what is already published, never from a side branch.
const head = run('jj', ['log', '-r', '@-', '--no-graph', '-T', 'commit_id'])
const mainAt = run('jj', ['log', '-r', 'main', '--no-graph', '-T', 'commit_id'])
if (head !== mainAt) die('parent commit is not main — rebase onto main first')

run('jj', ['git', 'fetch'])
const remoteAt = run('jj', ['log', '-r', 'main@origin', '--no-graph', '-T', 'commit_id'])
if (remoteAt !== mainAt) die('main and main@origin have diverged — push or pull first')

const existingTag = run('git', ['tag', '-l', tag])
if (existingTag) die(`tag ${tag} already exists`)

// A dead npm token is the failure that used to surface as a bogus 404 from the
// registry, after the tag had already been pushed. Catch it up front — and
// since the fix is always `npm login`, just run it here rather than dying and
// making the user restart the release.
const whoami = () => run('npm', ['whoami'], { stdio: ['ignore', 'pipe', 'ignore'] })
try {
  console.log(`  npm: ${whoami()}`)
} catch {
  if (DRY) {
    console.log('  npm: not logged in (dry run continues; a real release would run `npm login` here)')
  } else {
    console.log('  npm: not logged in — running `npm login`')
    runLoud('npm', ['login'])
    console.log(`  npm: ${whoami()}`)
  }
}

try {
  run('npm', ['view', `${published.name}@${version}`, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] })
  die(`${version} is already published — versions cannot be replaced`)
} catch (error) {
  if (String(error.message).includes('already published')) throw error
}
console.log(`  clean, on main, ${tag} is free`)

// ---------------------------------------------------------------- bump
step(`Bump to ${version}`)
mutate(`write ${version} across ${manifests.length} manifests`, () => {
  for (const path of manifests) {
    setVersion(path, version)
    console.log(`  ${path.slice(ROOT.length + 1)}`)
  }
  // The lockfile records each workspace version too; left alone it would fail
  // CI's `bun install --frozen-lockfile` on the very next push.
  runLoud('bun', ['install'])
})

// ---------------------------------------------------------------- verify
step('Verify')
runLoud('bun', ['run', 'check'])
if (SKIP_TESTS) console.log('  smoke test skipped (--skip-tests)')
else runLoud('node', [join(ROOT, 'scripts/smoke.mjs')])

// ---------------------------------------------------------------- publish
// Past this line the steps are visible to other people, so they go in the order
// that leaves the least mess if one of them fails.
step('Commit and push')
mutate(`commit and push ${tag}`, () => {
  runLoud('jj', ['describe', '-m', `chore(sidecar): release ${tag}`])
  runLoud('jj', ['bookmark', 'set', 'main', '-r', '@', '--allow-backwards'])
  runLoud('jj', ['git', 'push', '--bookmark', 'main'])
})

step(`Tag ${tag}`)
mutate(`tag and push ${tag}`, () => {
  // Resolve after the push: jj rewrites the working copy into an immutable
  // commit as it goes, so the id from before the push is already stale.
  const released = run('jj', ['log', '-r', 'main', '--no-graph', '-T', 'commit_id'])
  runLoud('git', ['tag', '-a', tag, '-m', `${published.name} ${version}`, released])
  runLoud('git', ['push', 'origin', tag])
})

step('Publish')
mutate(`publish ${published.name}@${version}`, () => {
  // prepack builds dist and copies README/LICENSE; prepublishOnly typechecks.
  // Without --otp, npm prompts for the code itself on a TTY.
  runLoud('npm', ['publish', ...(OTP ? [`--otp=${OTP}`] : [])], { cwd: PKG_DIR })
})

console.log(`\n  ${DRY ? 'dry run complete' : `released ${published.name}@${version}`}\n`)
