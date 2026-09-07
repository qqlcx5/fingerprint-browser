/**
 * 启动期一次性通知（08-T8）：挂载后 app:notices 拉取一次（读后清空，主进程侧）。
 */
import { onMounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { StartupNotice } from '@shared/types'

const NOTICE_TEXT: Record<StartupNotice['kind'], string> = {
  db_reset: '本地数据库曾损坏，已自动重建；环境列表为空属预期',
  weak_encryption: '系统安全加密不可用，代理密码将以混淆方式存储，建议在本机使用'
}

interface UseNoticesReturn {
  notices: Ref<StartupNotice[]>
  dismiss: (kind: StartupNotice['kind']) => void
}

export function useNotices(): UseNoticesReturn {
  const notices = ref<StartupNotice[]>([])
  onMounted(async () => {
    const res = await window.api.appNotices()
    if (res.ok) notices.value = res.data.map((n) => ({ ...n, message: NOTICE_TEXT[n.kind] }))
  })
  function dismiss(kind: StartupNotice['kind']): void {
    notices.value = notices.value.filter((n) => n.kind !== kind)
  }
  return { notices, dismiss }
}
