import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { fetchHistory } from '@/services/cfsm'
import type { HistorySeries } from '@/types/cfsm'

export type Traffic24hState = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export const useTraffic24hStore = defineStore('traffic24h', () => {
  const history = shallowRef<HistorySeries | null>(null)
  const state = ref<Traffic24hState>('idle')
  const points = computed(() => history.value?.points ?? [])
  let source: { id: string, base: string } | null = null
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let sequence = 0

  async function refresh(): Promise<void> {
    const current = source
    const signal = controller?.signal
    if (!current || !signal) return
    const requestSequence = ++sequence
    state.value = 'loading'
    try {
      const result = await fetchHistory(current.id, 24, current.base, { signal })
      if (signal.aborted || requestSequence !== sequence) return
      history.value = result
      state.value = result.points.length ? 'ready' : 'empty'
    } catch {
      if (signal.aborted || requestSequence !== sequence) return
      state.value = 'error'
    }
  }

  function close(): void {
    sequence += 1
    controller?.abort('detail closed')
    controller = null
    if (timer !== null) clearInterval(timer)
    timer = null
    source = null
    history.value = null
    state.value = 'idle'
  }

  function open(id: string, base: string): void {
    close()
    source = { id, base }
    controller = new AbortController()
    void refresh()
    timer = setInterval(() => { void refresh() }, 5 * 60 * 1000)
  }

  return { points, state, open, refresh, close }
})
