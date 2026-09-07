<script setup lang="ts">
import { computed } from 'vue'
import { useKernel } from '../composables/useKernel'

const { state, progress, error, retry } = useKernel()

const percent = computed(() => {
  if (!progress.value || !progress.value.total) return 0
  return Math.min(100, Math.round((progress.value.received / progress.value.total) * 100))
})
const receivedMb = computed(() =>
  progress.value ? (progress.value.received / 1024 / 1024).toFixed(1) : '0'
)
const totalMb = computed(() =>
  progress.value && progress.value.total ? (progress.value.total / 1024 / 1024).toFixed(0) : '?'
)

defineExpose({ state })
</script>

<template>
  <div v-if="state !== 'ready'" class="gate">
    <div class="gate__card">
      <h2>浏览器内核</h2>
      <p v-if="state === 'checking'" class="muted">正在检查内核状态…</p>
      <template v-else-if="state === 'downloading'">
        <p>正在下载 Chromium 内核（约 150–300MB，仅需一次）</p>
        <div class="bar">
          <div class="bar__fill" :style="{ width: percent + '%' }" />
        </div>
        <p class="muted">{{ percent }}% · {{ receivedMb }} / {{ totalMb }} MB</p>
      </template>
      <template v-else-if="state === 'error'">
        <p class="bad">内核准备失败：{{ error?.message || '未知错误' }}</p>
        <button class="btn btn--primary" type="button" @click="retry">重试</button>
      </template>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.gate {
  position: fixed;
  inset: 0;
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 800;
}
.gate__card {
  width: min(460px, calc(100vw - 48px));
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 28px;
  text-align: center;
}
.gate__card h2 {
  margin: 0 0 10px;
  font-size: 18px;
}
.bar {
  height: 10px;
  background: #f3f4f6;
  border-radius: 999px;
  overflow: hidden;
  margin: 14px 0 8px;
}
.bar__fill {
  height: 100%;
  background: #2563eb;
  transition: width 0.3s;
}
.muted {
  color: #6b7280;
  font-size: 13px;
}
.bad {
  color: #b91c1c;
}
</style>
