// The resident transport must not weaken the guards: a mutating command with a
// coordinate off every display has to be refused, and refused with its code.
import { callPythonHelper, disposePythonHelper } from '../src/utils/computerUse/pythonBridge.ts'

let refused = ''
try {
  await callPythonHelper('click', { x: -90000, y: -90000 })
  refused = 'NOT REFUSED'
} catch (error) {
  refused = error instanceof Error ? error.message : String(error)
}
disposePythonHelper()

const second = await (async () => {
  try {
    await callPythonHelper('move_mouse', { x: 999999, y: 999999 })
    return 'NOT REFUSED'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
})()

console.log(JSON.stringify({ click: refused.slice(0, 90), move: second.slice(0, 90) }))
