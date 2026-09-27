import { describe, expect, it } from 'vitest'
import { calculateTraffic24h } from '@/domain/traffic24h'
import { normalizeHistory } from '@/services/cfsm/adapters'

const now = Date.UTC(2026, 8, 27, 15)

function history(rows: Array<[number, number | null, number | null]>) {
  return normalizeHistory(rows.map(([timestamp, received, transmitted]) => ({
    timestamp,
    net_rx: received,
    net_tx: transmitted,
  })))
}

describe('rolling 24-hour traffic', () => {
  it('adds interface counter changes without treating a reset as traffic', () => {
    const points = history([
      [now - 23 * 3600_000, 1000, 2000],
      [now - 15 * 3600_000, 1300, 2400],
      [now - 8 * 3600_000, 100, 200],
      [now - 3600_000, 160, 260],
    ])
    expect(calculateTraffic24h(points, null, now)).toEqual({
      received: 360,
      transmitted: 460,
      total: 820,
    })
  })

  it('ignores a monthly counter correction that is absent from interface totals', () => {
    const points = normalizeHistory([
      { timestamp: now - 3600_000, net_rx: 100, net_tx: 200, net_rx_monthly: 1000, net_tx_monthly: 2000 },
      { timestamp: now - 1800_000, net_rx: 110, net_tx: 220, net_rx_monthly: 100_000, net_tx_monthly: 200_000 },
    ])
    expect(calculateTraffic24h(points, null, now)).toEqual({
      received: 10,
      transmitted: 20,
      total: 30,
    })
  })

  it('does not invent traffic from missing or out-of-window samples', () => {
    expect(calculateTraffic24h(history([
      [now - 25 * 3600_000, 100, 100],
      [now - 3600_000, 500, 600],
    ]), null, now)).toBeNull()
    expect(calculateTraffic24h(history([
      [now - 2 * 3600_000, null, 10],
      [now - 3600_000, null, 20],
    ]), null, now)).toBeNull()
  })
})
