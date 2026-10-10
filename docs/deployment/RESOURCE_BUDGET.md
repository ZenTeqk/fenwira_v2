# Resource budget: EC2 t3a.medium (2 vCPU, 4 GB)

Measured on 9 October 2026, natively on Ubuntu 24.04.5 x86_64 with Node 22.23.3, using the production build and `NODE_ENV=production`.
- **Stand-in host:** an Ubuntu container capped at 2 CPUs and 4 GB.
- **Stand-ins for AWS:** RDS was a TLS PostgreSQL 16, S3 was MinIO, and SES was Mailpit.
- **The numbers:** these are measurements under synthetic load, not proof of capacity. Load-test staging before launch.

## Measured

| Process | Idle RSS | Peak RSS under load | Heap limit (`NODE_OPTIONS`) | systemd `MemoryHigh` / `MemoryMax` |
| --- | ---: | ---: | ---: | --- |
| fenwira-web (Next.js standalone) | 99 MB | 157 MB | 384 MB (`--max-old-space-size=384`) | 500 / 650 MB |
| fenwira-api (NestJS) | 167 MB | 222 MB | 512 MB | 700 / 900 MB |
| fenwira-worker (25 BullMQ workers + relay) | 170 MB | 215 MB | 768 MB | 900 / 1100 MB |
| Redis `used_memory` | 2.8 MB | 6.7 MB | `maxmemory 512mb` | — |
| nginx (master + workers) | 34 MB | 36 MB | — | — |
| **Application total** | **~470 MB** | **~640 MB** | | |

The load was 60 seconds of mixed traffic:
- **HTTP:** 25 concurrent HTTP clients through nginx over TLS: 27,544 requests to SSR pages, readiness and authenticated API routes, with 0 errors and 5xx.
- **Webhooks:** a simultaneous burst of 300 signed inbound webhooks, all processed by the worker into conversations.

Not measured:
- campaign dispatch at scale (thousands of recipients through the mock Graph API);
- automation fan-out;
- large contact imports and exports;
- many concurrent WebSocket clients.

Those are the workloads most likely to raise worker and Redis memory.

## Budget on 4 GB

| Item | Planning figure | Notes |
| --- | ---: | --- |
| Ubuntu base, systemd, journald, SSM agent | 400 MB | Add about 100 MB when the CloudWatch agent is installed (Phase 2) |
| nginx | 50 MB | |
| Redis | up to 512 MB | Hard cap (`maxmemory`, `noeviction`) |
| web | up to 650 MB | `MemoryMax` |
| api | up to 900 MB | `MemoryMax` |
| worker | up to 1100 MB | `MemoryMax` |
| **Worst case, every cap reached at once** | **~3.6 GB** | Fits in 4 GB without swap, barely |
| **Expected steady state** (measured peaks + OS) | **~1.1–1.3 GB** | Leaves about 2.7 GB of headroom and page cache |

**Verdict:** the whole application fits on a t3a.medium, with wide headroom at the measured load and a bounded worst case. Three conditions apply:

1. **Don't build on the production instance while it serves traffic.** A release build (`pnpm install` + turbo + `next build`) is the largest memory consumer: it ran to completion inside a 4 GB container, but it competes with the services. Build on a separate Ubuntu x86_64 machine or a CI runner and copy the release over (Phase 2/3). If you must build on the instance, stop `fenwira-web` first or add swap.
2. **Add a 2 GB swap file** as a safety margin against an out-of-memory kill during spikes (`fallocate -l 2G /swapfile`, `vm.swappiness=10`).
3. **Watch memory before raising limits.** Set alarms on per-unit memory (`systemctl status` shows current use against `MemoryHigh`), Redis `used_memory` (warn at 70% of `maxmemory`) and the instance's available memory.

## Recommended settings

| Setting | Value | Reason |
| --- | --- | --- |
| `NODE_OPTIONS` web / api / worker | 384 / 512 / 768 MB | 2–3.5× the measured peak, below each `MemoryMax`, so V8 collects garbage before systemd throttles the process |
| `MemoryHigh` < `MemoryMax` | as in the units | `MemoryHigh` throttles and reclaims memory. `MemoryMax` is the OOM boundary, and the unit then restarts (`Restart=on-failure`) |
| `DB_POOL_SIZE` | API 10, worker 10 | 20 connections plus migrations; fine for the smallest RDS classes. The worker's ~157 concurrent job slots share this pool, so jobs queue on the pool instead of opening connections |
| Worker concurrency | unchanged (in code, per processor) | Not reduced: it is async I/O concurrency, and memory stayed flat at 215 MB under the burst. Revisit only after a staging load test shows pressure |
| Redis `maxmemory` | 512 MB, `noeviction` | Jobs are retained after completion: up to 24 h / 10,000 completed per queue, and failed jobs for 7 days (`packages/queue/src/connection.ts`). Across 27 queues that is the real growth driver at high message volume, about 1–2 KB per job. 512 MB covers several capped high-volume queues |
| Job payloads | unchanged | Payloads carry IDs, not records (ARCHITECTURE.md), so they stay small |
| Log level | `info` | `debug` substantially increases journald I/O and storage |
| journald | `SystemMaxUse=500M` in `/etc/systemd/journald.conf` | Bounds log disk use until CloudWatch shipping (Phase 2) |

## When to scale

- **Move the worker to its own instance:** when worker RSS stays above about 700 MB, or campaigns visibly lag. Point it at the same Redis (which must then be reachable privately or be ElastiCache) and the same RDS. The schedulers are idempotent, so two workers are safe.
- **Move Redis to ElastiCache or its own instance:** when Redis `used_memory` regularly passes 350 MB.
- **Upgrade to t3a.large (8 GB):** if swap is used regularly.
