import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

export function runOpening({ tool, move, trace }) {
  const threadId = 'opening-thread';
  const turnId = 'opening-turn';
  const send = message => process.stdout.write(JSON.stringify(message) + '\n');
  const call = (id, name, args) => send({
    id, method: 'item/tool/call',
    params: { threadId, turnId, callId: id, tool: name, arguments: args },
  });
  let thread;
  let turn;
  let position;
  let openingFinished = false;

  createInterface({ input: process.stdin }).on('line', line => {
    const { id, method, params, result } = JSON.parse(line);
    const reply = result => send({ id, result });
    switch (method) {
      case 'initialize': return reply({});
      case 'account/read': return reply({ requiresOpenaiAuth: false });
      case 'model/list': return reply({ data: [{
        model: 'example', displayName: 'Example', supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
      }] });
      case 'thread/start':
        thread = params;
        return reply({ thread: { id: threadId } });
      case 'turn/start':
        if (openingFinished) return reply({ turn: { id: 'follow-up-turn' } });
        turn = params;
        reply({ turn: { id: turnId } });
        return call('position', 'get_position', {});
      case 'turn/interrupt': return reply({});
      case 'thread/unsubscribe': return reply({ status: 'unsubscribed' });
    }
    if (id === 'position') {
      position = result;
      call('move', tool, move);
    }
    if (id === 'move') {
      appendFileSync(trace, JSON.stringify({ thread, turn, position, move: result }) + '\n');
      openingFinished = result.success;
      send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
    }
  });
}
