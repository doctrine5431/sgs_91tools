'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'heroes', 'zhang-yu-xiangchen.user.js'), 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRuntime(windowOverrides = {}, serviceOverrides = {}) {
  const document = {
    body: null,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { style: {}, select() {}, remove() {} }; },
    execCommand() { return true; },
  };
  const window = {
    document,
    addEventListener() {},
    dispatchEvent() {},
    ...windowOverrides,
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
  vm.runInNewContext(coreSource, context, { filename: '00-registry.user.js' });
  const messageListeners = [];
  window.SGS91Assistant.registerService('gameMessages', {
    subscribe(listener) { messageListeners.push(listener); return () => {}; },
  });
  window.SGS91Assistant.registerService('seatOverlay', serviceOverrides.seatOverlay || {
    show() { return false; },
    clear() { return true; },
    findGameManager() { return null; },
    readSeatObject() { return null; },
  });
  vm.runInNewContext(moduleSource, context, { filename: 'zhang-yu-xiangchen.user.js' });
  return { window, messageListeners };
}

const { window } = createRuntime();
const api = window.ZhangYuXiangchenHelper;
const test = api.__test;

{
  const module = window.SGS91Assistant.getModule('hero.zhang-yu.xiangchen');
  assert.equal(module.api, api);
  assert.deepEqual(Array.from(module.characterIds), [1912]);
  assert.deepEqual(Array.from(module.skillIds), [3800]);
}

{
  const model = test.createModel();
  const prompt = test.extractConfirmedSelection('MsgRoleOptTargetNtf', {
    skillName: '相谶', optSeat: 3, targetSeat: 1,
  }, model);
  assert.equal(prompt, null, '候选目标消息不得被当成最终目标');
  const confirmed = plain(test.extractConfirmedSelection('MsgRoleOptNtf', {
    skillName: '相谶', optSeat: 3, targetSeat: 1,
  }, model));
  assert.deepEqual(confirmed, { caster: 3, target: 1, type: 'MsgRoleOptNtf', spellId: null });
}

{
  const model = test.createModel();
  const selection = plain(test.extractConfirmedSelection('logicmsg.MsgUseSpell', {
    srcSeat: 7,
    spellId: 3800,
    ownerSeat: 7,
    ownerCharacterId: 1912,
    targets: [0],
  }, model));
  assert.deepEqual(selection, { caster: 7, target: 0, type: 'logicmsg.MsgUseSpell', spellId: 3800 });
  test.reduceMessage(model, 'MsgUseSpell', {
    srcSeat: 7,
    spellId: 3800,
    ownerSeat: 7,
    ownerCharacterId: 1912,
    targets: [0],
  });
  assert.equal(model.targets[7], 0);
  assert.equal(test.extractConfirmedSelection('MsgRoleOptTargetNtf', {
    optSeat: 7,
    targetSeat: 255,
    spellCasterSeat: 7,
    spellId: 3800,
  }, model), null);
  assert.equal(model.targets[7], 0, '选择临时技能时不能覆盖相谶目标');
}

{
  const model = test.createModel();
  test.reduceMessage(model, 'MsgRoleOptNtf', { skillName: '相谶', optSeat: 3, targetSeat: 1 });
  assert.equal(model.targets[3], 1);
  assert.equal(plain(test.evaluateHints(model.targets, [0, 1, 2, 3]))['1'].text, '相谶目标');
  test.reduceMessage(model, 'MsgGameTurnNtf', { currentSeat: 2 });
  assert.equal(model.targets[3], 1, '回合切换不应清除目标');
  test.reduceMessage(model, 'MsgRoleOptNtf', { skillName: '相谶', optSeat: 3, targetSeat: 2 });
  assert.equal(model.targets[3], 2, '再次发动应替换旧目标');
  test.reduceMessage(model, 'MsgGamePlayerDead', { seat: 2 });
  assert.equal(model.targets[3], undefined, '目标死亡应清除');
  test.reduceMessage(model, 'MsgRoleOptNtf', { skillName: '相谶', optSeat: 3, targetSeat: 1 });
  test.reduceMessage(model, 'MsgGamePlayerDead', { seat: 3 });
  assert.equal(model.targets[3], undefined, '张裕本人死亡应清除');
  test.reduceMessage(model, 'MsgRoleOptNtf', { skillName: '相谶', optSeat: 3, targetSeat: 1 });
  test.reduceMessage(model, 'MsgDealCharacters', {});
  assert.deepEqual(plain(model.targets), {}, '新对局应清除');
}

{
  const calls = [];
  const overlay = {
    show(key, seat, text) { calls.push(['show', key, seat, text]); return true; },
    clear(key) { calls.push(['clear', key]); },
  };
  const renderer = test.createSeatStripRenderer(() => overlay);
  renderer.render({ 1: { text: '相谶目标', color: '#f4d17b' } });
  renderer.render({ 1: { text: '相谶目标', color: '#f4d17b' } });
  assert.equal(calls.filter((call) => call[0] === 'show').length, 1, '相同文字不能重复绘制');
  renderer.render({});
  assert.equal(calls.filter((call) => call[0] === 'clear').length, 1);
}

{
  const stripCalls = [];
  const manager = {
    Seats: {
      0: { GeneralId: 100 },
      1: { GeneralId: 101 },
      2: { GeneralId: 1912 },
    },
  };
  const live = createRuntime({}, {
    seatOverlay: {
      findGameManager() { return manager; },
      readSeatObject(currentManager, seat) { return currentManager.Seats[seat] || null; },
      show(key, seat, text) { stripCalls.push(['show', key, seat, text]); return true; },
      clear(key) { stripCalls.push(['clear', key]); return true; },
    },
  });
  assert.equal(live.messageListeners.length, 1, '只能挂接一次内置消息监听');
  live.messageListeners[0]('MsgUseSpell', {
    srcSeat: 2,
    ownerSeat: 2,
    ownerCharacterId: 1912,
    spellId: 3800,
    targets: [1],
  });
  live.window.ZhangYuXiangchenHelper.probe();
  assert.equal(stripCalls.at(-1)[3], '相谶目标');
}

assert.doesNotMatch(moduleSource, /过河拆桥|顺手牵羊|队友|拆：/, '正式张裕模块不得混入队友拆牌功能');
assert.doesNotMatch(moduleSource, /__JND/, '张裕模块必须使用 91 助手自己的消息和座位服务');
assert.doesNotMatch(moduleSource, /requestAnimationFrame/);
assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
console.log('PASS 张裕相谶确认目标、替换、跨回合保留、死亡清理和座位提示');
console.log('PASS 张裕模块未包含队友过河拆桥或顺手牵羊提示');
