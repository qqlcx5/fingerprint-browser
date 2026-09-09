import type {
  AppError,
  EgressInfo,
  ProxyBinding,
  ProxyBindingInput,
  ProxyConfig,
  ProxyCsvPreviewInput,
  ProxyImportPreview,
  ProxyImportPreviewRow,
  ProxyNetworkClass
} from '../../shared/types'
import { getEnvDao, type StoredProxyBinding } from '../db'
import { toAppError } from '../ipc'
import { testEgress } from './testEgress'
import { validateProxyConfig } from './validate'

const NETWORK_CLASSES: readonly ProxyNetworkClass[] = [
  'static_residential',
  'sticky_residential',
  'isp'
]

export function validateProxyBindingInput(input: unknown): ProxyBindingInput {
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('代理绑定不能为空'), { code: 'VALIDATION' })
  }
  const value = input as { config?: unknown; networkClass?: unknown }
  const config = validateProxyConfig(value.config)
  if (
    typeof value.networkClass !== 'string' ||
    !NETWORK_CLASSES.includes(value.networkClass as ProxyNetworkClass)
  ) {
    throw Object.assign(
      new Error('代理网络类型必须是 static_residential、sticky_residential 或 isp'),
      { code: 'VALIDATION' }
    )
  }
  return { config, networkClass: value.networkClass as ProxyNetworkClass }
}

export async function previewProxyCsv(input: ProxyCsvPreviewInput): Promise<ProxyImportPreview> {
  const parsed = parseCsv(input.csv)
  if (parsed.length < 2) {
    throw Object.assign(new Error('CSV 至少需要表头和一条代理记录'), { code: 'VALIDATION' })
  }
  const [header, ...rows] = parsed
  const fields = ['type', 'host', 'port', 'username', 'password', 'networkClass']
  if (fields.some((field, index) => header[index]?.trim() !== field)) {
    throw Object.assign(new Error(`CSV 表头必须为：${fields.join(',')}`), { code: 'VALIDATION' })
  }

  const previews: ProxyImportPreviewRow[] = await mapLimit(rows, 3, async (row, index) => {
    const rowNumber = index + 2
    try {
      const binding = validateProxyBindingInput({
        config: {
          type: row[0],
          host: row[1],
          port: Number(row[2]),
          ...(row[3] ? { username: row[3] } : {}),
          ...(row[4] ? { password: row[4] } : {})
        },
        networkClass: row[5]
      })
      const egress = await testEgress(binding.config)
      const conflict = getEnvDao().getEnvIdByEgressIp(egress.ip)
      return {
        rowNumber,
        proxySummary: summary(binding.config),
        networkClass: binding.networkClass,
        egress,
        error: null,
        conflictsWithEnvId: conflict
      }
    } catch (error) {
      return {
        rowNumber,
        proxySummary: row?.[0] && row?.[1] && row?.[2] ? `${row[0]}://${row[1]}:${row[2]}` : null,
        networkClass: null,
        egress: null,
        error: toAppError(error),
        conflictsWithEnvId: null
      }
    }
  })
  const firstRowByIp = new Map<string, number>()
  for (const row of previews) {
    if (!row.egress || row.error || row.conflictsWithEnvId) continue
    const firstRow = firstRowByIp.get(row.egress.ip)
    if (firstRow !== undefined) {
      row.error = {
        code: 'PROXY_IP_CONFLICT',
        message: `与 CSV 第 ${firstRow} 行使用同一出口 IP ${row.egress.ip}`
      }
      continue
    }
    firstRowByIp.set(row.egress.ip, row.rowNumber)
  }
  return {
    rows: previews,
    readyCount: previews.filter((row) => row.egress && !row.error && !row.conflictsWithEnvId).length
  }
}

export async function createVerifiedBinding(
  input: ProxyBindingInput,
  changeReason: string | null
): Promise<StoredProxyBinding> {
  const binding = validateProxyBindingInput(input)
  const egress = await testEgress(binding.config)
  return {
    config: binding.config,
    networkClass: binding.networkClass,
    expectedEgressIp: egress.ip,
    country: egress.country,
    verifiedAt: Date.now(),
    changedAt: Date.now(),
    changeReason
  }
}

/** 启动前验证，不匹配时绝不更新绑定。 */
export async function verifyBoundEgress(binding: StoredProxyBinding): Promise<EgressInfo> {
  const egress = await testEgress(binding.config)
  if (egress.ip !== binding.expectedEgressIp) {
    throw Object.assign(
      new Error(`代理出口已从 ${binding.expectedEgressIp} 变为 ${egress.ip}，请完成重新绑定`),
      { code: 'PROXY_EGRESS_CHANGED' }
    )
  }
  return egress
}

export function asPublicBinding(binding: StoredProxyBinding): ProxyBinding {
  const { password: _password, ...config } = binding.config
  return { ...binding, config: { ...config, hasPassword: Boolean(_password) } }
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next++
      results[index] = await worker(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return results
}

function summary(config: ProxyConfig): string {
  return `${config.type}://${config.host}:${config.port}`
}

/** 支持双引号与转义双引号的最小 CSV 解析器，避免以 split(',') 误解析密码字段。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (char === '\n') {
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (quoted) throw Object.assign(new Error('CSV 存在未闭合的双引号'), { code: 'VALIDATION' })
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export type { AppError }
