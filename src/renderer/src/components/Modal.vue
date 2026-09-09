<script setup lang="ts">
const props = defineProps<{
  title: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

function cancelFromBackdrop(): void {
  if (!props.busy) emit('cancel')
}
</script>

<template>
  <div class="modal-mask" @pointerdown.self="cancelFromBackdrop">
    <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
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
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  width: min(520px, calc(100vw - 48px));
  box-shadow: 0 10px 40px rgb(0 0 0 / 20%);
}
.modal__title {
  margin: 0 0 12px;
  font-size: 16px;
}
.modal__body {
  font-size: 14px;
  color: #374151;
}
.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
