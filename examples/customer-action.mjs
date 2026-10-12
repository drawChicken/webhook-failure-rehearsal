// SPDX-License-Identifier: MIT
// For a trusted, reviewed workflow only. Do not run PR-selected code with elevated privileges.
import { runAction } from '../src/action-runner.mjs';
import { customerAdapter } from './customer-adapter.mjs';
process.exitCode = runAction({ factory: customerAdapter, label: 'customer-example' });
