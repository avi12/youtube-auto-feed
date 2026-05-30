// Forces IDE hover tooltips to expand named types into their object shape at use sites.
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
