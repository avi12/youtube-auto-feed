import { z } from "./zod";

/**
 * A type guard from a schema. Page objects (Polymer elements, their data, InnerTube payloads) are validated in place
 * and used as they are, since a parsed copy would lose their identity and any mutation would land on the copy
 */
export function createGuard<Schema extends z.ZodType>(schema: Schema) {
  return (value: unknown): value is z.infer<Schema> => schema.safeParse(value).success;
}

/** A page method zod checks only for being a function */
export const METHOD_SCHEMA = z.custom<(...parameters: never[]) => unknown>(value => typeof value === "function");

/**
 * A guard whose schema is built on first use. For classes that exist only in a browser (`Element`, `Request`): a schema
 * built at import time would throw when WXT imports the entrypoints in Node to read their options
 */
export function createLazyGuard<Schema extends z.ZodType>(getSchema: () => Schema) {
  let schema: Schema | undefined;
  return (value: unknown): value is z.infer<Schema> => (schema ??= getSchema()).safeParse(value).success;
}
