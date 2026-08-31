// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';

/**
 * Deterministic PRNG based on Mulberry32 for reproducible simulations.
 */
export class DeterministicRandom {
    private s: number;

    constructor(seed: number) {
        this.s = seed >>> 0;
    }

    /** Returns pseudo-random float in [0, 1). */
    nextFloat(): number {
        let t = (this.s += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Returns pseudo-random integer in [min, max] inclusive. */
    nextInt(min: number, max: number): number {
        return Math.floor(this.nextFloat() * (max - min + 1)) + min;
    }
}

export interface FramePattern {
    readonly id: number;
    readonly extended?: boolean;
    readonly dlc?: number;
    /** Byte match pattern: undefined in array means wildcard (any value matches) */
    readonly dataPattern?: readonly (number | undefined)[];
}

export interface MultiFrameSequencePattern {
    readonly frames: readonly FramePattern[];
    readonly maxIntervalMs: number;
}

export interface DutKeepAliveConfig {
    readonly id: number;
    readonly requiredIntervalMs: number;
    readonly sleepTimeoutMs: number;
    readonly dataPattern?: readonly (number | undefined)[];
}

export interface DutIndicatorConfig {
    readonly name: string;
    readonly id: number;
    readonly byteIndex: number;
    readonly bitMask: number;
    readonly activeState: boolean;
}

export interface DutNumericFieldConfig {
    readonly name: string;
    readonly id: number;
    readonly startByte: number;
    readonly byteLength: 1 | 2 | 4;
    readonly endianness: 'little' | 'big';
    readonly scale: number;
    readonly offset: number;
}

export interface DutFaultInjectionConfig {
    readonly spontaneousRxIntervalMs?: number;
    readonly spontaneousRxIds?: readonly number[];
    readonly responseJitterMs?: number;
    readonly rxDropProbability?: number;
}

export interface DutFixtureConfig {
    readonly name: string;
    readonly seed: number;
    readonly wakeUpFrame?: FramePattern;
    readonly wakeUpSequence?: MultiFrameSequencePattern;
    readonly keepAlive?: DutKeepAliveConfig;
    readonly indicators?: readonly DutIndicatorConfig[];
    readonly numericFields?: readonly DutNumericFieldConfig[];
    readonly statusFrameId?: number;
    readonly statusFrameIntervalMs?: number;
    readonly faultInjection?: DutFaultInjectionConfig;
}

/** Matches a received CanFrame against a FramePattern. */
export function matchesFramePattern(frame: CanFrame, pattern: FramePattern): boolean {
    if (frame.id !== pattern.id) {
        return false;
    }
    if (pattern.extended !== undefined && frame.extended !== pattern.extended) {
        return false;
    }
    if (pattern.dlc !== undefined && frame.dlc !== pattern.dlc) {
        return false;
    }
    if (pattern.dataPattern) {
        if (!frame.data || frame.data.length < pattern.dataPattern.length) {
            return false;
        }
        for (let i = 0; i < pattern.dataPattern.length; i++) {
            const expected = pattern.dataPattern[i];
            if (expected !== undefined && frame.data[i] !== expected) {
                return false;
            }
        }
    }
    return true;
}
