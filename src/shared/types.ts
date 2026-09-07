/**
 * 全局共享契约（冻结文件，见 doc/tasks/parallel-plan.md §3）
 *
 * 本文件是各并行模块的"合同"：
 * - IPC 通道名常量 IPC
 * - 各通道的载荷/返回类型 IpcPayloadMap / IpcDataMap
 * - 渲染层唯一入口类型 Api
 * - 统一返回信封 Result<T>（主进程永不向渲染层 throw）
 *
 * 修改本文件必须经协调者，禁止各模块轨自行改动。
 */

// ---------- 统一信封与错误 ----------

export interface AppError {
  code: AppErrorCode
  message: string
}

export type AppErrorCode =
  | 'VALIDATION' // 参数不合法
  | 'NOT_FOUND' // 环境等资源不存在
  | 'ENV_RUNNING' // 环境运行中，禁止该操作（如删除）
  | 'ENV_NOT_IDLE' // 环境非 idle，禁止启动
  | 'KERNEL_MISSING' // 内核缺失
  | 'KERNEL_CORRUPT' // 内核校验失败
  | 'KERNEL_DOWNLOAD_FAILED' // 内核下载失败（网络等）
  | 'DISK_FULL' // 磁盘空间不足
  | 'PROXY_AUTH' // 代理认证失败
  | 'PROXY_TIMEOUT' // 代理连接超时
  | 'PROXY_DNS' // 代理 DNS 解析失败
  | 'PROXY_PROTOCOL' // 代理协议错误
  | 'COUNTRY_CHANGED' // 代理出口国家变化，需用户确认对齐字段
  | 'DB_CORRUPT' // 数据库损坏（已自动重建后提示）
  | 'NOT_IMPLEMENTED' // 通道已定义但模块未接线（阶段性占位）
  | 'INTERNAL' // 未分类内部错误

/** 所有 invoke 通道的统一返回信封 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

// ---------- 领域模型 ----------

export type ProxyType = 'http' | 'https' | 'socks5'

export interface ProxyConfig {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

/** 回传给渲染层的代理配置：密码永不回传（需求文档 §8） */
export type PublicProxyConfig = Omit<ProxyConfig, 'password'> & { hasPassword: boolean }

/** 代理出口信息（proxy:test 与启动前测连共用） */
export interface EgressInfo {
  ip: string
  country: string // ISO 3166-1 alpha-2，如 'US'
  latencyMs: number
}

export interface ScreenInfo {
  width: number
  height: number
  colorDepth: number
  pixelRatio: number
}

/** 核心指纹：创建后永久只读（需求文档 §6.5；运行时深冻结由 05-T3 保证） */
export interface CoreFingerprint {
  userAgent: string
  platform: string
  hardwareConcurrency: number
  deviceMemory: number
  screen: ScreenInfo
  webgl: { vendor: string; renderer: string }
  /** 生成时的目标地区语言基线，如 'en-US' */
  locale: string
}

export type ReadonlyCoreFingerprint = Readonly<CoreFingerprint>

/** 对齐字段：跟随代理出口地区，可经确认流更新（需求文档 §6.5） */
export interface AlignFields {
  /** IANA 时区，如 'America/New_York' */
  timezone: string
  /** Accept-Language 首选，如 'en-US' */
  language: string
  geolocation: { latitude: number; longitude: number } | null
}

export type EnvStatus = 'idle' | 'starting' | 'running' | 'stopping'
export type EnvStatusMap = Record<string, EnvStatus>

export interface Env {
  id: string
  name: string
  remark: string
  fingerprint: ReadonlyCoreFingerprint
  alignFields: AlignFields
  proxyConfig: PublicProxyConfig | null
  createdAt: number
  updatedAt: number
  lastLaunchedAt: number | null
}

/** 环境列表行（env:list：DB 记录 join 内存运行态） */
export interface EnvSummary {
  id: string
  name: string
  remark: string
  status: EnvStatus
  /** 如 'socks5://1.2.3.4:1080'；无代理（直连）为 null */
  proxySummary: string | null
  lastLaunchedAt: number | null
}

export interface EnvCreateInput {
  name: string
  remark?: string
  proxyConfig?: ProxyConfig | null
}

export interface EnvUpdateInput {
  id: string
  name?: string
  remark?: string
  proxyConfig?: ProxyConfig | null
}

export interface IdInput {
  id: string
}

/** 对齐字段确认流（需求文档 §6.5 两段式） */
export interface AlignConfirmInput {
  id: string
  /** true = 更新对齐字段；false = 保留旧对齐字段 */
  accept: boolean
}

/** 国家变化提示（env:start 返回 COUNTRY_CHANGED 场景的数据载体） */
export interface CountryChangeInfo {
  envId: string
  from: string | null
  to: string | null
}

export interface DownloadProgress {
  received: number
  total: number
}

export interface KernelInfo {
  ready: boolean
  revision: string
  path: string | null
}

/** 骨架自检通道返回（better-sqlite3 原生模块可用性） */
export interface PingInfo {
  pong: true
  version: string
  arch: string
  sqlite: boolean
}

// ---------- IPC 通道 ----------

export const IPC = {
  appPing: 'app:ping',
  envList: 'env:list',
  envCreate: 'env:create',
  envUpdate: 'env:update',
  envDelete: 'env:delete',
  envStart: 'env:start',
  envStop: 'env:stop',
  envStatus: 'env:status',
  proxyTest: 'proxy:test',
  browserEnsure: 'browser:ensure',
  alignConfirm: 'align:confirm',
  // 以下为主进程 → 渲染层事件（非 invoke）
  envStatusChanged: 'env:status-changed',
  browserDownloadProgress: 'browser:download-progress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** invoke 通道全集（registerIpc 逐一注册；事件通道不在此列） */
export const INVOKE_CHANNELS: IpcChannel[] = [
  IPC.appPing,
  IPC.envList,
  IPC.envCreate,
  IPC.envUpdate,
  IPC.envDelete,
  IPC.envStart,
  IPC.envStop,
  IPC.envStatus,
  IPC.proxyTest,
  IPC.browserEnsure,
  IPC.alignConfirm
]

export type EventChannel =
  (typeof IPC)['envStatusChanged'] | (typeof IPC)['browserDownloadProgress']

/** invoke 通道 → 载荷类型 */
export interface IpcPayloadMap {
  [IPC.appPing]: undefined
  [IPC.envList]: undefined
  [IPC.envCreate]: EnvCreateInput
  [IPC.envUpdate]: EnvUpdateInput
  [IPC.envDelete]: IdInput
  [IPC.envStart]: IdInput
  [IPC.envStop]: IdInput
  [IPC.envStatus]: undefined
  [IPC.proxyTest]: ProxyConfig
  [IPC.browserEnsure]: undefined
  [IPC.alignConfirm]: AlignConfirmInput
}

/** invoke 通道 → 返回数据类型 */
export interface IpcDataMap {
  [IPC.appPing]: PingInfo
  [IPC.envList]: EnvSummary[]
  [IPC.envCreate]: Env
  [IPC.envUpdate]: Env
  [IPC.envDelete]: { id: string }
  [IPC.envStart]: CountryChangeInfo | null // null = 直接启动成功
  [IPC.envStop]: { id: string }
  [IPC.envStatus]: EnvStatusMap
  [IPC.proxyTest]: EgressInfo
  [IPC.browserEnsure]: KernelInfo
  [IPC.alignConfirm]: { id: string }
}

// ---------- 渲染层入口 ----------

/** preload 经 contextBridge 暴露的 window.api（白名单，唯一入口） */
export interface Api {
  ping(): Promise<Result<PingInfo>>
  envList(): Promise<Result<EnvSummary[]>>
  envCreate(input: EnvCreateInput): Promise<Result<Env>>
  envUpdate(input: EnvUpdateInput): Promise<Result<Env>>
  envDelete(input: IdInput): Promise<Result<{ id: string }>>
  /** 返回 null = 直接启动成功；返回 CountryChangeInfo = 需确认对齐字段 */
  envStart(input: IdInput): Promise<Result<CountryChangeInfo | null>>
  envStop(input: IdInput): Promise<Result<{ id: string }>>
  envStatus(): Promise<Result<EnvStatusMap>>
  proxyTest(input: ProxyConfig): Promise<Result<EgressInfo>>
  browserEnsure(): Promise<Result<KernelInfo>>
  alignConfirm(input: AlignConfirmInput): Promise<Result<{ id: string }>>
  /** 订阅环境状态变化，返回取消订阅函数 */
  onStatusChanged(cb: (status: EnvStatusMap) => void): () => void
  /** 订阅内核下载进度，返回取消订阅函数 */
  onDownloadProgress(cb: (progress: DownloadProgress) => void): () => void
}
