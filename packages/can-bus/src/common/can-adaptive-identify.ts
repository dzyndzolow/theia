// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';

export type AdaptiveIdentifyMode =
    | 'ISOLATE_SINGLE'
    | 'OMISSION_TEST'
    | 'SEQUENCE_MINIMIZATION'
    | 'KEEP_ALIVE_BISECTION';

export interface MinimalWakeupRecipe {
    readonly type: 'SINGLE_FRAME' | 'MULTI_FRAME_SEQUENCE' | 'KEEP_ALIVE_PERIODIC';
    readonly frames: readonly CanFrame[];
    readonly keepAliveIntervalMs?: number;
    readonly confirmedConfidence: number;
    readonly explanation: string;
}

export class CanAdaptiveIdentifyAlgorithms {
    /**
     * Delta debugging algorithm for sequence minimization (finds 1-minimal subset of frames).
     */
    static async minimizeSequence(
        sequence: readonly CanFrame[],
        testFn: (subseq: readonly CanFrame[]) => Promise<boolean>
    ): Promise<CanFrame[]> {
        if (sequence.length <= 1) {
            return [...sequence];
        }

        // Verify that the full sequence works
        const fullWorks = await testFn(sequence);
        if (!fullWorks) {
            return [...sequence];
        }

        let current = [...sequence];
        let n = 2;

        while (current.length >= 2) {
            const subsets: CanFrame[][] = [];
            const complements: CanFrame[][] = [];
            const chunkSize = Math.ceil(current.length / n);

            for (let i = 0; i < current.length; i += chunkSize) {
                const chunk = current.slice(i, i + chunkSize);
                subsets.push(chunk);
                const complement = [...current.slice(0, i), ...current.slice(i + chunkSize)];
                complements.push(complement);
            }

            let reduced = false;

            // 1. Try each individual chunk
            for (const subset of subsets) {
                if (subset.length < current.length && (await testFn(subset))) {
                    current = subset;
                    n = Math.max(n - 1, 2);
                    reduced = true;
                    break;
                }
            }

            if (reduced) {
                continue;
            }

            // 2. Try each complement (omitting one chunk)
            for (const complement of complements) {
                if (complement.length < current.length && (await testFn(complement))) {
                    current = complement;
                    n = Math.max(n - 1, 2);
                    reduced = true;
                    break;
                }
            }

            if (reduced) {
                continue;
            }

            // 3. Increase granularity or stop
            if (n < current.length) {
                n = Math.min(current.length, n * 2);
            } else {
                break;
            }
        }

        return current;
    }

    /**
     * Bisection algorithm to find the maximum keep-alive period before the DUT falls asleep.
     */
    static async bisectKeepAliveInterval(
        minIntervalMs: number,
        maxIntervalMs: number,
        toleranceMs: number,
        testFn: (intervalMs: number) => Promise<boolean>
    ): Promise<number> {
        let low = minIntervalMs;
        let high = maxIntervalMs;
        let bestWorking = minIntervalMs;

        while (high - low > toleranceMs) {
            const mid = Math.round((low + high) / 2);
            const works = await testFn(mid);

            if (works) {
                bestWorking = mid;
                low = mid; // Try longer interval
            } else {
                high = mid; // Too long, DUT slept; try shorter
            }
        }

        return bestWorking;
    }
}
