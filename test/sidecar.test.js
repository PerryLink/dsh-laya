/**
 * Tests for the launcher, with no sidecar, no harness and no filesystem.
 *
 * The failure being guarded against is invisible until it happens: on Windows a
 * `.cmd` is not a PE image, so `spawn` with `shell: false` fails with `EINVAL`
 * rather than a clear "not found", and a bare `laya-mcp` that only exists as
 * `laya-mcp.cmd` fails with `ENOENT` even though the user can see it on PATH.
 * Both are asserted here rather than discovered in a startup log.
 *
 * `resolveCommand` takes its `exists` as an argument precisely so these can be
 * pure. A test that wrote a real `laya-mcp.cmd` into a temp directory could only
 * run the Windows branch on Windows - and on Windows it could not run the POSIX
 * branch at all, because a drive letter's `:` is a path separator, not a PATH
 * separator, and the temp path would be split in half.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { needsShell, resolveCommand, planSpawn } from '../sidecar.js'

/** A stand-in filesystem: `exists` answers true for exactly these paths. */
const fakeFs = (present, { caseInsensitive = false } = {}) => (candidate) =>
  caseInsensitive
    ? present.some((entry) => entry.toLowerCase() === candidate.toLowerCase())
    : present.includes(candidate)

/** Windows resolves paths without regard to case, so the fake should too. */
const windowsFs = (present) => fakeFs(present, { caseInsensitive: true })

test('a batch shim needs a shell on Windows and nothing else does', () => {
  assert.equal(needsShell('C:\\tools\\laya-mcp.cmd', 'win32'), true)
  assert.equal(needsShell('C:\\tools\\laya-mcp.BAT', 'win32'), true)
  assert.equal(needsShell('C:\\tools\\laya-mcp.exe', 'win32'), false)
  assert.equal(needsShell('/usr/local/bin/laya-mcp', 'linux'), false)
  // A `.cmd` on Linux is just a file with an unusual name.
  assert.equal(needsShell('/opt/laya-mcp.cmd', 'linux'), false)
})

test('a bare name is found through PATHEXT on Windows', () => {
  const env = { PATH: 'C:\\nothing-here;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
  const exists = windowsFs(['C:\\tools\\laya-mcp.cmd'])
  const found = resolveCommand('laya-mcp', { env, platform: 'win32', exists })
  // Compared case-insensitively because Windows is: the path comes back spelled
  // with the PATHEXT entry that matched, not with the file's own casing.
  assert.equal(found.toLowerCase(), 'c:\\tools\\laya-mcp.cmd')
})

test('a bare name is found without an extension on POSIX', () => {
  const env = { PATH: '/nothing-here:/usr/local/bin' }
  const exists = fakeFs(['/usr/local/bin/laya-mcp'])
  assert.equal(
    resolveCommand('laya-mcp', { env, platform: 'linux', exists }),
    '/usr/local/bin/laya-mcp',
  )
})

test('the first match on PATH wins, in directory order', () => {
  const env = { PATH: '/first:/second' }
  const exists = fakeFs(['/first/laya-mcp', '/second/laya-mcp'])
  assert.equal(resolveCommand('laya-mcp', { env, platform: 'linux', exists }), '/first/laya-mcp')
})

test('a trailing separator on a PATH entry does not double up', () => {
  const env = { PATH: '/usr/bin/' }
  const exists = fakeFs(['/usr/bin/laya-mcp'])
  assert.equal(resolveCommand('laya-mcp', { env, platform: 'linux', exists }), '/usr/bin/laya-mcp')
})

test('an explicit path is taken as given, not searched for', () => {
  // Reporting "not found on PATH" for a path the caller spelled out would name
  // the wrong lookup.
  const never = () => false
  assert.equal(
    resolveCommand('C:\\somewhere\\python.exe', { env: { PATH: '' }, platform: 'win32', exists: never }),
    'C:\\somewhere\\python.exe',
  )
  assert.equal(
    resolveCommand('/opt/venv/bin/python', { env: { PATH: '' }, platform: 'linux', exists: never }),
    '/opt/venv/bin/python',
  )
})

test('an empty or missing PATH resolves to nothing rather than throwing', () => {
  const never = () => false
  assert.equal(resolveCommand('laya-mcp', { env: { PATH: '' }, platform: 'linux', exists: never }), null)
  assert.equal(resolveCommand('laya-mcp', { env: {}, platform: 'linux', exists: never }), null)
  assert.equal(resolveCommand('', { env: { PATH: '/usr/bin' }, platform: 'linux', exists: never }), null)
  assert.equal(resolveCommand(null, { env: { PATH: '/usr/bin' }, platform: 'linux', exists: never }), null)
})

test('planSpawn wraps a batch shim in cmd.exe /c', () => {
  const env = { PATH: 'C:\\tools', PATHEXT: '.CMD' }
  const exists = windowsFs(['C:\\tools\\laya-mcp.cmd'])
  const plan = planSpawn('laya-mcp', ['serve', '--port', '8787'], { env, platform: 'win32', exists })
  assert.equal(plan.ok, true)
  assert.equal(plan.viaShell, true)
  assert.equal(plan.file, 'cmd.exe')
  assert.deepEqual(
    plan.argv.map((part) => part.toLowerCase()),
    ['/c', 'c:\\tools\\laya-mcp.cmd', 'serve', '--port', '8787'],
  )
})

test('planSpawn runs a real executable directly', () => {
  const env = { PATH: 'C:\\tools', PATHEXT: '.EXE' }
  const exists = windowsFs(['C:\\tools\\python.exe'])
  const plan = planSpawn('python', ['-m', 'laya_mcp', 'serve'], { env, platform: 'win32', exists })
  assert.equal(plan.ok, true)
  assert.equal(plan.viaShell, false)
  assert.equal(plan.file.toLowerCase(), 'c:\\tools\\python.exe')
  assert.deepEqual(plan.argv, ['-m', 'laya_mcp', 'serve'])
})

test('a missing command fails with advice, not an ENOENT', () => {
  const never = () => false
  const plan = planSpawn('definitely-not-installed', [], {
    env: { PATH: '/nope' },
    platform: 'linux',
    exists: never,
  })
  assert.equal(plan.ok, false)
  // The reason has to name the knobs, or the operator has nowhere to go.
  assert.match(plan.reason, /spawnCommand/)
  assert.match(plan.reason, /lifecycle/)
})
