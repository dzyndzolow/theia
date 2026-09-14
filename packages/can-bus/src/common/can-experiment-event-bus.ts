// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, Emitter, Event } from '@theia/core';
import { ExperimentEvent, ExperimentEventType, GapEvent } from './can-experiment-protocol';

/**
 * Append-only in-memory ring buffer journal with monotonic order guarantee
 * and explicit dropped count / GAP event generation on buffer overflow.
 */
export class ExperimentJournal {
    static readonly DEFAULT_MAX_EVENTS = 100_000;
    static readonly MAX_GAP_EVENTS = 1024;
    private readonly events: (ExperimentEvent | undefined)[];
    private readonly gapEvents: GapEvent[] = [];
    private head = 0;
    private tail = 0;
    private count = 0;
    private droppedCount = 0;
    private lastTimestampNs: bigint = 0n;
    private readonly maxEvents: number;

    constructor(maxEvents: number = ExperimentJournal.DEFAULT_MAX_EVENTS) {
        this.maxEvents = Math.max(1, maxEvents);
        this.events = new Array<ExperimentEvent | undefined>(this.maxEvents);
    }

    /**
     * Records a persistent, bounded GAP marker indicating unrecoverable data loss.
     * Aggregates by matching stable eventId, or matching sessionId and reason,
     * even when interleaved with other gap events.
     * Returns whether the gap was newly inserted and the resulting GapEvent.
     */
    recordGap(gapEvent: GapEvent): { isNew: boolean; event: GapEvent } {
        const matchIndex = this.gapEvents.findIndex(existing => gapEvent.eventId
            ? existing.eventId === gapEvent.eventId
            : existing.sessionId === gapEvent.sessionId && existing.reason === gapEvent.reason
        );

        if (matchIndex !== -1) {
            const previous = this.gapEvents[matchIndex];
            const merged: GapEvent = Object.freeze({
                ...gapEvent,
                eventId: previous.eventId,
                droppedCount: previous.droppedCount + gapEvent.droppedCount,
                timestampMonotonicNs: gapEvent.timestampMonotonicNs > previous.timestampMonotonicNs
                    ? gapEvent.timestampMonotonicNs
                    : previous.timestampMonotonicNs,
                wallClockIso: gapEvent.wallClockIso || previous.wallClockIso
            });
            this.gapEvents[matchIndex] = merged;
            return { isNew: false, event: merged };
        }

        if (this.gapEvents.length < ExperimentJournal.MAX_GAP_EVENTS) {
            const frozen = Object.freeze({ ...gapEvent });
            this.gapEvents.push(frozen);
            return { isNew: true, event: frozen };
        }

        const aggregate = this.gapEvents[this.gapEvents.length - 1];
        const capped: GapEvent = Object.freeze({
            ...gapEvent,
            eventId: aggregate.eventId,
            droppedCount: aggregate.droppedCount + gapEvent.droppedCount,
            timestampMonotonicNs: gapEvent.timestampMonotonicNs > aggregate.timestampMonotonicNs
                ? gapEvent.timestampMonotonicNs
                : aggregate.timestampMonotonicNs,
            reason: 'Multiple loss intervals aggregated because the bounded GAP ledger reached capacity.'
        });
        this.gapEvents[this.gapEvents.length - 1] = capped;
        return { isNew: false, event: capped };
    }

    /**
     * Appends an event to the journal in O(1) time.
     * If the buffer has reached maximum capacity, the oldest event is overwritten
     * and the droppedCount is incremented.
     *
     * @returns true if an old event was dropped due to overflow, false otherwise.
     */
    append(event: ExperimentEvent): boolean {
        if (event.timestampMonotonicNs < this.lastTimestampNs) {
            // Guard against backward clock jump in monotonic timeline
            throw new Error(
                `Non-monotonic event timestamp: received ${event.timestampMonotonicNs}ns after ${this.lastTimestampNs}ns.`
            );
        }
        this.lastTimestampNs = event.timestampMonotonicNs;
        const frozen = Object.freeze({ ...event });

        let dropped = false;
        if (this.count < this.maxEvents) {
            this.events[this.tail] = frozen;
            this.tail = (this.tail + 1) % this.maxEvents;
            this.count++;
        } else {
            // Buffer full: overwrite oldest element at head
            this.events[this.head] = frozen;
            this.head = (this.head + 1) % this.maxEvents;
            this.tail = this.head;
            this.droppedCount++;
            dropped = true;
        }
        return dropped;
    }

    getAll(): readonly ExperimentEvent[] {
        const ringEvents: ExperimentEvent[] = new Array(this.count);
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head + i) % this.maxEvents;
            ringEvents[i] = this.events[idx]!;
        }
        if (this.gapEvents.length === 0) {
            return ringEvents;
        }
        const merged = [...this.gapEvents, ...ringEvents].sort((left, right) => {
            if (left.timestampMonotonicNs < right.timestampMonotonicNs) {
                return -1;
            }
            if (left.timestampMonotonicNs > right.timestampMonotonicNs) {
                return 1;
            }
            return left.type === 'GAP' && right.type !== 'GAP' ? -1 : left.type !== 'GAP' && right.type === 'GAP' ? 1 : 0;
        });
        if (merged.length > this.maxEvents) {
            const gapCount = Math.min(this.gapEvents.length, this.maxEvents);
            const ringCount = this.maxEvents - gapCount;
            const keptGaps = this.gapEvents.slice(-gapCount);
            const keptRing = ringEvents.slice(-ringCount);
            return [...keptGaps, ...keptRing].sort((left, right) => {
                if (left.timestampMonotonicNs < right.timestampMonotonicNs) {
                    return -1;
                }
                if (left.timestampMonotonicNs > right.timestampMonotonicNs) {
                    return 1;
                }
                return left.type === 'GAP' && right.type !== 'GAP' ? -1 : left.type !== 'GAP' && right.type === 'GAP' ? 1 : 0;
            });
        }
        return merged;
    }

    size(): number {
        return this.count;
    }

    getMaxEvents(): number {
        return this.maxEvents;
    }

    getDroppedCount(): number {
        return this.droppedCount;
    }

    getGapEventCount(): number {
        return this.gapEvents.length;
    }

    hasDroppedEvents(): boolean {
        return this.droppedCount > 0;
    }

    filterByType<T extends ExperimentEvent>(type: ExperimentEventType): readonly T[] {
        const result: T[] = [];
        for (const gap of this.gapEvents) {
            if (gap.type === type) {
                result.push(gap as unknown as T);
            }
        }
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head + i) % this.maxEvents;
            const ev = this.events[idx];
            if (ev !== undefined && ev.type === type) {
                result.push(ev as T);
            }
        }
        return result.sort((left, right) => left.timestampMonotonicNs < right.timestampMonotonicNs ? -1 : 1);
    }

    queryTimeRange(startNs: bigint, endNs: bigint): readonly ExperimentEvent[] {
        const result: ExperimentEvent[] = [];
        for (const gap of this.gapEvents) {
            if (gap.timestampMonotonicNs >= startNs && gap.timestampMonotonicNs <= endNs) {
                result.push(gap);
            }
        }
        for (let i = 0; i < this.count; i++) {
            const idx = (this.head + i) % this.maxEvents;
            const ev = this.events[idx];
            if (ev !== undefined && ev.timestampMonotonicNs >= startNs && ev.timestampMonotonicNs <= endNs) {
                result.push(ev);
            }
        }
        return result;
    }

    clear(): void {
        this.events.fill(undefined);
        this.gapEvents.length = 0;
        this.head = 0;
        this.tail = 0;
        this.count = 0;
        this.droppedCount = 0;
        this.lastTimestampNs = 0n;
    }
}

export class CanExperimentEventBus implements Disposable {
    private readonly onEventEmitter = new Emitter<ExperimentEvent>();
    private readonly journal: ExperimentJournal;
    private isDisposed = false;

    constructor(maxEvents?: number) {
        this.journal = new ExperimentJournal(maxEvents);
    }

    get onEvent(): Event<ExperimentEvent> {
        return this.onEventEmitter.event;
    }

    getJournal(): ExperimentJournal {
        return this.journal;
    }

    /**
     * Records a persistent GAP event directly in the journal.
     * Fires onEvent only if the gap is newly created (not aggregated).
     * Returns the recorded/aggregated GapEvent.
     */
    recordGap(gapEvent: GapEvent): GapEvent {
        if (this.isDisposed) {
            return gapEvent;
        }
        const result = this.journal.recordGap(gapEvent);
        if (result.isNew) {
            this.onEventEmitter.fire(result.event);
        }
        return result.event;
    }

    publish(event: ExperimentEvent): void {
        if (this.isDisposed) {
            return;
        }
        const dropped = this.journal.append(event);
        if (dropped) {
            const gapEvent: GapEvent = {
                eventId: `gap:journal:${event.sessionId}`,
                sessionId: event.sessionId,
                timestampMonotonicNs: event.timestampMonotonicNs,
                wallClockIso: new Date().toISOString(),
                type: 'GAP',
                droppedCount: 1,
                reason: `Journal ring buffer overflow (max ${this.journal.getMaxEvents()}); oldest event dropped.`
            };
            this.journal.recordGap(gapEvent);
            this.onEventEmitter.fire(gapEvent);
        }
        this.onEventEmitter.fire(event);
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;
        this.onEventEmitter.dispose();
    }
}
