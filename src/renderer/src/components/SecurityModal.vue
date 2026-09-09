<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Env, SecurityStatus, SecurityToggle } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const props = defineProps<{ env: Env }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const status = reactive<SecurityStatus>({ ...props.env.securityStatus })
const busy = ref(false)
const showTotpSetup = ref(false)
const totpSecret = ref('')
const confirmTotp = ref(false)
const code = ref<string | null>(null)
const expiresAt = ref<number | null>(null)
const securityOptions: Array<{ value: SecurityToggle; label: string }> = [
  { value: 'unknown', label: '未确认' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '未启用' }
]
const codeText = computed(() =>
  expiresAt.value
    ? `${code.value}，${new Date(expiresAt.value).toLocaleTimeString()} 到期`
    : code.value
)

async function save(): Promise<void> {
  busy.value = true
  const res = await window.api.envSecurityUpdate({ id: props.env.id, status: { ...status } })
  busy.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  pushToast('success', '账号安全状态已更新')
  emit('saved')
}

async function enableTotp(): Promise<void> {
  if (!confirmTotp.value || !totpSecret.value.trim()) {
    pushToast('error', '请填写密钥并确认本机安全存储要求')
    return
  }
  const res = await window.api.envTotpEnable({ id: props.env.id, secret: totpSecret.value.trim() })
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  totpSecret.value = ''
  confirmTotp.value = false
  showTotpSetup.value = false
  pushToast('success', 'TOTP 已启用')
  emit('saved')
}

async function showCode(): Promise<void> {
  const res = await window.api.envTotpCode({ id: props.env.id })
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  code.value = res.data.code
  expiresAt.value = res.data.expiresAt
}

async function clearTotp(): Promise<void> {
  if (!window.confirm('将删除本机保存的 TOTP 密钥，此操作不可恢复。')) return
  const res = await window.api.envTotpClear({ id: props.env.id })
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  code.value = null
  expiresAt.value = null
  pushToast('success', 'TOTP 已清除')
  emit('saved')
}
</script>

<template>
  <Modal
    title="账号安全"
    :busy="busy"
    confirm-text="保存状态"
    @confirm="save"
    @cancel="emit('close')"
  >
    <div class="form">
      <label class="field">
        <span>两步验证</span>
        <select v-model="status.twoStepVerification">
          <option v-for="option in securityOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>已配置验证方式数量</span>
        <input v-model.number="status.verificationMethodCount" type="number" min="0" step="1" />
      </label>
      <div class="grid2">
        <label class="field">
          <span>手机号绑定</span>
          <select v-model="status.phoneLinked">
            <option v-for="option in securityOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>登录提醒</span>
          <select v-model="status.loginAlertsEnabled">
            <option v-for="option in securityOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
      </div>
      <label class="check">
        <input v-model="status.reVerificationRequired" type="checkbox" />
        <span>平台要求重新验证</span>
      </label>
      <label class="check">
        <input
          :checked="status.unknownDevicesReviewedAt !== null"
          type="checkbox"
          @change="
            status.unknownDevicesReviewedAt = ($event.target as HTMLInputElement).checked
              ? Date.now()
              : null
          "
        />
        <span>已清理未知设备</span>
      </label>

      <div class="totp">
        <div class="totp__head">
          <strong>动态验证码（可选）</strong>
          <span>{{ env.hasTotpSecret ? '已启用' : '未启用' }}</span>
        </div>
        <p class="hint">
          只有店铺使用验证器 App 时才需要。默认不保存；启用后会加密保存在这台电脑。
        </p>
        <template v-if="env.hasTotpSecret">
          <button class="btn" type="button" @click="showCode">显示动态验证码</button>
          <p v-if="codeText" class="code" aria-live="polite">{{ codeText }}</p>
          <button class="btn btn--danger" type="button" @click="clearTotp">
            删除本机验证码设置
          </button>
        </template>
        <template v-else>
          <button class="btn" type="button" @click="showTotpSetup = !showTotpSetup">
            启用本机动态验证码
          </button>
          <div v-if="showTotpSetup" class="totp__setup">
            <input
              v-model="totpSecret"
              type="password"
              placeholder="验证器 App 的设置密钥"
              autocomplete="off"
            />
            <label class="check">
              <input v-model="confirmTotp" type="checkbox" />
              <span>我确认只在自己的电脑保存，删除环境时会一并删除</span>
            </label>
            <button class="btn" type="button" @click="enableTotp">确认启用</button>
          </div>
        </template>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #4b5563;
  font-size: 13px;
}
.field input,
.field select,
.totp__setup input {
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
.check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #4b5563;
  font-size: 13px;
  line-height: 1.4;
}
.totp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}
.totp__head {
  display: flex;
  justify-content: space-between;
  color: #374151;
  font-size: 13px;
}
.hint {
  margin: 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.totp__setup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.btn {
  align-self: flex-start;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  padding: 6px 9px;
  color: #374151;
  font-size: 12px;
  cursor: pointer;
}
.btn--danger {
  color: #b42318;
}
.code {
  margin: 0;
  color: #111827;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 15px;
  font-weight: 700;
}
</style>
