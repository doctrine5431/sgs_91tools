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
6. 确认后提交、推送、创建版本标签和 GitHub Release。
7. 将 `dist/sgs91-assistant.user.js` 作为 Release 附件上传。
