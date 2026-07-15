'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const overlaySource = fs.readFileSync(path.join(root, 'src', 'core', '30-seat-overlay.user.js'), 'utf8');

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
}

class Sprite {
  constructor() {
    this.name = '';
    this._children = [];
    this.graphics = {
      drawRect: (...args) => { this.drawRectArgs = args; },
      drawTexture: (...args) => { this.drawTextureArgs = args; },
    };
  }
  size(width, height) { this.width = width; this.height = height; }
  pos(x, y) { this.x = x; this.y = y; }
  addChild(child) { this._children.push(child); }
  removeSelf() { this.removed = true; }
}

class Text {}

const avatar = {
  width: 100,
  height: 80,
  localToGlobal(point) { return new Point(400 + point.x, 300 + point.y); },
};
const manager = {
  selfSeatIndex: 0,
  Seats: {
    0: { GeneralId: 100 },
    1: { GeneralId: 1912, SeatUI: { seatAvatar: avatar } },
  },
};
const layer = {
  name: 'seatComboSprite',
  _children: [],
  globalToLocal(point) { return point; },
  addChild(child) { this._children.push(child); },
};
const stage = {
  _children: [{ gameManager: manager }, layer],
  addChild(child) { this._children.push(child); },
};
const document = {
  body: null,
  getElementById() { return null; },
};
const seatTexture = { width: 175, height: 23 };
const window = {
  document,
  Laya: {
    Point,
    Sprite,
    Text,
    stage,
    loader: { getRes() { return { bitmap: { id: 'yjcm-seat-bitmap' } }; } },
    Texture: { create() { return seatTexture; } },
  },
};
window.window = window;
const context = { window, document, console };

assert.equal('__JND' in window, false);
vm.runInNewContext(coreSource, context, { filename: '00-registry.user.js' });
vm.runInNewContext(overlaySource, context, { filename: '30-seat-overlay.user.js' });

const overlay = window.SGS91Assistant.getService('seatOverlay');
assert.equal(overlay.findGameManager(), manager);
assert.equal(overlay.show('xiangchen-1', 1, '相谶目标', { color: '#f4d17b' }), true);
const rendered = overlay.probe();
assert.equal(rendered.length, 1);
assert.equal(rendered[0].mode, 'laya');
assert.equal(rendered[0].seat, 1);
const strip = layer._children.find((item) => item.name === 'sgs91-seat-overlay-xiangchen-1');
assert.equal(strip?._children?.[0]?.text, '相谶目标');
assert.deepEqual([strip.width, strip.height], [175, 23], '座位条尺寸必须与锦囊袋一致');
assert.deepEqual([strip.x, strip.y], [370, 357], '座位条必须使用武将牌中心点加锦囊袋偏移定位');
assert.equal(strip.drawTextureArgs?.[0], seatTexture, '座位条必须使用锦囊袋同款游戏纹理');
assert.equal(strip._children[0].font, 'FZBW');
assert.equal(strip._children[0].fontSize, 16);
assert.equal(strip._children[0].color, '#f4d17b');
overlay.clear('xiangchen-1');
assert.equal(strip.removed, true);
assert.equal(overlay.probe().length, 0);

console.log('PASS 不借助其他脚本时，91 助手可用 Laya 自行显示和清理座位文字');
