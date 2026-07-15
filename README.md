# 三国杀91助手

为网页版《三国杀一将成名》玩家制作的油猴助手。

目前支持谋邓艾「骤袭」提示和手牌花色排序。脚本只读取当前游戏页面中的本地数据，不会自动点击、自动出牌或上传对局数据。

## 一键安装

安装前请确保浏览器已经安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey。

**[点击安装三国杀91助手](https://github.com/doctrine5431/sgs_91tools/releases/latest/download/sgs91-assistant.user.js)**

打开链接后，在油猴扩展的安装页面点击“安装”，然后刷新游戏网页即可。

也可以进入 [Releases](https://github.com/doctrine5431/sgs_91tools/releases) 查看版本说明和下载历史版本。

## 支持的游戏页面

```text
https://web.sanguosha.com/*
https://*.sanguosha.com/*
```

## 使用方法

1. 安装脚本并打开网页版三国杀。
2. 进入对局后等待“91”按钮出现。
3. 使用谋邓艾时，骤袭数值和手牌标记会自动显示。
4. 需要整理手牌时，单击“91”按钮；按住按钮可以拖动位置。

## 常见问题

### 没有出现“91”按钮

游戏场景可能还没有加载完成，请稍等几秒。如果仍未出现，可以刷新游戏页面。

### 谋邓艾提示没有出现

请确认当前使用的是谋邓艾，并已进入自己的出牌阶段。如果仍无法识别，可按 `F12` 打开控制台并运行：

```javascript
MouDengAiJuxiHelper.copyDiagnostic()
```

诊断内容只会复制到剪贴板，由玩家自行决定是否提供。可以前往 [Issues](https://github.com/doctrine5431/sgs_91tools/issues) 反馈问题。

## 更新脚本

重新打开上方“一键安装”链接，油猴扩展会显示当前版本并允许安装新版。

## 开发与扩展

项目采用可扩展模块结构，后续可以继续增加武将技能提示和通用功能。开发者请查看 [添加武将或功能](docs/EXTENDING.md)。

本地构建和验证：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```
