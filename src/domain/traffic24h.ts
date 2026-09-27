import type { CfsmServer, HistoryPoint } from '@/types/cfsm'
import { normalizeTimestampMilliseconds } from '@/utils/format'

const WINDOW_MS = 24 * 60 * 60 * 1000

export interface Traffic24h {
  received: number
  transmitted: number
  total: number
}

interface CounterSample {
  timestamp: number
  received: number | null | undefined
  transmitted: number | null | undefined
}

function counter(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function delta(samples: readonly CounterSample[], field: 'received' | 'transmitted'): number | null {
  let previous: number | null = null
  let total = 0
  let transitions = 0
  for (const sample of samples) {
    const value = counter(sample[field])
    if (value === null) continue
    if (previous !== null) {
      // Interface counters can restart. A lower value is a reset, not traffic.
      if (value >= previous) {
        total += value - previous
        transitions += 1
      }
    }
    previous = value
  }
  return transitions > 0 ? total : null
}

/** Estimate the rolling window from real CFSM history samples and the latest report. */
export function calculateTraffic24h(
  points: readonly HistoryPoint[],
  current: CfsmServer | null,
  now = Date.now(),
): Traffic24h | null {
  const cutoff = now - WINDOW_MS
  const samples: CounterSample[] = points.flatMap((point) => {
    const timestamp = normalizeTimestampMilliseconds(point.timestamp)
    return timestamp !== null && timestamp >= cutoff && timestamp <= now
      ? [{
          timestamp,
          received: point.networkReceived,
          transmitted: point.networkTransmitted,
        }]
      : []
  })
  const latestTimestamp = normalizeTimestampMilliseconds(current?.lastUpdated ?? null)
  if (current && latestTimestamp !== null && latestTimestamp >= cutoff && latestTimestamp <= now) {
    samples.push({
      timestamp: latestTimestamp,
      received: current.networkReceived,
      transmitted: current.networkTransmitted,
    })
  }
  samples.sort((left, right) => left.timestamp - right.timestamp)
  const received = delta(samples, 'received')
  const transmitted = delta(samples, 'transmitted')
  if (received === null || transmitted === null) return null
  return { received, transmitted, total: received + transmitted }
}
