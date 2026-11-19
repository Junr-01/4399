# 对弈工具

## `get_position` 查看公开局面

输入 `{}`，返回 JSON。点号从左上角 0 开始，从左往右逐行编号，每行 8 格，右下角为 31。

| 字段 | 含义 |
| --- | --- |
| `board` | 32 格。空格为 `null`，暗子为 `"dark"`，明子为 `{ color, type }`。颜色为 `red` 或 `black`。 |
| `sides` | `{ human, ai }`，分别是玩家与你的执棋颜色。开局首翻前为 `null`。 |
| `quiet` | 最近一次翻棋或吃子起，双方合计连续无进展的着数。 |
| `last` | 最近的公开行动，包含 `action`、`player`（`human` 或 `ai`）、`to`、`piece`。走棋另含 `from`，吃子另有 `target`（被吃棋子）。未开始时为 `null`。 |
| `moveCommitted` | 为真表示当前 AI 回合已提交一着。会话重试时已提交的行动仍然有效。 |
| `legal` | 当前可选行动，包含 `action`、`to`，走棋另含 `from`。已提交行动后为空。 |

棋子 `type` 为 `general`（将帅）、`advisor`（仕士）、`elephant`（相象）、`chariot`（车）、`horse`（马）、`cannon`（炮）或 `soldier`（兵卒）。`piece` 和 `target` 沿用明子的表示。

## `play_action` 翻棋或走棋

提交 `legal` 中的一项。翻棋输入如 `{ "action": "flip", "to": 6 }`。走棋输入如 `{ "action": "move", "from": 6, "to": 14 }`。

- `success: true` 返回「行动成功。」，表示该着已提交。
- `success: false` 返回失败原因。「本回合已行动。」表示先前已成功提交。收到请求失效提示后，等到新回合再查看局面。
