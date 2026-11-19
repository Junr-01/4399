# 43gg 中国象棋：对照《象棋竞赛规则（2020版）》

核对日期：2026-11-18。修复前的代码基线：`432e4ea`。

中国象棋协会审定、人民体育出版社出版的[《象棋竞赛规则（2020版）》](https://wdd66d.top/downloads/qigui/Xqqg2020.pdf)是这次核对的依据。[2026 年第 58 届全国象棋锦标赛（个人）竞赛规程](https://www.sport.gov.cn/qpzx/n5387/c30123103/content.html)第十一条明确采用这一版。本文补充[原规则调研](rules-research.md)，关注现有代码的行为。网页条文便于查阅，棋例的初始盘面以出版物 PDF 为准。

**结论：基础行棋、将军与应将、将死与困毙符合规则。本轮逐例修正了 19 个重复局面裁决差异；更新后重放的 77 个可闭合主线棋例均符合预期。43gg 仍保留悔棋等休闲玩法。**

## 修复后的重放结果

按出版物第八、九章的图示和着法转录测试盘面；候选偏差回看原图，纠正转录后才登记为规则差异。统一在第 25 回合之后触发重复裁决，核对应变方，并继续原循环验证胜负或和棋。图 12 另在前 25 回合内验证，两个时间段都要求黑方变着，黑方不变则红胜。

| 来源 | 主线棋例 | 修复前 | 修复后 |
| --- | ---: | ---: | ---: |
| [第八章棋例](https://cnchess.net/rules/ChaptEight.html) | 28 | 25 | 28 |
| [第九章参考图](https://cnchess.net/rules/ChaptNine.html) | 49 | 33 | 49 |

- 第八章修正图 12、23、24：通过将军得子的机会、牵制下得不偿失的吃子、弃兵换马和弃兵将军换车的区别。
- 第九章修正参考图 4、7、11、16、22、25、28、30、32–35、39、45、49、50：安全邀兑、帅和兵的独立吃子、突然失去保护的责任、联合捉子，以及双方攻击同时持续时的变着裁决。
- 第八章图 29 展示的走法未返回初始盘面，未计入这批闭合重放。第九章参考图 8 的九回合交替进攻由已有测试单独验证。通过这里的主线不代表所有变例或更深的实战战术都已验证。

主要错判的盘面与预期结果已加入[规则回归测试](../../tests/xiangqi-rules.test.mjs)。用 `node --test tests/xiangqi-rules.test.mjs` 可重跑规则测试，`npm test` 可重跑项目全部测试。

## 条款对照

| 项目 | 43gg 实现 |
| --- | --- |
| [第 1–2 条：棋盘、行棋和吃子](https://cnchess.net/rules/ChapterOneSection2.html) | 一致。标准 9×10 开局、红先、交替行棋；七种棋子的走法，包括马腿、象眼、过河、炮架和不吃己子，均由 [棋盘引擎](../../scripts/xiangqi-board.mjs)校验。初始盘面在 [xiangqi-position.mjs](../../app/xiangqi-position.mjs#L1)。 |
| [第 3 条](https://cnchess.net/rules/ChapterOneSection3.html)、[4.1.1–4.1.3：应将、将死、困毙、自杀](https://cnchess.net/rules/ChapterOneSection4.html) | 判断一致，处理方式有别。无合法走法时，游戏按是否被将军区分将死与困毙，两者都判负。正式比赛中，若已落子而造成送帅、未应将或将帅照面，会判负；游戏在[生成合法着法](../../scripts/xiangqi-board.mjs#L106)时就拦住这些走法。正因如此，用户盘面里移开仕或相会让黑炮将军，所以它们不可选。这不妨碍玩家走出自身合法、但下一着会被对手将死的棋。 |
| [4.2.2、4.2.4 和棋条件](https://cnchess.net/rules/ChapterOneSection4.html)、[22.2 自然限着](https://cnchess.net/rules/ChapterFiveSection22.html) | [引擎](../../scripts/xiangqi-rules.mjs#L5)在双方仅剩帅将、仕士、相象且轮走方仍有合法着法时判和；这是对简单死和局面的具体实现，没有通用的「任何走法下都无法取胜」求解器。无吃子达到 60 回合时，按提和方的将军着最多计 10 着计算，符合默认数值。产品仅允许轮到玩家时申请自然限着和棋；正式规则允许任一方提出、由裁判审核，也允许裁判长主动审核以及赛事调整回合门槛。[对局接口](../../scripts/xiangqi.mjs#L27)会把可提和状态限制在玩家回合。[4.2.1](https://cnchess.net/rules/ChapterOneSection4.html) 的双方协议和棋未实现。 |
| [第 23、25、26 条：重复局面、长将、长杀和长捉](https://cnchess.net/rules/ChapterFiveSection23.html) | [裁决器](../../scripts/xiangqi-adjudication.mjs#L96)实现了三次着法循环、首着非吃子计入、单方长将立即判负、其他情形的两回合变着窗口，以及九回合交替进攻的识别；前 25 回合本可不变作和的局面由红方变着，来自 [4.3](https://cnchess.net/rules/ChapterOneSection4.html)。游戏自动触发裁决，正式条款通常由棋手提请。对 [第 24 条术语](https://cnchess.net/rules/ChapterSixSection24.html)、[第 26 条细节](https://cnchess.net/rules/ChapterSixSection26.html)、[第八章棋例](https://cnchess.net/rules/ChaptEight.html)和[第九章参考图](https://cnchess.net/rules/ChaptNine.html)的覆盖不完整，见下方反例。 |
| [第 5 条：摸子、落子、纠正错误](https://cnchess.net/rules/ChapterOneSection5.html)及赛事流程 | 游戏中的选子可更换，确认后也能用[悔棋](../../scripts/xiangqi.mjs#L83)撤回玩家的着法和 AI 已走的应手。正式赛事一般要求摸子走子、落子后不可悔棋。比赛计时、认输和犯规处罚均未作为本游戏的功能实现，见[第 4 条](https://cnchess.net/rules/ChapterOneSection4.html)和[第 8 条](https://cnchess.net/rules/ChapterTwoSection8.html)。 |

## 图 12 的原始裁决差异

以下以红方先走，设置 `playedPlies: 60`，表示取自 25 回合之后的局面，用来隔离开局变着规定。坐标从黑方上方标号 1 到 9 对应 `a` 到 `i`，从红方底线到黑方底线对应 `1` 到 `10`。两例均直接调用正式对局使用的 [`createXiangqi`](../../scripts/xiangqi-rules.mjs#L18)，重复同一组着法，直到返回结果。

| 棋例 | 规则书裁决 | 修复前实测 |
| --- | --- | --- |
| [第八章图 12，PDF 第 31 页](https://wdd66d.top/downloads/qigui/Xqqg2020.pdf#page=31) | 红方两闲，黑炮两着均为「捉」，应由黑方变着，不变判黑负。 | **不符。** 四着均判闲。第三次循环结束不指定变着方，再重复两回合判和。若去掉 `playedPlies: 60`，前 25 回合的默认规则会反过来要求红方变着，不变则红方输。 |
| [第八章图 2，PDF 第 21 页](https://wdd66d.top/downloads/qigui/Xqqg2020.pdf#page=21) | 红方退马直接捉车，进马则伏卧槽将军弃马得车，均为「捉」；黑方一兑一捉，应由红方变着，不变判红负。 | **相符。** 第三次循环结束后要求红方变着；红方继续原循环，判红负。 |

```js
// 在项目根目录使用 node --input-type=module 运行。
import { createXiangqi } from './scripts/xiangqi-rules.mjs';

const examples = [
  ['图 2', 60, '1r2kae1r/2c1a4/h1c1e1h2/4p2H1/p1p6/1C4P2/P1P1P4/2H1E3C/4A4/1REAK2R1',
    [['h7', 'i5'], ['i10', 'h10'], ['i5', 'h7'], ['h10', 'i10']]],
  ...[60, 0].map(playedPlies => ['图 12', playedPlies, '3k2P2/P3a4/6rc1/8R/9/9/9/E3E4/4A4/4KA3',
    [['i7', 'h7'], ['h8', 'i8'], ['h7', 'i7'], ['i8', 'h8']]]),
];
const point = square => (10 - Number(square.slice(1))) * 9 + square.charCodeAt(0) - 97;

for (const [label, playedPlies, placement, cycle] of examples) {
  const game = createXiangqi({ placement, playedPlies });
  for (let n = 1; n <= 4 && !game.snapshot().result; n++) {
    for (const [from, to] of cycle) {
      if (!game.play({ from: point(from), to: point(to) })) throw new Error(`${label}: ${from}–${to}`);
      if (game.snapshot().result) break;
    }
    if (n === 3) console.log(label, playedPlies, game.snapshot().adjudication);
  }
  console.log(label, playedPlies, game.snapshot().result);
}
```

[将、杀、捉分类](../../scripts/xiangqi-threats.mjs)用有限深度的连续将军搜索、子力估值和战术条件推断着法性质。图 12 中黑炮平移后可以沉底将军，应将过程中会出现新的吃象机会。旧逻辑只比较得子分值，已有的吃兵机会掩盖了新威胁；现在也会比较实际追捉的目标，并核对这些新机会和原有吃子、邀兑的关系。
