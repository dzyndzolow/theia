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
 * Generates exactly 20 standard 11-bit CAN IDs at configurable rates:
 *   Group A (0x100-0x104): 5 frames with constant payloads
 *   Group B (0x110-0x116): 7 frames with partially changing bytes
 *   Group C (0x120-0x125): 6 frames with continuously changing patterns
 *   0x130: UINT16 Little Endian incrementing signal
 *   0x131: INT16 Little Endian 0.2 Hz sinusoidal signal
 */
@injectable()
export class CanSimulatorAdapter implements CanHardwareAdapter {
    protected callback: ((frame: CanFrame) => void) | undefined;
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected startHr: bigint = 0n;
    protected frameCount = 0;
    protected configuredRate = 1000; // frames per second (base rate)
    protected configuredInterface = 'demo';
    protected running = false;

    // Exactly 20 CAN IDs with their individual frequencies (Hz)
    protected readonly ID_DEFS = [
        { id: 0x100, hz: 5, group: 'A' },
        { id: 0x101, hz: 5, group: 'A' },
        { id: 0x102, hz: 5, group: 'A' },
        { id: 0x103, hz: 5, group: 'A' },
        { id: 0x104, hz: 5, group: 'A' },
        { id: 0x110, hz: 8, group: 'B' },
        { id: 0x111, hz: 8, group: 'B' },
        { id: 0x112, hz: 10, group: 'B' },
        { id: 0x113, hz: 8, group: 'B' },
        { id: 0x114, hz: 10, group: 'B' },
        { id: 0x115, hz: 8, group: 'B' },
        { id: 0x116, hz: 10, group: 'B' },
        { id: 0x120, hz: 15, group: 'C' },
        { id: 0x121, hz: 15, group: 'C' },
        { id: 0x122, hz: 15, group: 'C' },
        { id: 0x123, hz: 15, group: 'C' },
        { id: 0x124, hz: 15, group: 'C' },
        { id: 0x125, hz: 15, group: 'C' },
        { id: 0x130, hz: 10, group: 'UINT16' },
        { id: 0x131, hz: 10, group: 'INT16' },
    ] as const;

    // Per-ID frame counters
    protected idCounters = new Array(20).fill(0);
    // Per-ID last-send timestamp in ns (for rate control)
    protected idLastSent = new Array<bigint>(20).fill(0n);

    configure(config: CanInterfaceConfig): void {
        const rate = config.frameRate !== undefined ? config.frameRate : (config.bitrate <= 5000 ? config.bitrate : 1000);
        this.configuredRate = Math.max(10, Math.min(rate, 5000));
        this.configuredInterface = config.name;
        this.idCounters.fill(0);
        this.idLastSent.fill(0n);
    }

    start(callback: (frame: CanFrame) => void): void {
        if (this.running) { return; }
        this.callback = callback;
        this.running = true;
        this.startHr = process.hrtime.bigint();
        this.frameCount = 0;
        this.idLastSent.fill(0n);
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

    /** Schedule the next frame delivery. Each iteration checks which IDs are due. */
    protected scheduleNext(): void {
        if (!this.running) { return; }

        // Use a fixed tick rate based on configuredRate (base tick = 10ms at 100fps)
        const tickIntervalNs = BigInt(Math.round(1e9 / Math.max(this.configuredRate, 100)));
        const nextTarget = this.startHr + tickIntervalNs * BigInt(this.frameCount + 1);
        const now = process.hrtime.bigint();
        const delayMs = Math.max(0, Number((nextTarget - now) / 1_000_000n));

        this.timer = setTimeout(() => {
            if (!this.running || !this.callback) { return; }

            this.frameCount++;
            const elapsedNs = process.hrtime.bigint() - this.startHr;
            const elapsedSeconds = Number(elapsedNs) / 1e9;

            // Check each ID whether it is due based on its frequency
            for (let slot = 0; slot < 20; slot++) {
                const def = this.ID_DEFS[slot];
                const intervalNs = BigInt(Math.round(1e9 / def.hz));
                const lastSent = this.idLastSent[slot];

                if (lastSent === 0n || (elapsedNs - lastSent) >= intervalNs) {
                    const frame = this.generateFrameForSlot(slot, this.idCounters[slot], elapsedNs, elapsedSeconds);
                    this.callback(frame);
                    this.idCounters[slot]++;
                    this.idLastSent[slot] = elapsedNs;
                }
            }

            this.scheduleNext();
        }, delayMs);
    }

    protected generateFrameForSlot(slot: number, counter: number, elapsedNs: bigint, elapsedSeconds: number): CanFrame {
        const def = this.ID_DEFS[slot];
        const dlc = 8;
        const data = this.createPayload(slot, def, counter, elapsedSeconds);

        return {
            id: def.id,
            extended: false,
            rtr: false,
            data,
            dlc,
            timestamp: Number(elapsedNs) / 1e6,
            interface: this.configuredInterface
        };
    }

    /**
     * Group A (0x100-0x104): constant payloads
     * Group B (0x110-0x116): selected bytes change with counters
     * Group C (0x120-0x125): continuously changing deterministic patterns
     * 0x130: UINT16 LE incrementing by 10
     * 0x131: INT16 LE 0.2 Hz sinusoid
     */
    protected createPayload(slot: number, def: typeof this.ID_DEFS[number], counter: number, elapsedSeconds: number): number[] {
        const data = new Array<number>(8).fill(0);

        if (def.group === 'A') {
            // Constant payloads: 0x100 -> [10,20,...,80], 0x101 -> [11,21,...,81], etc.
            const base = def.id - 0x100;
            for (let i = 0; i < 8; i++) {
                data[i] = (10 + i * 10 + base) & 0xFF;
            }
        } else if (def.group === 'B') {
            // Most bytes constant, selected bytes change
            const idOffset = def.id - 0x110;
            const constBase = 0x40 + idOffset * 5;
            for (let i = 0; i < 8; i++) {
                data[i] = (constBase + i * 3) & 0xFF;
            }
            // Per-ID variable bytes
            switch (def.id) {
                case 0x110: data[0] = counter & 0xFF; break;
                case 0x111: data[1] = counter & 0xFF; break;
                case 0x112: data[2] = counter & 0xFF; data[3] = (counter * 7) & 0xFF; break;
                case 0x113: data[4] = counter & 0xFF; break;
                case 0x114: data[5] = counter & 0xFF; data[6] = (counter * 11) & 0xFF; break;
                case 0x115: data[7] = counter & 0xFF; break;
                case 0x116: data[0] = counter & 0xFF; data[3] = (counter * 3) & 0xFF; data[7] = (counter * 7) & 0xFF; break;
            }
        } else if (def.group === 'C') {
            // Continuously changing deterministic patterns
            const idx = def.id - 0x120;
            switch (idx) {
                case 0: // Counter increasing
                    for (let i = 0; i < 8; i++) { data[i] = (counter + i) & 0xFF; }
                    break;
                case 1: // Counter decreasing
                    for (let i = 0; i < 8; i++) { data[i] = (0xFF - ((counter + i) & 0xFF)); }
                    break;
                case 2: // Rotating bit
                    for (let i = 0; i < 8; i++) { data[i] = (1 << ((counter + i) % 8)); }
                    break;
                case 3: // Multiple counters with different divisors
                    data[0] = counter & 0xFF;
                    data[1] = (Math.floor(counter / 2)) & 0xFF;
                    data[2] = (Math.floor(counter / 3)) & 0xFF;
                    data[3] = (Math.floor(counter / 5)) & 0xFF;
                    data[4] = (Math.floor(counter / 7)) & 0xFF;
                    data[5] = (Math.floor(counter / 11)) & 0xFF;
                    data[6] = (Math.floor(counter / 13)) & 0xFF;
                    data[7] = (Math.floor(counter / 17)) & 0xFF;
                    break;
                case 4: // Repeating sequence of length 16
                    for (let i = 0; i < 8; i++) { data[i] = ((counter + i) % 16) * 16; }
                    break;
                case 5: // Value derived from frame number
                    for (let i = 0; i < 8; i++) { data[i] = ((counter * (i + 1) * 13) % 256); }
                    break;
            }
        } else if (def.id === 0x130) {
            // UINT16 Little Endian, incrementing by 10, wrap at 65536
            // counter=0 -> 0, counter=1 -> 10, etc.
            const uint16Val = (counter * 10) & 0xFFFF;
            data[0] = uint16Val & 0xFF;         // LSB
            data[1] = (uint16Val >> 8) & 0xFF;  // MSB
            // Bytes 2-7 constant
            for (let i = 2; i < 8; i++) { data[i] = 0x55; }
        } else if (def.id === 0x131) {
            // INT16 Little Endian, 0.2 Hz sinusoid, amplitude 10000
            const int16Val = Math.round(10000 * Math.sin(2 * Math.PI * 0.2 * elapsedSeconds));
            // Clamp to INT16 range
            const clamped = Math.max(-32768, Math.min(32767, int16Val));
            // Store as 16-bit two's complement
            const unsigned = clamped < 0 ? (clamped + 65536) : clamped;
            data[0] = unsigned & 0xFF;          // LSB
            data[1] = (unsigned >> 8) & 0xFF;   // MSB
            // Bytes 2-7 constant
            for (let i = 2; i < 8; i++) { data[i] = 0xAA; }
        }

        return data;
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
