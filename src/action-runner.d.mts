// SPDX-License-Identifier: MIT
import type { AdapterFactory } from './index.js';
/** Runner-owned environment only. Never populate this from fixture JSON. */
export interface ActionOptions {
  factory?: AdapterFactory | null;
  label?: string;
  env?: Record<string, string | undefined>;
}
/** Writes local reports and the runner-owned output control file. Non-PASS is nonzero. */
export function runAction(options?: ActionOptions): 0 | 1 | 2 | 3;
