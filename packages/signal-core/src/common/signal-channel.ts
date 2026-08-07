// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ChannelId, createChannelId } from './contracts';
import { RingSampleStore } from './ring-sample-store';

export interface SignalChannelOptions {
    readonly id: ChannelId | string;
    readonly name: string;
    readonly sampleRate?: number;
    readonly capacity?: number;
    readonly enabled?: boolean;
}

export class SignalChannel {
    readonly id: ChannelId;
    readonly name: string;
    private _sampleRate: number;
    private _enabled: boolean;
    readonly sampleStore: RingSampleStore;

    constructor(options: SignalChannelOptions) {
        this.id = typeof options.id === 'string' ? createChannelId(options.id) : options.id;
        this.name = options.name;
        this._sampleRate = options.sampleRate ?? 1000000;
        this._enabled = options.enabled ?? true;
        this.sampleStore = new RingSampleStore(options.capacity ?? 10000);
    }

    get sampleRate(): number {
        return this._sampleRate;
    }

    setSampleRate(rate: number): void {
        if (rate <= 0) {
            throw new Error('Sample rate must be positive');
        }
        this._sampleRate = rate;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    setEnabled(enabled: boolean): void {
        this._enabled = enabled;
    }
}
