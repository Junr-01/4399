export function wrapIndex(index, count) {
  return ((index % count) + count) % count;
}

export function cardOffset(index, selected, count) {
  const offset = wrapIndex(index - selected, count);
  return offset > count / 2 ? offset - count : offset;
}
