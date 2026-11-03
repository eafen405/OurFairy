package me.rerere.rikkahub.ui.identity

/**
 * Measurement helpers shared by the presentation activities.
 *
 * Both the single-session tiers (#74) and the combined workload (#268) report the same shapes:
 * heap in bytes, percentiles in milliseconds and one result file per run. Keeping one definition
 * keeps a number from meaning two different things across the two tables.
 */
internal fun usedHeapBytes(): Long = Runtime.getRuntime().let { it.totalMemory() - it.freeMemory() }

/** Nearest-rank percentile over nanosecond samples, reported in milliseconds. */
internal fun percentileMillis(values: List<Long>, quantile: Double): Double =
    if (values.isEmpty()) 0.0 else values.sorted()[((values.size - 1) * quantile).toInt()] / 1_000_000.0

/** One result file per run, so a later round can never be read back as this one. */
internal fun resultFileName(scenario: String, runId: String?): String =
    if (runId == null) "presentation-$scenario.json" else "presentation-$scenario-$runId.json"
