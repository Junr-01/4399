import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapIndex, cardOffset } from '../app/selection.mjs';

test('cycling works in either direction, including rapid repeated changes', () => {
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(-16, 5), 4);
  assert.equal(wrapIndex(21, 5), 1);
});

test('each game can be selected with two unique neighbours on either side', () => {
  for (let selected = 0; selected < 5; selected++) {
    const offsets = Array.from({ length: 5 }, (_, index) => cardOffset(index, selected, 5));
    assert.equal(offsets[selected], 0);
    assert.deepEqual([...offsets].sort((a, b) => a - b), [-2, -1, 0, 1, 2]);
    assert.equal(cardOffset(wrapIndex(selected + 1, 5), selected, 5), 1);
    assert.equal(cardOffset(wrapIndex(selected - 1, 5), selected, 5), -1);
  }
});
