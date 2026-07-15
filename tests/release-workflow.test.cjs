'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const request = JSON.parse(fs.readFileSync(path.join(root, '.github', 'release-request.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const assetPath = path.join(root, request.asset);
const notesPath = path.join(root, request.notes);

assert.equal(request.tag, `v${packageJson.version}`, '发布标签必须与 package.json 版本一致');
assert.ok(fs.existsSync(notesPath), '发布说明文件必须存在');
assert.ok(fs.existsSync(assetPath), 'Release 成品文件必须存在');

const actualSha = crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex').toUpperCase();
assert.equal(request.sha256, actualSha, '发布清单 SHA-256 必须与成品一致');

assert.match(workflow, /paths:\s*[\s\S]*\.github\/release-request\.json/);
assert.match(workflow, /permissions:\s*[\s\S]*contents:\s*write/);
assert.match(workflow, /git ls-remote --exit-code --tags/);
assert.match(workflow, /gh release create/);
assert.match(workflow, /gh release upload "\$TAG" "\$ASSET" --clobber/);
assert.match(workflow, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);

console.log('PASS 自动发布清单与版本、说明、成品及 SHA-256 一致');
console.log('PASS GitHub Actions 包含标签验证、Release 创建和附件上传权限');
