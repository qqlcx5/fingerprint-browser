#!/usr/bin/env bash
# 本地构建脚本：自动识别当前平台并打包
# 用法:
#   ./scripts/build-local.sh          # 构建当前平台安装包
#   ./scripts/build-local.sh --dir    # 仅打包不生成安装器（快速验证）
set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM_ARG=""
if [[ "${1:-}" == "--dir" ]]; then
  PLATFORM_ARG="--dir"
fi

case "$(uname -s)" in
  Darwin*)
    echo "==> 平台: macOS"
    if [[ -n "$PLATFORM_ARG" ]]; then
      pnpm run build && pnpm exec electron-builder --mac --dir
    else
      pnpm run build:mac
    fi
    ;;
  Linux*)
    echo "==> 平台: Linux"
    if [[ -n "$PLATFORM_ARG" ]]; then
      pnpm run build && pnpm exec electron-builder --linux --dir
    else
      pnpm run build:linux
    fi
    ;;
  MINGW* | MSYS* | CYGWIN*)
    echo "==> 平台: Windows"
    if [[ -n "$PLATFORM_ARG" ]]; then
      pnpm run build && pnpm exec electron-builder --win --dir
    else
      pnpm run build:win
    fi
    ;;
  *)
    echo "错误: 不支持的平台 $(uname -s)" >&2
    exit 1
    ;;
esac

echo ""
echo "==> 构建完成，产物位于 dist/ 目录:"
ls -lh dist/*.exe dist/*.dmg dist/*.AppImage dist/*.deb 2>/dev/null || echo "(无安装包产物，可能使用了 --dir 模式)"
