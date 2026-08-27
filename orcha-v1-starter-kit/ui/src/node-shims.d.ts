// Minimal declarations for the node builtins used by dev-server plugins.
// This project intentionally does not depend on @types/node; chatPlugin.ts
// hand-rolls its request/response types for the same reason.

declare const process: { env: Record<string, string | undefined> }
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function appendFileSync(path: string, data: string, encoding: 'utf8'): void
  export function writeFileSync(path: string, data: string, encoding: 'utf8'): void
  export function unlinkSync(path: string): void
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string
}
declare module 'node:buffer' {
  export const Buffer: {
    concat(list: readonly Uint8Array[]): { toString(encoding: 'utf8'): string }
    from(data: string, encoding?: 'utf8' | 'hex'): Uint8Array
  }
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: 'hex'): string }
  }
  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean
}
declare module 'node:child_process' {
  type Stream = { on(event: 'data', listener: (chunk: { toString(enc: string): string }) => void): void }
  type Child = {
    pid?: number
    stdout: Stream
    on(event: 'error' | 'exit', listener: () => void): void
    kill(): void
  }
  export function spawn(command: string, args: string[], options?: { windowsHide?: boolean }): Child
}
declare module 'node:os' {
  export function tmpdir(): string
}
declare module 'node:http' {
  export type IncomingMessage = {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
    on(event: 'aborted' | 'data' | 'end', listener: (chunk?: Uint8Array) => void): void
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
  }
  export type ServerResponse = {
    writeHead(code: number, headers?: Record<string, string>): void
    setHeader(name: string, value: string): void
    write(chunk: string): void
    end(body?: string): void
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): {
    listen(port: number, host: string, cb: () => void): void
  }
}
