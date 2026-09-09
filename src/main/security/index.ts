import { createHmac, randomUUID } from 'crypto'
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { SecurityStatus, TotpCode } from '../../shared/types'
import { dataRoot } from '../../shared/paths'
import { getEnvDao, getLogger } from '../db'

function secretPath(ref: string): string {
  return join(dataRoot(), 'secrets', 'totp', `${ref}.bin`)
}

function assertSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(new Error('操作系统安全存储不可用，不能管理 TOTP 密钥'), {
      code: 'SECURE_STORAGE_UNAVAILABLE'
    })
  }
}

function validBase32(secret: string): string {
  const normalized = secret.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z2-7]+=*$/.test(normalized)) {
    throw Object.assign(new Error('TOTP 密钥必须是 Base32 字符串'), { code: 'VALIDATION' })
  }
  return normalized.replace(/=+$/, '')
}

function decodeBase32(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of input) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('无效 Base32 字符')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

export function getSecurityStatus(id: string): SecurityStatus {
  const env = getEnvDao().getEnv(id)
  if (!env) throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
  return env.securityStatus
}

export function updateSecurityStatus(id: string, status: SecurityStatus): SecurityStatus {
  if (!Number.isInteger(status.verificationMethodCount) || status.verificationMethodCount < 0) {
    throw Object.assign(new Error('验证方式数量必须是非负整数'), { code: 'VALIDATION' })
  }
  const next = { ...status, lastSecurityCheckedAt: Date.now() }
  const updated = getEnvDao().updateEnv(id, { securityStatus: next })
  if (!updated) throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
  getLogger().info('security.status_updated', { id })
  return updated.securityStatus
}

/** 默认未启用；调用方必须通过显式高风险确认后才可调用。 */
export function enableTotp(id: string, secret: string): void {
  const env = getEnvDao().getEnv(id)
  if (!env) throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
  assertSafeStorage()
  const normalized = validBase32(secret)
  const ref = randomUUID()
  const path = secretPath(ref)
  mkdirSync(join(dataRoot(), 'secrets', 'totp'), { recursive: true, mode: 0o700 })
  writeFileSync(path, safeStorage.encryptString(normalized), { mode: 0o600 })
  try {
    getEnvDao().updateEnv(id, { totpSecretRef: ref })
    if (env.totpSecretRef) removeTotpRef(env.totpSecretRef)
  } catch (error) {
    rmSync(path, { force: true })
    throw error
  }
  getLogger().info('security.totp_enabled', { id })
}

export function clearTotp(id: string): void {
  const env = getEnvDao().getEnv(id)
  if (!env) throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
  if (env.totpSecretRef) removeTotpRef(env.totpSecretRef)
  getEnvDao().updateEnv(id, { totpSecretRef: null })
  getLogger().info('security.totp_cleared', { id })
}

export function clearTotpRef(ref: string | null): void {
  if (ref) removeTotpRef(ref)
}

function removeTotpRef(ref: string): void {
  rmSync(secretPath(ref), { force: true })
}

export function generateTotpCode(id: string, now = Date.now()): TotpCode {
  const env = getEnvDao().getEnv(id)
  if (!env) throw Object.assign(new Error(`环境不存在: ${id}`), { code: 'NOT_FOUND' })
  if (!env.totpSecretRef) {
    throw Object.assign(new Error('该环境尚未启用 TOTP 管理'), { code: 'TOTP_NOT_CONFIGURED' })
  }
  assertSafeStorage()
  const path = secretPath(env.totpSecretRef)
  if (!existsSync(path)) {
    throw Object.assign(new Error('TOTP 密钥已丢失，请重新配置'), { code: 'TOTP_NOT_CONFIGURED' })
  }
  const secret = safeStorage.decryptString(readFileSync(path))
  const period = 30_000
  const counter = Math.floor(now / period)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return { code: value.toString().padStart(6, '0'), expiresAt: (counter + 1) * period }
}
