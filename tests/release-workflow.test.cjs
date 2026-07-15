'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const request = JSON.parse(fs.readFileSync(path.join(root, '.github', 'release-request.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const assetPath = path.join(root, request.asset);
const notesPath = path.join(root, request.notes);

function extractRunScripts(source) {
  const lines = source.split(/\r?\n/);
  const scripts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)run:\s*\|\s*$/);
    if (!match) continue;
    const bodyIndent = match[1].length + 2;
    const body = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() && line.match(/^\s*/)[0].length < bodyIndent) {
        index -= 1;
        break;
      }
      body.push(line.length >= bodyIndent ? line.slice(bodyIndent) : '');
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
}

assert.equal(request.tag, `v${packageJson.version}`, '发布标签必须与 package.json 版本一致');
assert.equal(request.assetLabel, `sgs91-assistant-${request.tag}.user.js`,
  'Release 附件显示名称必须带版本号');
assert.ok(fs.existsSync(notesPath), '发布说明文件必须存在');
assert.ok(fs.existsSync(assetPath), 'Release 成品文件必须存在');

const actualSha = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex').toUpperCase();
assert.equal(request.sha256, actualSha, '发布清单 SHA-256 必须与成品一致');
assert.equal(fs.readFileSync(assetPath).includes(Buffer.from('\r\n')), false, 'Release 成品必须统一使用 LF 换行');
assert.match(readme,
  /https:\/\/github\.com\/doctrine5431\/sgs_91tools\/releases\/latest\/download\/sgs91-assistant\.user\.js/,
  '主页一键安装必须始终使用不会随版本变化的稳定下载地址');
assert.doesNotMatch(readme, /releases\/latest\/download\/sgs91-assistant-v\d/,
  '主页一键安装不得指向带版本号的附件显示名称');

assert.match(workflow, /paths:\s*[\s\S]*\.github\/release-request\.json/);
assert.match(workflow, /permissions:\s*[\s\S]*contents:\s*write/);
assert.match(workflow, /git ls-remote --exit-code --tags/);
assert.match(workflow, /gh release create/);
assert.doesNotMatch(workflow, /cp "\$ASSET"/);
assert.match(workflow, /gh release upload "\$TAG" "\$ASSET#\$ASSET_LABEL" --clobber/);
assert.match(workflow, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);

const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
assert.ok(process.platform !== 'win32' || fs.existsSync(bash), 'Windows 本地验证需要 Git Bash');
for (const [index, script] of extractRunScripts(workflow).entries()) {
  const result = childProcess.spawnSync(bash, ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, `Release 工作流第 ${index + 1} 个 Bash 脚本语法错误：${result.stderr}`);
}

console.log('PASS 自动发布清单与版本、说明、成品及 SHA-256 一致');
console.log('PASS Release 成品使用跨平台一致的 LF 换行');
console.log('PASS GitHub Actions 包含标签验证、Release 创建和附件上传权限');
console.log('PASS Release 只上传一个附件，并以带版本号的名称显示');
console.log('PASS Release 工作流中的 Bash 脚本通过真实语法检查');
console.log('PASS 主页一键安装始终指向稳定下载地址');
