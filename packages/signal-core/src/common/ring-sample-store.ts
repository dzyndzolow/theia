// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { SampleBlock } from './contracts';

export class RingSampleStore {
    private readonly capacity: number;
    private readonly buffer: (SampleBlock | undefined)[];
    private head: number = 0;
    private tail: number = 0;
    private count: number = 0;

    constructor(capacity: number = 10000) {
        if (capacity <= 0) {
            throw new Error('RingSampleStore capacity must be positive');
        }
        this.capacity = capacity;
        this.buffer = new Array(capacity);
    }

    getCapacity(): number {
        return this.capacity;
    }

    getLength(): number {
        return this.count;
    }

    clear(): void {
        this.buffer.fill(undefined);
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    addBlock(block: SampleBlock): void {
        this.buffer[this.head] = block;
        this.head = (this.head + 1) % this.capacity;

        if (this.count < this.capacity) {
            this.count++;
        } else {
            this.tail = (this.tail + 1) % this.capacity;
        }
    }

    getBlock(index: number): SampleBlock | undefined {
        if (index < 0 || index >= this.count) {
            return undefined;
        }
        const internalIndex = (this.tail + index) % this.capacity;
        return this.buffer[internalIndex];
    }

    getStartTimeNs(): bigint | undefined {
        const first = this.getBlock(0);
        return first ? first.startTimeNs : undefined;
    }

    getEndTimeNs(): bigint | undefined {
        const last = this.getBlock(this.count - 1);
        return last ? last.startTimeNs : undefined;
    }

    /**
     * Binary search to find the block index closest to target time in O(log N).
     */
    findBlockIndexAtTime(targetNs: bigint): number {
        if (this.count === 0) {
            return -1;
        }

        let low = 0;
        let high = this.count - 1;
        let bestIndex = 0;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const block = this.getBlock(mid);
            if (!block) {
                break;
            }

            if (block.startTimeNs === targetNs) {
                return mid;
            } else if (block.startTimeNs < targetNs) {
                bestIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return bestIndex;
    }
}
