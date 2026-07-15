# 发布流程

## 上传前必须暂停确认

任何 `git push`、标签推送、GitHub Release 创建或附件上传之前，都必须先向项目所有者展示：

1. 准备上传的文件和主要差异。
2. 新版本号与标签。
3. `CHANGELOG.md` 中对应版本的内容。
4. GitHub Release 标题和完整说明。
5. 成品 JS 文件名、大小和 SHA-256。
6. 构建与测试结果。

只有收到明确的“确认上传”或同等意思回复后，才能进行外部上传。用户要求修改时，应继续在本地调整并重新展示完整预览。

## 标准步骤

1. 更新 `package.json` 版本和 `CHANGELOG.md`。
2. 准备 `release-notes/v版本号.md`。
3. 执行 `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`。
4. 确认 `dist/sgs91-assistant.user.js` 与中文成品内容一致。
5. 展示上传预览并等待确认。
6. 更新 `.github/release-request.json`，确保标签、标题、说明、成品路径和 SHA-256 与预览一致。
7. 确认后提交并创建版本标签；先推送标签，再推送 `main`。
8. `main` 中的发布清单变化会触发 GitHub Actions，自动创建或更新 Release；附件底层保持稳定名称 `sgs91-assistant.user.js`，在 Release 页面以带版本号的名称显示。

## GitHub Actions 自动发布

工作流位于 `.github/workflows/release.yml`，不需要在本机安装 GitHub CLI。GitHub 的运行环境会使用仓库自带的临时权限执行发布。

自动发布前会检查：

- 发布清单标签与 `package.json` 版本一致。
- Release 说明和成品 JS 文件存在。
- GitHub 上已经存在对应版本标签。
- 成品 JS 的 SHA-256 与发布清单完全一致。
- Release 附件显示名称符合 `sgs91-assistant-v版本号.user.js`，同时保持稳定下载地址供油猴自动更新。

任一检查失败时不会创建或更新 Release。
