<script setup lang="ts">
import { ref } from 'vue'
import type { CountryChangeInfo } from '@shared/types'
import { pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ info: CountryChangeInfo }>()
const emit = defineEmits<{ done: [] }>()

const busy = ref(false)

async function answer(accept: boolean): Promise<void> {
  busy.value = true
  const res = await window.api.alignConfirm({ id: props.info.envId, accept })
  busy.value = false
  if (res.ok) {
    pushToast('info', accept ? `已更新对齐字段（时区/语言），下次启动生效` : '已保留原对齐字段')
  }
  emit('done')
}
</script>

<template>
  <Modal
    title="代理出口地区已变化"
    :busy="busy"
    confirm-text="更新对齐字段"
    @confirm="answer(true)"
    @cancel="answer(false)"
  >
    <p>
      代理出口地区从 <strong>{{ info.from ?? '（无）' }}</strong> 变为
      <strong>{{ info.to ?? '（无）' }}</strong
      >。
    </p>
    <p class="hint">
      「更新对齐字段」仅调整时区 / 语言 / 定位等派生配置以匹配新地区；核心指纹（UA / 屏幕 /
      硬件）保持不变。本次会话仍使用旧对齐字段，下次启动生效。
    </p>
  </Modal>
</template>

<style scoped>
.hint {
  color: #6b7280;
  font-size: 13px;
}
</style>
