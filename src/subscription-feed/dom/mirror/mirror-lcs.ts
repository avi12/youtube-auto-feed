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
  for (let iLeft = leftCount - 1; iLeft >= 0; iLeft--) {
    for (let iRight = rightCount - 1; iRight >= 0; iRight--) {
      suffixLengths[iLeft][iRight] = leftIds[iLeft] === rightIds[iRight]
        ? suffixLengths[iLeft + 1][iRight + 1] + 1
        : Math.max(suffixLengths[iLeft + 1][iRight], suffixLengths[iLeft][iRight + 1]);
    }
  }

  const sequence: string[] = [];
  let iLeft = 0;
  let iRight = 0;
  while (iLeft < leftCount && iRight < rightCount) {
    if (leftIds[iLeft] === rightIds[iRight]) {
      sequence.push(leftIds[iLeft]);
      iLeft++;
      iRight++;
    } else if (suffixLengths[iLeft + 1][iRight] >= suffixLengths[iLeft][iRight + 1]) {
      iLeft++;
    } else {
      iRight++;
    }
  }
  return sequence;
}
