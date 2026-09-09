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
    pushToast('info', accept ? '已更新地区设置，下次打开环境时生效' : '已保持原来的地区设置')
  }
  emit('done')
}
</script>

<template>
  <Modal
    title="代理出口地区已变化"
    :busy="busy"
    confirm-text="更新地区设置"
    @confirm="answer(true)"
    @cancel="answer(false)"
  >
    <p>
      代理出口地区从 <strong>{{ info.from ?? '（无）' }}</strong> 变为
      <strong>{{ info.to ?? '（无）' }}</strong
      >。
    </p>
    <p class="hint">
      这不会更换代理，也不会影响已保存的店铺资料。只是把浏览器显示的语言、时区和定位建议改成更接近新出口地区的设置；下次打开环境时生效。
    </p>
  </Modal>
</template>

<style scoped>
.hint {
  color: #6b7280;
  font-size: 13px;
}
</style>
