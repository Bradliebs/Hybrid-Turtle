export function normalizePersistedPassFlag(
  value: boolean | null | undefined
): boolean | undefined {
  return value ?? undefined;
}

export function countTruthyPassFlags(
  values: Array<boolean | null | undefined>
): number {
  return values.filter((value) => value === true).length;
}