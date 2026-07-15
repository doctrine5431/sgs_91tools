'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', '三国杀91助手.user.js'), 'utf8');

assert.equal((source.match(/\/\/ ==UserScript==/g) || []).length, 1, '合并脚本只能有一个元数据头');
assert.equal((source.match(/\/\/ ==\/UserScript==/g) || []).length, 1, '合并脚本只能有一个元数据尾');
assert.match(source, /@name\s+三国杀91助手/);
assert.match(source, /@version\s+0\.2\.0/);
assert.match(source, /characterIds:\s*\{\s*mouDengAi:\s*1740,/);
assert.match(source, /skillIds:\s*\{\s*juxi:\s*3716,/);
assert.match(source, /window\.MouDengAiJuxiHelper\s*=/);
assert.match(source, /window\.SGS91CardSorter\s*=/);
assert.match(source, /window\.SGS91Assistant\s*=/);
assert.match(source, /function sortBySuit\(/);
assert.match(source, /sgs91-suit-sorter/);
assert.doesNotMatch(source, /@require/);
assert.doesNotMatch(source, /fetch\s*\(/);
assert.doesNotMatch(source, /XMLHttpRequest/);
assert.doesNotMatch(source, /GM_xmlhttpRequest/);

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

vm.runInNewContext(source, context, { filename: 'sgs91-assistant.user.js' });
assert.equal(window.SGS91Assistant.version, '0.2.0');
assert.equal(window.SGS91Assistant.getModule('hero.mou-deng-ai.juxi').api, window.MouDengAiJuxiHelper);
assert.equal(window.SGS91Assistant.getModule('feature.hand-suit-sorter').api, window.SGS91CardSorter);
assert.equal(window.SGS91Assistant.listModules().length, 2);
assert.equal(window.SGS91Assistant.listModules('hero').length, 1);
assert.ok(window.SGS91Assistant.getService('gameScene'));
assert.equal(typeof window.SGS91CardSorter.sortBySuit, 'function');

console.log('PASS 发布脚本包含谋邓艾骤袭与花色排序');
console.log('PASS 发布脚本保持只读、无远程代码和无上传请求');
console.log('PASS 合并脚本可加载并注册两个功能模块');
console.log('PASS 核心可查询武将、功能和共享游戏场景服务');
