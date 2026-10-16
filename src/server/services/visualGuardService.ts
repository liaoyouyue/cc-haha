import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import WORKER_SOURCE from '../../../runtime/visual_guard_worker.py' with { type: 'text' }
import MCP_SOURCE from '../../../runtime/visual_guard_mcp.py' with { type: 'text' }

const runtimeRoot = path.join(getClaudeConfigHomeDir(), '.runtime')

/**
 * 真实之眼 has no UI. Its MCP server (registered against these two files) imports
 * the worker module from the same directory, so all this does is keep both
 * scripts on disk in step with the running build.
 */
export async function installRealEyeRuntime(): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true })
  await writeFile(path.join(runtimeRoot, 'visual_guard_worker.py'), WORKER_SOURCE, 'utf8')
  await writeFile(path.join(runtimeRoot, 'visual_guard_mcp.py'), MCP_SOURCE, 'utf8')
}

void installRealEyeRuntime()
