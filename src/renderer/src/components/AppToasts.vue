<script setup lang="ts">
import { CircleAlert, CircleCheck, Info } from '@lucide/vue'
import type { Component } from 'vue'
import { toasts, type ToastItem } from '../lib/toast'

const kindIcon: Record<ToastItem['kind'], Component> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info
}
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast--${t.kind}`">
      <component :is="kindIcon[t.kind]" class="toast__icon" aria-hidden="true" />
      <span>{{ t.text }}</span>
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
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 13px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.45;
  box-shadow: 0 4px 14px rgb(0 0 0 / 12%);
  word-break: break-all;
}
.toast__icon {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-top: 1px;
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
