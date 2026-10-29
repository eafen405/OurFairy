/**
 * The projection benchmark's workload shape (#94).
 *
 * `scripts/bench-projection.ts` measures these history-turn and observer
 * counts; `scripts/bench-gate.ts` checks the `history/observers` cells they
 * derive. Both import the shape from this module.
 *
 * Data only: importing this module starts no benchmark, reads or writes no
 * file, and parses no argument.
 */

/** User turns seeded before the measured stream, one run per count. */
export const HISTORY_TURN_COUNTS: readonly number[] = Object.freeze([40, 160])

/** Observers connected to the same session, one run per count. */
export const OBSERVER_COUNTS: readonly number[] = Object.freeze([1, 2])

/** One measured `historyTurns × observers` cell. */
export type BenchmarkCell = {
  historyTurns: number
  observers: number
  /** The `history/observers` key benchmark documents and the gate share. */
  key: string
}

/** Every cell the workload measures, derived from the two counts above. */
export const BENCHMARK_CELLS: readonly BenchmarkCell[] = Object.freeze(
  HISTORY_TURN_COUNTS.flatMap(historyTurns =>
    OBSERVER_COUNTS.map(observers => ({ historyTurns, observers, key: `${historyTurns}/${observers}` }))),
)
