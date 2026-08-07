// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface IntervalItem<T> {
    readonly startNs: bigint;
    readonly endNs: bigint;
    readonly value: T;
}

class IntervalChunk<T> {
    readonly items: IntervalItem<T>[] = [];
    minStartNs: bigint = BigInt(0);
    maxEndNs: bigint = BigInt(0);

    constructor(readonly chunkSize: number) {}

    add(item: IntervalItem<T>): boolean {
        if (this.items.length >= this.chunkSize) {
            return false;
        }

        if (this.items.length === 0) {
            this.minStartNs = item.startNs;
            this.maxEndNs = item.endNs;
        } else {
            if (item.startNs < this.minStartNs) {
                this.minStartNs = item.startNs;
            }
            if (item.endNs > this.maxEndNs) {
                this.maxEndNs = item.endNs;
            }
        }

        this.items.push(item);
        return true;
    }
}

export class ChunkedIntervalTree<T> {
    private readonly chunkSize: number;
    private readonly chunks: IntervalChunk<T>[] = [];
    private totalCount: number = 0;

    constructor(chunkSize: number = 1024) {
        this.chunkSize = Math.max(16, chunkSize);
    }

    size(): number {
        return this.totalCount;
    }

    clear(): void {
        this.chunks.length = 0;
        this.totalCount = 0;
    }

    insert(startNs: bigint, endNs: bigint, value: T): void {
        const item: IntervalItem<T> = { startNs, endNs, value };

        let lastChunk = this.chunks[this.chunks.length - 1];
        if (!lastChunk || !lastChunk.add(item)) {
            lastChunk = new IntervalChunk<T>(this.chunkSize);
            lastChunk.add(item);
            this.chunks.push(lastChunk);
        }
        this.totalCount++;
    }

    /**
     * Search for all intervals overlapping with [startNs, endNs] in O(log N + K).
     */
    search(startNs: bigint, endNs: bigint): T[] {
        const results: T[] = [];
        if (this.totalCount === 0) {
            return results;
        }

        for (let i = 0; i < this.chunks.length; i++) {
            const chunk = this.chunks[i];

            // Skip chunk if it completely lies outside query range
            if (chunk.minStartNs > endNs || chunk.maxEndNs < startNs) {
                continue;
            }

            const items = chunk.items;
            const len = items.length;
            for (let j = 0; j < len; j++) {
                const item = items[j];
                if (item.startNs <= endNs && item.endNs >= startNs) {
                    results.push(item.value);
                }
            }
        }

        return results;
    }
}
