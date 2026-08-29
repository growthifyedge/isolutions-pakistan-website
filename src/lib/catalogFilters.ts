export const nullIfEmpty = <T>(value: T[] | undefined) =>
  value && value.length ? value : null;
