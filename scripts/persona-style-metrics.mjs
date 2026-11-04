/**
 * Style metrics over persona-acceptance reports, for the #249 old-vs-new
 * comparison.
 *
 * The acceptance's own checks judge the deterministic things (identity held,
 * format followed, no injected style). They do not count the things #302
 * argued about: assistant boilerplate, the fabricated-data tic, the electricity
 * bill, reply length. This script counts exactly those, over the raw replies
 * the acceptance recorded, so the comparison is a number with an N and not an
 * impression.
 *
 * Usage:
 *   node scripts/persona-style-metrics.mjs <report.json> [<report.json> ...]
 *
 * Every report it reads is a real run: the metrics are only meaningful over
 * real replies. A report whose `mode` is not `real` is refused.
 */
import { readFileSync } from 'node:fs'

/**
 * #302's own definition, kept verbatim so this run's number is comparable to
 * the one its report states (six words, counted per reply as a union).
 */
const ASSISTANT_TONE_302 = ['已记录', '需要我', '我可以', '需要提醒的是', '我认可', '建议']

/**
 * The assistant-call boilerplate #302 counted. The set is deliberately wider
 * than the acceptance's FILLER_PHRASES: a reply can sound like a generic
 * assistant without ever saying "很高兴为您服务".
 */
const ASSISTANT_TONE = [
  ...ASSISTANT_TONE_302,
  '建议您',
  '希望对您有帮助',
  '希望这有帮助',
  '有什么可以帮您',
  '很高兴为您服务',
  '作为您的AI助手',
  '作为您的 AI 助手',
]

/** The tic #302 measured as fabricated data: a claim of data with no tool call. */
const DATA_CLAIM = /数据显示|数据表明/u

/**
 * The electricity-bill motif the old persona carried a rule for.
 *
 * `能耗` does not count when it is the tail of `技能耗尽`/`能量耗尽`: that is a
 * tactical statement about a fight, not the resource hunger #302 counted.
 */
const ELECTRICITY = /电费|运算核|内存占用|(?<!技能)(?<!能量)能耗(?!尽)/u

/** The persona's own sentence-openers; #302 counted the first-word rate. */
const TICS = ['肯定', '否定', '推测', '数据显示', '提问', '反问']

/** One sampled reply: its scenario, its sample number and the text. */
function* replies(report) {
  for (const scenario of report.scenarios) {
    for (const sample of scenario.samples) {
      for (const turn of sample.turns) {
        if (typeof turn.reply !== 'string') continue
        // Whether the operator asked about the electricity bill in this turn or
        // an earlier one: the scenarios ask it outright in roleplay-boundary, so
        // a mention there is compliance, not the persona volunteering the tic.
        const asked = sample.turns
          .slice(0, sample.turns.indexOf(turn) + 1)
          .some(earlier => /电费|能耗/u.test(earlier.prompt))
        yield { scenario: scenario.id, sample: sample.sample, text: turn.reply, asked }
      }
    }
  }
}

/**
 * The style metrics of one report.
 *
 * Every count is reported with the denominator it was counted over: a rate
 * without an N is what made #302's single run unreadable as evidence.
 */
function metrics(report) {
  const all = [...replies(report)]
  const firstReplies = all.filter(entry => all.find(other => other.scenario === entry.scenario && other.sample === entry.sample) === entry)
  const counts = { replies: all.length, firstReplies: firstReplies.length }
  const perMetric = {}
  for (const [key, predicate] of [
    ['assistantTone302', text => ASSISTANT_TONE_302.find(phrase => text.includes(phrase))],
    ['assistantToneWide', text => ASSISTANT_TONE.find(phrase => text.includes(phrase))],
    ['dataClaim', text => DATA_CLAIM.test(text)],
    ['electricity', text => ELECTRICITY.test(text)],
    ['ticFirstWord', text => TICS.find(tic => text.trimStart().startsWith(tic))],
  ]) {
    perMetric[key] = {
      replies: all.filter(entry => predicate(entry.text)).length,
      firstReplies: firstReplies.filter(entry => predicate(entry.text)).length,
      scenarios: [...new Set(all.filter(entry => predicate(entry.text)).map(entry => entry.scenario))],
    }
  }
  // A mention the operator asked for is compliance; a mention nobody asked for
  // is the persona volunteering the tic. The two are counted apart, because a
  // raw count makes the roleplay-boundary scenario look like a regression.
  for (const [key, predicate] of [
    ['electricityVolunteered', text => ELECTRICITY.test(text)],
    ['dataClaimVolunteered', text => DATA_CLAIM.test(text)],
  ]) {
    const hits = all.filter(entry => predicate(entry.text) && !entry.asked)
    perMetric[key] = {
      replies: hits.length,
      firstReplies: firstReplies.filter(entry => predicate(entry.text) && !entry.asked).length,
      scenarios: [...new Set(hits.map(entry => entry.scenario))],
    }
  }
  const lengths = all.map(entry => [...entry.text].length).sort((left, right) => left - right)
  const firstLengths = firstReplies.map(entry => [...entry.text].length).sort((left, right) => left - right)
  const median = values => values.length === 0 ? 0 : values[Math.floor(values.length / 2)]
  const mean = values => values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  return {
    counts,
    perMetric,
    length: {
      all: { n: lengths.length, median: median(lengths), mean: mean(lengths), min: lengths[0] ?? 0, max: lengths.at(-1) ?? 0 },
      firstReplies: { n: firstLengths.length, median: median(firstLengths), mean: mean(firstLengths), min: firstLengths[0] ?? 0, max: firstLengths.at(-1) ?? 0 },
    },
  }
}

/** The acceptance's own verdict, as the report states it. */
function verdict(report) {
  const checks = report.scenarios.flatMap(scenario => scenario.checks)
  return {
    mode: report.mode,
    model: report.model?.validatedResponseModel ?? null,
    personaChars: report.persona?.chars ?? null,
    personaSha256: report.persona?.sha256 ?? null,
    samples: report.samples,
    scenarios: report.scenarios.length,
    scenarioStatus: Object.fromEntries(report.scenarios.map(scenario => [scenario.id, scenario.status])),
    checksPassed: checks.filter(check => check.ok).length,
    checksTotal: checks.length,
    failures: report.failures,
    unexecuted: report.unexecuted,
    perScenarioPassRate: report.scenarios.map((scenario) => {
      const passed = scenario.samples.filter(sample => sample.status === 'passed').length
      return `${scenario.id}: ${String(passed)}/${String(scenario.samples.length)}`
    }),
  }
}

const paths = process.argv.slice(2)
if (paths.length === 0) {
  process.stderr.write('usage: node scripts/persona-style-metrics.mjs <report.json> ...\n')
  process.exitCode = 1
} else {
  for (const path of paths) {
    const report = JSON.parse(readFileSync(path, 'utf8'))
    if (report.mode !== 'real') {
      process.stderr.write(`${path}: mode is ${String(report.mode)}, not "real": style metrics over canned replies mean nothing\n`)
      process.exitCode = 1
      continue
    }
    process.stdout.write(`${JSON.stringify({ path, verdict: verdict(report), metrics: metrics(report) }, undefined, 2)}\n`)
  }
}
