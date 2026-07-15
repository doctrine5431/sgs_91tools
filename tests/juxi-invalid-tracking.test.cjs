'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'heroes', 'mou-deng-ai-juxi.user.js'), 'utf8');
const shown = new Map();
const cleared = [];

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
  SGS91Assistant: {
    registerModule() {},
  },
  __JND: {
    selfSeatIndex() { return 0; },
    onMsg() {},
    showSeatSkillStrip(key, seat, text) {
      shown.set(key, { seat, text });
      return true;
    },
    clearSeatSkillStrip(key) {
      cleared.push(key);
      shown.delete(key);
    },
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

vm.runInNewContext(source, context, { filename: 'sgs-mou-deng-ai-juxi-helper.user.js' });
const helper = window.MouDengAiJuxiHelper;
helper.state.bodyReady = true;

helper.onMessage('MsgGameTurnNtf', { currentSeat: 1 });
helper.onMessage('MsgUseSkill', {
  srcSeat: 1,
  skillName: '骤袭',
  discardCardIds: [101, 102],
});

assert.equal(helper.state.juxiInvalidMarks[1].count, 2, '别人骤袭弃置 2 张时应标记失效');
assert.equal(shown.get('mou-deng-ai-juxi-invalid-1').text, '骤袭已失效', '对方武将座位条应显示骤袭已失效');
helper.onMessage('MsgGameTurnNtf', { currentSeat: 2 });
assert.equal(helper.state.juxiInvalidMarks[1], undefined, '发动者回合结束后应删除骤袭失效状态');
assert.ok(cleared.includes('mou-deng-ai-juxi-invalid-1'), '发动者回合结束后应清除其座位条');

helper.onMessage('MsgGameTurnNtf', { currentSeat: 0 });
helper.onMessage('MsgUseSkill', {
  srcSeat: 0,
  skillName: '骤袭',
  discardCardIds: [201],
});

assert.equal(helper.state.juxiInvalidMarks[0].count, 1, '自己骤袭弃置 1 张时也应标记失效');
assert.equal(shown.get('mou-deng-ai-juxi-invalid-0').text, '骤袭已失效', '自己武将座位条也应显示骤袭已失效');
helper.onMessage('MsgGameTurnNtf', { currentSeat: 1 });
assert.equal(helper.state.juxiInvalidMarks[0], undefined, '自己的回合结束后应删除骤袭失效状态');
assert.ok(cleared.includes('mou-deng-ai-juxi-invalid-0'), '自己的回合结束后应清除骤袭失效座位条');

helper.onMessage('MsgSetGamePhaseNtf', { seat: 3, phase: 4 });
helper.onMessage('MsgRoleOptTargetNtf', {
  optSeat: 3,
  spellCasterSeat: 3,
  targetSeat: 255,
  spellId: 3716,
  optType: 28,
  param: 1,
});

assert.equal(helper.state.juxiInvalidMarks[3].count, 1, '应按实战消息中的 optSeat、spellId=3716 和 param=1 标记失效');
assert.equal(shown.get('mou-deng-ai-juxi-invalid-3').text, '骤袭已失效', '实战消息也应在发动者武将上显示骤袭已失效');

helper.onMessage('MsgRoleOptTargetNtf', {
  optSeat: 3,
  spellCasterSeat: 3,
  targetSeat: 255,
  spellId: 3716,
  optType: 28,
  param: 3,
});
assert.equal(helper.state.juxiInvalidMarks[3], undefined, '实战消息 param=3 时不应标记骤袭失效');

helper.onMessage('MsgUseSpell', {
  srcSeat: 3,
  ownerSeat: 3,
  spellId: 3716,
  cards: [],
});
assert.equal(helper.state.juxiInvalidMarks[3], undefined, 'MsgUseSpell 的空 cards 不是弃牌 0 张，不能误标失效');

console.log('PASS 自己或别人骤袭弃牌少于 3 张时显示失效，并在其回合结束时清除');
