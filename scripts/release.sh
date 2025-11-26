#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

CURRENT_BRANCH=$(git branch --show-current)
[ "$CURRENT_BRANCH" != "develop" ] && echo_error "必须在 develop 分支执行"
[ -n "$(git status --porcelain)" ] && echo_error "工作区有未提交的修改"

if [ -n "$1" ]; then
    VERSION=$1
else
    echo -e "${YELLOW}请输入版本号 (例如: 1.0.1):${NC}"
    read VERSION
fi

[ -z "$VERSION" ] && echo_error "版本号不能为空"

echo_info "准备发布版本: $VERSION"

# 更新版本号
npm version $VERSION --no-git-tag-version
if [ -f ".claude-plugin/plugin.json" ]; then
    sed -i.bak "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" .claude-plugin/plugin.json
    rm -f .claude-plugin/plugin.json.bak
fi

git add package.json .claude-plugin/plugin.json
git commit -m "chore: bump version to $VERSION"
git push origin develop

# 构建
echo_info "构建项目..."
pnpm run build || echo_error "构建失败"

# 切换到 main
echo_info "切换到 main 分支..."
git checkout main

# 合并
echo_info "合并 develop 到 main..."
git merge develop --no-ff -m "merge: develop to main for v$VERSION"

# 添加构建产物
echo_info "添加构建产物..."
git add -f dist/
git commit --amend --no-edit

# 创建 tag
git tag -a "v$VERSION" -m "Release version $VERSION"

# 推送确认
echo -e "${YELLOW}是否推送到远程? (y/n):${NC}"
read CONFIRM

if [ "$CONFIRM" = "y" ]; then
    git push origin main
    git push origin "v$VERSION"
    echo_info "推送完成"
else
    echo_warn "已取消推送，可稍后手动执行："
    echo "  git push origin main"
    echo "  git push origin v$VERSION"
fi

git checkout develop
echo_info "发布完成！版本: $VERSION"
