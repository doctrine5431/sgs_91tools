'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'heroes', 'huan-jie-jianli.user.js'), 'utf8');

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function createRuntime(manager = null) {
  const document = {
    body: null,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() { return { style: {}, select() {}, remove() {} }; },
    execCommand() { return true; },
  };
  const window = { document, addEventListener() {}, dispatchEvent() {} };
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
  const listeners = [];
  const calls = [];
  window.SGS91Assistant.registerService('gameMessages', {
    subscribe(listener) { listeners.push(listener); return () => {}; },
  });
  window.SGS91Assistant.registerService('seatOverlay', {
    findGameManager() { return manager; },
    readSeatObject(current, seat) { return current?.Seats?.[seat] || null; },
    show(key, seat, text, options) { calls.push(['show', key, seat, text, options]); return true; },
    clear(key) { calls.push(['clear', key]); return true; },
  });
  vm.runInNewContext(moduleSource, context, { filename: 'huan-jie-jianli.user.js' });
  return { window, listeners, calls };
}

const basic = createRuntime();
const api = basic.window.HuanJieJianliHelper;
const test = api.__test;

{
  const module = basic.window.SGS91Assistant.getModule('hero.huan-jie.jianli');
  assert.equal(module.api, api);
  assert.deepEqual(Array.from(module.characterIds), [1098]);
  assert.deepEqual(Array.from(module.skillIds), [3735]);
  assert.equal(basic.listeners.length, 1, '桓阶模块只能挂接一次内置消息监听');
}

function readyModel(overrides = {}) {
  return test.createModel({
    selfSeat: 0,
    selfIsHuanJie: true,
    currentTurnSeat: 0,
    currentPhase: 'play',
    turnToken: 1,
    lastResetTurnToken: 1,
    ...overrides,
  });
}

function useJianli(model, overrides = {}) {
  return test.reduceMessage(model, 'MsgUseSpell', {
    ownerSeat: 0,
    ownerCharacterId: 1098,
    spellId: 3735,
    targets: [1],
    ...overrides,
  });
}

assert.equal(test.normalizePhase(4), 'play');
assert.equal(test.normalizePhase('出牌阶段'), 'play');
assert.equal(test.normalizeMessageType('logicmsg.MsgUseSpell', {}), 'MsgUseSpell');

{
  const model = readyModel({ uses: 0 });
  assert.equal(test.derivePresentation(model).text, '谏立可发动次数 2 次');
  model.uses = 1;
  assert.equal(test.derivePresentation(model).text, '谏立可发动次数 1 次');
  model.uses = 2;
  assert.equal(test.derivePresentation(model).text, '谏立已失效');
  assert.equal(test.derivePresentation(readyModel({ currentPhase: 'draw' })), null);
  assert.equal(test.derivePresentation(readyModel({ currentTurnSeat: 1 })), null);
}

{
  const model = readyModel();
  assert.equal(useJianli(model).activation, true);
  assert.equal(model.uses, 1);
  assert.equal(useJianli(model, { targets: [2] }).activation, true);
  assert.equal(model.uses, 2);
  useJianli(model, { targets: [3] });
  assert.equal(model.uses, 2, '谏立次数必须封顶为两次');
  assert.equal(test.derivePresentation(model).text, '谏立已失效');
}

{
  const model = readyModel();
  useJianli(model, { ownerSeat: 1, srcSeat: 1 });
  test.reduceMessage(model, 'MsgUseSpell', { ownerSeat: 0, spellId: 9999 });
  test.reduceMessage(model, 'MsgRoleOptTargetNtf', { ownerSeat: 0, spellId: 3735, targetSeat: 1 });
  assert.equal(model.uses, 0, '其他角色、其他技能和选目标提示均不得误计数');
}

{
  const model = test.createModel({ selfSeat: 0 });
  test.reduceMessage(model, 'MsgSetCharacterSpell', {
    seat: 3, characterId: 1098, spellIds: [3735, 3736],
  });
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 3, phase: 0 });
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 3, phase: 4 });
  assert.equal(test.derivePresentation(model, 3).text, '谏立可发动次数 2 次');
  test.reduceMessage(model, 'MsgUseSpell', { ownerSeat: 3, spellId: 3735, targets: [0] });
  assert.equal(test.derivePresentation(model, 3).text, '谏立可发动次数 1 次');
  test.reduceMessage(model, 'MsgUseSpell', { ownerSeat: 3, spellId: 3735, targets: [1] });
  assert.equal(test.derivePresentation(model, 3).text, '谏立已失效');
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 3, phase: 5 });
  assert.equal(test.derivePresentation(model, 3), null, '离开出牌阶段必须隐藏');
}

{
  const model = readyModel({ uses: 1 });
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  assert.equal(model.uses, 1, '重复出牌阶段通知不得重置');
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 0, phase: 0 });
  test.reduceMessage(model, 'MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  assert.equal(model.uses, 0, '下个回合进入出牌阶段必须重置');
}

{
  const model = readyModel({ selfIsHuanJie: false });
  test.reduceMessage(model, 'MsgSkillInfoNtf', {
    ownerSeat: 0,
    skill: { id: 4321, name: '谏立' },
  }, { characterId: 1098, skillId: null, characterNames: ['桓阶'], skillNames: ['谏立'] });
  assert.equal(model.discoveredSkillId, 4321);
  const result = test.reduceMessage(model, 'MsgUseSpell', { ownerSeat: 0, spellId: 4321 }, {
    characterId: 1098, skillId: null, characterNames: ['桓阶'], skillNames: ['谏立'],
  });
  assert.equal(result.activation, true, '动态发现的谏立技能 ID 也必须计数');
}

{
  const model = readyModel();
  let now = 1000;
  let handled = 0;
  const receive = test.createMessageReceiver((type, payload) => {
    handled += 1;
    test.reduceMessage(model, type, payload);
  }, { now: () => now, dedupeMs: 250 });
  const payload = { ownerSeat: 0, ownerCharacterId: 1098, spellId: 3735, targets: [1] };
  receive('console', 'logicmsg.MsgUseSpell', payload);
  receive('sgsmodule', 'MsgUseSpell', payload);
  assert.equal(handled, 1, '同一条双入口消息只能处理一次');
  now += 300;
  receive('console', 'MsgUseSpell', payload);
  assert.equal(model.uses, 2);
}

{
  const manager = {
    selfSeatIndex: 0,
    Seats: {
      0: { GeneralId: 100 },
      3: { GeneralId: 1098, GeneralName: '桓阶', spellIds: [3735, 3736] },
    },
  };
  const live = createRuntime(manager);
  live.listeners[0]('MsgGameTurnNtf', { currentSeat: 3 });
  live.listeners[0]('MsgSetGamePhaseNtf', { seat: 3, phase: 4 });
  assert.equal(live.calls.filter((call) => call[0] === 'show').at(-1)[3], '谏立可发动次数 2 次');
  live.listeners[0]('MsgUseSpell', { ownerSeat: 3, ownerCharacterId: 1098, spellId: 3735, targets: [0] });
  assert.equal(live.calls.filter((call) => call[0] === 'show').at(-1)[3], '谏立可发动次数 1 次');
  const options = live.calls.filter((call) => call[0] === 'show').at(-1)[4];
  assert.equal(options.font, 'FZBW');
  assert.equal(options.fontSize, 16);
}

for (const type of ['MsgGameOver', 'MsgLeaveGame', 'MsgDealCharacters']) {
  const model = readyModel({ uses: 2 });
  test.reduceMessage(model, type, {});
  assert.equal(test.derivePresentation(model), null, `${type} 后必须清理`);
}

assert.doesNotMatch(moduleSource, /速立|suli/i);
assert.doesNotMatch(moduleSource, /__JND|\bSGSMODULE\b/, '桓阶模块只能使用 91 助手自己的服务');
assert.doesNotMatch(moduleSource, /@require\s+|\brequire\s*\(|\bimport\s+/);
assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
console.log('PASS 桓阶谏立独立计数、回合重置、动态识别和 FZBW 座位提示');
