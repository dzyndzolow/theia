// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Zero-allocation ring buffer backed by a pre-allocated array.
 * Overwrites oldest entries without creating new references or resizing.
 */
export class RingBuffer<T> {
    protected readonly buf: (T | undefined)[];
    protected head = 0;
    protected count = 0;

    constructor(protected readonly capacity: number) {
        this.buf = new Array<T | undefined>(capacity);
    }

    /** Append an item, overwriting the oldest if full. No allocation after warm-up. */
    push(item: T): void {
        const idx = (this.head + this.count) % this.capacity;
        this.buf[idx] = item;
        if (this.count < this.capacity) {
            this.count++;
        } else {
            this.head = (this.head + 1) % this.capacity;
        }
    }

    /** Return the most recent `n` items in insertion order (oldest first). */
    last(n: number): T[] {
        const len = Math.min(n, this.count);
        const result: T[] = [];
        for (let i = 0; i < len; i++) {
            const idx = (this.head + this.count - len + i) % this.capacity;
            result.push(this.buf[idx]!);
        }
        return result;
    }

    /** Number of items currently stored. */
    get size(): number {
        return this.count;
    }

    /** Remove all items without deallocating the backing array. */
    clear(): void {
        this.head = 0;
        this.count = 0;
    }
}
