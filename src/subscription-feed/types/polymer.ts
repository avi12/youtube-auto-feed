// YouTube's UI is built on Polymer. Polymer custom elements expose a `data` property bound to the
// rendered template, plus `set`/`splice` paths that trigger re-rendering. This interface gives us
// a typed handle on those mutations so we never reach into innerHTML.
export interface PolymerElement<TData = unknown> extends HTMLElement {
  data: TData;
  set(path: string, value: unknown): void;
  splice(path: string, start: number, deleteCount: number, ...items: unknown[]): unknown[];
}
