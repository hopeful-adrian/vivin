// Usage: pnpm release [patch|minor|major|<x.y.z>] [--no-push]
// Bumps every version field, commits, and pushes main so the Release workflow publishes it.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const push = !args.includes('--no-push');
const bump = args.find((arg) => !arg.startsWith('--')) ?? 'patch';

const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (git('status', '--porcelain')) fail('工作区有未提交的改动，请先提交或暂存后再发版。');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (push && branch !== 'main') fail(`当前在 ${branch} 分支，只有推送 main 才会发布。`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const current = pkg.version.split('.').map(Number);
let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
else if (bump === 'major') next = `${current[0] + 1}.0.0`;
else if (bump === 'minor') next = `${current[0]}.${current[1] + 1}.0`;
else if (bump === 'patch') next = `${current[0]}.${current[1]}.${current[2] + 1}`;
else fail(`无法识别的版本参数：${bump}`);

const newer = next.split('.').map(Number);
const order = newer[0] - current[0] || newer[1] - current[1] || newer[2] - current[2];
if (order <= 0) fail(`新版本 ${next} 必须大于当前版本 ${pkg.version}，否则已安装的应用不会更新。`);

const replace = (file, pattern, value) => {
  const text = readFileSync(file, 'utf8');
  if (!pattern.test(text)) fail(`${file} 中找不到版本号。`);
  writeFileSync(file, text.replace(pattern, value));
};
replace('package.json', /("version":\s*")[^"]+/, `$1${next}`);
replace('src-tauri/tauri.conf.json', /("version":\s*")[^"]+/, `$1${next}`);
replace('src-tauri/Cargo.toml', /^(version = ")[^"]+/m, `$1${next}`);
replace('src-tauri/Cargo.lock', /(name = "vivin"\nversion = ")[^"]+/, `$1${next}`);

git(
  'commit',
  '-m',
  `chore(release): 发布 ${next}`,
  '--',
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
);
if (push) {
  git('push', 'origin', 'main');
  console.log(`已推送 ${next}，Release 工作流会构建并发布 v${next}。`);
} else console.log(`已提交 ${next}，推送 main 后发布。`);
