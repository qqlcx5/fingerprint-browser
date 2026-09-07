/**
 * 代理密码加密封装（02-T4，需求文档 §8）
 *
 * - 首选 Electron safeStorage（DPAPI / Keychain），密文入库
 * - safeStorage 不可用时降级为机器级混淆（XOR，密钥绑定本机 hostname + 本用户
 *   userData 路径，拷库到别的机器无法解出），返回值带 weak:true 供界面明确提示
 * - 明文仅限主进程内存：06/07 在启动与代理测试时经 decryptSecret 取用，
 *   不回传渲染层、不落日志（logger 侧另有脱敏兜底）
 */
import { createHash } from 'crypto'
import { hostname } from 'os'
import { app, safeStorage } from 'electron'
import { getLogger } from './logger'

/** 加密结果：payload 为入库字符串（base64 包 JSON），weak=true 表示降级混淆 */
export interface SealedSecret {
  payload: string
  weak: boolean
}

const FORMAT_VERSION = 1

function strongAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 机器级混淆密钥：本机 + 本用户作用域，跨机器拷贝数据不可解 */
function machineKey(): Buffer {
  return createHash('sha256')
    .update(`${hostname()}\u0000${app.getPath('userData')}`)
    .digest()
}

function mask(data: Buffer): Buffer {
  const key = machineKey()
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length]
  }
  return out
}

function encode(weak: boolean, data: Buffer): string {
  const body = JSON.stringify({ v: FORMAT_VERSION, weak, d: data.toString('base64') })
  return Buffer.from(body, 'utf8').toString('base64')
}

function decode(payload: string): { weak: boolean; data: Buffer } {
  let body: { v?: number; weak?: boolean; d?: string }
  try {
    body = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as typeof body
  } catch {
    throw new Error('SECRET_FORMAT: 密文格式无法解析')
  }
  if (body.v !== FORMAT_VERSION || typeof body.d !== 'string') {
    throw new Error('SECRET_FORMAT: 未知密文版本')
  }
  return { weak: body.weak === true, data: Buffer.from(body.d, 'base64') }
}

/** 加密明文。safeStorage 可用走系统加密；否则降级机器级混淆并记日志（§8） */
export function encryptSecret(plain: string): SealedSecret {
  if (strongAvailable()) {
    try {
      return { payload: encode(false, safeStorage.encryptString(plain)), weak: false }
    } catch (e) {
      getLogger().warn('secret.strong-encrypt-failed', {
        reason: e instanceof Error ? e.message : String(e),
        fallback: '降级机器级混淆'
      })
    }
  }
  getLogger().warn('secret.weak-encryption', {
    reason: 'safeStorage 不可用，代理密码降级为机器级混淆（§8 需提示用户）'
  })
  return { payload: encode(true, mask(Buffer.from(plain, 'utf8'))), weak: true }
}

/** 解密回明文。明文仅限主进程内存使用，禁止入库/回传/落日志 */
export function decryptSecret(sealed: SealedSecret): string {
  const { weak, data } = decode(sealed.payload)
  if (weak) {
    return mask(data).toString('utf8')
  }
  try {
    return safeStorage.decryptString(data)
  } catch (e) {
    // 常见原因：密文在本机制成但系统凭据已变（重装/迁移）
    throw new Error(`SECRET_DECRYPT_FAILED: ${e instanceof Error ? e.message : String(e)}`)
  }
}
