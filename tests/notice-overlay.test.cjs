'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const overlaySource = fs.readFileSync(path.join(root, 'src', 'core', '25-notice-overlay.user.js'), 'utf8');

class Graphics {
  constructor() { this.rects = []; }
  drawRect(...args) { this.rects.push(args); }
  clear() { this.rects = []; }
}

class Sprite {
  constructor() {
    this._children = [];
    this.parent = null;
    this.graphics = new Graphics();
    this.x = 0;
    this.y = 0;
    this.width = 0;
    this.height = 0;
    this.alpha = 1;
  }
  addChild(child) { child.parent = this; this._children.push(child); return child; }
  removeSelf() {
    if (this.parent) this.parent._children = this.parent._children.filter((child) => child !== this);
    this.parent = null;
    return this;
  }
  destroy() { this.removeSelf(); this._children = []; }
  size(width, height) { this.width = width; this.height = height; }
  pos(x, y) { this.x = x; this.y = y; }
}

class Text extends Sprite {
  constructor() { super(); this.text = ''; this.fontSize = 0; }
  get textWidth() {
    return Array.from(this.text).reduce((sum, character) => (
      sum + (/^[\x00-\xff]$/.test(character) ? this.fontSize * 0.58 : this.fontSize)
    ), 0);
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

const stage = new Sprite();
stage.width = 1600;
stage.height = 900;
const scene = new Sprite();
scene.width = 1600;
scene.height = 900;
const gameActionTipContainer = new Sprite();
scene.gameActionTipContainer = gameActionTipContainer;
scene.addChild(gameActionTipContainer);
stage.addChild(scene);
const actionPrompt = new Text();
actionPrompt.name = 'game-action-prompt';
actionPrompt.text = '出牌阶段，请选择一张卡牌';
actionPrompt.pos(0, 600);
gameActionTipContainer.addChild(actionPrompt);

const document = {
  body: { appendChild() {} },
  getElementById() { return null; },
  createElement() { return { style: {}, remove() {} }; },
};
const window = {
  document,
  Laya: {
    stage,
    Sprite,
    Text,
    loader: { getRes(name) { return name === 'gameActionBg' ? { width: 640, height: 50 } : null; } },
  },
  RES: { GetRes(name) { return name === 'gameActionBg' ? { width: 640, height: 50 } : null; } },
};
window.window = window;
const context = { window, document, console };
vm.runInNewContext(coreSource, context, { filename: '00-registry.user.js' });
vm.runInNewContext(overlaySource, context, { filename: '25-notice-overlay.user.js' });

const overlay = window.SGS91Assistant.getService('noticeOverlay');
assert.ok(overlay, '91 助手必须内置锦囊袋同款顶部提示服务');
const huBanNoticeOptions = {
  lane: 'private',
  anchor: 'before-action-prompt',
  text: 'Tips：崇义：首张出【杀】',
  parts: [
    { text: 'Tips：', font: 'FZBW', size: 24, color: '#f6de9c' },
    { text: '崇义：', font: 'FZBW', size: 24, color: '#c7de2c' },
    { text: '首张出', font: 'FZBW', size: 24, color: '#f6de9c' },
    { text: '【杀】', font: 'FZBW', size: 24, color: '#E7B43C' },
  ],
};
assert.equal(overlay.show('hu-ban-chongyi-tip', huBanNoticeOptions), true);

const feed = gameActionTipContainer._children.find((node) => node.name === 'sgs91-notice-feed');
assert.ok(feed, '顶部提示必须绘制在游戏的 gameActionTipContainer 中');
const row = feed._children.find((node) => node.name === 'sgs91-notice-overlay-hu-ban-chongyi-tip');
assert.ok(row);
assert.deepEqual([row.width, row.height], [832, 50], '私有提示栏必须使用锦囊袋 640×50 基准及 1.3 倍宽度');
assert.deepEqual([row.x, row.y], [384, 514],
  '胡班提示栏必须跟随实际出牌提示文字，并保持 36 像素间距，不能使用固定屏幕高度');

const gradientStrips = row._children.filter((node) => node.name === 'sgs91-notice-gradient-strip');
assert.equal(gradientStrips.length, 128, '提示栏必须使用锦囊袋同款 128 段渐隐背景');
assert.ok(gradientStrips[0].alpha < 0.01);
assert.ok(gradientStrips[64].alpha > 0.5);
assert.ok(gradientStrips[127].alpha < 0.01);

const labels = walk(row).filter((node) => node instanceof Text);
assert.deepEqual(labels.map((label) => label.text), ['Tips：', '崇义：', '首张出', '【杀】']);
assert.deepEqual(labels.map((label) => label.color), ['#f6de9c', '#c7de2c', '#f6de9c', '#E7B43C']);
assert.ok(labels.every((label) => label.font === 'FZBW' && label.fontSize === 24));

actionPrompt.pos(0, 760);
assert.equal(overlay.show('hu-ban-chongyi-tip', huBanNoticeOptions), true);
const movedRow = feed._children.find((node) => node.name === 'sgs91-notice-overlay-hu-ban-chongyi-tip');
assert.deepEqual([movedRow.x, movedRow.y], [384, 674],
  '窗口布局改变后，胡班提示栏必须继续跟随出牌提示文字一起移动');

overlay.clear('hu-ban-chongyi-tip');
assert.equal(feed._children.some((node) => node.name === 'sgs91-notice-overlay-hu-ban-chongyi-tip'), false);
assert.doesNotMatch(overlaySource, /__JND|fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest|@require/);
console.log('PASS 胡班顶部提示复刻锦囊袋私有通道的位置、尺寸、渐隐背景和分段字体颜色');
console.log('PASS 顶部提示服务完全内置，不依赖锦囊袋或远程代码');
