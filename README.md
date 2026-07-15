# 三国杀91助手

面向网页版《三国杀一将成名》的多武将油猴助手。项目只读取本地游戏页面状态并显示提示，不自动点击、不自动出牌、不上传数据，也不加载远程代码。

## 第一版功能

- 谋邓艾「骤袭」：完整继承已完成的 `1.0.4` 代码，识别谋邓艾与骤袭、计算 X、标记可计入骤袭的手牌，并显示骤袭失效状态。
- 手牌花色排序：显示可拖拽的“91”圆形按钮，点击后按游戏内部花色编号整理自己的手牌显示顺序。
- 统一入口：油猴只需安装 `dist/三国杀91助手.user.js`。
- 插件式扩展：核心统一登记武将与功能，构建器自动发现新模块。
- 共享场景服务：新模块直接读取当前场景、自己座位和手牌容器，不必重复编写查找代码。

## 项目结构

```text
src/heroes/       武将技能模块
src/features/     通用功能模块
src/core/         注册中心、事件总线和共享游戏场景服务
scripts/build.cjs 合并生成单一油猴脚本
dist/             可直接安装的成品脚本
tests/            规则和发布检查
templates/        新模块起步模板
docs/             扩展说明
```

以后添加武将时，只需把模板复制到 `src/heroes/` 并登记模块信息；构建器会自动发现，不需要修改构建脚本。详细步骤见 `docs/EXTENDING.md`。

## 构建与验证

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1
```

不需要安装第三方依赖。验证脚本会优先使用系统 Node.js，找不到时自动使用本机的 Codex 自带 Node。

## 使用

1. 在 Tampermonkey 或 Violentmonkey 中安装 `dist/三国杀91助手.user.js`。
2. 打开 `https://web.sanguosha.com/`。
3. 使用谋邓艾时，骤袭数值与手牌标记会自动显示。
4. 点击可拖拽的“91”按钮按花色整理手牌。

排查谋邓艾识别问题时，可在浏览器控制台运行：

```javascript
MouDengAiJuxiHelper.copyDiagnostic()
```
