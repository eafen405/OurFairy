/**
 * The memory service: the domain between the storage rows and the model tools.
 *
 * It owns the two rules the tools must not each reimplement — the query gate
 * keyed by the session that actually called the tool, and the retrieval budget
 * (20 memories / 8000 Unicode characters). Owner attribution is derived here
 * from each memory's source session, never supplied by the model.
 *
 * @module @ourfairy/dsh-memory/src/service
 */
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { MemoryError } from './tool-kit.js'
import { MAINTENANCE_PRESET } from './preset.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { MemoryRow, MemoryStore } from './store.js'
// The native session persistence handle is how one source session's immutable
// header (and therefore its owner) is read without a user association table.
import type {} from '@deepseek-ai/dsh-session-persistence'

/** The most memories one search returns. */
export const SEARCH_LIMIT = 20

/** The most Unicode characters of memory content one search returns. */
export const SEARCH_CHARACTER_BUDGET = 8000

/**
 * Where one instance keeps its context: a module-private symbol rather than a
 * `#` field, matching the two state symbols below.
 */
const STORE: unique symbol = Symbol('ourfairy-memory-store')
const GATE: unique symbol = Symbol('ourfairy-memory-gate')
const CONTEXT: unique symbol = Symbol('ourfairy-memory-context')

/** One memory as the model sees it in a search result. */
export type MemoryHit = {
  readonly id: number
  readonly content: string
  /** The owner derived from the source session, or null when that session has none. */
  readonly owner_short_id: number | null
  readonly content_updated_at: number
}

/** One search result: the memories plus the budget facts the model needs. */
export type MemorySearchReport = {
  readonly memories: MemoryHit[]
  readonly limit: number
  readonly character_budget: number
  readonly matched: number
  readonly returned: number
  readonly characters: number
  readonly truncated: boolean
}

/** The session facts every tool passes: the calling session, nothing else. */
type Caller = { readonly sessionId: string }

/**
 * The memory domain between the storage rows and the model tools.
 *
 * It is a plain class, not a Cordis service: the tools and the HTTP routes are
 * handed this instance directly, and no other row reads the memory domain
 * through `ctx`. Keeping it off the service registry means the row publishes
 * exactly the surfaces it actually exposes — tools, prompt sections and two
 * routes — and nothing else.
 */
export class MemoryService {
  declare [STORE]: MemoryStore
  declare [GATE]: Map<string, Set<number>>
  declare [CONTEXT]: Context

  constructor(ctx: Context, store: MemoryStore) {
    this[CONTEXT] = ctx
    this[STORE] = store
    this[GATE] = new Map()
  }

  /**
   * Resolve the session a content write is attributed to, from persistent
   * headers only.
   *
   * A normal session is its own source and its header supplies the owner. A
   * maintenance child has no owner by design; its durable `parentSession` names
   * the owned source session, which is both the source and the origin of the
   * owner. The model never supplies either value.
   */
  async sourceOf(agent: Agent): Promise<{ ownerShortId: number; sourceSession: string }> {
    const header = agent.session.header
    if (header.agentPreset !== MAINTENANCE_PRESET) {
      const ownerShortId = shortIdOf(header.owner)
      if (ownerShortId === undefined) {
        throw new MemoryError(403, 'memory/missing-owner', 'a memory source needs an owned session')
      }
      return { ownerShortId, sourceSession: agent.session.id }
    }
    const parentSession = header.parentSession
    const parent = parentSession === undefined
      ? undefined
      : await this[CONTEXT].sessionPersistence.stat(parentSession as SessionId)
    const ownerShortId = shortIdOf(parent?.header.owner)
    if (parentSession === undefined || ownerShortId === undefined) {
      throw new MemoryError(403, 'memory/missing-owner', 'the maintenance child needs an owned source session')
    }
    return { ownerShortId, sourceSession: parentSession }
  }

  /**
   * Store one memory whose source is the calling session, or the owned source
   * session a maintenance child reports through its persistent header.
   */
  add(input: Caller & {
    readonly content: string
    readonly isPrivate: boolean
    readonly ownerShortId: number | undefined
    /** The session that supports the content; defaults to the calling session. */
    readonly sourceSession?: string
  }): number {
    if (input.ownerShortId === undefined) {
      throw new MemoryError(403, 'memory/missing-owner', 'a memory source needs an owned session')
    }
    assertContent(input.content)
    return this[STORE].add({ content: input.content, isPrivate: input.isPrivate,
      sourceSession: input.sourceSession ?? input.sessionId })
  }

  /**
   * Search one layer, then record every returned number against the calling
   * session so only what this session saw can be changed.
   */
  async search(input: Caller & {
    readonly query: string
    readonly isPrivate: boolean
    readonly startAt: number | undefined
    readonly endAt: number | undefined
  }): Promise<MemorySearchReport> {
    assertQuery(input.query)
    const range = assertRange(input.startAt, input.endAt)
    const found = this[STORE].search({ query: input.query, isPrivate: input.isPrivate,
      ...range, limit: SEARCH_LIMIT, characterBudget: SEARCH_CHARACTER_BUDGET })
    remember(this[GATE], input.sessionId, found.rows.map(row => row.id))
    const owners = new Map<string, number | null>()
    for (const row of found.rows) {
      if (!owners.has(row.source_session)) owners.set(row.source_session, await ownerShortIdOfSession(this[CONTEXT], row.source_session))
    }
    return {
      memories: found.rows.map(row => ({ id: row.id, content: row.content,
        owner_short_id: owners.get(row.source_session) ?? null, content_updated_at: row.content_updated_at })),
      limit: SEARCH_LIMIT,
      character_budget: SEARCH_CHARACTER_BUDGET,
      matched: found.matched,
      returned: found.rows.length,
      characters: found.characters,
      truncated: found.truncated,
    }
  }

  /**
   * Replace one fragment of one memory, once.
   *
   * The number must have been returned to this session, the memory must exist
   * in the selected layer, and `old_string` must occur exactly once: zero hits
   * and several hits are both errors, because neither names one edit. The
   * source becomes this session, because it now supports the content.
   */
  edit(input: Caller & {
    readonly id: number
    readonly isPrivate: boolean
    readonly oldString: string
    readonly newString: string
    /** The session that supports the new content; defaults to the calling session. */
    readonly sourceSession?: string
  }): void {
    requireQueried(this[GATE], input.sessionId, input.id)
    const row = visibleMemory(this[STORE], input.id, input.isPrivate)
    if (typeof input.oldString !== 'string' || input.oldString === '') {
      throw new MemoryError(400, 'memory/invalid-patch', 'old_string must be a non-empty fragment of the memory')
    }
    const occurrences = row.content.split(input.oldString).length - 1
    if (occurrences === 0) throw new MemoryError(404, 'memory/no-match', 'old_string does not occur in that memory')
    if (occurrences > 1) {
      throw new MemoryError(409, 'memory/ambiguous-match', 'old_string occurs more than once; pass a longer fragment that occurs once')
    }
    const content = row.content.replace(input.oldString, input.newString)
    assertContent(content)
    this[STORE].edit({ id: input.id, isPrivate: input.isPrivate, content,
      sourceSession: input.sourceSession ?? input.sessionId })
  }

  /** Remove one memory physically; the number is never handed out again. */
  remove(input: Caller & { readonly id: number; readonly isPrivate: boolean }): void {
    requireQueried(this[GATE], input.sessionId, input.id)
    if (!this[STORE].remove({ id: input.id, isPrivate: input.isPrivate })) throw unknownMemory()
  }

  /**
   * Flip one memory's layer and answer the layer it now has.
   *
   * The number is globally unique, so no layer is selected here: the row's
   * current layer decides the direction, and nothing else about it changes.
   */
  switchLayer(input: Caller & { readonly id: number }): boolean {
    requireQueried(this[GATE], input.sessionId, input.id)
    const flipped = this[STORE].flip({ id: input.id })
    if (flipped === undefined) throw unknownMemory()
    return flipped.is_private === 1
  }

  /** Drop one session's recorded numbers; a disposed agent starts over. */
  forget(sessionId: string): void {
    this[GATE].delete(sessionId)
  }
}

/** The refusal shared by every operation that names a memory which is not there. */
function unknownMemory(): MemoryError {
  return new MemoryError(404, 'memory/unknown-memory', 'no memory with that number exists in the selected layer')
}

/**
 * Refuse a number this session has not been shown.
 *
 * The set is keyed by the session id of the agent that actually called the
 * tool, so a query in another session never authorizes this one, and a
 * maintenance child (later) keeps its own set.
 *
 * This check runs before the row lookup, so an unseen number is refused
 * without revealing whether it exists.
 */
function requireQueried(gate: Map<string, Set<number>>, sessionId: string, id: number): void {
  if (!gate.get(sessionId)?.has(id)) {
    throw new MemoryError(403, 'memory/not-queried', 'search this memory in this session before changing it')
  }
}

/** The memory one selected number names in one layer. */
function visibleMemory(store: MemoryStore, id: number, isPrivate: boolean): MemoryRow {
  const row = store.find({ id, isPrivate })
  if (row === undefined) throw unknownMemory()
  return row
}

/** The owner the source session's immutable header names, or null when it names none. */
async function ownerShortIdOfSession(ctx: Context, sessionId: string): Promise<number | null> {
  const snapshot = await ctx.sessionPersistence.stat(sessionId as SessionId)
  return shortIdOf(snapshot?.header.owner) ?? null
}

/** Record every number one search returned. */
function remember(gate: Map<string, Set<number>>, sessionId: string, ids: readonly number[]): void {
  const known = gate.get(sessionId) ?? new Set<number>()
  for (const id of ids) known.add(id)
  gate.set(sessionId, known)
}

/**
 * Refuse content that would store nothing or could never be returned.
 *
 * The search budget is also a write limit: a memory larger than the whole
 * budget is omitted by every search, so no session could ever see its number
 * and therefore could never edit, delete or switch it. Storing it would create
 * a row the product has no way to reach (User Story 10, ADR-0002).
 */
function assertContent(content: string): void {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new MemoryError(400, 'memory/invalid-content', 'provide the text to remember')
  }
  const characters = [...content].length
  if (characters > SEARCH_CHARACTER_BUDGET) {
    throw new MemoryError(400, 'memory/invalid-content',
      `the memory is ${String(characters)} Unicode characters; the limit is ${String(SEARCH_CHARACTER_BUDGET)}`)
  }
}

/** Refuse a search with no keyword; an empty term would match every memory. */
function assertQuery(query: string): void {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new MemoryError(400, 'memory/invalid-query', 'provide the keyword or phrase to look for')
  }
}

/**
 * The date bounds one search may carry: both or neither, non-negative safe
 * integers, start not later than end. The stored comparison is inclusive.
 */
function assertRange(startAt: number | undefined, endAt: number | undefined): { startAt?: number; endAt?: number } {
  if (startAt === undefined && endAt === undefined) return {}
  if (startAt === undefined || endAt === undefined) {
    throw new MemoryError(400, 'memory/invalid-range', 'provide start_at and end_at together, or neither')
  }
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || startAt < 0 || endAt < 0) {
    throw new MemoryError(400, 'memory/invalid-range', 'start_at and end_at must be millisecond timestamps')
  }
  if (startAt > endAt) {
    throw new MemoryError(400, 'memory/invalid-range', 'start_at must not be later than end_at')
  }
  return { startAt, endAt }
}
