// A promise you settle by hand — for tests that hold an async action in flight.
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
