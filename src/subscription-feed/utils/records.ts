function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPath(object: unknown, ...path: string[]) {
  let current = object;
  for (const key of path) {
    if (!isObject(current)) {
      return undefined;
    }

    current = current[key];
  }
  return current;
}

export function deepArray<T = unknown>(object: unknown, ...path: string[]): T[] {
  const value = readPath(object, ...path);
  if (Array.isArray(value)) {
    return value;
  }

  return [];
}
