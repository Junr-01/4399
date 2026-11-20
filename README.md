# 43gg

和AI玩几把。

## 本地开发

使用 Node.js 24。使用 nvm 时，运行 `nvm use` 切换到项目指定的版本。

```sh
npm ci
npm run lint
npm test
```

`npm run lint` 检查项目的 JavaScript 代码，跳过 `scripts/vendor/` 下的第三方代码。

每次克隆后，运行 `git config --local core.hooksPath .githooks` 启用提交钩子。提交前会执行 `npm run lint`。

推送到 `dev` 或 `main`，或向这两个分支提交 PR 时，GitHub Actions 会执行 lint 和测试。
