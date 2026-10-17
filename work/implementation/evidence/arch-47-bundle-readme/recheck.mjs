import { readFileSync } from 'node:fs'

const readme = readFileSync('backend/v1-bundle/README.md', 'utf8')
const source = readFileSync('tests/baseline-boot.test.mjs', 'utf8')
const block = /const FORBIDDEN_ROW_IDS = \[([\s\S]*?)\n\]/.exec(source)
const forbidden = [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1])
const quoted = new Set([...readme.matchAll(/`([^`\n]+)`/g)].map(match => match[1]))
const mounted = [...readFileSync('backend/v1-bundle/cordis.patch.yml', 'utf8')
  .matchAll(/^\s*- id: (\S+)\s*$/gm)].map(match => match[1])

console.log('FORBIDDEN_ROW_IDS count:', forbidden.length)
console.log('rows mounted by cordis.patch.yml:', mounted.length)
console.log('forbidden ids restated in README:', forbidden.filter(id => quoted.has(id)).join(', '))
console.log('restated ids that are actually mounted:',
  forbidden.filter(id => quoted.has(id) && mounted.includes(id)).join(', '))
