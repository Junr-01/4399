# 43gg

和AI玩几把。

## 在 Codex 中安装

43gg 在 Codex 桌面版的右侧浏览器中运行，需要本机安装 Node.js 24。

### 让 Codex 帮你安装

在 Codex 桌面版中新建对话，发送这句话：

> 请帮我从 https://github.com/Junr-01/43gg 安装 43gg 插件。按 README 检查本机环境，安装完成后打开 43gg 游戏馆。

### 手动安装

如果终端可以运行 `codex` 命令，依次执行：

```sh
codex plugin marketplace add Junr-01/43gg --ref main
codex plugin add 43gg@43gg-local
```

安装后，在 Codex 桌面版的新对话中发送「打开 43gg 游戏馆」。如果新对话还找不到插件，重启桌面应用后再试。与 AI 对弈需要登录 Codex。
