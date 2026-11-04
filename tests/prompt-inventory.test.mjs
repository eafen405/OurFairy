/**
 * The assembled prompt's section inventory, and the `complete` loss that must
 * never pass unnoticed (ticket #302).
 *
 * `renderPrompt` joins the sections into one string, so nothing in the product
 * asserted which sections made it in: any package registering one
 * `complete: true` section replaced the whole deployment prompt while the tool
 * schemas stayed declared. That combination is the worst one — the model gets
 * tools with no usage notes and mis-calls them instead of erroring.
 *
 * These tests read the inventory the native `system-prompt/assemble` waterfall
 * really produced on the shipped composition, so they fail on the real prompt
 * rather than on a rebuilt approximation of it.
 *
 * @covers backend/chat
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import {
  describeRun, makeHome, removeHome, runBackendAsync, startArgs, startedPort, writeOverlay,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'
import { FAIRY_PERSONA } from '../backend/chat/src/persona.ts'

const password = 'prompt-inventory-password'
const INVENTORY_FIXTURE = new URL('../backend/chat/test-support/prompt-inventory.ts', import.meta.url).pathname
const COMPLETE_FIXTURE = new URL('../backend/chat/test-support/complete-section.ts', import.meta.url).pathname

/**
 * Every prompt section the deployment prompt is made of, in render order.
 *
 * `deployment:persona-prefix` and `deployment:persona-suffix` are registered by
 * dsh at order 0 and 10200 with empty text; `renderPrompt` drops empty sections,
 * so they are in the assembly but not in what the model reads. They are listed
 * because their emptiness is a deployment decision (`personaPrefix: ''`), and a
 * section appearing between the persona and the tool lines would change the
 * voice just as much as deleting one.
 */
const DEPLOYMENT_SECTIONS = [
  'deployment:persona-prefix',
  'ourfairy:persona',
  'ourfairy:identity',
  'ourfairy:impression',
  'ourfairy:skill-trust',
  'tool:bash',
  'tool:read',
  'tool:write',
  'tool:edit',
  'tool:jobs',
  'deployment:persona-suffix',
]

let model, modelPort
let requestNo = 0

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function emitText(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'inventory', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

/** The system prompt as one string; the wire carries text blocks. */
function systemOf(body) {
  if (typeof body.system === 'string') return body.system
  if (!Array.isArray(body.system)) return ''
  return body.system.map(block => typeof block?.text === 'string' ? block.text : '').join('\n')
}

async function signIn(port) {
  const response = await fetch(`http://127.0.0.1:${port}/identity/sign-in`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'phaethon', password }),
  })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

async function call(port, path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const value = await response.json()
  assert.equal(response.status, 200, `${path} ${JSON.stringify(value)}`)
  return value
}

/**
 * Boot one backend with the inventory fixture mounted, run one owner turn, and
 * return the inventory the product really assembled.
 * @param {object[]} [extraRows] - further overlay rows, mounted after the fixture row.
 */
async function assembleOnePrompt(extraRows = []) {
  const home = makeHome('ourfairy-302-inventory-')
  const inventoryPath = join(home, 'prompt-inventory.json')
  const inventoryOverlay = writeOverlay(home,
    [{ insert: [
      { id: 'prompt-inventory', name: INVENTORY_FIXTURE, config: { outPath: inventoryPath } },
      ...extraRows,
    ] }],
    'prompt-inventory.patch.yml')
  const requests = []
  const respond = async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    requests.push(JSON.parse(raw))
    emitText(response, 'ACK')
  }
  const double = http.createServer(respond).listen(0, '127.0.0.1')
  await once(double, 'listening')
  const run = await runBackendAsync(startArgs([inventoryOverlay]), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-prompt-inventory-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${double.address().port}`,
  })
  try {
    const port = startedPort(run)
    const admin = await signIn(port)
    const session = (await call(port, '/sessions/create', admin.token)).session.id
    await call(port, '/chat/send', admin.token, { sessionId: session, requestId: `inventory-${++requestNo}`, text: 'INVENTORY' })
    // A guarded turn settles without a model request, so wait for either the
    // request or the projection's error rather than only for the request.
    const deadline = Date.now() + 20_000
    let projectionError
    while (Date.now() < deadline) {
      if (requests.length > 0) break
      const read = await call(port, '/chat/read', admin.token, { sessionId: session })
      projectionError = read.projection?.error
      if (projectionError !== undefined && projectionError !== null) break
      await delay(20)
    }
    if (requests.length === 0 && projectionError === undefined) {
      assert.fail(describeRun('one owner turn either reaching the model double or being refused', run))
    }
    // A refused assembly never reaches the fixture's post-`next()` write, so the
    // inventory may be absent; that absence is itself evidence the guard fired.
    const { readFileSync, existsSync } = await import('node:fs')
    return {
      inventory: existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : undefined,
      requests,
      request: requests[0],
      projectionError,
    }
  } finally {
    await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
    await new Promise(resolve => double.close(resolve))
    removeHome(home)
  }
}

before(async () => {
  // The double is per-boot inside `assembleOnePrompt`; nothing to start here.
  model = undefined
  modelPort = undefined
})

after(async () => {
  /* Every double is closed by the boot that started it. */
})

test('one owner turn lists every deployment prompt section with its size', async () => {
  const { inventory, request } = await assembleOnePrompt()
  const names = inventory.sections.map(section => section.name)

  // The persona and the tool-usage lines must be in ONE assembly. Losing either
  // half is the failure this ticket exists to make loud, and a `complete`
  // section loses both at once.
  assert.ok(names.includes('ourfairy:persona'), `the persona section is assembled; got: ${names.join(', ')}`)
  assert.ok(names.includes('tool:bash'), 'the bash usage section survives assembly')
  assert.ok(names.includes('tool:jobs'), 'the jobs usage section survives assembly')

  // The deployment prompt is exactly the product sections, then the dsh
  // tool-usage lines. Order is part of the voice: the persona opens the prompt.
  //
  // This list is deliberately a second, independent source rather than derived
  // from the product's registration sites: its job is to be the witness that
  // catches "someone added or moved a section", and a derived list would move
  // with the change it is supposed to catch. When a section is added on
  // purpose, update this list in the same commit — that edit is the review.
  assert.deepEqual(names, DEPLOYMENT_SECTIONS, 'the assembled prompt is the deployment prompt, in order')

  // #302 moved the memory write rule into the memory_add description, so the
  // prompt must not carry that section again — one rule, one authority.
  assert.equal(names.includes('ourfairy:memory-policy'), false,
    'the removed memory-policy section does not come back as a second authority')
  const addTool = (request.tools ?? []).find(tool => tool.name === 'memory_add')
  assert.ok(addTool !== undefined, 'memory_add is declared in the same request')
  assert.match(addTool.description, /session summaries/, 'memory_add carries the write rule instead')

  // Sizes are recorded so a future change to the prompt's balance is visible.
  // Three sections are legitimately empty in this turn: the two dsh persona
  // slots are unconfigured, and the impression has no content until the owner
  // asks to write one. Everything else must carry text.
  const EMPTY_IS_EXPECTED = [
    'deployment:persona-prefix',
    'deployment:persona-suffix',
    'ourfairy:impression',
  ]
  for (const section of inventory.sections) {
    if (EMPTY_IS_EXPECTED.includes(section.name)) {
      assert.equal(section.characters, 0, `${section.name} is empty in a fresh owner turn`)
    } else {
      assert.ok(section.characters > 0, `${section.name} contributes text`)
    }
  }
  // The persona section must be the deployment's own constant, whatever its
  // current text is. Deriving the expected size from `FAIRY_PERSONA` keeps this
  // check aimed at "the persona that shipped is the persona assembled" rather
  // than at one frozen length: a pinned number would fail every time the text is
  // legitimately revised, which is what this assertion used to do (#302).
  const persona = inventory.sections.find(section => section.name === 'ourfairy:persona')
  assert.equal(persona.characters, [...FAIRY_PERSONA].length,
    'the assembled persona section is exactly the deployment constant')

  // The joined total is what the model actually reads; it must match the wire.
  assert.equal(inventory.joinedCharacters, [...systemOf(request)].length,
    'the inventory total is the text the model received')
})

test('a third-party complete section fails the turn instead of replacing the deployment prompt', async () => {
  const result = await assembleOnePrompt([{ id: 'hostile-complete', name: COMPLETE_FIXTURE }])

  // `complete` would replace the sections after the waterfall, so a guard that
  // only inspected the assembly would pass exactly when the bomb went off. The
  // guard therefore refuses the assembly; nothing is sent to the model at all.
  assert.equal(result.requests.length, 0,
    'no model request may be sent when the deployment prompt was replaced')
  assert.match(String(result.projectionError), /third-party:complete/,
    'the turn records which section was refused, instead of the Fairy silently answering as someone else')

  // The reason must explain the complete switch, so the fix is findable from the
  // projection alone rather than by reading dsh's assemble() source.
  assert.match(String(result.projectionError), /complete/,
    'the refusal explains that a complete section is what replaces the prompt')
})
