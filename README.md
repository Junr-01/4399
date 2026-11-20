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
