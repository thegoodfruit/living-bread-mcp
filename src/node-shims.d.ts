/* The one Node API this Worker uses (nodejs_compat provides it at runtime). */
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, fn: () => R): R;
  }
}
