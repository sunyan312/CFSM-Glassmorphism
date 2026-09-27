import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeSiteConfig } from '@/services/cfsm/adapters'
import { useAppStore } from '@/stores/app'

const BASE = 'https://status.example'

function installLocation(): void {
  vi.stubGlobal('document', {
    querySelector: () => ({ content: BASE }),
  })
  vi.stubGlobal('window', { location: { origin: BASE } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('application config initialization', () => {
  it('shares one in-flight /api/config request across concurrent route initializers', async () => {
    installLocation()
    let release: ((response: Response) => void) | undefined
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve
    }))
    vi.stubGlobal('fetch', fetcher)
    setActivePinia(createPinia())
    const app = useAppStore()

    const first = app.initialize()
    const second = app.initialize()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(app.state).toBe('loading')

    release?.(new Response(JSON.stringify({ site_title: '真实站点' }), { status: 200 }))
    await Promise.all([first, second])
    expect(app.config?.siteTitle).toBe('真实站点')
    expect(app.state).toBe('ready')
  })

  it('does not let an older initialization overwrite a newer saved config', async () => {
    installLocation()
    let release: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => {
      release = resolve
    }))
    setActivePinia(createPinia())
    const app = useAppStore()
    const pending = app.initialize()

    app.applyConfig(normalizeSiteConfig({ site_title: '保存后的标题', version: '2.8.5' }))
    release?.(new Response(JSON.stringify({ site_title: '旧标题' }), { status: 200 }))
    await pending

    expect(app.config?.siteTitle).toBe('保存后的标题')
    expect(app.state).toBe('ready')
  })

  it('retains the last real config when a later refresh fails', async () => {
    installLocation()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    setActivePinia(createPinia())
    const app = useAppStore()
    app.applyConfig(normalizeSiteConfig({ site_title: '已加载站点', version: '2.8.5' }))

    await app.initialize()

    expect(app.config?.siteTitle).toBe('已加载站点')
    expect(app.state).toBe('error')
    expect(app.error).toBe('CFSM request could not be completed')
  })

  it('keeps the error state visible while a manual retry is in flight', async () => {
    installLocation()
    let release: ((response: Response) => void) | undefined
    let calls = 0
    vi.stubGlobal('fetch', () => {
      calls += 1
      if (calls === 1) return Promise.reject(new TypeError('offline'))
      return new Promise<Response>((resolve) => { release = resolve })
    })
    setActivePinia(createPinia())
    const app = useAppStore()

    await app.initialize()
    expect(app.state).toBe('error')

    const retry = app.initialize()
    expect(app.state).toBe('error')
    expect(app.error).toBe('CFSM request could not be completed')

    release?.(new Response(JSON.stringify({ site_title: '恢复的站点' }), { status: 200 }))
    await retry
    expect(app.state).toBe('ready')
    expect(app.config?.siteTitle).toBe('恢复的站点')
  })

  it('retries a timed-out config read in the background and clears the warning on recovery', async () => {
    vi.useFakeTimers()
    installLocation()
    let calls = 0
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }
      return Promise.resolve(new Response(JSON.stringify({ site_title: '恢复的站点' }), { status: 200 }))
    })
    setActivePinia(createPinia())
    const app = useAppStore()

    const first = app.initialize()
    await vi.advanceTimersByTimeAsync(15_000)
    await first
    expect(app.state).toBe('error')
    expect(app.error).toBe('CFSM request timed out')
    expect(calls).toBe(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toBe(2)
    expect(app.state).toBe('ready')
    expect(app.error).toBeNull()
    expect(app.config?.siteTitle).toBe('恢复的站点')
  })
})
