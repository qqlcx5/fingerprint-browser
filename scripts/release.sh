#!/usr/bin/env bash
# 版本发布脚本：更新版本号 -> 提交 -> 打 tag -> 推送，触发 GitHub Actions Release 工作流
# 用法:
#   ./scripts/release.sh 1.0.1        # 发布 v1.0.1
#   ./scripts/release.sh 1.0.1 --dry  # 预演，不实际执行
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
DRY="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "用法: ./scripts/release.sh <version> [--dry]"
  echo "示例: ./scripts/release.sh 1.0.1"
  exit 1
fi

# 去掉可能的 v 前缀，统一为纯数字版本号
VERSION="${VERSION#v}"
TAG="v${VERSION}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "错误: 版本号格式不合法: $VERSION (应为 x.y.z)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区有未提交的改动，请先提交或暂存(stash):" >&2
  git status --short >&2
  exit 1
fi

# 拉取远程最新代码，确保 tag 基于最新 main
git fetch origin --tags
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "错误: 本地 main 与 origin/main 不一致，请先 git pull --rebase" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "错误: tag $TAG 已存在" >&2
  exit 1
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "==> 当前版本: $CURRENT_VERSION"
echo "==> 目标版本: $VERSION (tag: $TAG)"

if [[ "$DRY" == "--dry" ]]; then
  echo "[dry-run] 将执行以下操作:"
  echo "  1. node 更新 package.json version -> $VERSION"
  echo "  2. git commit -m \"release: $TAG\""
  echo "  3. git tag -a $TAG -m \"Release $TAG\""
  echo "  4. git push origin main $TAG"
  exit 0
fi

# 1. 更新 package.json 版本号
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "==> package.json 版本已更新为 $VERSION"

# 2. 提交 + 打 tag
git add package.json
git commit -m "release: $TAG"
git tag -a "$TAG" -m "Release $TAG"

# 3. 推送触发 CI
echo "==> 推送 main 与 $TAG ..."
git push origin main
git push origin "$TAG"

echo ""
echo "==> 发布流程已启动！"
echo "    构建进度: https://github.com/$(git remote get-url origin | sed 's#.*github.com[:/]##; s#\.git$##')/actions"
echo "    构建完成后到 Releases 页面确认草稿并点击 Publish:"
echo "    https://github.com/$(git remote get-url origin | sed 's#.*github.com[:/]##; s#\.git$##')/releases"
