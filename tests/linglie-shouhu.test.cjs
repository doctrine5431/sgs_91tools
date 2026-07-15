'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'heroes', 'linglie-shouhu.user.js'), 'utf8');

function createRuntime(options = {}) {
  const shown = new Map();
  const cleared = [];
  const domElements = new Map();
  let jndListener = null;
  const body = {
    children: [],
    appendChild(element) {
      this.children.push(element);
      element.parentNode = this;
      if (element.id) domElements.set(element.id, element);
    },
  };
  const document = {
    body,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById(id) { return domElements.get(id) || null; },
    createElement() {
      return {
        id: '',
        textContent: '',
        style: {},
        remove() {
          if (this.id) domElements.delete(this.id);
        },
        select() {},
      };
    },
    execCommand() { return true; },
  };
  const window = {
    document,
    addEventListener() {},
    dispatchEvent() {},
    __JND: {
      selfSeatIndex() { return options.selfSeat ?? 0; },
      findGameManager() { return options.gameManager || null; },
      onMsg(listener) { jndListener = listener; },
      showSeatSkillStrip(key, seat, text, styleOptions) {
        shown.set(key, { seat, text, options: styleOptions });
        return true;
      },
      clearSeatSkillStrip(key) {
        cleared.push(key);
        shown.delete(key);
      },
    },
    SGSMODULE: [],
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
  vm.runInNewContext(moduleSource, context, { filename: 'linglie-shouhu.user.js' });
  return {
    window,
    helper: window.LinglieShouhuHelper,
    shown,
    cleared,
    emitJnd(type, payload) { jndListener(type, payload); },
    emitSgs(type, payload) {
      const listener = window.SGSMODULE.find((item) => typeof item === 'function');
      listener(type, payload);
    },
  };
}

{
  const { window, helper, shown } = createRuntime();
  const module = window.SGS91Assistant.getModule('hero.linglie.shouhu');
  assert.equal(module.api, helper);
  assert.deepEqual(Array.from(module.characterIds), [1126]);
  assert.deepEqual(Array.from(module.skillIds), [3757, 3758]);
  helper.onMessage('MsgSetCharacterSpell', { seat: 0, spellIds: [3757, 3758] });
  helper.onMessage('MsgGameTurnNtf', { currentSeat: 0 });
  helper.onMessage('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 可用');
  assert.equal(shown.get('sgs91-linglie-shouhu')?.options?.color, '#a9f0af');
}

{
  const { helper, shown } = createRuntime();
  helper.onMessage('MsgSetCharacterSpell', { seat: 0, spellIds: [3757, 3758] });
  helper.onMessage('MsgGameTurnNtf', { currentSeat: 0 });
  helper.onMessage('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  helper.onMessage('MsgUseSpell', { ownerSeat: 0, ownerCharacterId: 1126, spellId: 3757 });
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 不可用');
  helper.onMessage('MsgUpdateRoleDataExNtf', { seat: 1, id: 3757, data: [0, 0] });
  helper.onMessage('MsgUpdateRoleDataExNtf', { seat: 0, id: 8, data: [3757, 0, 1] });
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 不可用', '其他座位或距离叠层不能刷新自己的狩虎');
  helper.onMessage('MsgUpdateRoleDataExNtf', { seat: 0, id: 3757, data: [0, 0] });
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 可用');
}

{
  const gameManager = { selfSeatIndex: 0, Seats: [{ GeneralId: 1126, spellIds: [3757, 3758] }] };
  const { helper, shown, cleared } = createRuntime({ gameManager });
  helper.onMessage('MsgGameTurnNtf', { currentSeat: 0 });
  helper.onMessage('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 可用', '应能直接从座位对象识别凌烈');
  helper.onMessage('MsgGameOver', {});
  assert.equal(shown.has('sgs91-linglie-shouhu'), false);
  assert.ok(cleared.includes('sgs91-linglie-shouhu'));
  assert.equal(helper.state.selfIsLinglie, false);
}

{
  const { helper, shown, emitJnd, emitSgs } = createRuntime();
  emitJnd('MsgSetCharacterSpell', { seat: 0, spellIds: [3757, 3758] });
  emitJnd('MsgGameTurnNtf', { currentSeat: 0 });
  emitSgs('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  const payload = { ownerSeat: 0, ownerCharacterId: 1126, spellId: 3757 };
  emitJnd('MsgUseSpell', payload);
  emitSgs('MsgUseSpell', payload);
  assert.equal(shown.get('sgs91-linglie-shouhu')?.text, '狩虎 不可用');
  assert.equal(helper.probe().recentMessages.filter((item) => item.type === 'MsgUseSpell').length, 1);
}

assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
console.log('PASS 凌烈狩虎状态、身份识别、刷新条件、离局清理和双消息总线去重');
