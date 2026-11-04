# 文件资料库

DeepSeek Harness 自制插件 `@local/dsh-file-library`，当前插件版本 **1.0.0**。
本仓库独立保存源码、必要资源和可离线运行的回归检查。
整理基于本机 **DeepSeek Harness 0.2.1-rc.5** 使用的源码快照。

## 功能与数据

- 汇总会话附件和手动上传文件，支持搜索、筛选、收藏及刷新。
- 区分附件存储中的只读原件与工作目录中的相同/修改副本。
- 从输入框菜单选择资料库附件，添加到当前草稿。
- 提供 `/api/dsh-file-library/*` 路由及代理工具 `file_library`。

目录扫描只读取工作文件，不改写副本。默认跳过依赖、版本控制和缓存目录；
单文件哈希及手动上传上限均为 64 MiB，每次扫描最多 20,000 个文件、深度 12。
图片附件 ID 可能对应经过归一化的图片，不能假定等于原始上传文件的哈希。

手动上传记录、收藏和扫描缓存保存在当前 profile 的 `dsh-file-library/state.json`。
附件内容留在 DSH 附件存储中。本仓库不包含这些运行数据，也不包含上传文件。
路由复用 DSH 原有 connection 认证通道。

## 安装

克隆此私有仓库到固定目录后，在仓库根目录打开 PowerShell：

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Get-Location).Path
```

如 Harness 安装在其他位置，把 `$dsh` 改为对应 CLI 路径。插件使用 DSH
提供的服务，无需自行安装 React 或其他前端运行依赖。安装后刷新页面；涉及
原生启动配置时完整重启桌面程序。使用其他 profile 时替换 `desktop`。
本次整理未将这些副本重新安装进正在运行的 DSH。

卸载：

```powershell
& $dsh plugin --profile desktop remove @local/dsh-file-library
```

## 验证

使用 Node.js 22.15 或更新版本，在仓库根目录运行：

```powershell
npm test
npm pack --dry-run
```

检查使用本地代码、模拟服务或临时目录，不需要账户密钥。测试只证明相应离线
行为；从这些独立仓库重新安装后的桌面界面尚未验证。
`tests/` 中保留整理前已有的回归检查，并将路径改为仓库内路径。

## 目录

- `index.js`：Host 服务入口。
- `package.json`、`cordis.patch.yml`：DSH bundle 元数据与加载配置。
- `tests/`：可复跑检查。
- `client.js`、`locale/`、`icon.svg`：客户端页面和界面资源。

## 整理记录

2026-11-04：从当前工作目录独立归档，补全安装与验证说明、忽略规则和仓库元数据。
业务实现保持当前版本，整理差异见 `CHANGELOG.md`。GitHub 仓库设为私有；
`package.json` 中的 `private: true` 同时防止误发布到 npm。
