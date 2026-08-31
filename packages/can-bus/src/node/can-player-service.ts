// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject, optional } from '@theia/core/shared/inversify';
import { Disposable, Emitter, Event } from '@theia/core';
import { CanFrame } from '../common/can-protocol';
import { CanTransmitService } from './can-transmit-service';

export interface CanReplayOptions {
    readonly speedFactor?: number;
    readonly loop?: boolean;
    readonly timeOffsetMs?: number;
}

export type PlayerState = 'STOPPED' | 'PLAYING' | 'PAUSED';

export const CanPlayerService = Symbol('CanPlayerService');

export interface CanPlayerService extends Disposable {
    readonly onPlayerStateChanged: Event<PlayerState>;
    loadFrames(frames: readonly CanFrame[]): void;
    play(options?: CanReplayOptions): void;
    pause(): void;
    resume(): void;
    stop(): void;
    getState(): PlayerState;
    setTransmitService(transmitService: CanTransmitService): void;
}

@injectable()
export class CanPlayerServiceImpl implements CanPlayerService {
    protected transmitService?: CanTransmitService;

    constructor(
        @inject(CanTransmitService) @optional() transmitService?: CanTransmitService
    ) {
        if (transmitService) {
            this.transmitService = transmitService;
        }
    }

    setTransmitService(transmitService: CanTransmitService): void {
        this.transmitService = transmitService;
    }

    private readonly onPlayerStateChangedEmitter = new Emitter<PlayerState>();
    readonly onPlayerStateChanged: Event<PlayerState> = this.onPlayerStateChangedEmitter.event;

    private frames: CanFrame[] = [];
    private currentIndex = 0;
    private state: PlayerState = 'STOPPED';
    private options: CanReplayOptions = { speedFactor: 1.0, loop: false };
    private timerHandle?: NodeJS.Timeout;
    private playbackStartRealTimeNs = 0n;
    private playbackStartFrameTimeMs = 0;
    private isDisposed = false;

    loadFrames(frames: readonly CanFrame[]): void {
        this.stop();
        // Sort frames by timestamp to guarantee ordered chronological replay
        this.frames = [...frames].sort((a, b) => a.timestamp - b.timestamp);
        this.currentIndex = 0;
    }

    play(options?: CanReplayOptions): void {
        if (this.frames.length === 0 || this.isDisposed) {
            return;
        }
        if (options) {
            this.options = { ...this.options, ...options };
        }
        this.currentIndex = 0;
        this.setState('PLAYING');
        this.startScheduleLoop();
    }

    pause(): void {
        if (this.state === 'PLAYING') {
            this.clearTimer();
            this.setState('PAUSED');
        }
    }

    resume(): void {
        if (this.state === 'PAUSED' && this.currentIndex < this.frames.length) {
            this.startScheduleLoop();
            this.setState('PLAYING');
        }
    }

    stop(): void {
        this.clearTimer();
        this.currentIndex = 0;
        if (this.state !== 'STOPPED') {
            this.setState('STOPPED');
        }
    }

    getState(): PlayerState {
        return this.state;
    }

    private startScheduleLoop(): void {
        this.clearTimer();
        if (this.currentIndex >= this.frames.length) {
            if (this.options.loop) {
                this.currentIndex = 0;
            } else {
                this.stop();
                return;
            }
        }

        const currentFrame = this.frames[this.currentIndex];
        this.playbackStartRealTimeNs = process.hrtime.bigint();
        this.playbackStartFrameTimeMs = currentFrame.timestamp;

        this.scheduleNextFrame();
    }

    private scheduleNextFrame(): void {
        if (this.state === 'STOPPED' || this.currentIndex >= this.frames.length) {
            if (this.options.loop && this.frames.length > 0) {
                this.currentIndex = 0;
                this.startScheduleLoop();
            } else {
                this.stop();
            }
            return;
        }

        const targetFrame = this.frames[this.currentIndex];
        const speed = this.options.speedFactor && this.options.speedFactor > 0 ? this.options.speedFactor : 1.0;
        const frameDeltaMs = targetFrame.timestamp - this.playbackStartFrameTimeMs;
        const targetRealDeltaMs = frameDeltaMs / speed;

        const nowRealNs = process.hrtime.bigint();
        const elapsedRealMs = Number(nowRealNs - this.playbackStartRealTimeNs) / 1e6;
        const delayMs = Math.max(0, targetRealDeltaMs - elapsedRealMs);

        this.timerHandle = setTimeout(() => {
            if (this.state !== 'PLAYING') {
                return;
            }
            if (this.transmitService) {
                this.transmitService.transmit({
                    frame: targetFrame,
                    sourceKind: 'IMPORTED'
                });
            }
            this.currentIndex++;
            this.scheduleNextFrame();
        }, delayMs);
    }

    private clearTimer(): void {
        if (this.timerHandle) {
            clearTimeout(this.timerHandle);
            this.timerHandle = undefined;
        }
    }

    private setState(state: PlayerState): void {
        this.state = state;
        this.onPlayerStateChangedEmitter.fire(state);
    }

    dispose(): void {
        this.isDisposed = true;
        this.stop();
        this.onPlayerStateChangedEmitter.dispose();
        this.frames = [];
    }
}
