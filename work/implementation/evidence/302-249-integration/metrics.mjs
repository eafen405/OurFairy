#!/usr/bin/env node
/** Descriptive counts over recorded real replies; no semantic verdicts. */
import { readFileSync } from 'node:fs'

const tone302 = ['已记录', '需要我', '我可以', '需要提醒的是', '我认可', '建议']
const tics = ['肯定', '否定', '推测', '数据显示', '提问', '反问']
function collect(value, path = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (/replies$/i.test(path) && typeof entry === 'string') out.push({ path: `${path}/${index}`, text: entry })
      else collect(entry, `${path}/${index}`, out)
    })
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (/reply$/i.test(key) && typeof entry === 'string') out.push({ path: `${path}/${key}`, text: entry })
      else collect(entry, `${path}/${key}`, out)
    }
  }
  return out
}
function metrics(replies) {
  const texts = replies.map(reply => reply.text).filter(text => text.trim() !== '')
  const lengths = texts.map(text => [...text].length).sort((a, b) => a - b)
  return { n: texts.length, emptyReplies: replies.length - texts.length,
    ticFirstWord302: texts.filter(text => tics.some(tic => text.trimStart().startsWith(tic))).length,
    assistantTone302: texts.filter(text => tone302.some(phrase => text.includes(phrase))).length,
    evidencePhraseReplies: texts.filter(text => /数据显示|数据表明/.test(text)).length,
    evidencePhraseOccurrences: texts.reduce((n, text) => n + (text.match(/数据显示|数据表明/g) ?? []).length, 0),
    resourceMentionReplies: texts.filter(text => /电费|运算核|内存占用|(?<!技能)(?<!能量)能耗(?!尽)/.test(text)).length,
    medianCharacters: lengths[Math.floor(lengths.length / 2)] ?? 0,
  }
}
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  if (report.mode && report.mode !== 'real-product') throw new Error('only real product reports are accepted')
  const samples = report.cases ?? report.samples
  if (!Array.isArray(samples)) throw new Error(`${file}: missing cases or samples`)
  const usage = (report.samples ?? []).flatMap(sample => sample.turns ?? []).flatMap(turn => turn.usage ?? []).filter(Boolean)
  const cacheRead = usage.reduce((n, entry) => n + (entry.cacheReadTokens ?? 0), 0)
  const totalInput = usage.reduce((n, entry) => n + entry.inputTokens + (entry.cacheReadTokens ?? 0) + (entry.cacheWriteTokens ?? 0), 0)
  console.log(JSON.stringify({ file,
    all: metrics(collect(samples)),
    // #249 changed the impression case from an HTTP write to a model tool write.
    memoryCasesWithoutImpression: report.cases ? metrics(collect(report.cases.filter(entry => entry.id !== 'impression'))) : undefined,
    cases: samples.map(sample => ({ id: sample.id, sample: sample.sample, status: sample.status,
      failedChecks: (sample.checks ?? []).filter(check => !check.ok).map(check => check.name),
      ...metrics(collect(sample.turns ?? sample.evidence)),
    })),
    reportedCache: usage.length ? { requestsWithUsage: usage.length, cacheReadTokens: cacheRead, totalInputTokens: totalInput,
      readFraction: totalInput === 0 ? null : cacheRead / totalInput } : undefined,
  }, null, 2))
}
