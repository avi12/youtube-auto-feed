export function longestCommonSubsequence(leftIds: string[], rightIds: string[]) {
  const leftCount = leftIds.length;
  const rightCount = rightIds.length;
  const suffixLengths = Array.from(
    { length: leftCount + 1 },
    () => Array.from({ length: rightCount + 1 }, () => 0)
  );
  for (let left = leftCount - 1; left >= 0; left--) {
    for (let right = rightCount - 1; right >= 0; right--) {
      suffixLengths[left][right] = leftIds[left] === rightIds[right]
        ? suffixLengths[left + 1][right + 1] + 1
        : Math.max(suffixLengths[left + 1][right], suffixLengths[left][right + 1]);
    }
  }

  const sequence: string[] = [];
  let left = 0;
  let right = 0;
  while (left < leftCount && right < rightCount) {
    if (leftIds[left] === rightIds[right]) {
      sequence.push(leftIds[left]);
      left++;
      right++;
    } else if (suffixLengths[left + 1][right] >= suffixLengths[left][right + 1]) {
      left++;
    } else {
      right++;
    }
  }
  return sequence;
}
