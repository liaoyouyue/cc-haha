import { createHash, randomBytes } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { buildPipInstallAttempts } from './pipInstall.js'
import { loadStoredComputerUseConfig } from './preauthorizedConfig.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')

// All runtime state lives in ~/.claude/.runtime — writable in both dev and
// bundled (Tauri app) modes. The setup API (or ensureRuntimeFiles below)
// populates requirements-win.txt and win_helper.py here.
//
// This bridge is Windows-only. macOS routes every command to the signed native
// `cu-helper` daemon and `helperBridge` refuses to fall back, so the old
// `mac_helper.py` was unreachable and has been deleted along with its
// pyobjc requirements file. Keeping a dead darwin branch here invited the
// reading that Python is still a supported macOS path — it is not.
const runtimeStateRoot = path.join(getClaudeConfigHomeDir(), '.runtime')
const venvRoot = path.join(runtimeStateRoot, 'venv')
const installStampPath = path.join(runtimeStateRoot, 'requirements.sha256')

const isWindows = process.platform === 'win32'
const windowsInputTag = randomBytes(4).readUInt32LE(0) || 0x43434841

// Always read from ~/.claude/.runtime/ — works in both dev and bundled mode.
const requirementsPath = path.join(runtimeStateRoot, 'requirements.txt')
const helperFileName = 'win_helper.py'
const helperPath = path.join(runtimeStateRoot, helperFileName)
// Runs as its own process (the helper is a stateless one-shot CLI and cannot
// own a window across actions), so it ships as a separate file.
const cursorBadgeFileName = 'win_cursor_badge.py'
const cursorBadgePath = path.join(runtimeStateRoot, cursorBadgeFileName)

let bootstrapPromise: Promise<void> | undefined

export function getComputerUsePythonEnv(): NodeJS.ProcessEnv | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    CC_HAHA_COMPUTER_USE_INPUT_TAG: String(windowsInputTag),
  }
}

function pythonBinPath(): string {
  return isWindows
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function runOrThrow(file: string, args: string[], label: string): Promise<string> {
  const { code, stdout, stderr } = await execFileNoThrow(file, args, { useCwd: false })
  if (code !== 0) {
    throw new Error(`${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`)
  }
  return stdout
}

export async function runPipInstallWithFallback(
  baseArgs: string[],
  label: string,
  run: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }> = args =>
    execFileNoThrow(pythonBinPath(), args, { useCwd: false }),
): Promise<void> {
  let firstFailure = ''
  for (const args of buildPipInstallAttempts(baseArgs)) {
    const { code, stdout, stderr } = await run(args)
    if (code === 0) return
    if (!firstFailure) {
      firstFailure = `${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`
    }
  }
  throw new Error(firstFailure || `${label} failed`)
}

export async function installRuntimeDependencies(
  requirementsPath: string,
  install: typeof runPipInstallWithFallback = runPipInstallWithFallback,
): Promise<void> {
  await install(['-m', 'pip', 'install', '--upgrade', 'pip'], 'pip upgrade')
  await install(['-m', 'pip', 'install', '-r', requirementsPath], 'python dependency install')
}

async function getVenvCreationPythonCommand(): Promise<string> {
  const config = await loadStoredComputerUseConfig()
  if (config.pythonPath) return config.pythonPath
  return isWindows ? 'python' : 'python3'
}

/**
 * Ensure runtime source files exist in ~/.claude/.runtime/.
 * In dev mode, copies from the project's runtime/ directory on first run.
 * In bundled mode, these must have been placed there by the settings setup API.
 */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  const devRequirements = path.join(projectRoot, 'runtime', 'requirements-win.txt')
  const devHelper = path.join(projectRoot, 'runtime', helperFileName)

  // Always sync from dev runtime/ so source changes are reflected immediately.
  // Previously this only copied when the dest was missing, causing stale files
  // to persist after source updates — breaking mouse/keyboard actions if the
  // cached copy was from an older version.
  if (await pathExists(devRequirements)) {
    await writeFile(requirementsPath, await readFile(devRequirements, 'utf8'), 'utf8')
  }
  if (await pathExists(devHelper)) {
    await writeFile(helperPath, await readFile(devHelper, 'utf8'), 'utf8')
  }

  const devBadge = path.join(projectRoot, 'runtime', cursorBadgeFileName)
  if (await pathExists(devBadge)) {
    await writeFile(cursorBadgePath, await readFile(devBadge, 'utf8'), 'utf8')
  }
}

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    // Extract runtime files (requirements, helper, badge) to state dir
    await ensureRuntimeFiles()

    if (!(await pathExists(pythonBinPath()))) {
      logForDebugging('creating runtime venv at %s', { level: 'debug' })
      const pythonCmd = await getVenvCreationPythonCommand()
      await runOrThrow(pythonCmd, ['-m', 'venv', venvRoot], 'python venv creation')
    }

    const pipBin = isWindows
      ? path.join(venvRoot, 'Scripts', 'pip.exe')
      : path.join(venvRoot, 'bin', 'pip')
    if (!(await pathExists(pipBin))) {
      logForDebugging('bootstrapping pip with ensurepip', { level: 'debug' })
      await runOrThrow(pythonBinPath(), ['-m', 'ensurepip', '--upgrade'], 'ensurepip')
    }

    const requirements = await readFile(requirementsPath, 'utf8')
    const digest = createHash('sha256').update(requirements).digest('hex')
    let installedDigest = ''
    try {
      installedDigest = (await readFile(installStampPath, 'utf8')).trim()
    } catch {}

    if (installedDigest !== digest) {
      logForDebugging('installing python runtime dependencies', { level: 'debug' })
      await installRuntimeDependencies(requirementsPath)
      await writeFile(installStampPath, `${digest}\n`, 'utf8')
    }
  })()

  try {
    await bootstrapPromise
  } catch (error) {
    bootstrapPromise = undefined
    throw error
  }
}

/**
 * Resident helper process.
 *
 * Starting the Python helper costs ~0.3 s (interpreter + imports) while the
 * action itself takes ~1-10 ms, so a one-shot call per action spent almost all
 * of its time on startup. This keeps one helper alive and sends it commands as
 * JSON lines; the one-shot path below stays as the fallback.
 */
type Resident = {
  child: ChildProcessWithoutNullStreams
  nextId: number
  queue: Promise<unknown>
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>
}

let resident: Resident | null = null

function stopResident(): void {
  const current = resident
  resident = null
  if (!current) return
  for (const item of current.pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error('computer-use helper stopped'))
  }
  current.pending.clear()
  current.child.kill()
}

function startResident(): Resident | null {
  if (resident) return resident
  try {
    const child = spawn(pythonBinPath(), ['-u', helperPath, 'serve'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: getComputerUsePythonEnv(),
    })
    const created: Resident = { child, nextId: 1, queue: Promise.resolve(), pending: new Map() }
    createInterface({ input: child.stdout }).on('line', line => {
      let reply: { id?: number; output?: { ok?: boolean; error?: { code?: string; message?: string } } }
      try {
        reply = JSON.parse(line)
      } catch {
        return
      }
      const item = reply.id === undefined ? undefined : created.pending.get(reply.id)
      if (!item) return
      clearTimeout(item.timer)
      created.pending.delete(reply.id!)
      item.resolve(reply.output)
    })
    child.once('exit', () => {
      if (resident === created) resident = null
    })
    child.once('error', () => {
      if (resident === created) resident = null
    })
    resident = created
    return created
  } catch {
    return null
  }
}

/** Shared envelope handling: both transports return the helper's own JSON. */
function finishHelperResponse<T>(output: unknown, stderr: string): T {
  const parsed = output as { ok?: boolean; result?: T; error?: { code?: string; message?: string } } | null
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(stderr || 'Python helper returned invalid JSON')
  }
  if (!parsed.ok) {
    // Prefix the machine-readable code so callers can branch on it. The helper
    // reports refusals such as `user_interference` and `target_window_offscreen`
    // this way, and a bare message would flatten them into indistinguishable
    // prose — the model would then retry an action that was deliberately
    // refused. Mirrors how the macOS daemon surfaces `CUError.code`.
    const code = parsed.error?.code
    const message = parsed.error?.message || 'Python helper command failed'
    throw new Error(code && code !== 'runtime_error' ? `${code}: ${message}` : message)
  }
  return parsed.result as T
}

/** One command over the resident pipe; resolves null when it cannot be used. */
async function callResident(command: string, payload: Record<string, unknown>): Promise<unknown> {
  const live = startResident()
  if (!live) return null
  const id = live.nextId++
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      live.pending.delete(id)
      stopResident()
      resolve(null)
    }, 60_000)
    live.pending.set(id, { resolve: value => resolve(value), reject: () => resolve(null), timer })
    try {
      live.child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`)
    } catch {
      clearTimeout(timer)
      live.pending.delete(id)
      stopResident()
      resolve(null)
    }
  })
}

/** Frees the resident helper; the next call starts a new one. */
export function disposePythonHelper(): void {
  stopResident()
}

// The helper must not outlive the app.
process.once('exit', stopResident)

export async function callPythonHelper<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
  await ensureBootstrapped()

  const viaResident = await callResident(command, payload)
  if (viaResident !== null) return finishHelperResponse<T>(viaResident, '')

  const { code, stdout, stderr } = await execFileNoThrow(
    pythonBinPath(),
    [helperPath, command, '--payload', JSON.stringify(payload)],
    { useCwd: false, env: getComputerUsePythonEnv() },
  )

  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr || `Python helper ${command} failed with code ${code}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(stderr || stdout || `Python helper ${command} returned invalid JSON`)
  }

  return finishHelperResponse<T>(parsed, stderr)
}

export function getRuntimePaths(): { projectRoot: string; runtimeStateRoot: string; venvRoot: string } {
  return { projectRoot, runtimeStateRoot, venvRoot }
}

/** Interpreter + script path for the Windows virtual-cursor overlay. */
export function getCursorBadgeCommand(): { python: string; script: string } {
  return { python: pythonBinPath(), script: cursorBadgePath }
}
