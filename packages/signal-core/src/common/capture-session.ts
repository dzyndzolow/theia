// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common/event';
import { SessionId, createSessionId } from './contracts';
import { SignalChannel } from './signal-channel';

export type CaptureState = 'STOPPED' | 'CAPTURING' | 'PAUSED';
export type CaptureClockDomain = 'session-monotonic';

/** A sample with a stable position in a capture session. */
export interface CaptureSample<T = unknown> {
    readonly sequence: number;
    readonly channelId: string;
    readonly timestampNs: bigint;
    readonly wallTimeUtc?: string;
    readonly clockDomain: CaptureClockDomain;
    readonly value: T;
}

export interface CaptureSampleOptions {
    /** An external timestamp can be used while importing a recording. */
    readonly timestampNs?: bigint;
    /** Wall clock is metadata only and is never used for ordering. */
    readonly wallTimeUtc?: string;
}

export class InvalidStateException extends Error {
    constructor(readonly currentState: CaptureState, readonly attemptedState: CaptureState) {
        super(`Invalid state transition attempted from '${currentState}' to '${attemptedState}'`);
        this.name = 'InvalidStateException';
    }
}

export interface StateChangeEvent {
    readonly previousState: CaptureState;
    readonly currentState: CaptureState;
    readonly timestampNs: bigint;
}

export class CaptureSession {
    readonly sessionId: SessionId;
    private _state: CaptureState = 'STOPPED';
    private readonly channelsMap: Map<string, SignalChannel> = new Map();
    private sampleSequence = 0;
    private captureStartNs?: bigint;
    private pausedAtNs?: bigint;
    private pausedDurationNs = 0n;

    private readonly onStateChangedEmitter = new Emitter<StateChangeEvent>();
    readonly onStateChanged: Event<StateChangeEvent> = this.onStateChangedEmitter.event;

    private debounceTimeout?: ReturnType<typeof setTimeout>;
    private pendingStateEvent?: StateChangeEvent;

    constructor(id: SessionId | string) {
        this.sessionId = typeof id === 'string' ? createSessionId(id) : id;
    }

    get state(): CaptureState {
        return this._state;
    }

    addChannel(channel: SignalChannel): void {
        this.channelsMap.set(channel.id, channel);
    }

    removeChannel(channelId: string): boolean {
        return this.channelsMap.delete(channelId);
    }

    getChannel(channelId: string): SignalChannel | undefined {
        return this.channelsMap.get(channelId);
    }

    getChannels(): readonly SignalChannel[] {
        return Array.from(this.channelsMap.values());
    }

    start(): void {
        if (this._state !== 'STOPPED') {
            throw new InvalidStateException(this._state, 'CAPTURING');
        }
        this.captureStartNs = this.monotonicNowNs();
        this.pausedAtNs = undefined;
        this.pausedDurationNs = 0n;
        this.sampleSequence = 0;
        this.transitionTo('CAPTURING');
    }

    pause(): void {
        if (this._state !== 'CAPTURING') {
            throw new InvalidStateException(this._state, 'PAUSED');
        }
        this.pausedAtNs = this.monotonicNowNs();
        this.transitionTo('PAUSED');
    }

    resume(): void {
        if (this._state !== 'PAUSED') {
            throw new InvalidStateException(this._state, 'CAPTURING');
        }
        const now = this.monotonicNowNs();
        if (this.pausedAtNs !== undefined) {
            this.pausedDurationNs += now - this.pausedAtNs;
            this.pausedAtNs = undefined;
        }
        this.transitionTo('CAPTURING');
    }

    stop(): void {
        if (this._state === 'STOPPED') {
            throw new InvalidStateException(this._state, 'STOPPED');
        }
        this.transitionTo('STOPPED');
    }

    /**
     * Adds a sample using session time. The optional external timestamp is
     * intended for replay/import and is kept verbatim, so replay does not
     * depend on how quickly the consumer executes.
     */
    recordSample<T>(channelId: string, value: T, options: CaptureSampleOptions = {}): CaptureSample<T> {
        if (this._state !== 'CAPTURING') {
            throw new InvalidStateException(this._state, 'CAPTURING');
        }
        const timestampNs = options.timestampNs ?? this.sessionTimestampNow();
        const sample: CaptureSample<T> = {
            sequence: this.sampleSequence++,
            channelId,
            timestampNs,
            wallTimeUtc: options.wallTimeUtc,
            clockDomain: 'session-monotonic',
            value
        };
        return sample;
    }

    /** Replays a sequence without sleeping or rewriting its timestamps. */
    replay<T>(samples: readonly CaptureSample<T>[], consumer: (sample: CaptureSample<T>) => void): void {
        let previousSequence = -1;
        let previousTimestamp = -1n;
        for (const sample of samples) {
            if (sample.sequence <= previousSequence || sample.timestampNs < previousTimestamp) {
                throw new Error('Replay samples must be ordered by sequence and timestamp');
            }
            previousSequence = sample.sequence;
            previousTimestamp = sample.timestampNs;
            consumer(sample);
        }
    }

    private transitionTo(newState: CaptureState): void {
        const previousState = this._state;
        this._state = newState;

        const event: StateChangeEvent = {
            previousState,
            currentState: newState,
            timestampNs: this.sessionTimestampNow()
        };

        this.notifyStateChange(event);
    }

    private sessionTimestampNow(): bigint {
        if (this.captureStartNs === undefined) {
            return 0n;
        }
        const now = this.monotonicNowNs();
        const pausedDuration = this.pausedDurationNs + (this.pausedAtNs === undefined ? 0n : now - this.pausedAtNs);
        return now - this.captureStartNs - pausedDuration;
    }

    private monotonicNowNs(): bigint {
        if (typeof process !== 'undefined' && typeof process.hrtime?.bigint === 'function') {
            return process.hrtime.bigint();
        }
        return BigInt(Math.floor((globalThis.performance?.now() ?? Date.now()) * 1_000_000));
    }

    private notifyStateChange(event: StateChangeEvent): void {
        this.pendingStateEvent = event;

        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        // Emit state changes with minimal debounce delay to prevent rapid notification flooding
        this.debounceTimeout = setTimeout(() => {
            if (this.pendingStateEvent) {
                this.onStateChangedEmitter.fire(this.pendingStateEvent);
                this.pendingStateEvent = undefined;
            }
        }, 1);
    }

    dispose(): void {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        this.onStateChangedEmitter.dispose();
        this.channelsMap.clear();
        this.captureStartNs = undefined;
        this.pausedAtNs = undefined;
    }
}
