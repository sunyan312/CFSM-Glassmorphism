import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { SiteConfig } from '@/types/cfsm'
import { CfsmRequestError, adminUrl, fetchSiteConfig, getApiBases, onTurnstileRejected, verifyTurnstileToken } from '@/services/cfsm'
import { turnstileChallengeSiteKey } from '@/domain/turnstile'

export type LoadState = 'idle' | 'loading' | 'ready' | 'partial' | 'error'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown CFSM configuration error'
}

export const useAppStore = defineStore('app', () => {
  const apiBases = ref<string[]>([])
  const config = ref<SiteConfig | null>(null)
  const state = ref<LoadState>('idle')
  const error = ref<string | null>(null)
  let initializeInFlight: Promise<void> | null = null
  let initializeRevision = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let timeoutRetryCount = 0
  const retryDelaysMs = [2_000, 5_000, 15_000]

  function clearRetryTimer(): void {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function scheduleTimeoutRetry(): void {
    const delay = retryDelaysMs[timeoutRetryCount]
    if (delay === undefined) return
    timeoutRetryCount += 1
    clearRetryTimer()
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (state.value === 'error') void beginInitialize(true)
    }, delay)
  }

  const primaryBase = computed(() => apiBases.value[0] ?? null)
  const administrationUrl = computed(() => (
    primaryBase.value ? adminUrl(primaryBase.value) : null
  ))

  /*
   * 全局 Turnstile：请求中途收到 403 时由请求层通知；验证成功后递增 credentialRevision，
   * 各页面据此重新加载自己的数据（加载逻辑仍留在各页面）。
   */
  const turnstileRejected = ref(false)
  const credentialRevision = ref(0)
  const turnstileSiteKey = computed(() => turnstileChallengeSiteKey(config.value, turnstileRejected.value))
  onTurnstileRejected(() => {
    turnstileRejected.value = true
  })

  /**
   * 用组件给出的一次性令牌换取凭据；CFSM 确认后通知各页面重载数据并重新读取配置。
   * 先递增 credentialRevision：页面的重载与配置回读并行，遮罩在数据回来前不会退出。
   */
  async function completeTurnstile(token: string): Promise<boolean> {
    const base = primaryBase.value
    if (!base) return false
    const verified = (await verifyTurnstileToken(base, token)).verified
    if (!verified) return false
    turnstileRejected.value = false
    credentialRevision.value += 1
    await initialize()
    return config.value?.verified === true
  }

  async function performInitialize(expectedRevision: number, background: boolean): Promise<void> {
    // A background retry keeps the error visible and lets independently loaded nodes stay on screen.
    if (!background) {
      state.value = 'loading'
      error.value = null
    }

    try {
      apiBases.value = getApiBases()
      const base = apiBases.value[0]
      if (!base) throw new Error('No CFSM API base is configured')
      const nextConfig = await fetchSiteConfig(base)
      if (expectedRevision !== initializeRevision) return
      config.value = nextConfig
      state.value = 'ready'
      error.value = null
      timeoutRetryCount = 0
      clearRetryTimer()
    } catch (reason) {
      if (expectedRevision !== initializeRevision) return
      // 手动刷新失败时保留上一次真实配置；冷启动本来就是 null，仍按失败态走 fallback。
      state.value = 'error'
      error.value = errorMessage(reason)
      if (reason instanceof CfsmRequestError && reason.code === 'timeout') {
        scheduleTimeoutRetry()
      }
    }
  }

  function beginInitialize(background: boolean): Promise<void> {
    // 首页离开时请求不会被销毁；详情/设置若在它完成前接手，复用同一个配置请求。
    if (initializeInFlight) return initializeInFlight
    if (!background) {
      timeoutRetryCount = 0
      clearRetryTimer()
    }
    const expectedRevision = ++initializeRevision
    const pending = performInitialize(expectedRevision, background)
    initializeInFlight = pending
    void pending.then(
      () => {
        if (initializeInFlight === pending) initializeInFlight = null
      },
      () => {
        if (initializeInFlight === pending) initializeInFlight = null
      },
    )
    return pending
  }

  function initialize(): Promise<void> {
    // Retrying after an error must not put already loaded nodes behind the cold-start skeleton.
    return beginInitialize(state.value === 'error')
  }

  function applyConfig(nextConfig: SiteConfig): void {
    // 保存设置后的回读结果比任何更早启动的初始化请求更新。
    initializeRevision += 1
    initializeInFlight = null
    timeoutRetryCount = 0
    clearRetryTimer()
    config.value = nextConfig
    state.value = 'ready'
    error.value = null
  }

  return {
    apiBases,
    config,
    state,
    error,
    primaryBase,
    administrationUrl,
    turnstileSiteKey,
    credentialRevision,
    initialize,
    applyConfig,
    completeTurnstile,
  }
})
