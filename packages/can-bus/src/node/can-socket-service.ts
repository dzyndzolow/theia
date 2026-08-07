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

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common';
import { CanFrame, CanInterfaceConfig, CanStatistics } from '../common/can-protocol';

export const CanSocketService = Symbol('CanSocketService');
export const CanRpcService = Symbol('CanRpcService');

/** Abstraction over a physical or simulated CAN interface. */
export interface CanHardwareAdapter {
    /** Start delivering frames to the callback; the adapter owns the timer lifecycle. */
    start(callback: (frame: CanFrame) => void): void;
    /** Stop delivering frames and release all resources (timers, handles). */
    stop(): void;
    /** Apply interface-level configuration. */
    configure(config: CanInterfaceConfig): void;
}

export interface ICanSocketService {
    readonly onFrameReceived: Event<CanFrame>;
    readonly onStatisticsUpdated: Event<CanStatistics>;
    readonly onError: Event<Error>;
    readonly onStatusChanged: Event<boolean>;
    readonly isCapturing: boolean;
    start(config: CanInterfaceConfig): void;
    stop(interfaceName?: string): void;
    getStatistics(): CanStatistics;
}

/**
 * Deterministic CAN bus simulator driven by hrtime-compensated timers.
 *
 * Generates predictable 11-bit and 29-bit frames at a configurable rate
 * (100-5 000 fps). The sequence uses a linear congruential generator so
 * tests can verify exact frame values.
 */
@injectable()
export class CanSimulatorAdapter implements CanHardwareAdapter {
    protected callback: ((frame: CanFrame) => void) | undefined;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected startHr: bigint = 0n;
    protected frameCount = 0;
    protected configuredRate = 1000; // frames per second
    protected configuredInterface = 'demo';
    protected running = false;

    // Deterministic ID sequence state
    protected idState = 0x100;

    configure(config: CanInterfaceConfig): void {
        const rate = config.frameRate !== undefined ? config.frameRate : (config.bitrate <= 5000 ? config.bitrate : 1000);
        this.configuredRate = Math.max(10, Math.min(rate, 5000));
        this.configuredInterface = config.name;
        this.idState = config.name === 'demo2' ? 0x500 : 0x100;
    }

    start(callback: (frame: CanFrame) => void): void {
        if (this.running) { return; }
        this.callback = callback;
        this.running = true;
        this.startHr = process.hrtime.bigint();
        this.frameCount = 0;
        this.scheduleNext();
    }

    stop(): void {
        this.running = false;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.callback = undefined;
    }

    /** Schedule the next frame delivery, compensating for timer drift via hrtime. */
    protected scheduleNext(): void {
        if (!this.running) { return; }

        const intervalNs = BigInt(Math.round(1e9 / this.configuredRate));
        const nextTarget = this.startHr + intervalNs * BigInt(this.frameCount + 1);
        const now = process.hrtime.bigint();
        const delayMs = Math.max(0, Number((nextTarget - now) / 1_000_000n));

        this.timer = setTimeout(() => {
            if (!this.running || !this.callback) { return; }

            this.frameCount++;
            const actualNs = process.hrtime.bigint() - this.startHr;
            const frame = this.generateFrame(this.frameCount, actualNs);
            this.callback(frame);

            this.scheduleNext();
        }, delayMs);
    }

    /** Deterministic frame generator using a simple linear congruential sequence. */
    protected generateFrame(seq: number, elapsedNs: bigint): CanFrame {
        const useExtended = seq % 5 === 0; // every 5th frame is 29-bit
        const id = (this.idState + seq * 7) & (useExtended ? 0x1FFFFFFF : 0x7FF);
        const dlc = (seq % 8) + 1; // 1..8 bytes
        const data: number[] = [];
        for (let i = 0; i < dlc; i++) {
            data.push((seq + i * 13) & 0xFF);
        }

        return {
            id,
            extended: useExtended,
            rtr: false,
            data,
            dlc,
            timestamp: Number(elapsedNs) / 1e6, // ns -> ms
            interface: this.configuredInterface
        };
    }
}

@injectable()
export class CanSocketServiceImpl implements ICanSocketService {
    protected readonly onFrameReceivedEmitter = new Emitter<CanFrame>();
    readonly onFrameReceived: Event<CanFrame> = this.onFrameReceivedEmitter.event;

    protected readonly onStatisticsUpdatedEmitter = new Emitter<CanStatistics>();
    readonly onStatisticsUpdated: Event<CanStatistics> = this.onStatisticsUpdatedEmitter.event;

    protected readonly onErrorEmitter = new Emitter<Error>();
    readonly onError: Event<Error> = this.onErrorEmitter.event;

    protected readonly onStatusChangedEmitter = new Emitter<boolean>();
    readonly onStatusChanged: Event<boolean> = this.onStatusChangedEmitter.event;

    protected readonly adapters = new Map<string, CanHardwareAdapter>();
    protected adapterFactory: () => CanHardwareAdapter = () => new CanSimulatorAdapter();
    protected stats: CanStatistics = {
        totalFrames: 0, framesPerSecond: 0, errors: 0, busLoad: 0, startTime: 0
    };
    isCapturing = false;
    protected statsInterval: ReturnType<typeof setInterval> | undefined;

    constructor() {
    }

    @postConstruct()
    protected init(): void {
        // No extra setup needed; DI-ready.
    }

    start(config: CanInterfaceConfig): void {
        if (this.adapters.has(config.name)) { return; }
        if (!this.isCapturing) {
            this.stats = { totalFrames: 0, framesPerSecond: 0, errors: 0, busLoad: 0, startTime: Date.now() };
            this.isCapturing = true;
            this.statsInterval = setInterval(() => this.updateStats(), 1000);
        }

        const adapter = this.adapterFactory();
        adapter.configure(config);
        adapter.start(frame => {
            this.stats.totalFrames++;
            this.onFrameReceivedEmitter.fire(frame);
        });
        this.adapters.set(config.name, adapter);
        this.onStatusChangedEmitter.fire(this.isCapturing);
    }

    stop(interfaceName?: string): void {
        if (interfaceName !== undefined) {
            const adapter = this.adapters.get(interfaceName);
            if (adapter !== undefined) {
                adapter.stop();
                this.adapters.delete(interfaceName);
            }
        } else {
            for (const adapter of this.adapters.values()) {
                adapter.stop();
            }
            this.adapters.clear();
        }
        if (this.adapters.size > 0 || !this.isCapturing) { return; }
        this.isCapturing = false;

        if (this.statsInterval !== undefined) {
            clearInterval(this.statsInterval);
            this.statsInterval = undefined;
        }
        this.updateStats();
        this.onStatusChangedEmitter.fire(false);
    }

    getStatistics(): CanStatistics {
        return { ...this.stats };
    }

    protected updateStats(): void {
        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        this.stats.framesPerSecond = elapsed > 0 ? Math.round(this.stats.totalFrames / elapsed) : 0;
        this.stats.busLoad = this.isCapturing ? Math.min(100, (this.stats.framesPerSecond / 5000) * 100) : 0;
        this.onStatisticsUpdatedEmitter.fire({ ...this.stats });
    }

    /** Allow tests to inject a mock adapter. */
    setAdapter(adapter: CanHardwareAdapter): void {
        this.adapterFactory = () => adapter;
    }
}
