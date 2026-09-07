<script setup lang="ts">
import { toasts } from '../lib/toast'

const kindIcon: Record<string, string> = {
  success: 'icon-[lucide--check-circle]',
  error: 'icon-[lucide--alert-circle]',
  info: 'icon-[lucide--info]'
}
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.kind}`">
      <span :class="kindIcon[t.kind]"></span>
      {{ t.text }}
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 1000;
  max-width: 380px;
}
.toast {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
  word-break: break-all;
}
.toast--error {
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
}
.toast--info {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}
.toast--success {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
}
</style>
