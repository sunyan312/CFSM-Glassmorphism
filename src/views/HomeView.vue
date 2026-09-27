<script setup lang="ts">
import { computed, inject, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/dashboard/AppHeader.vue'
import AdvancedTools from '@/components/dashboard/AdvancedTools.vue'
import DashboardControls from '@/components/dashboard/DashboardControls.vue'
import EarthMap from '@/components/dashboard/EarthMap.vue'
import OverviewCards from '@/components/dashboard/OverviewCards.vue'
import ServerCard from '@/components/dashboard/ServerCard.vue'
import ServerList from '@/components/dashboard/ServerList.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  ALL_GROUPS,
  availableGroups,
  filterServers,
  sortServers,
  summarizeServers,
} from '@/domain/dashboard'
import {
  financeNodesOf,
  generalFinanceContext,
  isExpiring,
  isHighLoad,
  parseProviderAliases,
  resolveQuickControlKeys,
  type QuickControlKey,
} from '@/domain/theme-presentation'
import { hasMultipleSources, serverDetailLocation } from '@/router/links'
import { createGlassServerMapper } from '@/services/cfsm'
import { useAppStore } from '@/stores/app'
import { useDashboardPreferencesStore } from '@/stores/dashboard-preferences'
import { useDashboardViewStore } from '@/stores/dashboard-view'
import { useFinanceStore } from '@/stores/finance'
import { useRealtimeStore } from '@/stores/realtime'
import { useServersStore } from '@/stores/servers'
import { useThemeSettingsStore } from '@/stores/theme-settings'
import { parseSettingKeys } from '@/theme/settings'
import { bootstrapKey } from '@/domain/bootstrap'
import { injectedSiteTitleKey, injectedTitleForPrimary, resolveSiteTitle } from '@/domain/site-title'
import { configReady } from '@/domain/config-readiness'
import type { DashboardSort, DashboardViewMode, GlassServer } from '@/types/glassmorphism'

// App.vue 的 `KeepAlive :include="['HomeView']"` 按组件名匹配，与 Komari 一致。
defineOptions({ name: 'HomeView' })

const app = useAppStore()
const serverStore = useServersStore()
const preferences = useDashboardPreferencesStore()
const realtime = useRealtimeStore()
const theme = useThemeSettingsStore()
const finance = useFinanceStore()
const router = useRouter()
const glassServerMapper = createGlassServerMapper()
const injectedSiteTitle = inject(injectedSiteTitleKey, null)
const bootstrap = inject(bootstrapKey, null)
const coldStartCover = bootstrap?.coverVisible ?? ref(false)

// 首页浏览状态放在会话级 store 中，保证「首页 → 详情 → 返回首页」后
// 搜索词、分组、排序与快捷筛选保持不变，不需要刷新或重新筛选。
const viewState = useDashboardViewStore()
const { query, selectedGroup, sort, activeQuickFilter, advancedToolsVisible } = storeToRefs(viewState)
const refreshing = ref(false)
// Komari UI_CONFIG.motion：staggerMs 35、staggerLimit 12。
const NODE_ITEM_DELAY_STYLES = Array.from({ length: 13 }, (_, index) => ({
  '--node-item-delay': `${index * 35}ms`,
}))

const siteTitleResolution = computed(() => resolveSiteTitle(
  app.config?.siteTitle,
  app.config === null && (app.state === 'idle' || app.state === 'loading'),
  injectedTitleForPrimary(injectedSiteTitle, app.primaryBase),
))
const siteTitle = computed(() => siteTitleResolution.value.title)
const siteTitlePending = computed(() => siteTitleResolution.value.state === 'pending')
const siteConfigReady = computed(() => configReady(app.config, app.state))
const viewMode = computed({
  get: () => theme.viewMode,
  set: (value: DashboardViewMode) => theme.setDashboardViewMode(value),
})
const visibleAdminUrl = computed(() => (
  !siteConfigReady.value || (theme.runtime.hideAdminEntryWhenLoggedOut && app.config?.authorization !== true)
    ? null
    : app.administrationUrl
))
const advancedToolsAvailable = computed(() => (
  theme.runtime.homeToolsEnabled && app.config?.authorization === true
))
const showAdvancedTools = computed(() => advancedToolsAvailable.value && advancedToolsVisible.value)
const isDark = computed(() => theme.resolvedTheme === 'dark')
/** 主题级价格隐私；每台节点自身的 showPrice 仍在卡片与列表内单独生效。 */
const priceVisible = computed(() => (
  !theme.runtime.hidePriceWhenLoggedOut || app.config?.authorization === true
))
// 与 Komari NodeGeneralCards 一致：Earth 与总览卡片同处一个栅格容器。
// 球体渲染器在桌面端占右半、卡片占左半；tiled 则卡片在上、整幅地图在下。
const showEarth = computed(() => !theme.runtime.hideEarth)
const showGeneralCards = computed(() => !theme.runtime.hideGeneralCard)
const isTiledEarth = computed(() => showEarth.value && theme.runtime.earthRenderer === 'tiled')
const showGeneralStage = computed(() => showEarth.value || showGeneralCards.value)
const generalStageClass = computed(() => {
  if (!showEarth.value) return 'general-stage--cards-only'
  return isTiledEarth.value ? 'general-stage--tiled' : 'general-stage--globe'
})
const metadataFields = computed(() => parseSettingKeys(theme.runtime.nodeListMetadataFields))
const providerAliases = computed(() => parseProviderAliases(theme.runtime.providerAliases))
const quickControlKeys = computed(() => resolveQuickControlKeys(theme.runtime))
const glassServers = computed(() => (
  glassServerMapper.map(serverStore.servers, app.config)
))
const summary = computed(() => summarizeServers(glassServers.value))
/*
 * 总览里的剩余价值 / 月费用 / 年费用。只有选用了这些卡、价格对访客可见、而且确有跨币种换算时
 * 才请求汇率；站点关闭 show_price 的节点不参与合计，明细弹窗也只拿到这些节点。
 */
const financeNodes = computed(() => financeNodesOf(glassServers.value))
const generalFinance = computed(() => (
  siteConfigReady.value && showGeneralCards.value
    ? generalFinanceContext(glassServers.value, theme.runtime, {
      priceVisible: priceVisible.value,
      target: finance.preferences.displayCurrency,
      view: finance.view,
      excludeFree: finance.preferences.excludeFree,
      now: Date.now(),
    })
    : undefined
))
watch(
  () => generalFinance.value?.state === 'visible' && generalFinance.value.summary.needsRates,
  (needed) => {
    if (needed) void finance.ensureRates()
  },
  { immediate: true },
)
const groups = computed(() => availableGroups(glassServers.value))
const filteredServers = computed(() => {
  const servers = filterServers(
    glassServers.value,
    query.value,
    selectedGroup.value,
    activeQuickFilter.value === 'favorite' ? preferences.favorites : undefined,
  )
  if (activeQuickFilter.value === 'offline') return servers.filter((server) => !server.online)
  if (activeQuickFilter.value === 'highLoad') return servers.filter((server) => isHighLoad(server, theme.runtime.homeHighLoadThreshold))
  if (activeQuickFilter.value === 'expiring') return servers.filter((server) => isExpiring(server, theme.runtime.homeExpiringDays))
  return servers
})
const visibleServers = computed(() => sortServers(
  filteredServers.value,
  sort.value,
  theme.runtime.offlineNodesLast,
))
const favoriteCount = computed(() => glassServers.value.reduce(
  (count, server) => count + (preferences.isFavorite(server.key) ? 1 : 0),
  0,
))
const quickCounts = computed<Partial<Record<QuickControlKey, number>>>(() => ({
  favorite: favoriteCount.value,
  offline: glassServers.value.filter((server) => !server.online).length,
  highLoad: glassServers.value.filter((server) => isHighLoad(server, theme.runtime.homeHighLoadThreshold)).length,
  expiring: glassServers.value.filter((server) => isExpiring(server, theme.runtime.homeExpiringDays)).length,
}))
const isDenseCollection = computed(() => visibleServers.value.length >= 30)
// Komari enableNodeCardTransition：关闭页面动画或卡片超过 30 张（denseNodeAppearThreshold）时不播进场过渡。
const cardTransition = computed(() => !theme.runtime.disablePageAnimation && visibleServers.value.length <= 30)
const showSource = computed(() => (
  app.apiBases.length > 1 || serverStore.collections.length > 1
))
const sourceCount = computed(() => (
  app.apiBases.length || serverStore.collections.length
))
const initialLoading = computed(() => !siteConfigReady.value || (
  glassServers.value.length === 0
  && (app.state === 'idle' || app.state === 'loading'
    || serverStore.state === 'idle' || serverStore.state === 'loading')
))
const hasNoServers = computed(() => (
  !initialLoading.value
  && serverStore.state !== 'error'
  && glassServers.value.length === 0
))
const hasNoMatches = computed(() => (
  glassServers.value.length > 0 && visibleServers.value.length === 0
))
const allOffline = computed(() => summary.value.total > 0 && summary.value.online === 0)
const realtimeLabel = computed(() => {
  if (realtime.status === 'live') return 'Live updates'
  if (realtime.status === 'fallback') return 'REST fallback'
  if (realtime.status === 'timed-out') return 'Live updates timed out'
  if (realtime.status === 'paused') return 'Live updates paused'
  if (realtime.status === 'connecting') return 'Live updates connecting'
  return 'REST snapshot'
})

watch(groups, (nextGroups) => {
  if (selectedGroup.value !== ALL_GROUPS && !nextGroups.includes(selectedGroup.value)) {
    selectedGroup.value = ALL_GROUPS
  }
})

watch(siteTitle, (title) => {
  if (title) document.title = title
}, { immediate: true })

// KeepAlive 回到首页时组件不重建，上面的 watch 不会再执行，这里恢复被详情页改写的标题。
onActivated(() => {
  if (siteTitle.value) document.title = siteTitle.value
})

async function refreshRest(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([
      app.initialize(),
      serverStore.load(),
    ])
  } finally {
    refreshing.value = false
  }
}

// 通过 Turnstile 人机验证后重新拉取数据：此前的请求都因缺少凭据被 CFSM 以 403 拒绝。
// 与手动刷新一样，拉取后让实时连接按新的节点列表同步；验证前列表为空，不同步的话 WebSocket 不会建立。
watch(() => app.credentialRevision, () => {
  void refresh()
})

async function refresh(): Promise<void> {
  await refreshRest()
  realtime.sync()
}

/**
 * 与 Komari 的 NodeCard / NodeList 主路径一致：卡片或列表行的主点击直接进入节点详情，
 * 中间不插入快速预览、二次确认或任何其它中间层。
 *
 * 链接由 `router/links` 统一生成：多 apiBase 场景仍然带上该节点的 owning source，
 * 避免把节点解析到错误的后端；单后端站点上该参数恒等于当前同源地址，予以省略。
 */
function openServer(server: GlassServer): void {
  void router.push(serverDetailLocation(
    server.id,
    server.sourceBase,
    hasMultipleSources(app.apiBases),
  ))
}

function cardStyle(index: number): Record<string, string> {
  return NODE_ITEM_DELAY_STYLES[Math.min(index, 12)] ?? NODE_ITEM_DELAY_STYLES[0] ?? {}
}

function quickAction(key: QuickControlKey): void {
  if (activeQuickFilter.value === key) {
    activeQuickFilter.value = null
    if (['totalTraffic', 'upload', 'download', 'peak'].includes(key)) sort.value = 'order'
    return
  }
  activeQuickFilter.value = key
  const sorts: Partial<Record<QuickControlKey, DashboardSort>> = {
    totalTraffic: 'traffic',
    upload: 'upload',
    download: 'download',
    peak: 'peak',
  }
  if (sorts[key]) sort.value = sorts[key] as DashboardSort
}

onMounted(async () => {
  preferences.initialize()
  if (bootstrap?.claimInitialPage()) {
    await Promise.all([
      app.state === 'idle' || app.state === 'loading' ? app.initialize() : Promise.resolve(),
      serverStore.state === 'idle' || serverStore.state === 'loading' ? serverStore.load() : Promise.resolve(),
    ])
  } else {
    await refreshRest()
  }
  realtime.start(refreshRest)
})

onUnmounted(() => realtime.stop())
</script>

<template>
  <div class="app-root">
    <div class="app-shell">
      <AppHeader
        :title="siteTitle"
        :title-pending="siteTitlePending"
        :version="app.config?.version ?? null"
        :loading="refreshing"
        :online="summary.online"
        :total="summary.total"
        :source-count="sourceCount"
        :admin-url="visibleAdminUrl"
        :theme-mode="theme.siteThemeMode"
        :resolved-theme="theme.resolvedTheme"
        :theme-override="theme.themeOverride"
        @refresh="refresh"
        @cycle-theme="theme.cycleTheme"
      />

      <main v-if="!coldStartCover" class="dashboard">
        <!-- 与 Komari 一致：公告位于总览与节点区之前，是首页第一块内容。 -->
        <section
          v-if="siteConfigReady && theme.runtime.alertEnabled && (theme.runtime.alertTitle || theme.runtime.alertContent)"
          class="theme-announcement glass-panel"
          role="status"
        >
          <span class="theme-announcement__mark" aria-hidden="true">
            <AppIcon name="lucide:info" :size="16" />
          </span>
          <div>
            <strong>{{ theme.runtime.alertTitle || '站点公告' }}</strong>
            <p v-if="theme.runtime.alertContent">
              {{ theme.runtime.alertContent }}
            </p>
          </div>
        </section>

        <div
          v-if="app.state === 'error'"
          class="notice notice--warning"
          role="status"
        >
          <strong>站点配置读取失败</strong>
          <span>{{ app.error }}。节点数据仍会独立尝试加载。</span>
          <button type="button" @click="app.initialize()">
            重试读取配置
          </button>
        </div>

        <div
          v-if="serverStore.sourceFailures.length > 0"
          class="notice notice--warning"
          role="status"
        >
          <strong>部分数据源暂不可用</strong>
          <span
            v-for="failure in serverStore.sourceFailures"
            :key="failure.source.base"
          >
            {{ failure.source.label }}：{{ failure.message }}
            <template v-if="failure.status">（HTTP {{ failure.status }}）</template>
          </span>
        </div>

        <div
          v-if="realtime.timedOut"
          class="notice notice--warning notice--choice"
          role="status"
        >
          <div>
            <strong>实时连接已达到站点设置的连接时限</strong>
            <span>请选择继续建立新的实时连接，或暂时停用实时更新。</span>
          </div>
          <div class="notice__actions">
            <button type="button" @click="realtime.continueAfterTimeout">
              继续实时连接
            </button>
            <button type="button" @click="realtime.pauseAfterTimeout">
              保持暂停
            </button>
          </div>
        </div>

        <div
          v-else-if="realtime.paused"
          class="notice notice--warning notice--choice"
          role="status"
        >
          <div>
            <strong>实时更新已暂停</strong>
            <span>当前页面保留最后一次真实数据快照；恢复后会重新连接各数据源。</span>
          </div>
          <div class="notice__actions">
            <button type="button" @click="realtime.resume">
              恢复实时连接
            </button>
          </div>
        </div>

        <div
          v-if="realtime.fallbackActive"
          class="notice notice--warning"
          role="status"
        >
          <strong>实时连接暂不可用</strong>
          <span>已启用低频 REST 补偿刷新，WebSocket 会按退避策略继续恢复。</span>
        </div>

        <div
          v-if="allOffline"
          class="notice notice--offline"
          role="status"
        >
          <strong>当前所有节点均为离线状态</strong>
          <span>页面保留后端返回的最后指标，不把旧指标标记为实时数据。</span>
        </div>

        <template v-if="initialLoading">
          <div class="overview-grid" aria-label="正在加载总览">
            <span
              v-for="index in 6"
              :key="index"
              class="skeleton skeleton--overview"
            />
          </div>
          <section class="skeleton-grid" aria-label="正在加载节点">
            <span
              v-for="index in 3"
              :key="index"
              class="skeleton skeleton--card"
            />
          </section>
        </template>

        <template v-else>
          <section
            v-if="showGeneralStage"
            class="general-stage"
            :class="generalStageClass"
          >
            <EarthMap
              v-if="showEarth"
              class="general-stage__earth"
              :servers="glassServers"
              :renderer="theme.runtime.earthRenderer"
              :stopped="theme.runtime.stopEarth"
              :is-dark="isDark"
            />

            <OverviewCards
              v-if="showGeneralCards"
              class="general-stage__cards"
              :servers="glassServers"
              :settings="theme.runtime"
              :finance="generalFinance"
              :finance-nodes="financeNodes"
            />
          </section>

          <AdvancedTools
            v-if="showAdvancedTools"
            :servers="glassServers"
            :settings="theme.runtime"
            :site-title="siteTitle ?? ''"
            @select="openServer"
          />

          <div
            v-if="serverStore.state === 'error'"
            class="state-panel state-panel--error"
            role="alert"
          >
            <span class="state-panel__icon" aria-hidden="true">!</span>
            <h2>无法加载节点</h2>
            <p>{{ serverStore.error }}</p>
            <button type="button" class="state-panel__retry" @click="refresh">
              重新加载
            </button>
          </div>

          <div
            v-else-if="hasNoServers"
            class="state-panel"
          >
            <span class="state-panel__icon" aria-hidden="true">0</span>
            <h2>暂无节点</h2>
            <p>CFSM 返回了空服务器列表。添加节点后，它们会出现在这里。</p>
          </div>

          <div v-else class="dashboard-node-info">
            <DashboardControls
              v-model:query="query"
              v-model:group="selectedGroup"
              v-model:view-mode="viewMode"
              :groups="groups"
              :quick-controls-enabled="theme.runtime.homeQuickControlsEnabled"
              :quick-control-keys="quickControlKeys"
              :quick-counts="quickCounts"
              :active-quick-filter="activeQuickFilter"
              :tools-available="advancedToolsAvailable"
              :tools-visible="showAdvancedTools"
              @quick-action="quickAction"
              @toggle-tools="advancedToolsVisible = !advancedToolsVisible"
            />

            <div
              v-if="hasNoMatches"
              class="state-panel state-panel--compact"
            >
              <span class="state-panel__icon" aria-hidden="true">⌕</span>
              <h2>没有匹配节点</h2>
              <p>请调整搜索词或分组筛选。</p>
              <button
                type="button"
                @click="viewState.clearFilters()"
              >
                清除筛选
              </button>
            </div>

            <!--
              与 Komari 一致：卡片进场用 TransitionGroup 的过渡，只在首次渲染与卡片加入列表时播放；
              KeepAlive 重新插回页面时不会重播（CSS animation 会）。
            -->
            <TransitionGroup
              v-else-if="viewMode === 'card'"
              :appear="cardTransition"
              :css="cardTransition"
              name="node-card-switch"
              tag="div"
              :class="[
                'server-grid',
                `server-grid--size-${theme.runtime.nodeCardSize}`,
                { 'server-grid--dense': isDenseCollection },
              ]"
            >
              <ServerCard
                v-for="(server, index) in visibleServers"
                :key="server.key"
                :server="server"
                :show-source="showSource"
                :density="theme.runtime.nodeCardSize"
                :favorite="preferences.isFavorite(server.key)"
                :price-visible="priceVisible"
                :style="cardStyle(index)"
                @open="openServer(server)"
                @toggle-favorite="preferences.toggleFavorite(server.key)"
              />
            </TransitionGroup>
            <ServerList
              v-else
              :servers="visibleServers"
              :show-source="showSource"
              :favorite-keys="preferences.favorites"
              :metadata-enabled="theme.runtime.nodeListMetadataEnabled"
              :metadata-fields="metadataFields"
              :provider-aliases="providerAliases"
              :custom-tags-visible="theme.runtime.nodeListCustomTagsVisible"
              :price-visible="priceVisible"
              @open="openServer"
              @toggle-favorite="preferences.toggleFavorite"
            />
          </div>
        </template>
      </main>

      <footer v-if="!coldStartCover" class="app-footer">
        <span>
          Powered by
          <a href="https://github.com/huilang-me/CF-Server-Monitor/">
            CF-Server-Monitor<template v-if="app.config?.version"> v{{ app.config.version }}</template>
          </a>
        </span>
        <span>Glassmorphism Theme · {{ realtimeLabel }}</span>
      </footer>
    </div>
  </div>
</template>
