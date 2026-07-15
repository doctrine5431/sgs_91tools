'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'dist', '三国杀91助手.user.js'), 'utf8');
const releaseAsset = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sgs91-assistant.user.js'), 'utf8');

assert.equal((source.match(/\/\/ ==UserScript==/g) || []).length, 1, '合并脚本只能有一个元数据头');
assert.equal((source.match(/\/\/ ==\/UserScript==/g) || []).length, 1, '合并脚本只能有一个元数据尾');
assert.match(source, /@name\s+三国杀91助手/);
assert.match(source, /@namespace\s+https:\/\/github\.com\/doctrine5431/);
assert.match(source, /@version\s+0\.3\.0/);
assert.match(source, /@homepageURL\s+https:\/\/github\.com\/doctrine5431\/sgs_91tools/);
assert.match(source, /@supportURL\s+https:\/\/github\.com\/doctrine5431\/sgs_91tools\/issues/);
assert.match(source, /@updateURL\s+https:\/\/github\.com\/doctrine5431\/sgs_91tools\/releases\/latest\/download\/sgs91-assistant\.user\.js/);
assert.match(source, /@downloadURL\s+https:\/\/github\.com\/doctrine5431\/sgs_91tools\/releases\/latest\/download\/sgs91-assistant\.user\.js/);
assert.match(source, /@grant\s+GM_registerMenuCommand/);
assert.match(source, /@grant\s+GM_getValue/);
assert.match(source, /@grant\s+GM_setValue/);
assert.match(source, /@grant\s+unsafeWindow/);
assert.doesNotMatch(source, /@sandbox\s+raw/);
assert.doesNotMatch(source, /@inject-into\s+page/);
assert.match(source, /typeof unsafeWindow !== 'undefined'/);
assert.equal(releaseAsset, source, 'Release 附件必须与中文成品脚本完全一致');
assert.match(source, /characterIds:\s*\{\s*mouDengAi:\s*1740,/);
assert.match(source, /skillIds:\s*\{\s*juxi:\s*3716,/);
assert.match(source, /window\.MouDengAiJuxiHelper\s*=/);
assert.match(source, /window\.LinglieShouhuHelper\s*=/);
assert.match(source, /window\.ZhangYuXiangchenHelper\s*=/);
assert.match(source, /window\.HuBanChongyiHelper\s*=/);
assert.match(source, /window\.HuanJieJianliHelper\s*=/);
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
  unsafeWindow: window,
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
assert.equal(window.SGS91Assistant.version, '0.3.0');
assert.equal(window.SGS91Assistant.getModule('hero.mou-deng-ai.juxi').api, window.MouDengAiJuxiHelper);
assert.equal(window.SGS91Assistant.getModule('hero.linglie.shouhu').api, window.LinglieShouhuHelper);
assert.equal(window.SGS91Assistant.getModule('hero.zhang-yu.xiangchen').api, window.ZhangYuXiangchenHelper);
assert.equal(window.SGS91Assistant.getModule('hero.hu-ban.chongyi').api, window.HuBanChongyiHelper);
assert.equal(window.SGS91Assistant.getModule('hero.huan-jie.jianli').api, window.HuanJieJianliHelper);
assert.equal(window.SGS91Assistant.getModule('feature.hand-suit-sorter').api, window.SGS91CardSorter);
assert.equal(window.SGS91Assistant.listModules().length, 6);
assert.equal(window.SGS91Assistant.listModules('hero').length, 5);
assert.ok(window.SGS91Assistant.getService('gameScene'));
assert.ok(window.SGS91Assistant.getService('gameMessages'));
assert.ok(window.SGS91Assistant.getService('noticeOverlay'));
assert.ok(window.SGS91Assistant.getService('seatOverlay'));
assert.equal(typeof window.SGS91CardSorter.sortBySuit, 'function');
assert.equal(window.SGS91CardSorter.isFloatingBallEnabled(), false, '91 悬浮窗必须默认关闭');

console.log('PASS 发布脚本包含谋邓艾、凌烈、张裕、胡班、桓阶提示与花色排序');
console.log('PASS 发布脚本保持只读、无远程代码和无上传请求');
console.log('PASS 合并脚本可加载并注册六个功能模块');
console.log('PASS 核心可查询武将、功能和共享游戏场景服务');
console.log('PASS GitHub 地址、自动更新地址和 Release 附件一致');
