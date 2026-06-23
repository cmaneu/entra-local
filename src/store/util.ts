import type { SQLOutputValue } from 'node:sqlite';

/** Returns the current time as integer Unix epoch seconds (UTC). */
export type Clock = () => number;

/** Default wall-clock clock used at runtime. Tests inject a fixed clock for determinism. */
export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

/** A raw result row as returned by `node:sqlite` statement `get`/`all`. */
export type Row = Record<string, SQLOutputValue>;

/** Read a guaranteed-present TEXT column as a string. */
export function reqStr(row: Row, key: string): string {
  return row[key] as string;
}

/** Read a nullable TEXT column as `string | null`. */
export function optStr(row: Row, key: string): string | null {
  const v = row[key];
  return v == null ? null : (v as string);
}

/** Read a guaranteed-present INTEGER column as a number. */
export function reqNum(row: Row, key: string): number {
  return Number(row[key]);
}

/** Read a nullable INTEGER column as `number | null`. */
export function optNum(row: Row, key: string): number | null {
  const v = row[key];
  return v == null ? null : Number(v);
}

/** Read an INTEGER 0/1 column as a boolean. */
export function asBool(row: Row, key: string): boolean {
  return Number(row[key]) === 1;
}

/** Encode a boolean as an INTEGER 0/1 for storage. */
export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Escape SQL `LIKE` wildcards (`%`, `_`) and the escape char itself so a user-supplied substring
 * is matched literally. Pair with `LIKE ? ESCAPE '\'` in the query.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
