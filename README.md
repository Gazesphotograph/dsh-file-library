# 文件资料库

集中管理 DeepSeek Harness 的会话附件和上传文件，查找原件与工作区副本，并快速添加到对话。

插件：`@local/dsh-file-library` · 版本：**1.0.0**

适用版本：**DeepSeek Harness 0.2.1-rc.5**。

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

克隆仓库到固定目录后，在仓库根目录打开 PowerShell：

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Get-Location).Path
```

如 Harness 安装在其他位置，把 `$dsh` 改为对应 CLI 路径。插件使用 DSH
提供的服务，无需自行安装 React 或其他前端运行依赖。安装后刷新页面；涉及
原生启动配置时完整重启桌面程序。使用其他 profile 时替换 `desktop`。

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

`tests/` 包含使用本地代码、模拟服务或临时目录的离线回归检查，无需账户密钥。
这些检查不覆盖安装后的完整桌面交互，界面兼容性需在对应 Harness 版本中确认。

## 目录

- `index.js`：Host 服务入口。
- `package.json`、`cordis.patch.yml`：DSH bundle 元数据与加载配置。
- `tests/`：可复跑检查。
- `client.js`、`locale/`、`icon.svg`：客户端页面和界面资源。
