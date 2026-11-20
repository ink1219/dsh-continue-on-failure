# dsh-continue-on-failure

模型请求失败后，在 DSH 输入框上方出现一张「继续」卡片，点一下即可接着跑 —— 不用手动重新输入，也不用换模型再打一遍。

After a model request fails, a Continue card appears above the DSH composer. One click resends the turn — no retyping, no manual model switch.

## 做什么 / What it does

- **自动检测失败**：读取会话持久日志里最近一次 `turn/end` 的结束原因，与宿主 Chat 自身的失败判定（`error` / `interrupted` / 登出中断）保持一致。只在会话空闲时提示，运行中不打扰。
- **一键继续**：点击「继续」向同一会话投递一条重发消息（queue 模式），Agent 基于原有上下文接着跑。重试再次失败时按钮会重新出现。
- **原生外观**：卡片样式对齐宿主 QueueDock 面板（同款圆角、毛玻璃底、发丝边框与控件规格），全部使用主题 token，深浅色模式自动适配。
- **附赠**：每条已完成的 Assistant 消息上保留一个「重试」小按钮，可重新生成该条回复。

## 安装 / Install

在 DSH 里打开插件市场（dshmarket）添加本仓库为源，或直接对你的 Agent 说：

> 从 GitHub 安装插件 https://github.com/你的用户名/dsh-continue-on-failure

安装后无需配置，立即生效。

## 卸载 / Uninstall

插件页中禁用或移除 `dsh-continue-on-failure` 即可，不留任何数据。

## 原理简述 / How it works

纯 Client 半区插件（无 Host 逻辑、无依赖、不写任何持久数据）：

- 通过 `remote.session.events` 读取会话事件页，折叠出最近一轮的成败结论；
- 通过 `remote.session.state` 判断会话是否空闲；
- 通过 `remote.session.prompt` 投递继续消息；
- 渲染挂在 `conversation.input.dock`（失败卡片）与 `conversation.chat.assistant-actions`（重试按钮）两个官方槽位上。

## License

MIT
