'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sgs91-assistant.user.js'), 'utf8');
const capturedLogs = [];
const testConsole = {
  log(...args) { capturedLogs.push(args); },
  error(...args) { capturedLogs.push(['error', ...args]); },
  warn(...args) { capturedLogs.push(['warn', ...args]); },
};
const document = {
  body: null,
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  getElementById() { return null; },
  createElement() {
    return {
      id: '',
      textContent: '',
      style: {},
      appendChild() {},
      remove() {},
      select() {},
    };
  },
  execCommand() { return true; },
};
const window = {
  document,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
const context = {
  window,
  document,
  location: { href: 'https://web.sanguosha.com/' },
  navigator: {},
  console: testConsole,
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  GM_getValue(key, fallback) { return fallback; },
  GM_setValue() {},
  GM_registerMenuCommand() { return 'menu'; },
  GM_unregisterMenuCommand() {},
};
window.window = window;
window.location = context.location;
window.navigator = context.navigator;

assert.equal('__JND' in window, false, '测试环境不能预装其他辅助脚本');
assert.equal('SGSMODULE' in window, false, '测试环境不能预装其他消息脚本');
vm.runInNewContext(source, context, { filename: 'sgs91-assistant.user.js' });

const app = window.SGS91Assistant;
const messages = app.getService('gameMessages');
const noticeOverlay = app.getService('noticeOverlay');
const seatOverlay = app.getService('seatOverlay');
assert.ok(messages, '91 助手必须自带游戏消息服务');
assert.ok(noticeOverlay, '91 助手必须自带锦囊袋同款顶部提示服务');
assert.ok(seatOverlay, '91 助手必须自带座位文字服务');
assert.equal(messages.probe().consoleHooked, true, '没有其他脚本时必须直接监听游戏页面消息');
assert.equal(messages.probe().optionalJndHooked, false, '独立运行测试不能误用外部脚本通道');
assert.equal(messages.probe().subscriberCount, 5, '五个武将模块都必须接入内置消息服务');

testConsole.log('Recv MsgGameHandCardNtf', { seat: 0, cards: [] });
testConsole.log('Recv MsgSetCharacterSpell', { seat: 0, spellIds: [3757, 3758] });
testConsole.log('Recv MsgGameTurnNtf', { currentSeat: 0 });
testConsole.log('Recv MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
assert.equal(window.LinglieShouhuHelper.state.selfIsLinglie, true);
assert.equal(window.LinglieShouhuHelper.state.shouhuStatus, 'ready');

testConsole.log('Recv MsgUseSpell', {
  srcSeat: 2,
  ownerSeat: 2,
  ownerCharacterId: 1912,
  spellId: 3800,
  targets: [1],
});
const zhangYuState = window.ZhangYuXiangchenHelper.probe().state;
assert.equal(zhangYuState.targets[2], 1, '张裕必须通过内置消息服务记录相谶目标');

testConsole.log('Recv MsgGameTurnNtf', { currentSeat: 3 });
assert.equal(window.MouDengAiJuxiHelper.state.currentTurnSeat, 3, '谋邓艾必须通过内置消息服务接收回合消息');

testConsole.log('Recv MsgGameSetCharacter', {
  characterInfo: [{ seat: 0, characterId: 1122 }],
});
testConsole.log('Recv MsgGameTurnNtf', { currentSeat: 0 });
testConsole.log('Recv MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
const huBanState = window.HuBanChongyiHelper.probe().logic;
assert.equal(huBanState.generals[0], 1122, '胡班必须通过内置消息服务识别角色');
assert.equal(huBanState.firstCardPending, true, '胡班必须通过内置消息服务跟踪首张牌状态');

testConsole.log('Recv MsgSetCharacterSpell', {
  seat: 5, characterId: 1098, spellIds: [3735, 3736],
});
testConsole.log('Recv MsgGameTurnNtf', { currentSeat: 5 });
testConsole.log('Recv MsgSetGamePhaseNtf', { seat: 5, phase: 4 });
testConsole.log('Recv MsgUseSpell', {
  ownerSeat: 5, ownerCharacterId: 1098, spellId: 3735, targets: [0],
});
const huanJieState = window.HuanJieJianliHelper.probe().state;
assert.equal(huanJieState.seatStates[5].uses, 1, '桓阶必须通过内置消息服务记录谏立发动次数');

assert.doesNotMatch(source, /@require\s+/, '独立成品不能加载其他脚本');
console.log('PASS 仅运行三国杀91助手时，内置消息总线连接五个武将模块并提供顶部提示服务');
console.log('PASS 独立环境没有 __JND、预置 SGSMODULE 或 @require 依赖');
