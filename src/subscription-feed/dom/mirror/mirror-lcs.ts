import type { Prettify } from "../../types/prettify";

type LongestCommonSubsequenceParams = Prettify<{
  leftIds: string[];
  rightIds: string[];
}>;

export function longestCommonSubsequence({ leftIds, rightIds }: LongestCommonSubsequenceParams) {
  const leftCount = leftIds.length;
  const rightCount = rightIds.length;
  const suffixLengths = Array.from(
    { length: leftCount + 1 },
    () => Array.from({ length: rightCount + 1 }, () => 0)
  );
  function suffixLengthAt(iLeft: number, iRight: number) {
    return suffixLengths[iLeft]?.[iRight] ?? 0;
  }

  for (let iLeft = leftCount - 1; iLeft >= 0; iLeft--) {
    const suffixRow = suffixLengths[iLeft] ?? [];
    for (let iRight = rightCount - 1; iRight >= 0; iRight--) {
      suffixRow[iRight] = leftIds[iLeft] === rightIds[iRight]
        ? suffixLengthAt(iLeft + 1, iRight + 1) + 1
        : Math.max(suffixLengthAt(iLeft + 1, iRight), suffixLengthAt(iLeft, iRight + 1));
    }
  }

  const sequence: string[] = [];
  let iLeft = 0;
  let iRight = 0;
  while (iLeft < leftCount && iRight < rightCount) {
    const leftId = leftIds[iLeft];
    if (leftId !== undefined && leftId === rightIds[iRight]) {
      sequence.push(leftId);
      iLeft++;
      iRight++;
    } else if (suffixLengthAt(iLeft + 1, iRight) >= suffixLengthAt(iLeft, iRight + 1)) {
      iLeft++;
    } else {
      iRight++;
    }
  }
  return sequence;
}
