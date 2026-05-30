// Tiny helpers for safely walking unknown-shape objects (e.g. raw InnerTube responses or Polymer
// `data` payloads) without resorting to `any`.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndexable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dig(object: unknown, ...path: string[]) {
  let current = object;
  for (const key of path) {
    if (!isIndexable(current)) {
      return undefined;
    }

    current = current[key];
  }
  return current;
}

// Walks `object` along `path`. Returns the value cast to T[] when it's an array, otherwise [].
// Use this anywhere an InnerTube renderer might emit a list or omit it entirely.
export function deepArray<T = unknown>(object: unknown, ...path: string[]): T[] {
  const value = dig(object, ...path);
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}
