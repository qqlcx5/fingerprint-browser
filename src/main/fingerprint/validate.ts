import type { AlignFields, CoreFingerprint } from '../../shared/types'

export function coreFingerprintError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '核心指纹必须是对象'
  const fp = value as Partial<CoreFingerprint>
  if (typeof fp.userAgent !== 'string' || !/Chrome\/\d+/.test(fp.userAgent)) {
    return 'UA 必须是 Chrome UA'
  }
  if (typeof fp.platform !== 'string' || !fp.platform) return '平台不能为空'
  if (/Windows/i.test(fp.userAgent) && fp.platform !== 'Win32')
    return 'Windows UA 必须使用 Win32 平台'
  if (/Mac OS X|Macintosh/i.test(fp.userAgent) && fp.platform !== 'MacIntel') {
    return 'macOS UA 必须使用 MacIntel 平台'
  }
  const hardwareConcurrency = fp.hardwareConcurrency
  if (
    !Number.isInteger(hardwareConcurrency) ||
    hardwareConcurrency === undefined ||
    hardwareConcurrency < 1 ||
    hardwareConcurrency > 128
  ) {
    return '硬件并发数必须在 1 到 128 之间'
  }
  const deviceMemory = fp.deviceMemory
  if (
    !Number.isFinite(deviceMemory) ||
    deviceMemory === undefined ||
    deviceMemory < 1 ||
    deviceMemory > 128
  ) {
    return '设备内存必须在 1 到 128GB 之间'
  }
  const screen = fp.screen
  if (
    !screen ||
    !Number.isInteger(screen.width) ||
    !Number.isInteger(screen.height) ||
    !Number.isInteger(screen.colorDepth)
  ) {
    return '屏幕字段不完整'
  }
  if (
    screen.width < 600 ||
    screen.width > 10_000 ||
    screen.height < 600 ||
    screen.height > 10_000
  ) {
    return '屏幕分辨率超出合理范围'
  }
  if (
    screen.colorDepth < 8 ||
    screen.colorDepth > 48 ||
    !Number.isFinite(screen.pixelRatio) ||
    screen.pixelRatio < 0.5 ||
    screen.pixelRatio > 4
  ) {
    return '屏幕色深或缩放比不合法'
  }
  if (
    !fp.webgl ||
    typeof fp.webgl.vendor !== 'string' ||
    typeof fp.webgl.renderer !== 'string' ||
    !fp.webgl.vendor ||
    !fp.webgl.renderer
  ) {
    return 'WebGL 字段不完整'
  }
  if (typeof fp.locale !== 'string' || !/^[a-z]{2,3}-[A-Z]{2}$/.test(fp.locale)) {
    return '语言区域格式不合法'
  }
  return null
}

export function alignFieldsError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '对齐字段必须是对象'
  const align = value as Partial<AlignFields>
  if (
    typeof align.timezone !== 'string' ||
    !align.timezone ||
    typeof align.language !== 'string' ||
    !align.language
  ) {
    return '时区或语言不能为空'
  }
  if (align.geolocation !== null && align.geolocation !== undefined) {
    if (
      !Number.isFinite(align.geolocation.latitude) ||
      !Number.isFinite(align.geolocation.longitude)
    ) {
      return '地理位置不合法'
    }
  }
  return null
}
