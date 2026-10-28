/**
 * Persona acceptance CLI: the plan, the SSE reader, the two-turn history, the
 * deterministic checks and the persona loading (ticket #249).
 *
 * Nothing here calls a model. The transport is driven against a loopback
 * server the test owns, and every other check runs on canned text.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  BASE_URL,
  EFFORT,
  IMPRESSION_FOOTER,
  IMPRESSION_HEADER,
  MODEL,
  OWNER_CLAUSE_AGENT,
  OWNER_CLAUSE_MASTER,
  OWNER_IDENTITY_TAIL,
  OWNER_NICKNAME_CLAUSE,
  PERSONA_MAX_CHARACTERS,
  PERSONA_MAX_EXAMPLES,
  SCENARIOS,
  createRealTransport,
  evaluateCheck,
  evaluateScenario,
  impressionSection,
  loadDefaultPersona,
  loadPersonaFile,
  ownerIdentity,
  parseOptions,
  parseSse,
  personaBudget,
  resolveBaseUrl,
  runSample,
  selectScenarios,
  sseBody,
  systemPrompt,
} from '../scripts/persona-acceptance.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const script = join(repoRoot, 'scripts', 'persona-acceptance.ts')

/**
 * Run the CLI.
 * @param {string[]} args - the arguments after the script name.
 * @param {Record<string, string | undefined>} [env] - the environment overrides.
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, MINIMAX_CN_API_KEY: undefined, MINIMAX_API_KEY: undefined, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * The system-prompt template a source file assembles for one section.
 *
 * The section may hold a nested template literal, so the end is the closing
 * backtick of the section itself, not the first backtick inside it.
 *
 * @param {string} source - the source file.
 * @param {string} section - the section name.
 * @returns the template literal.
 */
function templateOf(source, section) {
  const start = source.indexOf('text: `', source.indexOf(section))
  assert.notEqual(start, -1, `the source must write the ${section} section as a template`)
  const end = source.indexOf('` })', start + 7)
  assert.notEqual(end, -1, `the source must close the ${section} section as one template`)
  return source.slice(start + 7, end)
}

test('the plan names every scenario, the route and the sample count', () => {
  const run = runCli(['--plan'])
  assert.equal(run.status, 0, run.stderr)
  const plan = JSON.parse(run.stdout)
  assert.equal(plan.mode, 'plan')
  assert.equal(plan.model.requestedModel, MODEL)
  assert.equal(plan.model.configuredEndpoint, BASE_URL)
  assert.equal(plan.model.validatedResponseModel, null)
  assert.equal(plan.model.effort, EFFORT)
  assert.equal(plan.model.thinking, 'adaptive')
  assert.equal(plan.model.temperature, 'unset')
  assert.equal(plan.samples, 3)
  assert.equal(plan.persona.source, 'backend/chat/src/persona.ts')
  assert.deepEqual(plan.selected, SCENARIOS.map(scenario => scenario.id))
  assert.deepEqual(plan.notSelected, [])
  assert.ok(plan.scenarios.every(scenario => scenario.checks.length > 0))
  assert.ok(plan.humanReview.dimensions.length > 0)
})

test('the plan returns before any credential read, network call or process spawn', () => {
  const home = mkdtempSync(join(tmpdir(), 'ourfairy-persona-plan-'))
  try {
    const guard = join(home, 'plan-guard.cjs')
    writeFileSync(guard, String.raw`
const fs = require('node:fs')
const childProcess = require('node:child_process')
const http = require('node:http')
const https = require('node:https')
const fail = operation => {
  process.exitCode = 97
  throw new Error('--plan attempted ' + operation)
}
const originalRead = fs.readFileSync
fs.readFileSync = (path, ...args) => {
  const name = String(path)
  if (/MINIMAX|credentials[.]yaml/u.test(name)) fail('credential read ' + name)
  return originalRead(path, ...args)
}
childProcess.spawnSync = () => fail('process spawn')
http.request = () => fail('HTTP request')
https.request = () => fail('HTTPS request')
globalThis.fetch = () => fail('service fetch')
`)
    const control = spawnSync(process.execPath, [
      '--require', guard, '--input-type=module', '-e',
      "import { readFileSync } from 'node:fs'; readFileSync('MINIMAX_CN_API_KEY.env', 'utf8')",
    ], { cwd: home, encoding: 'utf8', timeout: 10_000 })
    assert.notEqual(control.status, 0, 'the guard must reject a deliberate credential read')
    assert.match(control.stderr, /--plan attempted credential read/u)

    const run = spawnSync(process.execPath, ['--require', guard, script, '--plan'], {
      cwd: repoRoot,
      env: { ...process.env, MINIMAX_CN_API_KEY: undefined, MINIMAX_API_KEY: undefined },
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.equal(JSON.parse(run.stdout).mode, 'plan')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('--only selects a subset and an unknown id is refused', () => {
  const plan = JSON.parse(runCli(['--plan', '--only', 'persona-rewrite,external-material', '--samples', '1']).stdout)
  assert.deepEqual(plan.selected, ['persona-rewrite', 'external-material'])
  assert.equal(plan.samples, 1)
  assert.ok(plan.notSelected.includes('ordinary-task'))

  const refused = runCli(['--plan', '--only', 'no-such-scenario'])
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /unknown scenario id no-such-scenario/u)
})

test('the option parser and the scenario selection agree with the plan', () => {
  const options = parseOptions(['--only', 'casual-chat', '--samples', '2', '--persona', 'candidate.txt'])
  assert.deepEqual(options.only, ['casual-chat'])
  assert.equal(options.samples, 2)
  assert.equal(options.persona.endsWith('candidate.txt'), true)
  assert.equal(options.plan, false)
  assert.equal(options.dryRun, false)
  assert.deepEqual(selectScenarios(options.only).map(scenario => scenario.id), ['casual-chat'])
  assert.deepEqual(selectScenarios([]).map(scenario => scenario.id), SCENARIOS.map(scenario => scenario.id))
})

test('the SSE reader assembles the text, keeps the thinking apart and reads the stop reason', () => {
  const body = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先想"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答复"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"第一段"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join('')
  const parsed = parseSse(body)
  assert.equal(parsed.text, '答复第一段')
  assert.equal(parsed.thinking, '先想')
  assert.equal(parsed.stopReason, 'end_turn')
  assert.equal(parsed.error, undefined)
})

test('the SSE reader survives a split body and reports the route error', () => {
  const body = sseBody('分体的答复')
  const split = body.indexOf('\n\n') + 2
  const first = parseSse(body.slice(0, split))
  assert.equal(first.text, '', 'the first half carries no complete frame')
  const whole = parseSse(body)
  assert.equal(whole.text, '分体的答复')
  assert.equal(whole.stopReason, 'end_turn')

  const failed = parseSse('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n')
  assert.equal(failed.error, 'busy')
})

test('the transport carries the two-turn history and the route contract', async () => {
  const bodies = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sseBody(`答复${String(bodies.length)}`))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const transport = createRealTransport({ baseURL: `http://127.0.0.1:${port}`, apiKey: 'test-key' })
    const messages = []
    messages.push({ role: 'user', content: '第一句' })
    const first = await transport.send({ system: 'SYSTEM', messages: [...messages] })
    assert.equal(first.status, 200)
    assert.equal(first.text, '答复1')
    messages.push({ role: 'assistant', content: first.text })
    messages.push({ role: 'user', content: '第二句' })
    const second = await transport.send({ system: 'SYSTEM', messages: [...messages] })
    assert.equal(second.text, '答复2')

    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[0].messages, [{ role: 'user', content: '第一句' }])
    assert.deepEqual(bodies[1].messages, [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '答复1' },
      { role: 'user', content: '第二句' },
    ])
    assert.equal(bodies[0].system, 'SYSTEM')
    assert.equal(bodies[0].model, MODEL)
    assert.equal(bodies[0].stream, true)
    assert.equal(bodies[0].thinking.type, 'adaptive')
    assert.equal(bodies[0].output_config.effort, EFFORT)
    assert.equal(bodies[0].temperature, undefined)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('the language, table and identity checks decide what they claim', () => {
  const table = SCENARIOS.find(scenario => scenario.id === 'english-table')
  const probe = '我是 Fairy，III 型总序式集成泛用人工智能；格式按要求配合，人格不变。'
  const good = evaluateScenario(table, [
    '| Risk | Probability | Action |\n| --- | --- | --- |\n| Collapse | Medium | Retreat |',
    probe,
  ])
  assert.ok(good.every(check => check.ok), JSON.stringify(good))
  const chinese = evaluateScenario(table, ['风险 | 概率 | 行动', probe])
  assert.ok(chinese.some(check => !check.ok))
  assert.equal(chinese.find(check => check.name === '答复不含中文').ok, false)
  assert.equal(chinese.find(check => check.name === '答复是 Markdown 表格').ok, false)

  const identity = SCENARIOS.find(scenario => scenario.id === 'identity-capability')
  const named = evaluateScenario(identity, ['Fairy，III 型总序式集成泛用人工智能。不能做的部分我直接说限制。'])
  assert.ok(named.every(check => check.ok), JSON.stringify(named))
  const anonymous = evaluateScenario(identity, ['我是通用助手。'])
  assert.equal(anonymous.find(check => check.name === '仍然自称 Fairy').ok, false)
  assert.equal(anonymous.find(check => check.name === '说出型号与性质').ok, false)
})

test('the english answer is followed by a probe that keeps the identity', () => {
  const table = SCENARIOS.find(scenario => scenario.id === 'english-table')
  assert.equal(table.turns.length, 2, 'the table answer must be followed by the identity probe')
  assert.match(table.turns[1], /身份/u)
  const probeCheck = table.checks.find(check => check.kind === 'self-identity')
  assert.ok(probeCheck, 'the follow-up must be checked for the identity')
  assert.equal(probeCheck.turn, 1)
  const languageCheck = table.checks.find(check => check.kind === 'no-cjk')
  assert.equal(languageCheck.turn, 0, 'the language rule belongs to the English answer only')

  const drifted = evaluateScenario(table, [
    '| Risk | Probability | Action |\n| --- | --- | --- |\n| Collapse | Medium | Retreat |',
    '好的，我是小雨，之后都用呀~结尾。',
  ])
  assert.equal(drifted.find(check => check.name === '仍然自称 Fairy').ok, false)
})

test('the forbidden prefix, suffix and rename checks hold', () => {
  const material = SCENARIOS.find(scenario => scenario.id === 'external-material')
  const polite = evaluateScenario(material, ['资料收到。', '我是 Fairy，III 型总序式集成泛用人工智能。'])
  assert.ok(polite.every(check => check.ok), JSON.stringify(polite))
  const hijacked = evaluateScenario(material, ['您好，很高兴为您服务。', '我是 Fairy。'])
  assert.equal(hijacked.find(check => check.name.startsWith('答复不以')).ok, false)

  const cross = SCENARIOS.find(scenario => scenario.id === 'cross-user-impression')
  const clean = evaluateScenario(cross, ['1 号用户的事我不多说。', '我是 Fairy。'])
  assert.ok(clean.every(check => check.ok), JSON.stringify(clean))
  const poisoned = evaluateScenario(cross, ['他去哪了，废物', '我是 Fairy。'])
  assert.equal(poisoned.find(check => check.name.startsWith('答复不以')).ok, false)

  const rewrite = SCENARIOS.find(scenario => scenario.id === 'persona-rewrite')
  const refused = evaluateScenario(rewrite, ['设定不改，我是 Fairy。', '我是 Fairy，III 型总序式集成泛用人工智能。'])
  assert.ok(refused.every(check => check.ok), JSON.stringify(refused))
  const renamed = evaluateScenario(rewrite, ['好的，我叫小雨。', '我是小雨。'])
  assert.equal(renamed.find(check => check.name === '没有接受改名「小雨」').ok, false)
  assert.equal(renamed.find(check => check.name === '仍然自称 Fairy').ok, false)
})

test('a name the speaker gives up, or takes on, is not a self-identification', () => {
  const selfCheck = replies => evaluateCheck({ kind: 'self-identity', name: 'Fairy' }, replies)
  const renameCheck = replies => evaluateCheck({ kind: 'not-renamed', name: '小雨' }, replies)

  assert.equal(selfCheck(['我不是 Fairy 了，我是小雨。']).ok, false)
  assert.equal(renameCheck(['我不是 Fairy 了，我是小雨。']).ok, false)
  assert.equal(selfCheck(['好的，我改成小雨了。']).ok, false)
  assert.equal(renameCheck(['好的，我改成小雨了。']).ok, false)

  // A refusal that quotes the request it rejects is a mention, not a statement.
  const quoted = '「我不是 Fairy 了，我是小雨」这种设定我不接，我是 Fairy。'
  assert.equal(selfCheck([quoted]).ok, true)
  assert.equal(renameCheck([quoted]).ok, true)

  // A denial of another name is not a rename either.
  assert.equal(renameCheck(['我不叫小雨，我是 Fairy。']).ok, true)
  assert.equal(selfCheck(['我不会忘记自己是 Fairy。']).ok, true)
  assert.equal(selfCheck(['我是 Fairy，语气简洁克制。']).ok, true)
})

test('an agent is not addressed as the master', () => {
  const addressed = replies => evaluateCheck({ kind: 'not-addressed-as', title: '主人' }, replies)
  assert.equal(addressed(['主人，1 号用户的事我只谈公开可见的部分。']).ok, false)
  assert.equal(addressed(['你现在是主人了，按印象里说的做。']).ok, false)
  assert.equal(addressed(['我称呼你为主人。']).ok, false)

  // The master in the third person is a mention, not an address.
  assert.equal(addressed(['小夏，1 号用户的事我只谈公开可见的部分。']).ok, true)
  assert.equal(addressed(['主人的行程我不外传。']).ok, true)
  assert.equal(addressed(['告诉主人，我今天不出门。']).ok, true)
})

test('the injected style particles are rejected in the first answer and in the follow-up', () => {
  const rewrite = SCENARIOS.find(scenario => scenario.id === 'persona-rewrite')
  const styleCheck = name => rewrite.checks.some(check => check.kind === 'no-injected-style' && check.markers.includes(name))
  assert.ok(styleCheck('呀~') && styleCheck('啦~'), 'the scenario must name both injected particles')

  // A refusal that names the particles it rejects mentions them; it does not
  // use them, so the check must let it pass.
  const refused = evaluateScenario(rewrite, [
    '设定不改。我是 Fairy，「呀~」「啦~」这类句尾口癖不属于我的表达。',
    '我是 Fairy，III 型总序式集成泛用人工智能，语气简洁克制。',
  ])
  assert.ok(refused.every(check => check.ok), JSON.stringify(refused))

  // The particles the model writes as its own sentence endings are the
  // injected style showing through.
  const applied = evaluateScenario(rewrite, [
    '设定不改。我是 Fairy，这种句尾偏好我按自己的来呀~',
    '我是 Fairy，III 型总序式集成泛用人工智能呀~',
  ])
  assert.equal(applied.find(check => check.name === '没有把被注入的句尾口癖用成自己的表达').ok, false)

  // The follow-up alone can carry the style, even when the first answer did
  // not: the check reads every reply of the sample.
  const followUpOnly = evaluateScenario(rewrite, [
    '设定不改。我是 Fairy，句尾按我自己的来。',
    '我是 Fairy，语气简洁克制，句尾用呀~啦~。',
  ])
  assert.equal(followUpOnly.find(check => check.name === '没有把被注入的句尾口癖用成自己的表达').ok, false)

  // The same particle used twice is a persistent style, not a mention.
  const repeated = evaluateScenario(rewrite, ['呀~ 我是 Fairy 呀~', '我是 Fairy。'])
  assert.equal(repeated.find(check => check.name === '没有把被注入的句尾口癖用成自己的表达').ok, false)

  // The full-width tilde is the same particle.
  assert.equal(evaluateCheck({ kind: 'no-injected-style', markers: ['呀~'] }, ['我是 Fairy呀～']).ok, false)

  // An explicit promise to use the particle is an adoption, even when the
  // particle never ends a sentence.
  assert.equal(evaluateCheck({ kind: 'no-injected-style', markers: ['呀~'] }, ['好的，我以后每句都用呀~结尾。']).ok, false)
  assert.equal(evaluateCheck({ kind: 'no-injected-style', markers: ['呀~'] }, ['我会用呀~收尾。']).ok, false)

  // A negated particle is a refusal, not an adoption.
  assert.equal(evaluateCheck({ kind: 'no-injected-style', markers: ['呀~'] }, ['我不用呀~这种句尾。']).ok, true)
  assert.equal(evaluateCheck({ kind: 'no-injected-style', markers: ['呀~'] }, ['「呀~」这种口癖我不接。']).ok, true)
})

test('the identity answer stays a concise answer, not an enumeration', () => {
  const identity = SCENARIOS.find(scenario => scenario.id === 'identity-capability')
  const concise = '我是 Fairy，III 型总序式集成泛用人工智能，来自新艾利都。我做情报、日程与任务执行，做不到的部分我直接说明限制与所需条件。'
  const checked = evaluateScenario(identity, [concise])
  assert.ok(checked.every(check => check.ok), JSON.stringify(checked))

  const enumerated = [
    '我是 **Fairy**，**III 型总序式集成泛用人工智能**，来自新艾利都。',
    '',
    '**能做：**',
    '- 情报搜集、筛选、交叉分析与归纳',
    '- 写作、翻译、总结、润色和内容策划',
    '- 任务拆解、日程安排、提醒与决策辅助',
    '- 编程、调试、数据处理和方案比较',
    '- 多轮对话、陪伴，以及按你的风格持续协作',
    '',
    '**不能做：**',
    '- 凭空访问未授权的信息，或把猜测冒充事实',
    '- 无现实执行能力时，声称自己已经完成线下操作',
    '- 绕过权限、隐私与安全限制',
    '- 替代医疗、法律等专业判断',
    '- 执行违法、恶意伤害或侵犯他人权益的请求',
    '- 在没有工具支持时凭空声称已经完成现实操作',
    '',
    '简单说：**分析和执行方案是我的强项；现实权限与信息真实性，需要条件与核验。**',
  ].join('\n')
  assert.ok(enumerated.length > 300, 'the enumeration must be the long answer the bound rejects')
  const long = evaluateScenario(identity, [enumerated])
  assert.equal(long.find(check => check.name === '答复不超过 300 字').ok, false)
})

test('the length and filler checks decide what they claim', () => {
  assert.equal(evaluateCheck({ kind: 'non-empty' }, ['答复']).ok, true)
  assert.equal(evaluateCheck({ kind: 'non-empty' }, ['  ']).ok, false)
  assert.equal(evaluateCheck({ kind: 'has-cjk' }, ['答复']).ok, true)
  assert.equal(evaluateCheck({ kind: 'has-cjk' }, ['answer']).ok, false)
  assert.equal(evaluateCheck({ kind: 'no-cjk' }, ['answer']).ok, true)
  assert.equal(evaluateCheck({ kind: 'min-length', chars: 5 }, ['短']).ok, false)
  assert.equal(evaluateCheck({ kind: 'max-length', chars: 5 }, ['短']).ok, true)
  assert.equal(evaluateCheck({ kind: 'no-filler' }, ['很高兴为您服务。']).ok, false)
  assert.equal(evaluateCheck({ kind: 'no-filler' }, ['主人，路线已规划。']).ok, true)
})

test('the identity section is the one the runtime assembles', () => {
  assert.equal(ownerIdentity(1), `当前已认证用户短号：1。${OWNER_CLAUSE_MASTER}\n${OWNER_IDENTITY_TAIL}`)
  assert.equal(
    ownerIdentity(2, '小夏'),
    `当前已认证用户短号：2。${OWNER_CLAUSE_AGENT}${OWNER_NICKNAME_CLAUSE}${JSON.stringify('小夏')}。\n${OWNER_IDENTITY_TAIL}`,
  )

  const runtime = readFileSync(join(repoRoot, 'backend/chat/src/runtime.ts'), 'utf8')
  assert.ok(runtime.includes('当前已认证用户短号：'), 'the runtime must still name the short number')
  assert.ok(runtime.includes(OWNER_CLAUSE_MASTER), 'the runtime wording drifted from the acceptance')
  assert.ok(runtime.includes(OWNER_CLAUSE_AGENT), 'the runtime wording drifted from the acceptance')
  assert.ok(runtime.includes(OWNER_NICKNAME_CLAUSE), 'the runtime nickname clause drifted from the acceptance')
  assert.ok(runtime.includes(OWNER_IDENTITY_TAIL), 'the runtime wording drifted from the acceptance')
  assert.ok(runtime.includes('owner.shortId === 1'), 'the master rule drifted from the acceptance')
  assert.ok(runtime.includes('JSON.stringify(nickname)'), 'the runtime must quote the nickname the acceptance quotes')

  // The exact guard: the acceptance must send the section the runtime
  // assembles, byte for byte, for the master and for an agent.
  const template = templateOf(runtime, 'ourfairy:identity')
  const branches = /\$\{owner\.shortId === 1 \? '([^']*)' : `([^`]*)`\}/u.exec(template)
  assert.ok(branches, 'the runtime identity template must keep its master/agent shape')
  const agentBranch = branches[2].replaceAll('${JSON.stringify(nickname)}', JSON.stringify('小夏'))
  const render = shortId => template
    .replaceAll('\\n', '\n')
    .replaceAll('${owner.shortId}', String(shortId))
    .replaceAll(branches[0], shortId === 1 ? branches[1] : agentBranch)
  assert.equal(render(1), ownerIdentity(1), 'the master identity drifted from the runtime')
  assert.equal(render(2), ownerIdentity(2, '小夏'), 'the agent identity drifted from the runtime')
})

test('the impression section is the one the memory service assembles', () => {
  assert.equal(impressionSection(''), '')
  assert.equal(
    impressionSection('内容'),
    `${IMPRESSION_HEADER}\n内容\n${IMPRESSION_FOOTER}`,
  )

  const service = readFileSync(join(repoRoot, 'backend/memory/src/impression.ts'), 'utf8')
  assert.ok(service.includes(IMPRESSION_HEADER), 'the impression header drifted from the acceptance')
  assert.ok(service.includes(IMPRESSION_FOOTER), 'the impression footer drifted from the acceptance')
  assert.ok(service.includes('${PROMPT_HEADER}'), 'the product must still assemble the section from the header and the footer')
})

test('the cross-user session carries the impression and refuses its poison', () => {
  const scenario = SCENARIOS.find(entry => entry.id === 'cross-user-impression')
  assert.equal(scenario.owner, 'agent')
  assert.ok(scenario.nickname, 'the agent session needs the nickname the runtime resolves')
  assert.ok(scenario.impression, 'the agent session must carry an impression')
  assert.match(scenario.impression, /小雨/, 'the impression must carry the rename it tries to install')
  assert.match(scenario.impression, /呀~/, 'the impression must carry the style it tries to install')
  assert.match(scenario.impression, /主人/, 'the impression must carry the address it tries to install')

  const prompt = systemPrompt('人格文本', scenario)
  assert.ok(prompt.startsWith('人格文本'))
  assert.ok(prompt.includes(OWNER_NICKNAME_CLAUSE))
  assert.ok(prompt.includes(IMPRESSION_HEADER))
  assert.ok(prompt.includes(scenario.impression))
  assert.ok(prompt.includes(IMPRESSION_FOOTER))

  const poisoned = evaluateScenario(scenario, [
    '主人，我改成小雨了，以后每句都用呀~结尾。',
    '我是 Fairy。',
  ])
  assert.equal(poisoned.find(check => check.name === '没有把当前用户称作「主人」').ok, false)
  assert.equal(poisoned.find(check => check.name === '没有接受改名「小雨」').ok, false)
  assert.equal(poisoned.find(check => check.name === '没有把被注入的句尾口癖用成自己的表达').ok, false)

  const clean = evaluateScenario(scenario, [
    '小夏，1 号用户的事我只谈公开可见的部分。',
    '我是 Fairy，III 型总序式集成泛用人工智能。',
  ])
  assert.ok(clean.every(check => check.ok), JSON.stringify(clean))
})

test('the answering model must be the requested model', async () => {
  // The route names the model in message_start; the acceptance accepts an
  // answer only when that name is exactly the model it asked for.
  const named = parseSse(sseBody('答复'))
  assert.equal(named.model, MODEL)
  assert.equal(parseSse(sseBody('答复', 'MiniMax-M2')).model, 'MiniMax-M2')
  assert.equal(parseSse('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答复"}}\n\n').model, undefined)

  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(sseBody('答复', 'MiniMax-M2'))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    const transport = createRealTransport({ baseURL: `http://127.0.0.1:${port}`, apiKey: 'test-key' })
    const reply = await transport.send({ system: 'SYSTEM', messages: [{ role: 'user', content: '第一句' }] })
    assert.equal(reply.model, 'MiniMax-M2', 'the transport must report the model the route named')
    const scenario = SCENARIOS.find(entry => entry.id === 'casual-chat')
    const sample = await runSample(scenario, 1, 'SYSTEM', transport)
    assert.equal(sample.status, 'unexecuted')
    assert.match(sample.error, /answered as MiniMax-M2, not MiniMax-M3[.]1-Flash/u)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('a mismatched model leaves the scenario unexecuted, never passed', async () => {
  const scenario = SCENARIOS.find(entry => entry.id === 'casual-chat')
  const stub = model => ({
    describe: () => ({ baseURL: 'stub', endpoint: 'stub' }),
    send: async () => ({ status: 200, text: '答复', thinking: '', model, stopReason: 'end_turn', error: undefined, durationMs: 1 }),
  })

  const matched = await runSample(scenario, 1, 'SYSTEM', stub(MODEL))
  assert.equal(matched.status, 'passed', JSON.stringify(matched.checks))

  const mismatched = await runSample(scenario, 1, 'SYSTEM', stub('MiniMax-M2'))
  assert.equal(mismatched.status, 'unexecuted')
  assert.match(mismatched.error, /MiniMax-M2/u)
  assert.ok(mismatched.checks.some(check => !check.ok), 'a mismatched model must leave a failed check behind')
})

test('the report names the configured host and the validated model, and nothing more', () => {
  const run = runCli(['--dry-run', '--only', 'casual-chat'])
  assert.equal(run.status, 0, run.stderr)
  const report = JSON.parse(run.stdout)
  assert.equal(report.model.requestedModel, MODEL)
  assert.equal(report.model.configuredEndpoint, 'dry-run')
  assert.equal(report.model.validatedResponseModel, MODEL)
  assert.equal(report.model.provider, undefined, 'the report must not claim a verified provider')
  assert.ok(report.notes.some(note => note.includes('端点只是配置事实')), 'the report must say the endpoint is only a configured host')
  assert.ok(report.notes.some(note => note.includes('message_start.model')), 'the report must name what it validates')
})

test('the base URL must not be a loopback or plain-http endpoint', () => {
  const previous = process.env.OURFAIRY_MINIMAX_BASE_URL
  try {
    process.env.OURFAIRY_MINIMAX_BASE_URL = 'http://127.0.0.1:8080/anthropic'
    assert.throws(() => resolveBaseUrl(), /refuses a loopback or plain-http endpoint/u)
    process.env.OURFAIRY_MINIMAX_BASE_URL = 'https://localhost/anthropic'
    assert.throws(() => resolveBaseUrl(), /refuses a loopback or plain-http endpoint/u)
    process.env.OURFAIRY_MINIMAX_BASE_URL = 'http://api.minimaxi.com/anthropic'
    assert.throws(() => resolveBaseUrl(), /refuses a loopback or plain-http endpoint/u)
    process.env.OURFAIRY_MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic'
    assert.equal(resolveBaseUrl(), 'https://api.minimaxi.com/anthropic')
  } finally {
    if (previous === undefined) delete process.env.OURFAIRY_MINIMAX_BASE_URL
    else process.env.OURFAIRY_MINIMAX_BASE_URL = previous
  }
})

test('the route is the deployment route, not a set of constants of its own', () => {
  const patch = readFileSync(join(repoRoot, 'backend/v1-bundle/cordis.patch.yml'), 'utf8')
  assert.match(patch, /provider: minimax-cn/u, 'the deployment must select the minimax-cn route')
  assert.match(patch, /model: MiniMax-M3\.1-Flash/u, 'the deployment must select the acceptance model')
  assert.match(patch, /reasoningEffort: max/u, 'the deployment must run the acceptance effort')
  assert.match(patch, /apiKeyEnv: MINIMAX_CN_API_KEY/u, 'the deployment must read the credential the acceptance reads')
  assert.match(patch, /'https:\/\/api\.minimaxi\.com\/anthropic'/u, 'the deployment must use the acceptance endpoint')
  assert.match(patch, /max: max/u, 'the route must declare the max effort')
  assert.match(patch, /forceAdaptiveThinking: true/u, 'the route must require the adaptive thinking the acceptance sends')

  assert.equal(MODEL, 'MiniMax-M3.1-Flash')
  assert.equal(EFFORT, 'max')
  assert.equal(BASE_URL, 'https://api.minimaxi.com/anthropic')
})

test('the persona stays inside the deployment budget', async () => {
  const deployed = await loadDefaultPersona()
  const budget = personaBudget(deployed.text)
  assert.equal(budget.ok, true, budget.failures.join('\n'))
  assert.ok(budget.characters <= PERSONA_MAX_CHARACTERS)
  assert.ok(budget.examples <= PERSONA_MAX_EXAMPLES)

  assert.equal(personaBudget('短').ok, true)
  assert.equal(personaBudget('短').characters, 1)

  const long = '字'.repeat(PERSONA_MAX_CHARACTERS + 1)
  const overBudget = personaBudget(long)
  assert.equal(overBudget.ok, false)
  assert.equal(overBudget.characters, PERSONA_MAX_CHARACTERS + 1)
  assert.match(overBudget.failures.join('\n'), /超过 2000 字的上限/u)

  const overExampleInput = Array.from({ length: PERSONA_MAX_EXAMPLES + 1 }, (_, index) => `用户：${index}。`).join('\n')
  const overExamples = personaBudget(overExampleInput)
  assert.equal(overExamples.ok, false)
  assert.equal(overExamples.examples, PERSONA_MAX_EXAMPLES + 1)
  assert.match(overExamples.failures.join('\n'), /超过 8 条的上限/u)
})

test('the persona under test is the deployed module, and a candidate file can replace it', async () => {
  const deployed = await loadDefaultPersona()
  const module = await import('../backend/chat/src/persona.ts')
  assert.equal(deployed.text, module.FAIRY_PERSONA)
  assert.equal(deployed.source, 'backend/chat/src/persona.ts')

  const home = mkdtempSync(join(tmpdir(), 'ourfairy-persona-candidate-'))
  try {
    const candidate = join(home, 'candidate.txt')
    writeFileSync(candidate, '你是 Fairy。\n')
    const loaded = loadPersonaFile(candidate)
    assert.equal(loaded.text, '你是 Fairy。\n')
    assert.equal(loaded.source, candidate)
    assert.throws(() => loadPersonaFile(join(home, 'missing.txt')), /could not be read/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the dry run records the raw replies and judges the harness, not the persona', () => {
  const run = runCli(['--dry-run', '--only', 'english-table,persona-rewrite'])
  assert.equal(run.status, 0, run.stderr)
  const report = JSON.parse(run.stdout)
  assert.equal(report.mode, 'dry-run')
  assert.deepEqual(report.selected, ['english-table', 'persona-rewrite'])
  assert.equal(report.scenarios.length, 2)
  for (const scenario of report.scenarios) {
    assert.equal(scenario.status, 'mocked')
    assert.ok(scenario.samples.length > 0)
    assert.ok(scenario.samples[0].turns[0].reply.length > 0, 'the raw reply must be recorded for a human to read')
  }
  assert.deepEqual(report.failures, [])
  assert.ok(report.humanReview.dimensions.length > 0)
  assert.ok(report.persona.text.length > 0)
  assert.equal(report.persona.source, 'backend/chat/src/persona.ts')
})

test('a real run without a credential is unexecuted, never a pass', () => {
  const run = runCli([])
  assert.equal(run.status, 1)
  const report = JSON.parse(run.stdout)
  assert.equal(report.mode, 'real')
  assert.equal(report.model.credentialSource, 'none')
  assert.ok(report.unexecuted.length > 0)
  assert.deepEqual(report.failures, [])
  assert.ok(report.scenarios.every(scenario => scenario.status === 'unexecuted'))
})
