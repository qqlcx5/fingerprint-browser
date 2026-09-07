import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import type { EnvTransfer, PublicProxyConfig } from '../../shared/types'
import { createEnvWithDirs, getEnvDao, toPublicProxy, type EnvRecord } from '../db'

function exportRecord(record: EnvRecord): EnvTransfer['environments'][number] {
  return {
    name: record.name,
    remark: record.remark,
    group: record.group,
    fingerprint: record.fingerprint,
    alignFields: record.alignFields,
    proxyConfig: record.proxyConfig ? toPublicProxy(record.proxyConfig) : null
  }
}

function parseTransfer(text: string): EnvTransfer {
  const parsed = JSON.parse(text) as Partial<EnvTransfer>
  if (parsed.version !== 1 || !Array.isArray(parsed.environments)) {
    throw new Error('导入文件格式无效')
  }
  for (const item of parsed.environments) {
    if (!item || typeof item.name !== 'string' || !item.fingerprint || !item.alignFields) {
      throw new Error('导入文件含无效环境配置')
    }
  }
  return parsed as EnvTransfer
}

export async function exportEnvs(): Promise<{ count: number; path: string | null }> {
  const result = await dialog.showSaveDialog({
    title: '导出环境配置',
    defaultPath: 'fingerprint-browser-envs.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { count: 0, path: null }
  const transfer: EnvTransfer = {
    version: 1,
    environments: getEnvDao().listEnvs().map(exportRecord)
  }
  writeFileSync(result.filePath, `${JSON.stringify(transfer, null, 2)}\n`, 'utf8')
  return { count: transfer.environments.length, path: result.filePath }
}

export async function importEnvs(): Promise<{ count: number; path: string | null }> {
  const result = await dialog.showOpenDialog({
    title: '导入环境配置',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return { count: 0, path: null }
  const transfer = parseTransfer(readFileSync(filePath, 'utf8'))
  const dao = getEnvDao()
  for (const item of transfer.environments) {
    const proxyConfig = item.proxyConfig
      ? toImportProxy(item.proxyConfig)
      : null
    createEnvWithDirs(dao, {
      name: item.name.trim(),
      remark: item.remark ?? '',
      group: item.group ?? '',
      fingerprint: item.fingerprint,
      alignFields: item.alignFields,
      proxyConfig
    })
  }
  return { count: transfer.environments.length, path: filePath }
}

function toImportProxy(proxy: PublicProxyConfig) {
  return {
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    ...(proxy.username ? { username: proxy.username } : {})
  }
}
