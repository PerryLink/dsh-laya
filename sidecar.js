/**
 * Starting the sidecar, and knowing whether we are allowed to.
 *
 * The plugin's original position was that it installs nothing and launches
 * nothing, because a plugin that shells out to `pip install` and then downloads
 * a 650 MB checkpoint behind the user's back is hostile. That reasoning was
 * right about *installing* and wrong about *launching*: a sidecar the operator
 * already installed and then had to start by hand, in a terminal, before every
 * session - and re-start by hand whenever it died - is a plugin that does not
 * work on its own.
 *
 * So `lifecycle: spawn` launches a command the operator names explicitly. The
 * line is the same one the rest of this package draws: never do an install,
 * never fetch a model, never guess at something the user did not ask for. The
 * command comes from configuration or it does not run at all.
 *
 * Everything here is pure or takes its environment as an argument, so it is
 * testable without spawning anything - which is why it is not inline in
 * `index.js`, where importing `@deepseek-ai/dsh-tools` would make it unreachable
 * from a bare `node --test`.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Extensions Windows will execute through a shell, in PATHEXT order. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/**
 * Whether this command has to go through a shell on this platform.
 *
 * Node's `spawn` is `shell: false`, and on Windows a `.cmd` or `.bat` is not a
 * PE image - `CreateProcess` cannot run it, so spawn fails with `EINVAL` rather
 * than `ENOENT`, which reads like a bug in the caller. This is the same trap
 * that shaped how the MCP harness installer registers the server: a console
 * script is a `.cmd` shim, so it points at `python -m laya_mcp` instead.
 */
export const needsShell = (command, platform = process.platform) =>
  platform === 'win32' && /\.(cmd|bat)$/i.test(command)

/**
 * Find a command on PATH the way a shell would.
 *
 * Returns the path a shell would run, or `null`. On Windows it also tries each
 * PATHEXT extension, because `laya-mcp` is really `laya-mcp.cmd` on disk and a
 * caller passing the bare name should not have to know that.
 *
 * `exists` is injectable so this can be tested against a synthetic PATH without
 * creating files: a test that has to write a `laya-mcp.cmd` into a temp directory
 * cannot exercise the Windows branch on Linux, or the POSIX branch on Windows
 * (where a drive letter's `:` is a path separator, not a PATH separator).
 */
export const resolveCommand = (command, options = {}) => {
  const { env = process.env, platform = process.platform, exists = existsSync } = options

  if (typeof command !== 'string' || command.trim() === '') return null

  // An explicit path is used as given; whether it exists is the spawn's problem,
  // and reporting "not found on PATH" for `C:\missing\tool.exe` would be a lie
  // about which lookup failed.
  if (command.includes('/') || command.includes('\\')) return command

  const path = platform === 'win32' ? env.PATH ?? env.Path ?? '' : env.PATH ?? ''
  if (path === '') return null

  const separator = platform === 'win32' ? ';' : ':'
  const joiner = platform === 'win32' ? '\\' : '/'
  const directories = path.split(separator).filter((entry) => entry !== '')
  const extensions =
    platform === 'win32' ? (env.PATHEXT ?? DEFAULT_PATHEXT).split(';').filter(Boolean) : ['']

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = `${directory.replace(/[\\/]+$/, '')}${joiner}${command}${extension}`
      if (exists(candidate)) return candidate
    }
  }
  return null
}

/**
 * Work out exactly what to hand `spawn`.
 *
 * Separate from spawning so it can be asserted on directly: the failure this
 * prevents - `EINVAL` on Windows for a `.cmd`, or `ENOENT` for a bare name that
 * only exists with an extension - is invisible until the moment it matters.
 */
export const planSpawn = (command, args = [], options = {}) => {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const resolved = resolveCommand(command, { env, platform, exists: options.exists })

  if (resolved === null) {
    return {
      ok: false,
      reason:
        `\`${command}\` was not found on PATH. Set \`spawnCommand\` to an absolute ` +
        'path, or leave `lifecycle` at "never" and start the sidecar yourself.',
    }
  }
  if (needsShell(resolved, platform)) {
    // `cmd.exe /c` is the only way to run a batch shim without giving Node a
    // shell for everything else it spawns.
    return { ok: true, file: 'cmd.exe', argv: ['/c', resolved, ...args], resolved, viaShell: true }
  }
  return { ok: true, file: resolved, argv: args, resolved, viaShell: false }
}

/**
 * Launch the sidecar.
 *
 * Returns a handle whose `stop()` kills the process tree. The caller owns that
 * decision: a sidecar this plugin started is stopped when the plugin unmounts,
 * and a sidecar somebody else started is never touched.
 *
 * `onLine` receives the child's stdout and stderr a line at a time, because the
 * first thing that goes wrong with a spawned model server is a Python traceback
 * on stderr and a caller reading an empty log.
 */
export const startSidecar = (command, args = [], options = {}) => {
  const plan = planSpawn(command, args, options)
  if (!plan.ok) return { ok: false, reason: plan.reason }

  const child = spawn(plan.file, plan.argv, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    cwd: options.cwd,
    env: options.env ?? process.env,
  })

  const onLine = typeof options.onLine === 'function' ? options.onLine : () => {}
  const pump = (stream, streamName) => {
    if (!stream) return
    let buffered = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffered += chunk
      let index = buffered.indexOf('\n')
      while (index !== -1) {
        onLine(streamName, buffered.slice(0, index).replace(/\r$/, ''))
        buffered = buffered.slice(index + 1)
        index = buffered.indexOf('\n')
      }
    })
    stream.on('end', () => {
      if (buffered !== '') onLine(streamName, buffered)
    })
  }
  pump(child.stdout, 'stdout')
  pump(child.stderr, 'stderr')

  let spawnFailed = null
  child.on('error', (error) => {
    spawnFailed = error
    onLine('stderr', `could not start ${plan.resolved}: ${error.message}`)
  })

  return {
    ok: true,
    pid: child.pid,
    resolved: plan.resolved,
    viaShell: plan.viaShell,
    /** Settles once the process has actually started, or failed to. */
    async started(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (spawnFailed) return { ok: false, reason: spawnFailed.message }
        if (child.pid !== undefined) return { ok: true, pid: child.pid }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return { ok: false, reason: `${plan.resolved} did not start within ${timeoutMs} ms` }
    },
    onExit(handler) {
      child.on('exit', (code, signal) => handler(code, signal))
    },
    stop() {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    },
  }
}
