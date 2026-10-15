import { readFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { createServer, request } from 'node:http'

// Execute the actual new responder, without changing product sources. Only the
// attachment source is an instrumented async generator to expose its cleanup.
const source = readFileSync('/home/eafen405/projects/OurFairy/backend/attachments/src/index.mjs', 'utf8')
const start = source.indexOf('async (res, input) => {', source.indexOf("register('/attachments/download'"))
const end = source.indexOf('\n  }))', start)
let sourceClosed = false, handlerSettled = false, responseClosed = false, chunks = 0
const ctx = { attachments: { async *readFileStream() {
  try { for (let i = 0; i < 512; i++) { chunks++; yield Buffer.alloc(65536) } }
  finally { sourceClosed = true }
} } }
const respond = new Function('ctx', 'once', `return (${source.slice(start, end)}\n})`)(ctx, once)
const server = createServer((_req, res) => {
  res.once('close', () => { responseClosed = true })
  respond(res, { original: { bytes: 32 * 1024 * 1024 }, mime: 'application/octet-stream', name: 'original.bin' })
    .finally(() => { handlerSettled = true })
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
await new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: server.address().port, method: 'POST' }, res => {
    res.once('data', () => { res.destroy(); resolve() })
    res.on('error', () => {})
  })
  req.on('error', reject); req.end()
})
await new Promise(resolve => setTimeout(resolve, 250))
const result = { responseClosed, handlerSettled, sourceClosed, chunks }
console.log(JSON.stringify(result))
writeFileSync('/tmp/ourfairy-stage789-download-abort-result.json', JSON.stringify(result, null, 2) + '\n')
server.closeAllConnections(); server.close()
