'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', '00-registry.user.js'), 'utf8')
  .replaceAll('__SGS91_VERSION__', 'test-version');
const window = {};
vm.runInNewContext(source, { window, console }, { filename: '00-registry.user.js' });

const app = window.SGS91Assistant;
assert.equal(app.version, 'test-version');
assert.equal(app.listModules().length, 0);

const api = { run() { return true; } };
const registeredModule = app.registerModule({
  id: 'hero.test.skill',
  type: 'hero',
  name: '测试武将·测试技能',
  version: '1.0.0',
  capabilities: ['game-message-read'],
  characterIds: [1000],
  skillIds: [2000],
  api,
});
assert.equal(app.getModule('hero.test.skill'), registeredModule);
assert.equal(app.listModules('hero').length, 1);
assert.equal(registeredModule.api, api);
assert.throws(() => app.registerModule({ id: 'hero.test.skill', type: 'hero', name: '重复', version: '1' }), /Duplicate/);
assert.throws(() => app.registerModule({ id: 'bad', type: 'unknown', name: '错误', version: '1' }), /Unsupported/);

const service = { value: 91 };
app.registerService('test', service);
assert.equal(app.getService('test'), service);
assert.throws(() => app.registerService('test', {}), /Duplicate/);

let received = null;
const unsubscribe = app.on('test:event', (payload) => { received = payload; });
app.emit('test:event', 91);
assert.equal(received, 91);
unsubscribe();
received = null;
app.emit('test:event', 92);
assert.equal(received, null);

console.log('PASS 核心注册、查询、重复保护、共享服务和事件总线');
