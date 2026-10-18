/**
 * The parent specification's 75 user stories and their owning tickets.
 *
 * The matrix exists so integration review can walk every promise in the
 * specification. A promise that no ticket claims, a ticket number the tracker
 * list does not derive, or an evidence link that does not resolve makes this
 * test fail: the matrix cannot quietly disagree with the documents it names.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { repoRoot } from './helpers/backend.mjs'

const spec = readFileSync(join(repoRoot, 'docs', 'specs', 'ourfairy-v1.md'), 'utf8')
const ticketReadme = readFileSync(join(repoRoot, 'work', 'tickets', 'ourfairy-v1', 'README.md'), 'utf8')
const matrixPath = join(repoRoot, 'work', 'implementation', 'evidence', '21-integration', 'user-stories.md')
const matrix = readFileSync(matrixPath, 'utf8')

/** Story number to the owning ticket numbers, read from the ticket list's coverage section. */
function coverage() {
  const section = ticketReadme.split('## 用户故事覆盖')[1]
  assert.ok(section !== undefined, 'the ticket list keeps a 用户故事覆盖 section')
  return new Map([...section.matchAll(/^- (\d+)：(.+)$/gm)].map(match => [Number(match[1]), match[2]]))
}

/** Ticket title to its issue number, from the same ordered ticket list. */
function ticketNumbers() {
  const numbers = new Map()
  const titles = [...ticketReadme.matchAll(/^\d+\. \*\*(.+?)\*\*/gm)]
  titles.forEach((title, index) => {
    const start = title.index + title[0].length
    const end = index + 1 < titles.length ? titles[index + 1].index : ticketReadme.length
    const issue = ticketReadme.slice(start, end).match(/issues\/(\d+)/)
    if (issue !== null) numbers.set(title[1], Number(issue[1]))
  })
  return numbers
}

test('the matrix carries exactly the 75 specification stories, in order', () => {
  const stories = [...spec.matchAll(/^(\d+)\. (作为[^\n]+)$/gm)].map(match => ({ number: Number(match[1]), text: match[2] }))
  assert.equal(stories.length, 75, 'the parent specification lists 75 stories')
  const rows = [...matrix.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \|$/gm)]
    .filter(match => match[1] !== '#')
    .map(match => ({ number: Number(match[1]), text: match[2], owners: match[3] }))
  assert.deepEqual(rows.map(row => row.number), stories.map(story => story.number))
  assert.deepEqual(rows.map(row => row.text), stories.map(story => story.text))
})

test('every story is owned by the ticket the ticket list derives, and its evidence resolves', () => {
  const names = ticketNumbers()
  const ownership = coverage()
  const rows = [...matrix.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \|$/gm)].filter(match => match[1] !== '#')
  for (const match of rows) {
    const number = Number(match[1])
    const titles = ownership.get(number)?.split('；').map(title => title.trim())
    assert.ok(titles !== undefined, `story ${number} has no owning ticket in the ticket list`)
    const expected = titles.map(title => {
      assert.ok(names.has(title), `ticket title "${title}" is not in the ticket list`)
      return names.get(title)
    })
    const declared = [...match[3].matchAll(/#(\d+)/g)].map(entry => Number(entry[1]))
    assert.deepEqual(declared, expected, `story ${number} must name exactly its derived tickets`)
    for (const link of match[3].matchAll(/\]\(([^)]+)\)/g)) {
      const target = resolve(dirname(matrixPath), link[1])
      assert.ok(existsSync(target), `story ${number} evidence link ${link[1]} must resolve`)
    }
  }
})
