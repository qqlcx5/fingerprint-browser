<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProxyBindingInput, ProxyImportPreview } from '@shared/types'
import { errorText, pushToast } from '../lib/toast'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: []; saved: [] }>()

interface CsvRow {
  rowNumber: number
  binding: ProxyBindingInput
}

const csv = ref('type,host,port,username,password,networkClass\n')
const group = ref('')
const site = ref('US')
const roleNote = ref('')
const namePrefix = ref('店铺环境')
const preview = ref<ProxyImportPreview | null>(null)
const rows = ref<CsvRow[]>([])
const selected = ref<number[]>([])
const previewing = ref(false)
const creating = ref(false)

const readyRows = computed(
  () =>
    preview.value?.rows.filter((row) => row.egress && !row.error && !row.conflictsWithEnvId) ?? []
)

async function loadFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  csv.value = await file.text()
  preview.value = null
  selected.value = []
}

function parseRows(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const expected = 'type,host,port,username,password,networkClass'
  if (lines[0] !== expected) throw new Error(`CSV 表头必须为：${expected}`)
  return lines.slice(1).map((line, index) => {
    const [type, host, rawPort, username, password, networkClass] = line
      .split(',')
      .map((value) => value.trim())
    if (line.split(',').length !== 6)
      throw new Error(`第 ${index + 2} 行字段数量不正确，不支持包含逗号的字段`)
    return {
      rowNumber: index + 2,
      binding: {
        config: {
          type: type as ProxyBindingInput['config']['type'],
          host,
          port: Number(rawPort),
          ...(username ? { username } : {}),
          ...(password ? { password } : {})
        },
        networkClass: networkClass as ProxyBindingInput['networkClass']
      }
    }
  })
}

async function runPreview(): Promise<void> {
  try {
    rows.value = parseRows(csv.value)
  } catch (error) {
    pushToast('error', error instanceof Error ? error.message : String(error))
    return
  }
  previewing.value = true
  const res = await window.api.proxyCsvPreview({ csv: csv.value })
  previewing.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  preview.value = res.data
  selected.value = readyRows.value.map((row) => row.rowNumber)
}

async function createEnvs(): Promise<void> {
  const picked = rows.value.filter((row) => selected.value.includes(row.rowNumber))
  if (!picked.length) {
    pushToast('error', '请选择至少一条预检通过的代理')
    return
  }
  if (!namePrefix.value.trim()) {
    pushToast('error', '请填写环境名称前缀')
    return
  }
  creating.value = true
  const res = await window.api.envBatchCreate({
    group: group.value.trim(),
    shop: { site: site.value.trim() || 'UNKNOWN', roleNote: roleNote.value.trim() },
    items: picked.map((row, index) => ({
      name: `${namePrefix.value.trim()}-${String(index + 1).padStart(2, '0')}`,
      shopIdentifier: `batch-${row.rowNumber}`,
      proxyBinding: row.binding
    }))
  })
  creating.value = false
  if (!res.ok) {
    pushToast('error', errorText(res.error))
    return
  }
  pushToast('success', `已创建 ${res.data.length} 个环境`)
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal
    title="批量导入代理并创建环境"
    :busy="creating"
    confirm-text="创建环境"
    @confirm="createEnvs"
    @cancel="emit('close')"
  >
    <div class="form">
      <div class="grid2">
        <label class="field"><span>名称前缀</span><input v-model="namePrefix" type="text" /></label>
        <label class="field"><span>站点</span><input v-model="site" type="text" /></label>
      </div>
      <div class="grid2">
        <label class="field"><span>分组</span><input v-model="group" type="text" /></label>
        <label class="field"><span>角色备注</span><input v-model="roleNote" type="text" /></label>
      </div>
      <label class="field"
        ><span>CSV 文件</span><input type="file" accept=".csv,text/csv" @change="loadFile"
      /></label>
      <label class="field"
        ><span>CSV 内容</span><textarea v-model="csv" rows="7" spellcheck="false" />
      </label>
      <button class="btn" type="button" :disabled="previewing" @click="runPreview">
        {{ previewing ? '预检中...' : '预检代理' }}
      </button>
      <div v-if="preview" class="preview">
        <p>可创建 {{ readyRows.length }} / {{ preview.rows.length }} 条</p>
        <label v-for="row in preview.rows" :key="row.rowNumber" class="row">
          <input
            v-if="row.egress && !row.error && !row.conflictsWithEnvId"
            v-model="selected"
            type="checkbox"
            :value="row.rowNumber"
          />
          <span>第 {{ row.rowNumber }} 行</span>
          <span>{{ row.proxySummary ?? '格式错误' }}</span>
          <span v-if="row.egress">{{ row.egress.ip }} · {{ row.egress.country }}</span>
          <span v-if="row.error || row.conflictsWithEnvId" class="error">{{
            row.error?.message ?? `已绑定到 ${row.conflictsWithEnvId}`
          }}</span>
        </label>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #4b5563;
  font-size: 13px;
}
.field input,
.field textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}
.field textarea {
  font-family: ui-monospace, SFMono-Regular, monospace;
  resize: vertical;
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
.preview {
  display: flex;
  max-height: 180px;
  flex-direction: column;
  gap: 5px;
  overflow: auto;
  border-top: 1px solid #e5e7eb;
  padding-top: 8px;
  font-size: 12px;
}
.preview p {
  margin: 0;
  color: #4b5563;
}
.row {
  display: grid;
  grid-template-columns: auto 58px minmax(100px, 1fr) minmax(100px, 1fr);
  gap: 6px;
  align-items: center;
}
.error {
  grid-column: 3 / -1;
  color: #b42318;
}
</style>
