'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sgs91-assistant.user.js'), 'utf8');
const elements = new Map();
const commands = new Map();

function createHost() {
  return {
    children: [],
    appendChild(element) {
      this.children.push(element);
      element.parentNode = this;
      if (element.id) elements.set(element.id, element);
    },
  };
}

const pageDocument = {
  body: createHost(),
  head: createHost(),
  documentElement: createHost(),
  getElementById(id) { return elements.get(id) || null; },
  createElement(tagName) {
    return {
      tagName,
      id: '',
      title: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {} },
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
      remove() {
        if (this.id) elements.delete(this.id);
        if (this.parentNode?.children) {
          this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
        }
      },
      select() {},
    };
  },
  addEventListener() {},
  removeEventListener() {},
  execCommand() { return true; },
};

const pageConsole = {
  log() {},
  error() {},
  warn() {},
};
const pageWindow = {
  document: pageDocument,
  location: { href: 'https://web.sanguosha.com/x/pc/index.php?lf=0' },
  navigator: {},
  console: pageConsole,
  Laya: { stage: {} },
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
pageWindow.window = pageWindow;

// 模拟 Chrome 油猴隔离环境：脚本的 window 与游戏页 unsafeWindow 不是同一个对象。
const sandboxWindow = {
  document: pageDocument,
  location: pageWindow.location,
  navigator: pageWindow.navigator,
  console,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
};
sandboxWindow.window = sandboxWindow;

const context = {
  window: sandboxWindow,
  unsafeWindow: pageWindow,
  document: pageDocument,
  location: pageWindow.location,
  navigator: pageWindow.navigator,
  console,
  setTimeout() { return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
  clearInterval() {},
  GM_getValue(key, fallback) { return key === 'sgs91-floating-window-enabled' ? false : fallback; },
  GM_setValue() {},
  GM_registerMenuCommand(label, callback, options) {
    const id = options?.id || `menu-${commands.size + 1}`;
    commands.set(id, { label, callback });
    return id;
  },
  GM_unregisterMenuCommand(id) { commands.delete(id); },
};

vm.runInNewContext(source, context, { filename: 'sgs91-assistant.user.js' });

assert.ok(pageWindow.SGS91Assistant, '油猴隔离运行时，助手核心必须注册到真实游戏页面');
assert.equal(pageWindow.SGS91Assistant.listModules().length, 6, '真实游戏页面必须获得全部模块');
assert.ok(pageWindow.SGS91CardSorter, '花色排序 API 必须暴露到真实游戏页面');
assert.equal(commands.size, 1, '油猴菜单必须保留一个悬浮窗开关');

const command = Array.from(commands.values())[0];
assert.match(command.label, /开启 91 悬浮窗/);
command.callback();
assert.equal(elements.has('sgs91-suit-sorter'), true, '从油猴菜单开启后，必须在真实游戏页面显示 91 悬浮窗');
assert.equal(pageWindow.SGS91CardSorter.isFloatingBallEnabled(), true);
assert.equal(sandboxWindow.SGS91Assistant, undefined, '核心不应只留在无法访问游戏 Laya 的隔离 window 中');

console.log('PASS Chrome 油猴隔离环境仍能访问游戏页面并切换 91 悬浮窗');
