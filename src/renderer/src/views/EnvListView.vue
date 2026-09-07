<script setup lang="ts">
import { ref } from 'vue'
import { useEnvs } from '../composables/useEnvs'
import { errorText, pushToast, unwrap } from '../lib/toast'
import type { CountryChangeInfo, Env, EnvSummary } from '@shared/types'
import StatusBadge from '../components/StatusBadge.vue'
import EnvFormModal from '../components/EnvFormModal.vue'
import CountryChangeModal from '../components/CountryChangeModal.vue'
import Modal from '../components/Modal.vue'

const {
  rows,
  loading,
  refresh
  // 崩溃（06-T6）→ 通知栏（08-T9）
} = useEnvs((info) => {
  pushToast('error', `环境进程异常退出（${info.envId.slice(0, 8)}…），已回退为空闲；详情见日志`)
})

// 弹窗状态
const showForm = ref(false)
const editing = ref<Env | null>(null)
const deleting = ref<EnvSummary | null>(null)
const countryChange = ref<CountryChangeInfo | null>(null)
const busyId = ref<string | null>(null)

function fmtTime(ts: number | null): string {
  if (!ts) return '从未启动'
  return new Date(ts).toLocaleString()
}

function openCreate(): void {
  editing.value = null
  showForm.value = true
}

// 编辑需要完整 Env（含 hasPassword 标记），列表行只有摘要 → 先 envGet 取详情
async function openEdit(env: EnvSummary): Promise<void> {
  const detail = await unwrap(window.api.envGet({ id: env.id }))
  if (detail) {
    editing.value = detail
    showForm.value = true
  }
}

async function onStart(env: EnvSummary): Promise<void> {
  busyId.value = env.id
  const res = await window.api.envStart({ id: env.id })
  busyId.value = null
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  if (res.data)
    countryChange.value = res.data // §6.5 确认流
  else pushToast('success', `「${env.name}」已启动`)
  await refresh()
}

async function onStop(env: EnvSummary): Promise<void> {
  busyId.value = env.id
  await unwrap(window.api.envStop({ id: env.id }))
  busyId.value = null
  await refresh()
}

async function onDelete(): Promise<void> {
  const env = deleting.value
  if (!env) return
  busyId.value = env.id
  // 全清入口（08-T10）：走 app:wipeData（停全部环境 → 删 db+envs，内核/日志保留）
  const ok =
    env.id === '__all__'
      ? await unwrap(window.api.appWipeData()).then((r) => (r !== null ? r : null))
      : await unwrap(window.api.envDelete({ id: env.id }))
  busyId.value = null
  deleting.value = null
  if (ok !== null) {
    pushToast('success', env.id === '__all__' ? '已彻底清除全部环境数据' : `「${env.name}」已删除`)
    await refresh()
  }
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <h1>环境列表</h1>
      <div class="page__actions">
        <button
          class="btn"
          type="button"
          :disabled="rows.length === 0"
          title="清除全部环境数据（内核与日志保留）"
          @click="deleting = { id: '__all__', name: '全部环境数据' } as unknown as EnvSummary"
        >
          <span class="icon-[lucide--trash-2]"></span>
          彻底清除数据
        </button>
        <button class="btn btn--primary" type="button" @click="openCreate">
          <span class="icon-[lucide--plus]"></span>
          创建环境
        </button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>

    <div v-else-if="rows.length === 0" class="empty">
      <p>还没有环境。</p>
      <p class="muted">每个环境 = 独立浏览器数据 + 独立代理 + 独立指纹，互不串号。</p>
      <button class="btn btn--primary" type="button" @click="openCreate">
        <span class="icon-[lucide--plus]"></span>
        创建第一个环境
      </button>
    </div>

    <table v-else class="table">
      <thead>
        <tr>
          <th>名称</th>
          <th>代理</th>
          <th>状态</th>
          <th>最后启动</th>
          <th class="th-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in rows" :key="e.id">
          <td>
            <div class="name">{{ e.name }}</div>
            <div v-if="e.remark" class="remark">{{ e.remark }}</div>
          </td>
          <td>
            <span v-if="e.proxySummary" class="mono">{{ e.proxySummary }}</span>
            <span v-else class="direct">直连</span>
          </td>
          <td><StatusBadge :status="e.status" /></td>
          <td class="muted">{{ fmtTime(e.lastLaunchedAt) }}</td>
          <td class="th-actions">
            <button
              v-if="e.status === 'idle'"
              class="btn btn--primary btn--sm"
              type="button"
              :disabled="busyId === e.id"
              @click="onStart(e)"
            >
              <span class="icon-[lucide--play]"></span>
              启动
            </button>
            <button
              v-else-if="e.status === 'running'"
              class="btn btn--sm"
              type="button"
              :disabled="busyId === e.id"
              @click="onStop(e)"
            >
              <span class="icon-[lucide--square]"></span>
              停止
            </button>
            <span v-else class="muted">…</span>
            <button
              class="btn btn--sm"
              type="button"
              :disabled="e.status !== 'idle'"
              @click="openEdit(e)"
            >
              <span class="icon-[lucide--pencil]"></span>
              编辑
            </button>
            <button
              class="btn btn--sm btn--danger-ghost"
              type="button"
              :disabled="e.status !== 'idle'"
              @click="deleting = e"
            >
              <span class="icon-[lucide--trash-2]"></span>
              删除
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <EnvFormModal v-if="showForm" :env="editing" @close="showForm = false" @saved="refresh" />
    <CountryChangeModal v-if="countryChange" :info="countryChange" @done="countryChange = null" />
    <Modal
      v-if="deleting"
      title="确认删除"
      danger
      confirm-text="删除"
      :busy="busyId === deleting.id"
      @confirm="onDelete"
      @cancel="deleting = null"
    >
      <template v-if="deleting.id === '__all__'">
        <p>将删除<strong>全部环境</strong>的配置与浏览数据（登录态、Cookie、下载），不可恢复。</p>
        <p class="muted">浏览器内核与日志会保留。</p>
      </template>
      <template v-else>
        <p>
          删除环境「<strong>{{ deleting.name }}</strong
          >」？
        </p>
        <p>其配置与浏览数据（登录态、Cookie、下载文件）将一并删除，<strong>不可恢复</strong>。</p>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
h1 {
  font-size: 18px;
  margin: 0;
}
.page__actions {
  display: flex;
  gap: 8px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
}
.table th,
.table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: top;
}
.table th {
  color: #6b7280;
  font-weight: 500;
  background: #f9fafb;
}
.th-actions {
  text-align: right;
  white-space: nowrap;
}
.th-actions .btn {
  margin-left: 6px;
}
.name {
  font-weight: 600;
}
.remark {
  color: #9ca3af;
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.direct {
  color: #b45309;
  font-size: 12px;
}
.empty {
  text-align: center;
  padding: 48px 0;
  background: #fff;
  border: 1px dashed #d1d5db;
  border-radius: 10px;
}
.muted {
  color: #9ca3af;
  font-size: 12px;
}
</style>
