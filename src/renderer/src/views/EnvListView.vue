<script setup lang="ts">
import {
  FileDown,
  FilePlus2,
  FileText,
  FileUp,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2
} from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useEnvs } from '../composables/useEnvs'
import { errorText, pushToast, unwrap } from '../lib/toast'
import type { CountryChangeInfo, Env, EnvSummary, SecurityTodo } from '@shared/types'
import StatusBadge from '../components/StatusBadge.vue'
import FingerprintModal from '../components/FingerprintModal.vue'
import EnvFormModal from '../components/EnvFormModal.vue'
import CountryChangeModal from '../components/CountryChangeModal.vue'
import SecurityModal from '../components/SecurityModal.vue'
import ProxyCsvModal from '../components/ProxyCsvModal.vue'
import ProxyRebindModal from '../components/ProxyRebindModal.vue'
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
const fingerprinting = ref<Env | null>(null)
const securing = ref<Env | null>(null)
const showProxyCsv = ref(false)
const rebinding = ref<Env | null>(null)
const deleting = ref<EnvSummary | null>(null)
const countryChange = ref<CountryChangeInfo | null>(null)
const securityTodo = ref<SecurityTodo | null>(null)
const busyId = ref<string | null>(null)
const query = ref('')
const groupFilter = ref('')
const selectedIds = ref<string[]>([])
const bulkDeletePending = ref(false)
const showLogs = ref(false)
const logLines = ref<string[]>([])
const startupEnabled = ref(false)

const groups = computed(() =>
  [...new Set(rows.value.map((row) => row.group).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
)
const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    const matchesGroup = !groupFilter.value || row.group === groupFilter.value
    const haystack =
      `${row.name} ${row.remark} ${row.group} ${row.shop.site} ${row.shop.shopIdentifier} ${row.shop.roleNote} ${row.proxySummary ?? ''} ${row.expectedEgressIp ?? ''} ${row.egressCountry ?? ''}`.toLowerCase()
    return matchesGroup && (!q || haystack.includes(q))
  })
})
const allVisibleSelected = computed(
  () =>
    filteredRows.value.length > 0 &&
    filteredRows.value.every((row) => selectedIds.value.includes(row.id))
)

onMounted(async () => {
  const res = await window.api.appStartupGet()
  if (res.ok) startupEnabled.value = res.data.enabled
})

async function toggleStartup(): Promise<void> {
  const res = await window.api.appStartupSet({ enabled: !startupEnabled.value })
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  startupEnabled.value = res.data.enabled
  pushToast('success', startupEnabled.value ? '已开启开机启动' : '已关闭开机启动')
}

function fmtTime(ts: number | null): string {
  if (!ts) return '从未启动'
  return new Date(ts).toLocaleString()
}

function openCreate(): void {
  editing.value = null
  showForm.value = true
}

// 编辑需要完整 Env，先 envGet 取详情。
async function openEdit(env: EnvSummary): Promise<void> {
  const detail = await unwrap(window.api.envGet({ id: env.id }))
  if (detail) {
    editing.value = detail
    showForm.value = true
  }
}

async function openFingerprint(env: EnvSummary): Promise<void> {
  const detail = await unwrap(window.api.envGet({ id: env.id }))
  if (detail) fingerprinting.value = detail
}

async function openSecurity(env: EnvSummary): Promise<void> {
  const detail = await unwrap(window.api.envGet({ id: env.id }))
  if (detail) securing.value = detail
}

async function openRebind(env: EnvSummary): Promise<void> {
  const detail = await unwrap(window.api.envGet({ id: env.id }))
  if (detail) rebinding.value = detail
}

async function onStart(env: EnvSummary): Promise<void> {
  busyId.value = env.id
  const res = await window.api.envStart({ id: env.id })
  busyId.value = null
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  if (res.data.countryChanged) countryChange.value = res.data.countryChanged
  if (Object.values(res.data.securityTodo).some(Boolean)) {
    securityTodo.value = res.data.securityTodo
  }
  if (!res.data.countryChanged && !Object.values(res.data.securityTodo).some(Boolean)) {
    pushToast('success', `「${env.name}」已启动`)
  }
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

function toggleAllVisible(): void {
  selectedIds.value = allVisibleSelected.value
    ? selectedIds.value.filter((id) => !filteredRows.value.some((row) => row.id === id))
    : [...new Set([...selectedIds.value, ...filteredRows.value.map((row) => row.id)])]
}

async function transfer(kind: 'export' | 'import'): Promise<void> {
  const res = kind === 'export' ? await window.api.envExport() : await window.api.envImport()
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  if (res.data.path) {
    pushToast('success', `${kind === 'export' ? '已导出' : '已导入'} ${res.data.count} 个环境`)
  }
  if (kind === 'import' && res.data.count) await refresh()
}

async function openLogs(): Promise<void> {
  const res = await window.api.appLogs()
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  logLines.value = res.data.lines
  showLogs.value = true
}

async function deleteSelected(): Promise<boolean> {
  const ids = [...selectedIds.value]
  for (const id of ids) {
    const res = await window.api.envDelete({ id })
    if (!res.ok) {
      pushToast('error', errorText(res.error))
      return false
    }
  }
  selectedIds.value = []
  pushToast('success', `已删除 ${ids.length} 个环境`)
  await refresh()
  return true
}

async function confirmBulkDelete(): Promise<void> {
  if (await deleteSelected()) bulkDeletePending.value = false
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
          size="icon-xs"
          :title="startupEnabled ? '关闭开机启动' : '开启开机启动'"
          :aria-label="startupEnabled ? '关闭开机启动' : '开启开机启动'"
          :class="startupEnabled ? 'startup-on' : ''"
          @click="toggleStartup"
        >
          <Power aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          title="查看日志"
          aria-label="查看日志"
          @click="openLogs"
        >
          <FileText aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          title="批量导入代理并创建环境"
          aria-label="批量导入代理并创建环境"
          @click="showProxyCsv = true"
        >
          <FilePlus2 aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          title="导入环境配置"
          aria-label="导入环境配置"
          @click="transfer('import')"
        >
          <FileUp aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-xs"
          title="导出环境配置"
          aria-label="导出环境配置"
          @click="transfer('export')"
        >
          <FileDown aria-hidden="true" />
        </Button>
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

    <div v-else class="list-tools">
      <input v-model="query" class="search" type="search" placeholder="搜索名称、备注或代理" />
      <select v-model="groupFilter" class="group-filter">
        <option value="">全部分组</option>
        <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
      </select>
      <Button
        v-if="selectedIds.length"
        variant="outline"
        size="sm"
        class="bulk-delete"
        @click="bulkDeletePending = true"
      >
        <Trash2 aria-hidden="true" />
        删除 {{ selectedIds.length }} 项
      </Button>
    </div>

    <div v-if="!loading && rows.length === 0" class="empty">
      <div class="empty__icon"><ShieldAlert aria-hidden="true" /></div>
      <p class="empty__title">还没有环境</p>
      <p class="muted">创建独立环境来分离浏览器数据、代理和指纹。</p>
      <Button size="sm" @click="openCreate">
        <Plus aria-hidden="true" />
        创建第一个环境
      </Button>
    </div>

    <div v-else-if="rows.length" class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="select-col">
              <input type="checkbox" :checked="allVisibleSelected" @change="toggleAllVisible" />
            </th>
            <th>名称</th>
            <th>店铺</th>
            <th>代理出口</th>
            <th>安全</th>
            <th>状态</th>
            <th>最后启动</th>
            <th class="th-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filteredRows" :key="e.id">
            <td class="select-col">
              <input
                v-model="selectedIds"
                type="checkbox"
                :value="e.id"
                :disabled="e.status !== 'idle'"
              />
            </td>
            <td>
              <div class="name">{{ e.name }}</div>
              <div v-if="e.group" class="group">{{ e.group }}</div>
              <div v-if="e.remark" class="remark">{{ e.remark }}</div>
            </td>
            <td>
              <div class="mono">{{ e.shop.site }}</div>
              <div v-if="e.shop.shopIdentifier" class="remark">{{ e.shop.shopIdentifier }}</div>
              <div v-if="e.shop.roleNote" class="remark">{{ e.shop.roleNote }}</div>
            </td>
            <td>
              <span v-if="e.proxySummary" class="mono">{{ e.proxySummary }}</span>
              <span v-else class="direct">未绑定</span>
              <div v-if="e.expectedEgressIp" class="remark">
                {{ e.expectedEgressIp }}{{ e.egressCountry ? ` · ${e.egressCountry}` : '' }}
              </div>
              <div v-if="e.verifiedAt" class="remark">验证：{{ fmtTime(e.verifiedAt) }}</div>
            </td>
            <td>
              <span
                :class="[
                  'security',
                  e.securityStatus.reVerificationRequired ? 'security--warning' : ''
                ]"
              >
                {{
                  e.securityStatus.reVerificationRequired
                    ? '需重新验证'
                    : `2SV：${e.securityStatus.twoStepVerification}`
                }}
              </span>
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
                  :aria-label="`重新绑定代理：${e.name}`"
                  :title="`重新绑定代理：${e.name}`"
                  @click="openRebind(e)"
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  :disabled="e.status !== 'idle'"
                  :aria-label="`管理账号安全：${e.name}`"
                  :title="`管理账号安全：${e.name}`"
                  @click="openSecurity(e)"
                >
                  <ShieldCheck aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  :disabled="e.status !== 'idle'"
                  :aria-label="`编辑核心指纹：${e.name}`"
                  :title="`编辑核心指纹：${e.name}`"
                  @click="openFingerprint(e)"
                >
                  <SlidersHorizontal aria-hidden="true" />
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

    <Modal
      v-if="securityTodo"
      title="账号安全待办"
      confirm-text="知道了"
      @confirm="securityTodo = null"
      @cancel="securityTodo = null"
    >
      <p>环境已启动。请在 TikTok Shop Seller Center 完成以下项目：</p>
      <ul class="todo-list">
        <li v-if="securityTodo.twoStepVerification">启用两步验证</li>
        <li v-if="securityTodo.phoneLinked">绑定手机号</li>
        <li v-if="securityTodo.loginAlertsEnabled">开启登录提醒</li>
        <li v-if="securityTodo.reVerificationRequired">完成平台要求的重新验证</li>
      </ul>
    </Modal>
    <Modal
      v-if="bulkDeletePending"
      title="确认批量删除"
      danger
      confirm-text="删除选中环境"
      @confirm="confirmBulkDelete"
      @cancel="bulkDeletePending = false"
    >
      <p>将删除 {{ selectedIds.length }} 个环境的配置与浏览数据，无法恢复。</p>
    </Modal>
    <Modal
      v-if="showLogs"
      title="运行日志"
      confirm-text="关闭"
      @confirm="showLogs = false"
      @cancel="showLogs = false"
    >
      <pre class="logs">{{ logLines.join('\n') || '暂无日志' }}</pre>
    </Modal>
    <FingerprintModal
      v-if="fingerprinting"
      :env="fingerprinting"
      @close="fingerprinting = null"
      @saved="refresh"
    />
    <EnvFormModal v-if="showForm" :env="editing" @close="showForm = false" @saved="refresh" />
    <ProxyCsvModal v-if="showProxyCsv" @close="showProxyCsv = false" @saved="refresh" />
    <ProxyRebindModal
      v-if="rebinding"
      :env="rebinding"
      @close="rebinding = null"
      @saved="refresh"
    />
    <SecurityModal v-if="securing" :env="securing" @close="securing = null" @saved="refresh" />
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
.row-actions,
.list-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.list-tools {
  margin-bottom: 12px;
}
.search,
.group-filter {
  height: 32px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  padding: 0 10px;
  color: #374151;
  font-size: 13px;
}
.search {
  width: min(300px, 100%);
}
.bulk-delete {
  color: #b42318;
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
.select-col {
  width: 36px;
  padding-right: 0 !important;
  text-align: center !important;
}
.select-col input {
  accent-color: #111827;
}
.group {
  display: inline-block;
  margin-top: 4px;
  border-radius: 4px;
  background: #f3f4f6;
  padding: 1px 5px;
  color: #6b7280;
  font-size: 11px;
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
.security {
  color: #4b5563;
  font-size: 12px;
  white-space: nowrap;
}
.security--warning {
  color: #b42318;
  font-weight: 600;
}
.todo-list {
  margin: 8px 0 0;
  padding-left: 20px;
  color: #4b5563;
  line-height: 1.8;
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
.startup-on {
  border-color: #16a34a;
  color: #15803d;
}
.logs {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #111827;
  padding: 12px;
  color: #d1d5db;
  font:
    12px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  white-space: pre-wrap;
  word-break: break-word;
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
