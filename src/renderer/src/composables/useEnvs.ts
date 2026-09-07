/**
 * 环境列表 + 运行状态（08-T2）
 * 数据源：env:list / env:status 首屏，env:status-changed 实时刷新。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { CrashedInfo, EnvStatus, EnvStatusMap, EnvSummary } from '@shared/types'

export interface EnvRow extends EnvSummary {
  status: EnvStatus
}

interface UseEnvsReturn {
  envs: Ref<EnvSummary[]>
  rows: Ref<EnvRow[]>
  statusMap: Ref<EnvStatusMap>
  loading: Ref<boolean>
  refresh: () => Promise<void>
}

export function useEnvs(onCrashed?: (info: CrashedInfo) => void): UseEnvsReturn {
  const envs = ref<EnvSummary[]>([])
  const statusMap = ref<EnvStatusMap>({})
  const loading = ref(true)

  const rows = computed(() =>
    envs.value.map((e) => ({ ...e, status: statusMap.value[e.id] ?? e.status }))
  )

  async function refresh(): Promise<void> {
    const [l, s] = await Promise.all([window.api.envList(), window.api.envStatus()])
    if (l.ok) envs.value = l.data
    if (s.ok) statusMap.value = s.data
    loading.value = false
  }

  const offs: (() => void)[] = []
  onMounted(async () => {
    await refresh()
    offs.push(
      window.api.onStatusChanged((m) => {
        statusMap.value = m
      })
    )
    if (onCrashed) offs.push(window.api.onCrashed(onCrashed))
  })
  onUnmounted(() => offs.forEach((off) => off()))

  return { envs, rows, statusMap, loading, refresh }
}
