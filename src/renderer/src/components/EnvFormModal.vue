<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { Env, ProxyConfig, ProxyType, PublicProxyConfig } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ env?: Env | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const isEdit = !!props.env?.id

const form = reactive({
  name: props.env?.name ?? '',
  remark: props.env?.remark ?? '',
  group: props.env?.group ?? '',
  type: 'socks5' as ProxyType,
  host: '',
  port: '',
  username: '',
  password: '',
  useProxy:
    !!props.env &&
    ('proxySummary' in props.env ? !!props.env.proxySummary : !!props.env.proxyConfig)
})

// 编辑态回填。PublicProxyConfig 不含密码（§8 永不回传）；密码输入框留空表示保留已存密码。
const savedProxy = ref<PublicProxyConfig | null>(null)
if (isEdit && props.env?.proxyConfig) {
  const p = props.env.proxyConfig
  if (p) {
    savedProxy.value = p
    form.type = p.type
    form.host = p.host
    form.port = String(p.port)
    form.username = p.username ?? ''
    form.useProxy = true
  }
}

const busy = ref(false)
const testing = ref(false)
const testResult = ref<{ ip: string; country: string; latencyMs: number } | null>(null)
const proxyDirty = ref(!isEdit)

function markDirty(): void {
  proxyDirty.value = true
}

function buildProxyConfig(): ProxyConfig | null {
  if (!form.useProxy) return null
  const cfg: ProxyConfig = { type: form.type, host: form.host.trim(), port: Number(form.port) }
  if (form.username) cfg.username = form.username
  if (form.password) cfg.password = form.password
  return cfg
}

async function onTest(): Promise<void> {
  const cfg = buildProxyConfig()
  if (!cfg || !cfg.host || !cfg.port) {
    pushToast('error', '请先填写代理主机与端口')
    return
  }
  testing.value = true
  testResult.value = null
  const testInput = isEdit && props.env ? { ...cfg, savedPasswordEnvId: props.env.id } : cfg
  const res = await window.api.proxyTest(testInput)
  testing.value = false
  if (res.ok) testResult.value = res.data
  else pushToast('error', errorText(res.error))
}

async function onSave(): Promise<void> {
  const name = form.name.trim()
  if (!name) {
    pushToast('error', '环境名称不能为空')
    return
  }
  // 代理提交语义：
  // - 新建：useProxy 即提交（或 null 直连）
  // - 编辑且未动代理字段：省略 proxyConfig（原配置保持不变）
  // - 编辑且改动代理字段：密码留空则由主进程保留已有密文
  let proxyConfig: ProxyConfig | null | undefined
  if (!isEdit || proxyDirty.value || (form.useProxy === false && savedProxy.value)) {
    proxyConfig = form.useProxy ? buildProxyConfig() : null
  }
  busy.value = true
  const payload = {
    name,
    remark: form.remark.trim(),
    group: form.group.trim(),
    proxyConfig
  }
  const res =
    isEdit && props.env
      ? await window.api.envUpdate({ id: props.env.id, ...payload })
      : await window.api.envCreate(payload)
  busy.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  pushToast('success', isEdit ? '环境已更新' : '环境已创建')
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal
    :title="isEdit ? '编辑环境' : '创建环境'"
    :busy="busy"
    confirm-text="保存"
    @confirm="onSave"
    @cancel="emit('close')"
  >
    <div class="form">
      <label class="field">
        <span>名称 *</span>
        <input v-model="form.name" type="text" placeholder="如：店铺A" />
      </label>
      <label class="field">
        <span>备注</span>
        <input v-model="form.remark" type="text" placeholder="可选" />
      </label>
      <label class="field">
        <span>分组</span>
        <input v-model="form.group" type="text" placeholder="如：北美店铺" />
      </label>
      <label class="field field--row">
        <input v-model="form.useProxy" type="checkbox" @change="markDirty" />
        <span>绑定代理（不绑定则直连，平台将看到本机 IP）</span>
      </label>
      <template v-if="form.useProxy">
        <div class="grid2">
          <label class="field">
            <span>类型</span>
            <select v-model="form.type" @change="markDirty">
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
            </select>
          </label>
          <label class="field">
            <span>端口</span>
            <input v-model="form.port" type="text" placeholder="如 1080" @input="markDirty" />
          </label>
        </div>
        <div class="grid2">
          <label class="field">
            <span>主机</span>
            <input
              v-model="form.host"
              type="text"
              placeholder="如 proxy.example.com"
              @input="markDirty"
            />
          </label>
          <label class="field">
            <span>账号</span>
            <input v-model="form.username" type="text" placeholder="可选" @input="markDirty" />
          </label>
        </div>
        <label class="field">
          <span
            >密码{{ savedProxy?.hasPassword ? '（已安全保存，留空保持不变）' : '（可选）' }}</span
          >
          <input v-model="form.password" type="password" placeholder="可选" @input="markDirty" />
        </label>
        <div class="test">
          <button class="btn" type="button" :disabled="testing" @click="onTest">
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
          <span v-if="testResult" class="test__ok">
            出口 {{ testResult.ip }} · {{ testResult.country }} · {{ testResult.latencyMs }}ms
          </span>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #4b5563;
}
.field--row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.field input[type='text'],
.field input[type='password'],
.field select {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.test {
  display: flex;
  align-items: center;
  gap: 10px;
}
.test__ok {
  color: #15803d;
  font-size: 13px;
}
</style>
