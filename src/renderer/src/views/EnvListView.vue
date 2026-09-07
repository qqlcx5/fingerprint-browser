<script setup lang="ts">
import { Pencil, Play, Plus, ShieldAlert, Square, Trash2 } from '@lucide/vue'
import { ref } from 'vue'
import { useEnvs } from '../composables/useEnvs'
import { errorText, pushToast, unwrap } from '../lib/toast'
import type { CountryChangeInfo, Env, EnvSummary } from '@shared/types'
import StatusBadge from '../components/StatusBadge.vue'
import EnvFormModal from '../components/EnvFormModal.vue'
import CountryChangeModal from '../components/CountryChangeModal.vue'
import { Button } from '../components/ui/button'
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
      <div>
        <h1>环境列表</h1>
        <p class="page__sub">{{ rows.length }} 个环境</p>
      </div>
      <div class="page__actions">
        <Button
          variant="outline"
          size="sm"
          :disabled="rows.length === 0"
          title="清除全部环境数据，内核与日志保留"
          @click="deleting = { id: '__all__', name: '全部环境数据' } as unknown as EnvSummary"
        >
          <Trash2 aria-hidden="true" />
          彻底清除数据
        </Button>
        <Button size="sm" @click="openCreate">
          <Plus aria-hidden="true" />
          创建环境
        </Button>
      </div>
    </header>

    <p v-if="loading" class="muted">加载中…</p>

    <div v-else-if="rows.length === 0" class="empty">
      <div class="empty__icon"><ShieldAlert aria-hidden="true" /></div>
      <p class="empty__title">还没有环境</p>
      <p class="muted">创建独立环境来分离浏览器数据、代理和指纹。</p>
      <Button size="sm" @click="openCreate">
        <Plus aria-hidden="true" />
        创建第一个环境
      </Button>
    </div>

    <div v-else class="table-wrap">
      <table class="table">
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
              <div class="row-actions">
                <Button
                  v-if="e.status === 'idle'"
                  size="icon-xs"
                  :disabled="busyId === e.id"
                  :aria-label="`启动环境：${e.name}`"
                  :title="`启动环境：${e.name}`"
                  @click="onStart(e)"
                >
                  <Play aria-hidden="true" />
                </Button>
                <Button
                  v-else-if="e.status === 'running'"
                  variant="outline"
                  size="icon-xs"
                  :disabled="busyId === e.id"
                  :aria-label="`停止环境：${e.name}`"
                  :title="`停止环境：${e.name}`"
                  @click="onStop(e)"
                >
                  <Square aria-hidden="true" />
                </Button>
                <span v-else class="row-actions__wait" title="环境状态正在变化">…</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  :disabled="e.status !== 'idle'"
                  :aria-label="`编辑环境：${e.name}`"
                  :title="`编辑环境：${e.name}`"
                  @click="openEdit(e)"
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  :disabled="e.status !== 'idle'"
                  :aria-label="`删除环境：${e.name}`"
                  :title="`删除环境：${e.name}`"
                  class="delete-action"
                  @click="deleting = e"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
.page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 28px 24px 48px;
}
.page__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  color: #111827;
  font-size: 20px;
  line-height: 1.25;
}
.page__sub {
  margin: 4px 0 0;
  color: #6b7280;
  font-size: 12px;
}
.page__actions,
.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}
.table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  padding: 12px 14px;
  border-bottom: 1px solid #f0f1f3;
  vertical-align: middle;
}
.table tr:last-child td {
  border-bottom: 0;
}
.table th {
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  text-align: left;
  background: #fafafa;
}
.table tbody tr:hover {
  background: #fafcff;
}
.th-actions {
  width: 132px;
  text-align: right !important;
}
.th-actions .row-actions {
  justify-content: flex-end;
}
.row-actions__wait {
  display: inline-grid;
  width: 24px;
  height: 24px;
  place-items: center;
  color: #9ca3af;
}
.delete-action {
  color: #b42318;
}
.delete-action:hover:not(:disabled) {
  color: #8f1710;
  background: #fff1f0;
}
.name {
  max-width: 240px;
  overflow: hidden;
  color: #1f2937;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remark {
  max-width: 240px;
  margin-top: 2px;
  overflow: hidden;
  color: #9ca3af;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.direct {
  color: #9a6700;
  font-size: 12px;
}
.empty {
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed #d1d5db;
  border-radius: 8px;
  background: #fff;
  text-align: center;
}
.empty__icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: #fff7ed;
  color: #c2410c;
}
.empty__title {
  margin: 0;
  color: #1f2937;
  font-weight: 600;
}
.muted {
  color: #9ca3af;
  font-size: 12px;
}
@media (max-width: 640px) {
  .page {
    padding: 20px 16px 36px;
  }
  .page__head {
    align-items: stretch;
    flex-direction: column;
  }
  .page__actions {
    justify-content: space-between;
  }
}
</style>
