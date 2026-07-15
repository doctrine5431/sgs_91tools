'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const moduleSource = fs.readFileSync(path.join(root, 'src', 'features', 'suit-sorter.user.js'), 'utf8');

function createRuntime(initialEnabled) {
  const elements = new Map();
  const commands = new Map();
  const saved = [];
  const listeners = new Map();
  let commandSequence = 0;

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

  const document = {
    body: createHost(),
    head: createHost(),
    documentElement: createHost(),
    getElementById(id) { return elements.get(id) || null; },
    createElement(tagName) {
      const ownListeners = new Map();
      return {
        tagName,
        id: '',
        style: {},
        classList: { add() {}, remove() {} },
        offsetLeft: 0,
        offsetTop: 0,
        addEventListener(type, listener) { ownListeners.set(type, listener); },
        removeEventListener(type) { ownListeners.delete(type); },
        remove() {
          if (this.id) elements.delete(this.id);
          if (this.parentNode?.children) {
            this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
          }
        },
      };
    },
    addEventListener(type, listener) { listeners.set(`document:${type}`, listener); },
    removeEventListener(type) { listeners.delete(`document:${type}`); },
  };

  const window = {
    document,
    Laya: { stage: {} },
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener(type, listener) { listeners.set(`window:${type}`, listener); },
    removeEventListener(type) { listeners.delete(`window:${type}`); },
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
    GM_getValue(key, fallback) { return key === 'sgs91-floating-window-enabled' ? initialEnabled : fallback; },
    GM_setValue(key, value) { saved.push([key, value]); initialEnabled = value; },
    GM_registerMenuCommand(label, callback, options) {
      const id = options?.id || `command-${++commandSequence}`;
      commands.set(id, { label, callback, options });
      return id;
    },
    GM_unregisterMenuCommand(id) { commands.delete(id); },
  };
  window.window = window;
  window.location = context.location;
  window.navigator = context.navigator;
  vm.runInNewContext(coreSource, context, { filename: '00-registry.user.js' });
  vm.runInNewContext(moduleSource, context, { filename: 'suit-sorter.user.js' });
  return {
    window,
    elements,
    commands,
    saved,
    currentCommand() { return Array.from(commands.values()).at(-1); },
  };
}

{
  const runtime = createRuntime(false);
  const api = runtime.window.SGS91CardSorter;
  assert.equal(api.isFloatingBallEnabled(), false);
  assert.equal(runtime.elements.has('sgs91-suit-sorter'), false, '首次安装默认不能显示悬浮窗');
  assert.match(runtime.currentCommand()?.label || '', /开启 91 悬浮窗/);

  runtime.currentCommand().callback();
  assert.equal(api.isFloatingBallEnabled(), true);
  assert.equal(runtime.elements.has('sgs91-suit-sorter'), true, '菜单开启后应立即显示悬浮窗');
  assert.match(runtime.currentCommand()?.label || '', /关闭 91 悬浮窗/);
  assert.deepEqual(runtime.saved.at(-1), ['sgs91-floating-window-enabled', true]);

  runtime.currentCommand().callback();
  assert.equal(api.isFloatingBallEnabled(), false);
  assert.equal(runtime.elements.has('sgs91-suit-sorter'), false, '菜单关闭后应立即移除悬浮窗');
  assert.match(runtime.currentCommand()?.label || '', /开启 91 悬浮窗/);
  assert.deepEqual(runtime.saved.at(-1), ['sgs91-floating-window-enabled', false]);
}

{
  const runtime = createRuntime(true);
  assert.equal(runtime.window.SGS91CardSorter.isFloatingBallEnabled(), true);
  assert.equal(runtime.elements.has('sgs91-suit-sorter'), true, '用户开启后的选择应在刷新页面后保留');
}

assert.doesNotMatch(moduleSource, /fetch\s*\(|XMLHttpRequest|GM_xmlhttpRequest/);
console.log('PASS 91 悬浮窗默认关闭、油猴菜单开关、即时显示隐藏和持久化设置');
