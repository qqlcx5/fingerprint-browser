/**
 * 内核状态机（08-T6/T8）：checking → ready | downloading | error
 * 首挂载即 browser:ensure（§6.2 首启自动下载），进度走 browser:download-progress。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { AppError, DownloadProgress } from '@shared/types'

export type KernelState = 'checking' | 'ready' | 'downloading' | 'error'

interface UseKernelReturn {
  state: Ref<KernelState>
  progress: Ref<DownloadProgress | null>
  error: Ref<AppError | null>
  retry: () => Promise<void>
}

export function useKernel(): UseKernelReturn {
  const state = ref<KernelState>('checking')
  const progress = ref<DownloadProgress | null>(null)
  const error = ref<AppError | null>(null)

  let offProgress: (() => void) | null = null

  async function ensure(): Promise<void> {
    if (state.value === 'ready') return
    state.value = 'downloading'
    error.value = null
    const res = await window.api.browserEnsure()
    if (res.ok && res.data.ready) {
      state.value = 'ready'
    } else if (res.ok) {
      // ready:false 理论不出现在 ensure 返回后（内部会直接下载），防御归为 downloading 等进度
      state.value = 'downloading'
    } else {
      error.value = res.error
      state.value = 'error'
    }
  }

  onMounted(() => {
    offProgress = window.api.onDownloadProgress((p) => {
      progress.value = p
    })
    void ensure()
  })
  onUnmounted(() => offProgress?.())

  return { state, progress, error, retry: ensure }
}
