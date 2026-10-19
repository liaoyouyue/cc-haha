// Send one user turn from the CI host into the isolated session. Used for the
// approval smoke because adb cannot type the mock-tool JSON payload.
import { readFileSync } from 'node:fs'

const info = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const content = process.argv[3]
const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws/${info.sessionId}?token=${encodeURIComponent(info.token)}`)
const timer = setTimeout(() => { console.error('sendTurn timeout'); process.exit(1) }, 45000)
ws.onopen = () => ws.send(JSON.stringify({ type: 'user_message', content }))
ws.onmessage = event => {
  const message = JSON.parse(String(event.data))
  if (message.type === 'message_complete') {
    clearTimeout(timer)
    ws.close()
    process.exit(0)
  }
}
ws.onerror = () => { clearTimeout(timer); process.exit(1) }
