// Helpers for safely walking unknown-shape objects (InnerTube responses, Polymer data) without `any`.

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

// Walks `object` along `path` and returns the value as T[] if it's an array, otherwise [].
export function deepArray<T = unknown>(object: unknown, ...path: string[]): T[] {
  const value = dig(object, ...path);
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}
