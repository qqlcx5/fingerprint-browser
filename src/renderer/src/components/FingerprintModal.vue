<script setup lang="ts">
import { ref } from 'vue'
import type { Env } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ env: Env }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const text = ref(JSON.stringify(props.env.fingerprint, null, 2))
const busy = ref(false)

async function save(): Promise<void> {
  let fingerprint: Env['fingerprint']
  try {
    fingerprint = JSON.parse(text.value) as Env['fingerprint']
  } catch {
    pushToast('error', '核心指纹必须是合法 JSON')
    return
  }
  busy.value = true
  const res = await window.api.envUpdateFingerprint({ id: props.env.id, fingerprint })
  busy.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  pushToast('success', '核心指纹已更新')
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal
    title="编辑核心指纹"
    :busy="busy"
    confirm-text="保存"
    @confirm="save"
    @cancel="emit('close')"
  >
    <p class="hint">仅空闲环境可修改。保存后在下次启动生效。</p>
    <textarea v-model="text" class="editor" spellcheck="false" />
  </Modal>
</template>

<style scoped>
.hint {
  margin: 0 0 10px;
  color: #6b7280;
  font-size: 12px;
}
.editor {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 10px;
  font:
    12px/1.45 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
}
</style>
