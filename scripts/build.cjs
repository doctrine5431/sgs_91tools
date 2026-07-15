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
    .replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, '')
    .replaceAll('__SGS91_VERSION__', version)
    .trim();
  return `// ---- ${relativePath.replaceAll('\\', '/')} ----\n${source}`;
}

const header = `// ==UserScript==
// @name         三国杀91助手
// @namespace    https://z456.cc/sanguosha/91-assistant
// @version      ${version}
// @description  多武将只读对局助手：首版支持谋邓艾骤袭提示和手牌花色排序，不自动出牌、不上传数据。
// @author       FAWEI
// @license      MIT
// @match        https://web.sanguosha.com/*
// @match        https://*.sanguosha.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==`;

const sourceFiles = [
  ...listUserscriptFiles(path.join('src', 'core')),
  ...listUserscriptFiles(path.join('src', 'heroes')),
  ...listUserscriptFiles(path.join('src', 'features')),
];
if (!sourceFiles.length) throw new Error('No userscript modules found.');

const output = `${header}\n\n${sourceFiles.map(readModule).join('\n\n')}\n`;
const outputPath = path.join(root, 'dist', '三国杀91助手.user.js');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Built ${path.relative(root, outputPath)} from ${sourceFiles.length} modules (${output.length} chars)`);
