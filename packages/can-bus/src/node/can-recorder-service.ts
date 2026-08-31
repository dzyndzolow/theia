// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Disposable, Emitter, Event } from '@theia/core';
import { CanFrame } from '../common/can-protocol';

export interface RecordedSessionLog {
    readonly metadata: {
        readonly recordedAt: string;
        readonly interfaceName: string;
        readonly frameCount: number;
        readonly durationMs: number;
    };
    readonly frames: readonly CanFrame[];
}

export type RecorderState = 'IDLE' | 'RECORDING';

export const CanRecorderService = Symbol('CanRecorderService');

export interface CanRecorderService extends Disposable {
    readonly onRecorderStateChanged: Event<RecorderState>;
    startRecording(interfaceName: string): void;
    recordFrame(frame: CanFrame): void;
    stopRecording(): RecordedSessionLog;
    getState(): RecorderState;
    getRecordedFrames(): readonly CanFrame[];
}

@injectable()
export class CanRecorderServiceImpl implements CanRecorderService {
    private readonly onRecorderStateChangedEmitter = new Emitter<RecorderState>();
    readonly onRecorderStateChanged: Event<RecorderState> = this.onRecorderStateChangedEmitter.event;

    private state: RecorderState = 'IDLE';
    private interfaceName = '';
    private startTimeMs = 0;
    private frames: CanFrame[] = [];
    private isDisposed = false;

    startRecording(interfaceName: string): void {
        this.interfaceName = interfaceName;
        this.startTimeMs = Date.now();
        this.frames = [];
        this.setState('RECORDING');
    }

    recordFrame(frame: CanFrame): void {
        if (this.state === 'RECORDING' && !this.isDisposed) {
            this.frames.push({ ...frame });
        }
    }

    stopRecording(): RecordedSessionLog {
        const durationMs = this.startTimeMs > 0 ? Date.now() - this.startTimeMs : 0;
        const log: RecordedSessionLog = {
            metadata: {
                recordedAt: new Date().toISOString(),
                interfaceName: this.interfaceName,
                frameCount: this.frames.length,
                durationMs
            },
            frames: [...this.frames]
        };
        this.setState('IDLE');
        return log;
    }

    getState(): RecorderState {
        return this.state;
    }

    getRecordedFrames(): readonly CanFrame[] {
        return this.frames;
    }

    private setState(state: RecorderState): void {
        this.state = state;
        this.onRecorderStateChangedEmitter.fire(state);
    }

    dispose(): void {
        this.isDisposed = true;
        this.setState('IDLE');
        this.onRecorderStateChangedEmitter.dispose();
        this.frames = [];
    }
}
