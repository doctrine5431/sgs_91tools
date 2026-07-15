'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;

function listUserscriptFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return listUserscriptFiles(relativePath);
      return entry.isFile() && entry.name.endsWith('.user.js') ? [relativePath] : [];
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function readModule(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    .replace(/\r\n?/g, '\n')
    .replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, '')
    .replaceAll('__SGS91_VERSION__', version)
    .trim();
  return `// ---- ${relativePath.replaceAll('\\', '/')} ----\n${source}`;
}

const header = `// ==UserScript==
// @name         三国杀91助手
// @namespace    https://github.com/doctrine5431
// @version      ${version}
// @description  多武将只读对局助手：提供技能状态、目标与手牌提示，并支持手牌花色排序。
// @author       FAWEI
// @license      MIT
// @homepageURL  https://github.com/doctrine5431/sgs_91tools
// @supportURL   https://github.com/doctrine5431/sgs_91tools/issues
// @updateURL    https://github.com/doctrine5431/sgs_91tools/releases/latest/download/sgs91-assistant.user.js
// @downloadURL  https://github.com/doctrine5431/sgs_91tools/releases/latest/download/sgs91-assistant.user.js
// @match        https://web.sanguosha.com/*
// @match        https://*.sanguosha.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==`;

const sourceFiles = [
  ...listUserscriptFiles(path.join('src', 'core')),
  ...listUserscriptFiles(path.join('src', 'heroes')),
  ...listUserscriptFiles(path.join('src', 'features')),
];
if (!sourceFiles.length) throw new Error('No userscript modules found.');

const moduleBody = sourceFiles.map(readModule).join('\n\n');
const output = `${header}

(function (sgs91PageWindow) {
  'use strict';

  // Tampermonkey/Violentmonkey 会把 GM 菜单 API 放在隔离环境中。
  // 所有游戏读取与显示逻辑必须显式使用真实页面 window，才能访问 Laya 和游戏消息。
  const window = sgs91PageWindow;
  const document = sgs91PageWindow.document;
  const location = sgs91PageWindow.location;
  const navigator = sgs91PageWindow.navigator;
  const console = sgs91PageWindow.console || globalThis.console;
  const CustomEvent = sgs91PageWindow.CustomEvent || globalThis.CustomEvent;

${moduleBody}
})(typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window);
`;
const outputPaths = [
  path.join(root, 'dist', '三国杀91助手.user.js'),
  path.join(root, 'dist', 'sgs91-assistant.user.js'),
];
fs.mkdirSync(path.dirname(outputPaths[0]), { recursive: true });
for (const outputPath of outputPaths) fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Built ${outputPaths.map((item) => path.relative(root, item)).join(', ')} from ${sourceFiles.length} modules (${output.length} chars each)`);
