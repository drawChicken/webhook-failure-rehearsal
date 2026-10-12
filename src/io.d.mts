// SPDX-License-Identifier: MIT
export function checkRoot(root: string): void;
export function readInput(root: string, relative: string): { text: string; absolute: string };
export interface WriteOptions { force?: boolean; inputAbsolute?: string | null }
/** Always supply inputAbsolute when reading a file. Output is a non-atomic generated pair. */
export function writeReports(root: string, relative: string, rendered: { json: string; html: string }, options?: WriteOptions): string[];
