<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { Env, ProxyConfig, ProxyNetworkClass, ProxyType } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ env: Env }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const currentBinding = props.env.proxyBinding
const currentProxy = currentBinding?.config ?? props.env.proxyConfig
const form = reactive({
  type: (currentProxy?.type ?? 'socks5') as ProxyType,
  networkClass: (currentBinding?.networkClass ?? 'static_residential') as ProxyNetworkClass,
  host: currentProxy?.host ?? '',
  port: currentProxy ? String(currentProxy.port) : '',
  username: currentProxy?.username ?? '',
  password: '',
  reason: ''
})
const busy = ref(false)

function config(): ProxyConfig {
  return {
    type: form.type,
    host: form.host.trim(),
    port: Number(form.port),
    ...(form.username.trim() ? { username: form.username.trim() } : {}),
    ...(form.password ? { password: form.password } : {})
  }
}

async function submit(): Promise<void> {
  if (!form.host.trim() || !Number(form.port)) {
    pushToast('error', '请填写代理主机和端口')
    return
  }
  if (!form.reason.trim()) {
    pushToast('error', '请填写更换原因')
    return
  }
  busy.value = true
  const res = await window.api.envProxyRebind({
    id: props.env.id,
    binding: { config: config(), networkClass: form.networkClass },
    changeReason: form.reason.trim()
  })
  busy.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  pushToast('success', `代理已更换为出口 ${res.data.proxyBinding?.expectedEgressIp ?? ''}`)
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal
    title="更换代理"
    :busy="busy"
    confirm-text="验证并更换"
    @confirm="submit"
    @cancel="emit('close')"
  >
    <div class="form">
      <p class="explain">
        只在原代理无法使用或确实要更换时操作。点击确认后系统会验证新代理，验证通过才会保存。
      </p>
      <p v-if="currentBinding" class="current">
        当前固定出口 IP：{{ currentBinding.expectedEgressIp }} · {{ currentBinding.country }}
      </p>
      <p v-else-if="currentProxy" class="current">
        当前代理尚未固定出口 IP，保存后系统会自动验证并记录。
      </p>
      <div class="grid3">
        <label class="field">
          <span>类型</span>
          <select v-model="form.type">
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </label>
        <label class="field">
          <span>代理类别</span>
          <select v-model="form.networkClass">
            <option value="static_residential">静态住宅</option>
            <option value="sticky_residential">粘性住宅</option>
            <option value="isp">ISP</option>
          </select>
        </label>
        <label class="field"><span>端口</span><input v-model="form.port" type="text" /></label>
      </div>
      <div class="grid2">
        <label class="field"><span>主机</span><input v-model="form.host" type="text" /></label>
        <label class="field"><span>账号</span><input v-model="form.username" type="text" /></label>
      </div>
      <label class="field">
        <span>密码</span>
        <input
          v-model="form.password"
          type="password"
          :placeholder="currentProxy?.hasPassword ? '留空时自动保留已保存的密码' : '没有密码可留空'"
        />
      </label>
      <label class="field">
        <span>更换原因</span>
        <input v-model="form.reason" type="text" placeholder="如：原代理无法使用" />
      </label>
    </div>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.explain {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.current {
  margin: 0;
  color: #4b5563;
  font-size: 13px;
}
.grid2,
.grid3 {
  display: grid;
  gap: 10px;
}
.grid2 {
  grid-template-columns: 1fr 1fr;
}
.grid3 {
  grid-template-columns: 1fr 1fr 96px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #4b5563;
  font-size: 13px;
}
.field input,
.field select {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}
</style>
