# Capture reliability

The existing scheduled workflow gets an opportunity at minute 17 and 47 each hour.
Persisted `collection.lastAttemptAt` permits source checks every two hours; intervening
runs can restore older Git captures. GitHub schedules are best effort and can be delayed.
This is not a guarantee of real-time publication. Consumers must evaluate source check times.

Each forum refresh reads the recent head with an overlap since the last completed check.
A separate persisted cursor reconciles the last 30 days in bounded slices, restarted daily
when complete. A failed page never advances the cursor. Exhausted slices are partial, not
complete. Reads have deadlines and bounded retries; source 403/429 responses persist a
cooldown and stop that source. Other sources can still publish their successful results.
News records success/failure per discovery query; empty valid RSS is distinct from failure.

Captured post IDs merge into monthly topic files under `public/data/archive/posts`.
Date rollovers only change the 30-day summary. History is never deleted by a refresh or failed
source. Previously observed timestamps remain intact, and older observations cannot overwrite
newer source corrections. Corrupt saved state stops publication. A Git commit publishes the
index, partitions and summary atomically. API readers reject mixed cached generations.

Initial recovery pins a Git commit and examines up to 2000 historical post blobs per scheduled
run, resuming from the saved offset. It restores real source IDs only, excluding the original
synthetic dashboard examples. Recovery progress and retention start/limits are public metadata.
Aggregate sparklines retain 24 observations; this limit does not apply to captured posts.
Unresolved discovery observations remain saved separately for later company matching.

This is a retained capture archive, not an exhaustive archive of each source. Public discovery
queries, category selection and heuristic company attribution are bounded. Not every company is
queried. Posts never observed, deleted before capture, outside accessible forum history, or
missing from Git cannot be promised recoverable. Forum previews remain source excerpts.
Matched holdings measure observed mentions, not successfully checked holdings.

Validation is local: `node scripts/scrape/selftest.mjs`,
`node scripts/scrape/reliability-selftest.mjs`, `node api/selftest.mjs`, and
`node api/reliability-selftest.mjs`. They cover pagination, cooldowns, partial reads, retained
history, rollover, failed publication inputs, Git recovery, archive API pages and source health.
Repository merges activate the existing workflows. No manual production run is part of testing.
