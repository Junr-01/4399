# 对弈工具

## `get_position`：查看局面

输入 `{}`。输出是 JSON：

| 字段 | 含义 |
| --- | --- |
| `board` | 90 个点，黑方在上、红方在下。每行 9 点，从左到右编号：第一行 0–8，最后一行 81–89。大写是红子，小写是黑子，`null` 是空点。`k/a/e/h/r/c/p` 依次表示帅将、仕士、相象、马、车、炮、兵卒。 |
| `check` | `true` 表示下一着要走的一方被将军：本回合尚未走棋时指你，已走棋时指玩家。 |
| `lastMove` | 最近一着 `{ from, to, side }`。点号与 `board` 相同；`side` 是 `"red"` 或 `"black"`。开局未走棋时为 `null`。 |
| `adjudication` | 待处理的重复局面裁决。无裁决时为 `null`。 |
| `moveCommitted` | `true` 表示你本回合已经走棋。异常重试时也以此为准：已走棋就结束回合。 |
| `legal` | 可提交的走法，每项是 `{ from, to }`。被将军时只列解将走法；已走棋时为 `[]`。 |

当 `adjudication` 有值时：

| 字段 | 含义 |
| --- | --- |
| `side` | `"red"` 或 `"black"` 表示该方必须打破循环，否则到期判负。`null` 表示双方继续重复到期会判和。你的棋色见本局的「先手」。 |
| `reason` | `perpetual-chase`：长捉；`perpetual-mate-threat`：长杀；`alternating-threats`：循环进攻；`repetition`：重复局面。 |
| `remaining` | 有应变方时，按该方剩余的走棋机会计数；`side` 为 `null` 时，按双方各走一着的完整回合计数。 |
| `requiresQuiet` | 若为 `true`，应变方还须在剩余机会里至少走一着「闲」；否则省略。 |

`legal` 里的走法可以提交，但继续原循环仍可能触发判罚。轮到你变着时，从 `legal` 中选一着打破循环。

## `move_piece`：走棋

提交从 `legal` 选出的 `{ from, to }`。两个点号都是必填的 0–89 整数。

- 成功（`success: true`）：返回「走棋成功。」棋子已移动。
- 失败（`success: false`）：返回原因。同一 AI 回合再次走棋会返回「本回合已走棋。」，保留第一次走棋的结果。如果着法不合法，可按原因改选；请求已失效时以新的回合为准。
