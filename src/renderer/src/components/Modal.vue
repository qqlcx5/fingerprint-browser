<script setup lang="ts">
import { X } from '@lucide/vue'

defineProps<{
  title: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="modal-mask">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
      <button
        class="modal__close"
        type="button"
        :disabled="busy"
        aria-label="关闭弹窗"
        title="关闭"
        @click="emit('cancel')"
      >
        <X aria-hidden="true" />
      </button>
      <h3 class="modal__title">{{ title }}</h3>
      <div class="modal__body"><slot /></div>
      <div class="modal__actions">
        <button class="btn" type="button" :disabled="busy" @click="emit('cancel')">
          {{ cancelText ?? '取消' }}
        </button>
        <button
          class="btn"
          :class="danger ? 'btn--danger' : 'btn--primary'"
          type="button"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ confirmText ?? '确认' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 40%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
}
.modal {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  box-sizing: border-box;
  width: min(560px, calc(100vw - 32px));
  max-height: min(760px, 82vh);
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 10px 40px rgb(0 0 0 / 20%);
}
.modal__title {
  margin: 0 32px 12px 0;
  font-size: 16px;
}
.modal__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
}
.modal__close:hover:not(:disabled) {
  background: #f3f4f6;
  color: #111827;
}
.modal__close:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.modal__body {
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
  font-size: 14px;
  color: #374151;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #e5e7eb;
}
</style>
