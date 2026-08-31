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

export type FieldByteOrder = 'LITTLE_ENDIAN' | 'BIG_ENDIAN';
export type FieldDataType = 'UINT8' | 'INT8' | 'UINT16' | 'INT16' | 'UINT32' | 'INT32';

export interface FieldSweepConfig {
    readonly targetId: number;
    readonly extended?: boolean;
    readonly dlc?: number;
    readonly baselinePayload: readonly number[];
    readonly startByte: number;
    readonly dataType: FieldDataType;
    readonly byteOrder: FieldByteOrder;
    readonly minValue: number;
    readonly maxValue: number;
    readonly step: number;
    readonly scale?: number;
    readonly offset?: number;
    readonly safeReturnValue?: number;
}

export interface FieldSweepFrameItem {
    readonly value: number;
    readonly rawValue: number;
    readonly frame: CanFrame;
    readonly isSafeReturn?: boolean;
}

export class CanFieldDiscovery {
    static generateSweepFrames(config: FieldSweepConfig): FieldSweepFrameItem[] {
        const dlc = config.dlc !== undefined ? config.dlc : 8;
        const baseline = [...config.baselinePayload];
        while (baseline.length < dlc) {
            baseline.push(0);
        }

        const scale = config.scale !== undefined && config.scale !== 0 ? config.scale : 1.0;
        const offset = config.offset !== undefined ? config.offset : 0.0;
        const step = config.step !== 0 ? Math.abs(config.step) : 1;

        const items: FieldSweepFrameItem[] = [];

        for (let val = config.minValue; val <= config.maxValue; val += step) {
            const rawVal = Math.round((val - offset) / scale);
            const frameData = this.injectValueIntoPayload(
                baseline,
                config.startByte,
                rawVal,
                config.dataType,
                config.byteOrder,
                dlc
            );

            const frame: CanFrame = {
                id: config.targetId,
                extended: !!config.extended,
                rtr: false,
                dlc,
                data: frameData,
                timestamp: Date.now(),
                interface: 'vcan0'
            };

            items.push({ value: val, rawValue: rawVal, frame });
        }

        // Add safe return frame if specified
        if (config.safeReturnValue !== undefined) {
            const rawVal = Math.round((config.safeReturnValue - offset) / scale);
            const frameData = this.injectValueIntoPayload(
                baseline,
                config.startByte,
                rawVal,
                config.dataType,
                config.byteOrder,
                dlc
            );

            const frame: CanFrame = {
                id: config.targetId,
                extended: !!config.extended,
                rtr: false,
                dlc,
                data: frameData,
                timestamp: Date.now(),
                interface: 'vcan0'
            };

            items.push({ value: config.safeReturnValue, rawValue: rawVal, frame, isSafeReturn: true });
        }

        return items;
    }

    private static injectValueIntoPayload(
        baseline: number[],
        startByte: number,
        rawValue: number,
        dataType: FieldDataType,
        byteOrder: FieldByteOrder,
        dlc: number
    ): number[] {
        const payload = [...baseline];
        const isLittle = byteOrder === 'LITTLE_ENDIAN';

        switch (dataType) {
            case 'UINT8':
            case 'INT8':
                if (startByte < dlc) {
                    payload[startByte] = rawValue & 0xFF;
                }
                break;

            case 'UINT16':
            case 'INT16':
                if (startByte + 1 < dlc) {
                    const b0 = rawValue & 0xFF;
                    const b1 = (rawValue >> 8) & 0xFF;
                    if (isLittle) {
                        payload[startByte] = b0;
                        payload[startByte + 1] = b1;
                    } else {
                        payload[startByte] = b1;
                        payload[startByte + 1] = b0;
                    }
                }
                break;

            case 'UINT32':
            case 'INT32':
                if (startByte + 3 < dlc) {
                    const b0 = rawValue & 0xFF;
                    const b1 = (rawValue >> 8) & 0xFF;
                    const b2 = (rawValue >> 16) & 0xFF;
                    const b3 = (rawValue >> 24) & 0xFF;
                    if (isLittle) {
                        payload[startByte] = b0;
                        payload[startByte + 1] = b1;
                        payload[startByte + 2] = b2;
                        payload[startByte + 3] = b3;
                    } else {
                        payload[startByte] = b3;
                        payload[startByte + 1] = b2;
                        payload[startByte + 2] = b1;
                        payload[startByte + 3] = b0;
                    }
                }
                break;
        }

        return payload;
    }
}
