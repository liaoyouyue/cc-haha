import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { openLocalIndexDatabase } from './database.js'
import { openScheduledRunIndex } from './scheduledRunIndex.js'
import { openTraceIndexDatabase } from './traceDatabase.js'

/**
 * Windows only lets an elevated or developer-mode process create symlinks, so the
 * symlink-rejection cases below cannot run there. Skip rather than fail: the code
 * under test still refuses the path, we just cannot build the fixture.
 */
const canSymlink = await (async () => {
  const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-symlink-probe-'))
  try {
    await fs.writeFile(path.join(probeRoot, 'target'), '')
    await fs.symlink(path.join(probeRoot, 'target'), path.join(probeRoot, 'link'))
    return true
  } catch {
    return false
  } finally {
    await fs.rm(probeRoot, { recursive: true, force: true }).catch(() => {})
  }
})()

const roots: string[] = []

async function tempRoot(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `managed-db-${label}-`))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root =>
    fs.rm(root, { recursive: true, force: true }),
  ))
})

describe('managed SQLite database paths', () => {
  test.skipIf(!canSymlink).each([
    ['session', 'index-v1.sqlite', openLocalIndexDatabase],
    ['trace', 'trace-index-v1.sqlite', openTraceIndexDatabase],
    ['custom trace', 'trace-storage-index-v1.sqlite', (options: { path: string, scope: string }) => openTraceIndexDatabase({ ...options, customStorage: true })],
    ['scheduled', 'scheduled-runs-v1.sqlite', openScheduledRunIndex],
  ] as const)(
    'rejects a descendant db-directory symlink before opening the %s database',
    async (_kind, filename, openDatabase) => {
      const root = await tempRoot(filename)
      const scope = path.join(root, 'config')
      const outside = path.join(root, 'outside')
      await fs.mkdir(path.join(scope, 'cc-haha'), { recursive: true })
      await fs.mkdir(outside)
      await fs.symlink(outside, path.join(scope, 'cc-haha', 'db'))
      const databasePath = path.join(scope, 'cc-haha', 'db', filename)

      expect(() => openDatabase({ path: databasePath, scope })).toThrow(
        expect.objectContaining({ code: 'LOCAL_INDEX_UNSAFE_PATH' }),
      )
      await expect(fs.stat(path.join(outside, filename))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  test.skipIf(!canSymlink)('allows the configured trust root itself to be a symlink', async () => {
    const root = await tempRoot('scope-symlink')
    const realScope = path.join(root, 'real-config')
    const scope = path.join(root, 'config-link')
    await fs.mkdir(realScope)
    await fs.symlink(realScope, scope)
    const databasePath = path.join(scope, 'cc-haha', 'db', 'index-v1.sqlite')

    const database = openLocalIndexDatabase({ path: databasePath, scope })
    database.close()

    expect((await fs.lstat(databasePath)).isFile()).toBe(true)
  })

  test.skipIf(!canSymlink)('rejects an existing database-file symlink', async () => {
    const root = await tempRoot('file-symlink')
    const scope = path.join(root, 'config')
    const databaseDir = path.join(scope, 'cc-haha', 'db')
    const outside = path.join(root, 'outside.sqlite')
    await fs.mkdir(databaseDir, { recursive: true })
    await fs.writeFile(outside, '')
    await fs.symlink(outside, path.join(databaseDir, 'index-v1.sqlite'))

    expect(() => openLocalIndexDatabase({
      path: path.join(databaseDir, 'index-v1.sqlite'),
      scope,
    })).toThrow(expect.objectContaining({ code: 'LOCAL_INDEX_UNSAFE_PATH' }))
  })

  test('rejects an existing database-file hardlink to an outside inode', async () => {
    const root = await tempRoot('file-hardlink')
    const scope = path.join(root, 'config')
    const databaseDir = path.join(scope, 'cc-haha', 'db')
    const outside = path.join(root, 'outside.sqlite')
    await fs.mkdir(databaseDir, { recursive: true })
    await fs.writeFile(outside, 'outside-owned')
    await fs.link(outside, path.join(databaseDir, 'index-v1.sqlite'))

    expect(() => openLocalIndexDatabase({
      path: path.join(databaseDir, 'index-v1.sqlite'),
      scope,
    })).toThrow(expect.objectContaining({ code: 'LOCAL_INDEX_UNSAFE_PATH' }))
    expect(await fs.readFile(outside, 'utf8')).toBe('outside-owned')
  })
})
