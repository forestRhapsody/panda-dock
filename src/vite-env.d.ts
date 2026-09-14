/// <reference types="vite/client" />

declare module '*/scripts/package.mjs' {
  export interface ZipEntry {
    name: string
    data: Buffer
    mtime?: Date
  }
  export function createZipBuffer(entries: ZipEntry[]): Buffer
  export function collectFiles(dir: string, baseDir?: string): ZipEntry[]
  export function toDosDateTime(date?: Date): { dosTime: number; dosDate: number }
  export function run(): void
}
