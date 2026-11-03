/**
 * The per-agent skill provider: each user session's window into the catalog.
 *
 * dsh registers a provider into the calling context's scope layer, and an Agent
 * is its own scope key. The row therefore registers one provider per user
 * session on `agent.ctx`, capturing that session's owner in the closure — the
 * provider itself only receives lookup options, never the agent. A provider
 * registered on the row's own host context would be global and could not answer
 * "whose catalog is this".
 *
 * The provider serves only the winners derived by {@link SkillService}: common
 * skills this user enabled plus their own enabled personal skills, with a
 * personal identity shadowing a same-name common one. Product candidates force
 * `userInvocable: false`, so the native `/name` gesture can never become a
 * second activation path; the model must call the native `skill` tool, which is
 * also the only path the chat activation row pairs.
 *
 * `get` is the integrity gate: it re-checks the database and recomputes the
 * package manifest hash before returning any body. A changed package throws;
 * the native tool then reports a failed call and the projection shows no
 * activation row.
 *
 * @module @ourfairy/dsh-skill-creator/src/provider
 */
import { shortIdOf } from '@ourfairy/dsh-identity/owner'
import { isUserSession } from '@ourfairy/dsh-identity/session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillCandidate, SkillDefinition, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type { SkillService } from './service.js'
// Type-only: the dsh context's `skills` service augmentation. The import adds
// no runtime dependency; the row resolves it from the dsh installation.
import type {} from '@deepseek-ai/dsh-skill'

/** The provider name every candidate must name, exactly as the registry validates. */
export const PROVIDER_NAME = 'ourfairy-skills'

/** Candidate rank within the agent's own layer; the product catalog wins ties there. */
const CANDIDATE_RANK = 100

/** The catalog source tag; the native summary's `source` is informational. */
const CANDIDATE_SOURCE = 'ourfairy'

/** The activation locator: identity is the version, the hash is the approval the provider listed. */
type SkillLocator = { readonly versionId: number; readonly manifestHash: string }

/** One live registration, kept so a preference/seed change can invalidate it. */
type Registration = {
  readonly owner: number
  /** The agent-scope inject fiber that owns the provider; disposing it unregisters. */
  readonly fiber: { dispose: () => Promise<void> }
  /** Read once the inject callback has run; a change before then needs no invalidation. */
  readonly control: () => SkillProviderControl | undefined
}

/** Whether an opaque locator is one this provider wrote. */
function isSkillLocator(value: unknown): value is SkillLocator {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { versionId?: unknown; manifestHash?: unknown }
  return typeof candidate.versionId === 'number' && Number.isSafeInteger(candidate.versionId)
    && candidate.versionId > 0 && typeof candidate.manifestHash === 'string'
}

/** Build one agent-scoped provider bound to its owner. */
function providerFor(service: SkillService, owner: number): SkillProvider {
  return {
    name: PROVIDER_NAME,
    async list() {
      // An empty catalog is a complete answer, never "incomplete": an incomplete
      // observation makes the native catalog listener keep the last-good catalog
      // instead of publishing the empty replacement.
      const candidates: SkillCandidate[] = service.catalog(owner).map(candidate => ({
        name: candidate.name,
        description: candidate.description,
        invocation: { modelInvocable: true as const, userInvocable: false as const },
        source: CANDIDATE_SOURCE,
        provider: PROVIDER_NAME,
        rank: CANDIDATE_RANK,
        resourceBase: { kind: 'directory' as const, path: candidate.directory },
        locator: { versionId: candidate.versionId, manifestHash: candidate.manifestHash } satisfies SkillLocator,
      }))
      return { candidates, complete: true }
    },
    async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
      const locator = candidate.locator
      if (!isSkillLocator(locator)) return undefined
      const loaded = service.load(owner, locator.versionId)
      if (loaded === undefined) return undefined
      return {
        name: loaded.name,
        description: loaded.description,
        invocation: { modelInvocable: true as const, userInvocable: false as const },
        source: CANDIDATE_SOURCE,
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: loaded.directory },
        content: loaded.body,
      }
    },
  }
}

/**
 * The row's per-agent provider registrations.
 *
 * Registration follows the product rows' usual shape: a global
 * `agent/created` listener plus a replay of `ctx.agents.list()`, so a resumed
 * session first seen at boot also gets a provider. Only user sessions
 * (`isUserSession`) are served; a maintenance/learning child gets no product
 * catalog.
 */
export class SkillProviders {
  readonly #service: SkillService
  readonly #registrations = new Map<Agent, Registration>()

  constructor(service: SkillService) {
    this.#service = service
  }

  /**
   * Register one provider for one live user session; replay-safe.
   *
   * The agent's scope context is minted from the agent loop's dependency API
   * and does not itself declare `skills`; accessing the registry through it
   * directly is refused. `agent.ctx.inject(['skills'], ...)` creates a child
   * fiber that declares the dependency while inheriting the agent's scope tag,
   * so the provider lands in that agent's layer. The callback runs on the
   * fiber's load microtask, before any model step can read the catalog.
   */
  register(agent: Agent): void {
    if (!isUserSession(agent.session.header)) return
    const owner = shortIdOf(agent.session.header.owner)
    if (owner === undefined) return
    if (this.#registrations.has(agent)) return
    let control: SkillProviderControl | undefined
    const fiber = agent.ctx.inject(['skills'], child => {
      const dispose = child.skills.registerProvider(received => {
        control = received
        return providerFor(this.#service, owner)
      })
      // The inject fiber owns the registration; returning the registry's
      // disposer makes fiber disposal unregister it in the same step.
      return dispose
    })
    this.#registrations.set(agent, { owner, fiber, control: () => control })
  }

  /** Drop one agent's registration and its invalidation handle. */
  forget(agent: Agent): void {
    const registration = this.#registrations.get(agent)
    if (registration === undefined) return
    this.#registrations.delete(agent)
    void registration.fiber.dispose()
  }

  /** Invalidate every live agent of one owner after their catalog inputs changed. */
  invalidateOwner(shortId: number): void {
    for (const registration of this.#registrations.values()) {
      if (registration.owner === shortId) registration.control()?.invalidate()
    }
  }

  /** Invalidate every live agent after a deployment-wide change. */
  invalidateAll(): void {
    for (const registration of this.#registrations.values()) registration.control()?.invalidate()
  }

  /** Release every registration; the row's disposal owns this. */
  dispose(): void {
    for (const registration of [...this.#registrations.values()]) void registration.fiber.dispose()
    this.#registrations.clear()
  }
}
