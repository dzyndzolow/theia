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
        this.transitionTo('CAPTURING');
    }

    pause(): void {
        if (this._state !== 'CAPTURING') {
            throw new InvalidStateException(this._state, 'PAUSED');
        }
        this.transitionTo('PAUSED');
    }

    resume(): void {
        if (this._state !== 'PAUSED') {
            throw new InvalidStateException(this._state, 'CAPTURING');
        }
        this.transitionTo('CAPTURING');
    }

    stop(): void {
        if (this._state === 'STOPPED') {
            throw new InvalidStateException(this._state, 'STOPPED');
        }
        this.transitionTo('STOPPED');
    }

    private transitionTo(newState: CaptureState): void {
        const previousState = this._state;
        this._state = newState;

        const event: StateChangeEvent = {
            previousState,
            currentState: newState,
            timestampNs: BigInt(Date.now()) * BigInt(1000000)
        };

        this.notifyStateChange(event);
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
    }
}
