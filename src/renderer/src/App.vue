<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import EnvListView from './views/EnvListView.vue'

const ping = ref('自检中…')
const statusJson = ref('{}')
let offStatus: (() => void) | null = null

onMounted(async () => {
  // 01-T5 端到端验证：渲染层 → preload → 主进程 → 渲染层
  const res = await window.api.ping()
  ping.value = res.ok
    ? `骨架 OK · v${res.data.version} · ${res.data.arch} · better-sqlite3 ${res.data.sqlite ? '可用' : '不可用'}`
    : `ping 失败：${res.error.code} ${res.error.message}`

  // 事件通道验证：主进程 broadcast → 渲染层订阅
  offStatus = window.api.onStatusChanged((s) => {
    statusJson.value = JSON.stringify(s)
  })
})

onUnmounted(() => offStatus?.())
</script>

<template>
  <main class="page">
    <h1>多账号环境隔离浏览器</h1>
    <p class="ping" data-testid="ping">{{ ping }}</p>
    <EnvListView />
    <p class="tip">
      状态事件（env:status-changed）：<code>{{ statusJson }}</code>
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px;
}
h1 {
  font-size: 20px;
  margin: 0 0 12px;
}
.ping {
  color: #16a34a;
  margin: 0 0 24px;
}
.tip {
  color: #888;
  font-size: 12px;
}
</style>
