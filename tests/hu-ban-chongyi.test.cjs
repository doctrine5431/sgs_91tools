'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'heroes', 'hu-ban-chongyi.user.js'), 'utf8');

class Sprite {
  constructor() {
    this._children = [];
    this.parent = null;
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.destroyed = false;
    this._destroyed = false;
  }

  addChild(child) {
    child.parent = this;
    this._children.push(child);
    return child;
  }

  removeChildren() {
    this._children.forEach((child) => { child.parent = null; });
    this._children = [];
  }

  pos(x, y) {
    this.x = x;
    this.y = y;
  }

  size(width, height) {
    this.width = width;
    this.height = height;
  }

  destroy() {
    this.destroyed = true;
    this._destroyed = true;
    if (this.parent) this.parent._children = this.parent._children.filter((child) => child !== this);
    this.parent = null;
    this.removeChildren();
  }
}

class Text extends Sprite {
  constructor() {
    super();
    this.text = '';
  }
}

function walk(rootNode) {
  const rows = [];
  const queue = [rootNode];
  while (queue.length) {
    const item = queue.shift();
    if (!item) continue;
    rows.push(item);
    queue.push(...(item._children || []));
  }
  return rows;
}

function createRuntime(options = {}) {
  const elements = new Map();
  const documentElement = {
    appendChild(element) {
      element.parentNode = this;
      if (element.id) elements.set(element.id, element);
      return element;
    },
  };
  const body = {
    appendChild(element) {
      element.parentNode = this;
      if (element.id) elements.set(element.id, element);
      return element;
    },
  };
  const document = {
    body,
    head: { appendChild() {} },
    documentElement,
    getElementById(id) { return elements.get(id) || null; },
    createElement() {
      return {
        id: '',
        style: {},
        innerHTML: '',
        value: '',
        select() {},
        remove() {
          if (this.id) elements.delete(this.id);
        },
      };
    },
    execCommand() { return true; },
  };
  const listeners = [];
  const window = {
    document,
    addEventListener() {},
    dispatchEvent() {},
    ...(options.window || {}),
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
  window.SGS91Assistant.registerService('gameMessages', {
    subscribe(listener) {
      listeners.push(listener);
      return () => {};
    },
  });
  window.SGS91Assistant.registerService('seatOverlay', options.seatOverlay || {
    findGameManager() { return null; },
    show() { return false; },
    clear() { return true; },
  });
  window.SGS91Assistant.registerService('noticeOverlay', options.noticeOverlay || {
    show() { return false; },
    clear() { return true; },
  });
  vm.runInNewContext(moduleSource, context, { filename: 'hu-ban-chongyi.user.js' });
  return { window, document, elements, listeners };
}

{
  const { window, listeners } = createRuntime();
  const api = window.HuBanChongyiHelper;
  const test = api.__test;
  const module = window.SGS91Assistant.getModule('hero.hu-ban.chongyi');
  assert.equal(module.api, api);
  assert.deepEqual(Array.from(module.characterIds), [1122]);
  assert.deepEqual(Array.from(module.skillIds), []);
  assert.equal(listeners.length, 1, '胡班模块只能订阅一次 91 助手内置消息服务');

  assert.equal(test.normalizePhase(4), 'play');
  assert.equal(test.normalizePhase('出牌阶段'), 'play');
  for (const name of ['杀', '火杀', '雷杀', '冰杀', '【普通杀】']) {
    assert.equal(test.isSlashName(name), true, name);
  }
  assert.equal(test.isSlashName('闪'), false);

  const ready = {
    enabled: true,
    twoVersusTwo: true,
    currentSeat: 0,
    alliedSeats: [0, 2],
    huBanSeats: [2],
    phase: 'play',
    firstCardPending: true,
    currentCards: [{ name: '杀' }, { name: '闪' }, { name: '雷杀' }],
  };
  assert.equal(test.evaluatePrompt(ready).show, true);
  assert.deepEqual(Array.from(test.evaluatePrompt(ready).slashIndexes), [0, 2]);
  assert.equal(test.evaluatePrompt({ ...ready, currentCards: [{ name: '闪' }] }).reason, 'no-visible-slash');
  assert.equal(test.evaluatePrompt({ ...ready, currentCards: [{ name: '闪' }] }).show, false,
    '胡班原版规则：当前可见手牌没有【杀】时不显示整套提示');
  assert.equal(test.evaluatePrompt({ ...ready, twoVersusTwo: false }).show, true,
    '不能用不稳定的模式探测结果覆盖已经确认的我方胡班、出牌阶段和可见杀证据');
  assert.equal(test.evaluatePrompt({ ...ready, currentSeat: 1 }).reason, 'current-seat-not-allied');
  assert.equal(test.evaluatePrompt({ ...ready, huBanSeats: [1] }).reason, 'allied-huban-not-found');
  assert.equal(test.evaluatePrompt({ ...ready, phase: 'draw' }).reason, 'not-play-phase');
  assert.equal(test.evaluatePrompt({ ...ready, firstCardPending: false }).reason, 'first-card-already-used');

  let state = test.createLogicState();
  state = test.reduceMessage(state, 'MsgGameSetCharacter', {
    characterInfo: [{ seat: 2, characterId: 1122 }],
  });
  assert.equal(state.generals[2], 1122);
  state = test.reduceMessage(state, 'MsgGameTurnNtf', { currentSeat: 2 });
  state = test.reduceMessage(state, 'MsgSetGamePhaseNtf', { seat: 2, phase: 4 });
  assert.equal(state.firstCardPending, true);
  state = test.reduceMessage(state, 'MsgUseCard', { srcSeat: 1, card: { CardName: '无懈可击' } });
  assert.equal(state.firstCardPending, true, '其他角色响应不能关闭当前角色提示');
  state = test.reduceMessage(state, 'MsgUseCard', { srcSeat: 2, card: { CardName: '杀' } });
  assert.equal(state.firstCardPending, false);
}

{
  const stage = new Sprite();
  const selfSeat = { SeatId: 0, GeneralId: 100, TeamId: 1 };
  const manager = {
    Seats: {
      0: selfSeat,
      1: { SeatId: 1, GeneralId: 101, TeamId: 2 },
      2: { SeatId: 2, GeneralId: 1122, TeamId: 1 },
      3: { SeatId: 3, GeneralId: 102, TeamId: 2 },
    },
    selfSeatIndex: 0,
    currentSeat: 0,
  };
  const handView = new Sprite();
  handView.seat = selfSeat;
  const cardContainer = new Sprite();
  cardContainer.cardUis = [];
  handView.cardContainer = cardContainer;
  handView.addChild(cardContainer);
  stage.addChild(handView);
  const dodge = new Sprite();
  dodge.Card = { CardName: '闪' };
  dodge.pos(500, 800);
  dodge.size(120, 180);
  cardContainer.cardUis.push(dodge);
  cardContainer.addChild(dodge);

  const noticeCalls = [];
  const runtime = createRuntime({
    window: { Laya: { stage, Sprite, Text } },
    seatOverlay: {
      findGameManager() { return manager; },
      show() { throw new Error('胡班顶部提示不得走座位条通道'); },
      clear() { return true; },
    },
    noticeOverlay: {
      show(...args) { noticeCalls.push(['show', ...args]); return true; },
      clear(...args) { noticeCalls.push(['clear', ...args]); return true; },
    },
  });
  runtime.listeners[0]('MsgGameTurnNtf', { currentSeat: 0 });
  runtime.listeners[0]('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });
  assert.equal(runtime.elements.has('sgs91-hu-ban-chongyi-tip'), false,
    '当前可见手牌没有杀时应与胡班原版一致，不显示顶部提示');
  assert.equal(noticeCalls.some(([method]) => method === 'show'), false,
    '当前可见手牌没有杀时不应显示锦囊袋同款顶部提示');
  assert.equal(walk(stage).filter((node) => node instanceof Text).length, 0,
    '没有杀时不应绘制推荐标记');
}

{
  const stage = new Sprite();
  const selfSeat = { SeatId: 0, GeneralId: 100, TeamId: 1 };
  const teammateSeat = { SeatId: 2, GeneralId: 1122, TeamId: 1 };
  const manager = {
    Seats: {
      0: selfSeat,
      1: { SeatId: 1, GeneralId: 101, TeamId: 2 },
      2: teammateSeat,
      3: { SeatId: 3, GeneralId: 102, TeamId: 2 },
    },
    selfSeatIndex: 0,
    currentSeat: 0,
  };
  const handView = new Sprite();
  handView.seat = selfSeat;
  const cardContainer = new Sprite();
  cardContainer.cardUis = [];
  handView.cardContainer = cardContainer;
  handView.addChild(cardContainer);
  stage.addChild(handView);

  const slash = new Sprite();
  slash.Card = { CardName: '杀' };
  slash.pos(500, 800);
  slash.size(120, 180);
  cardContainer.cardUis.push(slash);
  cardContainer.addChild(slash);

  const dodge = new Sprite();
  dodge.Card = { CardName: '闪' };
  dodge.pos(620, 800);
  dodge.size(120, 180);
  cardContainer.cardUis.push(dodge);
  cardContainer.addChild(dodge);

  const seatTipCalls = [];
  const noticeCalls = [];
  const runtime = createRuntime({
    window: { Laya: { stage, Sprite, Text } },
    seatOverlay: {
      findGameManager() { return manager; },
      show(...args) { seatTipCalls.push(['show', ...args]); return true; },
      clear(...args) { seatTipCalls.push(['clear', ...args]); return true; },
    },
    noticeOverlay: {
      show(...args) { noticeCalls.push(['show', ...args]); return true; },
      clear(...args) { noticeCalls.push(['clear', ...args]); return true; },
    },
  });
  runtime.listeners[0]('MsgGameTurnNtf', { currentSeat: 0 });
  runtime.listeners[0]('MsgSetGamePhaseNtf', { seat: 0, phase: 4 });

  assert.equal(runtime.elements.has('sgs91-hu-ban-chongyi-tip'), false,
    '胡班提示不得再创建屏幕中央的大横幅');
  assert.equal(seatTipCalls.some(([method]) => method === 'show'), false,
    '胡班提示不得显示在武将牌旁的座位条上');
  const notice = noticeCalls.find(([method]) => method === 'show');
  assert.ok(notice, '满足条件时必须使用锦囊袋同款私有顶部提示服务');
  assert.equal(notice[1], 'hu-ban-chongyi-tip');
  assert.equal(notice[2].lane, 'private');
  assert.equal(notice[2].anchor, 'before-action-prompt',
    '胡班提示必须动态跟随游戏自己的出牌阶段提示，不能使用固定屏幕高度');
  assert.equal(notice[2].text, 'Tips：崇义：首张出【杀】');
  assert.deepEqual(Array.from(notice[2].parts, (part) => part.text), ['Tips：', '崇义：', '首张出', '【杀】']);
  assert.deepEqual(Array.from(notice[2].parts, (part) => part.color),
    ['#f6de9c', '#c7de2c', '#f6de9c', '#E7B43C']);
  const labels = walk(stage).filter((node) => node instanceof Text).map((node) => node.text);
  assert.deepEqual(labels, ['推荐'], '只在【杀】上方标记“推荐”');

  runtime.listeners[0]('MsgUseCard', { srcSeat: 0, card: { CardName: '桃' } });
  assert.equal(runtime.elements.has('sgs91-hu-ban-chongyi-tip'), false, '使用首张牌后应隐藏提示');
  assert.ok(noticeCalls.some(([method, key]) => method === 'clear' && key === 'hu-ban-chongyi-tip'),
    '使用首张牌后应清除锦囊袋同款顶部提示');
  assert.equal(walk(stage).filter((node) => node instanceof Text).length, 0, '使用首张牌后应清除推荐标记');
}

assert.doesNotMatch(moduleSource, /__JND/, '胡班模块不得依赖其他油猴脚本');
assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest|@require/);
console.log('PASS 胡班崇义首牌规则、胡班识别、我方判定与状态切换');
console.log('PASS 胡班提示使用 91 助手内置消息服务并自行绘制提示与推荐标记');
console.log('PASS 胡班模块无其他油猴脚本、远程代码或网络请求依赖');
