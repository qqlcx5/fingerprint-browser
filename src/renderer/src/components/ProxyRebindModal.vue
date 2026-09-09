<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { Env, ProxyConfig, ProxyNetworkClass, ProxyType } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ env: Env }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const current = props.env.proxyBinding
const form = reactive({
  type: (current?.config.type ?? 'socks5') as ProxyType,
  networkClass: (current?.networkClass ?? 'static_residential') as ProxyNetworkClass,
  host: current?.config.host ?? '',
  port: current ? String(current.config.port) : '',
  username: current?.config.username ?? '',
  password: '',
  reason: ''
})
const testing = ref(false)
const busy = ref(false)
const testResult = ref<{ ip: string; country: string; latencyMs: number } | null>(null)
const testedKey = ref<string | null>(null)
const testError = ref<string | null>(null)

function config(): ProxyConfig {
  return {
    type: form.type,
    host: form.host.trim(),
    port: Number(form.port),
    ...(form.username.trim() ? { username: form.username.trim() } : {}),
    ...(form.password ? { password: form.password } : {})
  }
}
function key(): string {
  const cfg = config()
  return `${form.networkClass}|${cfg.type}|${cfg.host}|${cfg.port}|${cfg.username ?? ''}|${cfg.password ?? ''}`
}

async function test(): Promise<void> {
  const cfg = config()
  if (!cfg.host || !cfg.port) {
    pushToast('error', '请填写代理主机和端口')
    return
  }
  testing.value = true
  testResult.value = null
  testedKey.value = null
  testError.value = null
  const res = await window.api.proxyTest(cfg)
  testing.value = false
  if (!res.ok) {
    testError.value = errorText(res.error)
    pushToast('error', testError.value)
    return
  }
  testResult.value = res.data
  testedKey.value = key()
}

async function submit(): Promise<void> {
  if (!form.reason.trim()) {
    pushToast('error', '请填写代理变更原因')
    return
  }
  if (!testResult.value || testedKey.value !== key()) {
    pushToast('error', '请先测试当前代理后再重新绑定')
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
  pushToast('success', `代理已绑定到出口 ${res.data.proxyBinding?.expectedEgressIp ?? ''}`)
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal
    title="重新绑定代理"
    :busy="busy"
    confirm-text="确认重绑定"
    @confirm="submit"
    @cancel="emit('close')"
  >
    <div class="form">
      <p v-if="current" class="current">
        当前出口：{{ current.expectedEgressIp }} · {{ current.country }}
      </p>
      <div class="grid3">
        <label class="field"
          ><span>类型</span
          ><select v-model="form.type">
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select></label
        >
        <label class="field"
          ><span>代理类别</span
          ><select v-model="form.networkClass">
            <option value="static_residential">静态住宅</option>
            <option value="sticky_residential">粘性住宅</option>
            <option value="isp">ISP</option>
          </select></label
        >
        <label class="field"><span>端口</span><input v-model="form.port" type="text" /></label>
      </div>
      <div class="grid2">
        <label class="field"><span>主机</span><input v-model="form.host" type="text" /></label>
        <label class="field"><span>账号</span><input v-model="form.username" type="text" /></label>
      </div>
      <label class="field"
        ><span>密码</span
        ><input v-model="form.password" type="password" placeholder="必须重新填写以验证"
      /></label>
      <label class="field"
        ><span>变更原因</span
        ><input v-model="form.reason" type="text" placeholder="如：原代理出口变化"
      /></label>
      <div class="test">
        <button class="btn" type="button" :disabled="testing" @click="test">
          {{ testing ? '测试中...' : '测试连接' }}</button
        ><span v-if="testResult" class="ok"
          >出口 {{ testResult.ip }} · {{ testResult.country }} · {{ testResult.latencyMs }}ms</span
        >
      </div>
      <p v-if="testError" class="error">{{ testError }}</p>
    </div>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.test {
  display: flex;
  align-items: center;
  gap: 8px;
}
.btn {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  padding: 6px 9px;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}
.ok {
  color: #15803d;
  font-size: 12px;
}
.error {
  margin: 0;
  color: #b42318;
  font-size: 12px;
}
</style>
