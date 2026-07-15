# 添加武将或功能

项目采用“核心 + 自动发现模块”的结构。构建器会自动合并以下目录中的所有 `.user.js` 文件，不需要再修改模块清单：

- `src/heroes/`：武将技能助手。
- `src/features/`：花色排序等通用功能。

## 添加一个武将

1. 复制 `templates/module-template.user.js` 到 `src/heroes/`。
2. 文件名使用英文小写和连字符，例如 `mou-caocao-skill.user.js`。
3. 修改 `registerModule()` 中的 ID、名称、版本、武将 ID 和技能 ID。
4. 通过 `app.getService('gameScene')` 读取游戏场景、自己座位和手牌容器。
5. 执行 `powershell -ExecutionPolicy Bypass -File .\scripts\verify.ps1`。

模块 ID 必须唯一，推荐格式为 `hero.武将英文名.技能英文名` 或 `feature.功能英文名`。

## 模块接口

每个模块调用一次：

```javascript
app.registerModule({
  id: 'hero.example.skill',
  type: 'hero',
  name: '示例武将·示例技能',
  version: '0.1.0',
  description: '功能说明',
  capabilities: ['game-state-read'],
  characterIds: [武将ID],
  skillIds: [技能ID],
  api: Object.freeze({ probe }),
});
```

核心会拒绝重复 ID 和未知模块类型。其他模块可以通过 `app.getModule(id)` 取得公开 API，通过 `app.on()`、`app.emit()` 传递事件。

## 共享服务

`gameScene` 服务提供 `findInScene()`、`getGameScene()`、`getSelfSeatUi()` 和 `getCardContainer()`。

`gameMessages` 服务提供 `subscribe()`、`publish()` 和 `probe()`，是武将模块的主要消息来源。`seatOverlay` 服务提供 `show()`、`clear()` 和座位对象读取能力。新模块应优先使用这两个内置服务，不能把 `__JND` 或其他油猴脚本作为运行前提。

通用读取逻辑应优先加入共享服务，避免每个武将复制一份。已经完成并验证的谋邓艾代码暂时保持模块内独立，后续只在有对应回归测试时再逐步抽取。
