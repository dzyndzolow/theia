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
import { ExperimentEvent, ExperimentEventType } from './can-experiment-protocol';

/**
 * Append-only in-memory journal with monotonic order guarantee.
 */
export class ExperimentJournal {
    private readonly events: ExperimentEvent[] = [];
    private lastTimestampNs: bigint = 0n;

    append(event: ExperimentEvent): void {
        if (event.timestampMonotonicNs < this.lastTimestampNs) {
            // Guard against backward clock jump in monotonic timeline
            throw new Error(
                `Non-monotonic event timestamp: received ${event.timestampMonotonicNs}ns after ${this.lastTimestampNs}ns.`
            );
        }
        this.lastTimestampNs = event.timestampMonotonicNs;
        this.events.push(Object.freeze({ ...event }));
    }

    getAll(): readonly ExperimentEvent[] {
        return this.events;
    }

    size(): number {
        return this.events.length;
    }

    filterByType<T extends ExperimentEvent>(type: ExperimentEventType): readonly T[] {
        return this.events.filter(e => e.type === type) as T[];
    }

    queryTimeRange(startNs: bigint, endNs: bigint): readonly ExperimentEvent[] {
        return this.events.filter(
            e => e.timestampMonotonicNs >= startNs && e.timestampMonotonicNs <= endNs
        );
    }

    clear(): void {
        this.events.length = 0;
        this.lastTimestampNs = 0n;
    }
}

export class CanExperimentEventBus implements Disposable {
    private readonly onEventEmitter = new Emitter<ExperimentEvent>();
    private readonly journal = new ExperimentJournal();
    private isDisposed = false;

    get onEvent(): Event<ExperimentEvent> {
        return this.onEventEmitter.event;
    }

    getJournal(): ExperimentJournal {
        return this.journal;
    }

    publish(event: ExperimentEvent): void {
        if (this.isDisposed) {
            return;
        }
        this.journal.append(event);
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
