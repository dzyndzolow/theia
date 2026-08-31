// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';
import {
    DutFixtureConfig,
    DeterministicRandom,
    matchesFramePattern
} from '../common/can-device-lab-fixture';

export interface DutStateSnapshot {
    readonly isAwake: boolean;
    readonly lastWakeTimestampMs: number;
    readonly lastKeepAliveTimestampMs: number;
    readonly indicators: Readonly<Record<string, boolean>>;
    readonly numericValues: Readonly<Record<string, number>>;
    readonly wakeCount: number;
}

export class CanDeviceLabSimulator {
    private readonly rng: DeterministicRandom;
    private isAwake = false;
    private lastWakeTimestampMs = 0;
    private lastKeepAliveTimestampMs = 0;
    private sequenceStep = 0;
    private lastSequenceStepTimestampMs = 0;
    private lastStatusFrameTimestampMs = 0;
    private lastSpontaneousFrameTimestampMs = 0;
    private wakeCount = 0;

    private readonly indicatorStates = new Map<string, boolean>();
    private readonly numericValues = new Map<string, number>();

    constructor(readonly config: DutFixtureConfig) {
        this.rng = new DeterministicRandom(config.seed);
        this.resetInternalStates();
    }

    /**
     * Resets the DUT state to cold power-on.
     */
    powerCycle(): void {
        this.isAwake = false;
        this.lastWakeTimestampMs = 0;
        this.lastKeepAliveTimestampMs = 0;
        this.sequenceStep = 0;
        this.lastSequenceStepTimestampMs = 0;
        this.lastStatusFrameTimestampMs = 0;
        this.lastSpontaneousFrameTimestampMs = 0;
        this.wakeCount = 0;
        this.resetInternalStates();
    }

    getStateSnapshot(): DutStateSnapshot {
        const indicators: Record<string, boolean> = {};
        for (const [k, v] of this.indicatorStates.entries()) {
            indicators[k] = v;
        }

        const numericValues: Record<string, number> = {};
        for (const [k, v] of this.numericValues.entries()) {
            numericValues[k] = v;
        }

        return {
            isAwake: this.isAwake,
            lastWakeTimestampMs: this.lastWakeTimestampMs,
            lastKeepAliveTimestampMs: this.lastKeepAliveTimestampMs,
            indicators,
            numericValues,
            wakeCount: this.wakeCount
        };
    }

    /**
     * Processes an incoming CAN frame sent to the DUT.
     * Returns any immediate response frames generated.
     */
    processFrame(frame: CanFrame, nowMs: number): CanFrame[] {
        const responses: CanFrame[] = [];

        // Check simulated packet drop
        if (this.config.faultInjection?.rxDropProbability) {
            if (this.rng.nextFloat() < this.config.faultInjection.rxDropProbability) {
                return responses;
            }
        }

        // Check single-frame wake-up
        if (!this.isAwake && this.config.wakeUpFrame) {
            if (matchesFramePattern(frame, this.config.wakeUpFrame)) {
                this.triggerWakeUp(nowMs);
                responses.push(...this.generateWakeUpBurst(nowMs));
            }
        }

        // Check multi-frame sequence wake-up
        if (!this.isAwake && this.config.wakeUpSequence) {
            const seq = this.config.wakeUpSequence;
            const expectedPattern = seq.frames[this.sequenceStep];

            if (matchesFramePattern(frame, expectedPattern)) {
                const interval = nowMs - this.lastSequenceStepTimestampMs;
                if (this.sequenceStep === 0 || interval <= seq.maxIntervalMs) {
                    this.sequenceStep++;
                    this.lastSequenceStepTimestampMs = nowMs;

                    if (this.sequenceStep >= seq.frames.length) {
                        this.triggerWakeUp(nowMs);
                        this.sequenceStep = 0;
                        responses.push(...this.generateWakeUpBurst(nowMs));
                    }
                } else {
                    // Sequence timed out, restart from step 0
                    this.sequenceStep = 0;
                }
            } else if (matchesFramePattern(frame, seq.frames[0])) {
                this.sequenceStep = 1;
                this.lastSequenceStepTimestampMs = nowMs;
            } else {
                this.sequenceStep = 0;
            }
        }

        // If DUT is awake, process operational frames
        if (this.isAwake) {
            // Keep-alive check
            if (this.config.keepAlive) {
                if (frame.id === this.config.keepAlive.id) {
                    let keepAliveValid = true;
                    if (this.config.keepAlive.dataPattern) {
                        keepAliveValid = matchesFramePattern(frame, {
                            id: this.config.keepAlive.id,
                            dataPattern: this.config.keepAlive.dataPattern
                        });
                    }
                    if (keepAliveValid) {
                        this.lastKeepAliveTimestampMs = nowMs;
                    }
                }
            }

            // Indicator bits check
            if (this.config.indicators) {
                for (const ind of this.config.indicators) {
                    if (frame.id === ind.id && frame.data && frame.data.length > ind.byteIndex) {
                        const byteVal = frame.data[ind.byteIndex];
                        const isActive = (byteVal & ind.bitMask) !== 0;
                        this.indicatorStates.set(ind.name, isActive === ind.activeState);
                    }
                }
            }

            // Numeric fields check
            if (this.config.numericFields) {
                for (const num of this.config.numericFields) {
                    if (frame.id === num.id && frame.data && frame.data.length >= num.startByte + num.byteLength) {
                        let rawVal = 0;
                        if (num.byteLength === 1) {
                            rawVal = frame.data[num.startByte];
                        } else if (num.byteLength === 2) {
                            if (num.endianness === 'little') {
                                rawVal = frame.data[num.startByte] | (frame.data[num.startByte + 1] << 8);
                            } else {
                                rawVal = (frame.data[num.startByte] << 8) | frame.data[num.startByte + 1];
                            }
                        } else if (num.byteLength === 4) {
                            if (num.endianness === 'little') {
                                rawVal = (frame.data[num.startByte]) |
                                         (frame.data[num.startByte + 1] << 8) |
                                         (frame.data[num.startByte + 2] << 16) |
                                         (frame.data[num.startByte + 3] << 24);
                            } else {
                                rawVal = (frame.data[num.startByte] << 24) |
                                         (frame.data[num.startByte + 1] << 16) |
                                         (frame.data[num.startByte + 2] << 8) |
                                         (frame.data[num.startByte + 3]);
                            }
                        }
                        const physicalValue = (rawVal * num.scale) + num.offset;
                        this.numericValues.set(num.name, physicalValue);
                    }
                }
            }
        }

        return responses;
    }

    /**
     * Advance simulator time and produce periodic frames / check timeouts.
     */
    tick(nowMs: number): CanFrame[] {
        const frames: CanFrame[] = [];

        // Check keep-alive timeout if awake
        if (this.isAwake && this.config.keepAlive) {
            const timeSinceKeepAlive = nowMs - this.lastKeepAliveTimestampMs;
            if (timeSinceKeepAlive > this.config.keepAlive.sleepTimeoutMs) {
                this.isAwake = false;
            }
        }

        // Emit periodic status frames when awake
        if (this.isAwake && this.config.statusFrameId && this.config.statusFrameIntervalMs) {
            if (nowMs - this.lastStatusFrameTimestampMs >= this.config.statusFrameIntervalMs) {
                this.lastStatusFrameTimestampMs = nowMs;
                frames.push(this.createStatusFrame(nowMs));
            }
        }

        // Emit spontaneous / noise frames if configured
        if (this.config.faultInjection?.spontaneousRxIntervalMs && this.config.faultInjection.spontaneousRxIds) {
            if (nowMs - this.lastSpontaneousFrameTimestampMs >= this.config.faultInjection.spontaneousRxIntervalMs) {
                this.lastSpontaneousFrameTimestampMs = nowMs;
                const ids = this.config.faultInjection.spontaneousRxIds;
                const id = ids[this.rng.nextInt(0, ids.length - 1)];
                frames.push({
                    id,
                    extended: false,
                    rtr: false,
                    dlc: 8,
                    data: [
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255),
                        this.rng.nextInt(0, 255)
                    ],
                    timestamp: nowMs,
                    interface: 'vcan0'
                });
            }
        }

        return frames;
    }

    private triggerWakeUp(nowMs: number): void {
        this.isAwake = true;
        this.lastWakeTimestampMs = nowMs;
        this.lastKeepAliveTimestampMs = nowMs;
        this.lastStatusFrameTimestampMs = nowMs;
        this.wakeCount++;
    }

    private generateWakeUpBurst(nowMs: number): CanFrame[] {
        if (this.config.statusFrameId) {
            return [this.createStatusFrame(nowMs)];
        }
        return [];
    }

    private createStatusFrame(nowMs: number): CanFrame {
        const payload = [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        let idx = 1;
        for (const val of this.indicatorStates.values()) {
            if (val) {
                payload[1] |= (1 << (idx - 1));
            }
            idx++;
        }
        return {
            id: this.config.statusFrameId || 0x200,
            extended: false,
            rtr: false,
            dlc: 8,
            data: payload,
            timestamp: nowMs,
            interface: 'vcan0'
        };
    }

    private resetInternalStates(): void {
        this.indicatorStates.clear();
        if (this.config.indicators) {
            for (const ind of this.config.indicators) {
                this.indicatorStates.set(ind.name, false);
            }
        }

        this.numericValues.clear();
        if (this.config.numericFields) {
            for (const num of this.config.numericFields) {
                this.numericValues.set(num.name, 0);
            }
        }
    }
}
