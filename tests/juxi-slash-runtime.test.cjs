'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'heroes', 'mou-deng-ai-juxi.user.js'), 'utf8');
const selfSeat = {
  GeneralId: 1740,
  attackRange: 1,
  equipCardUIs: [],
};
const otherSeat = { GeneralId: 1 };
const manager = {
  selfSeatIndex: 0,
  currentSeat: 0,
  actionSeats: [0, 1],
  Seats: [selfSeat, otherSeat],
};

const document = {
  body: null,
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
  getElementById() { return null; },
  createElement() { return { id: '', textContent: '', style: {}, appendChild() {}, remove() {} }; },
};
const window = {
  document,
  addEventListener() {},
  dispatchEvent() {},
  SGS91Assistant: { registerModule() {} },
  __JND: {
    selfSeatIndex() { return 0; },
    findGameManager() { return manager; },
    onMsg() {},
  },
};
const context = {
  window,
  document,
  location: { href: 'https://web.sanguosha.com/' },
  navigator: {},
  console,
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
};
window.window = window;
window.location = context.location;
window.navigator = context.navigator;

vm.runInNewContext(source, context, { filename: 'mou-deng-ai-juxi.user.js' });
const helper = window.MouDengAiJuxiHelper;
helper.state.currentPhase = 'play';
helper.state.currentTurnSeat = 0;
helper.state.handCards = [{ name: '杀' }];
helper.state.slashUsageBySeat[0] = { seat: 0, used: 1, limit: 1, remaining: 0 };

let probe = helper.probe();
assert.equal(probe.handCards[0].countsAsUnavailable, true,
  '游戏直接报告剩余出杀次数为 0 时，手牌杀必须计入 X');

selfSeat.equipCardUIs = [{ theCard: { name: '诸葛连弩', typeName: 'weapon' } }];
probe = helper.probe();
assert.equal(probe.handCards[0].countsAsUnavailable, false,
  '装备区有诸葛连弩时，普通杀次数用完仍可继续出杀');
assert.equal(probe.handCards[0].reason, '已装备【诸葛连弩】，且范围内有目标');

selfSeat.equipCardUIs = [];
probe = helper.probe();
assert.equal(probe.handCards[0].countsAsUnavailable, true,
  '失去诸葛连弩后必须立即恢复普通杀次数限制');

helper.state.slashUsageBySeat[0] = { seat: 0, used: 0, limit: 1, remaining: 1 };
helper.onMessage('MsgUseCard', {
  srcSeat: 0,
  cardName: '杀',
  spellId: 1,
  sourceSpellId: 3716,
});
assert.equal(helper.state.slashUsageBySeat[0].remaining, 1,
  '骤袭产生的杀不得消耗普通杀次数');
assert.equal(helper.state.slashUsageBySeat[0].used, 0,
  '骤袭产生的杀不得增加普通杀已用次数');

helper.onMessage('MsgUseCard', { srcSeat: 0, cardName: '杀', spellId: 1 });
assert.equal(helper.state.slashUsageBySeat[0].remaining, 0,
  '正常使用杀必须消耗一次普通杀次数');
assert.equal(helper.state.slashUsageBySeat[0].used, 1,
  '正常使用杀必须增加普通杀已用次数');

console.log('PASS 谋邓艾运行时读取实际剩余出杀次数，并随诸葛连弩装备状态实时重算');
console.log('PASS 骤袭产生的杀不消耗普通杀次数，正常杀仍会消耗次数');
