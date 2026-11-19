# 对弈工具

## `get_position` 查看公开局面

输入 `{}`，返回 JSON。点号从左上角的 0 开始，由上往下逐行编号，每行由左往右，一共 60 点。

| 字段 | 含义 |
| --- | --- |
| `board` | 60 个棋盘点。空点为 `null`，暗子为 `"dark"`，明子为 `{ color, type }`。颜色为 `red` 或 `blue`。 |
| `sides` | `{ human, ai }`，对应人类玩家和你的阵营。定阵营前为 `null`。 |
| `flips` | `{ human, ai }`，双方各自上一次翻出的颜色，未翻过时为 `null`。定阵营前用于判断下一次是否翻到同色。 |
| `mines` | `{ red, blue }`，各颜色尚未离场的地雷总数，包括仍扣着的地雷。 |
| `quiet` | 自上一次翻棋或有棋子离场后，双方合计连续移动的着数。 |
| `last` | 最近公开行动，含 `action`、`to`、`player` 和 `piece`。走棋还有 `from`，交战时还含 `target` 和 `survivor`（无幸存棋子为 `null`）。开局未行动时为 `null`。 |
| `moveCommitted` | 为真表示你在当前 AI 回合已成功行动，包括会话异常后重试的情况。 |
| `legal` | 当前可选行动。翻棋含 `action: "flip"` 与 `to`，走棋含 `action: "move"`、`from` 与 `to`。本回合已提交时为空。 |

棋子 `type` 为 `commander`（司令）、`general`（军长）、`division`（师长）、`brigade`（旅长）、`regiment`（团长）、`battalion`（营长）、`company`（连长）、`platoon`（排长）、`engineer`（工兵）、`bomb`（炸弹）、`mine`（地雷）或 `flag`（军旗）。

## `play_action` 翻棋或走棋

提交 `legal` 中的一项。翻棋输入形如 `{ "action": "flip", "to": 6 }`。走棋输入形如 `{ "action": "move", "from": 6, "to": 11 }`。

- `success: true` 返回「行动成功。」行动已提交。
- `success: false` 返回失败原因。若返回「本回合已行动。」，说明先前成功的行动已保留。若本次请求已经失效，在新回合重新查看局面。
