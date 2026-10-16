// Times callPythonHelper through the real call path: the first call starts the
// resident helper, the rest should be milliseconds.
import { callPythonHelper, disposePythonHelper } from '../src/utils/computerUse/pythonBridge.ts'

const start = Date.now()
const times: number[] = []
for (let i = 0; i < 6; i++) {
  const t = Date.now()
  const result = await callPythonHelper<{ x: number; y: number }>('cursor_position')
  times.push(Date.now() - t)
  if (typeof result?.x !== 'number') throw new Error(`bad result: ${JSON.stringify(result)}`)
}
disposePythonHelper()
console.log(JSON.stringify({ times, total: Date.now() - start }))
