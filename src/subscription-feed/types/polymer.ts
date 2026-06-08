// Typed handle on Polymer's `data`/`set`/`splice` API so mutations never touch innerHTML.
export interface PolymerElement<TData = unknown> extends HTMLElement {
  data: TData;
  set(path: string, value: unknown): void;
  splice(path: string, start: number, deleteCount: number, ...items: unknown[]): unknown[];
}
