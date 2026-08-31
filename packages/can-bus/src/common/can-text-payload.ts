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

export interface TextPayloadConfig {
    readonly targetId: number;
    readonly text: string;
    readonly encoding?: 'ASCII' | 'UTF-8';
    readonly extended?: boolean;
    readonly paddingByte?: number;
}

export class CanTextPayload {
    /**
     * Encodes text into raw Classical CAN frames (up to 8 bytes per frame).
     */
    static encodeRawTextFrames(config: TextPayloadConfig): CanFrame[] {
        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(config.text));
        const padding = config.paddingByte !== undefined ? config.paddingByte : 0x00;
        const frames: CanFrame[] = [];

        for (let i = 0; i < bytes.length; i += 8) {
            const chunk = bytes.slice(i, i + 8);
            while (chunk.length < 8) {
                chunk.push(padding);
            }
            frames.push({
                id: config.targetId,
                extended: !!config.extended,
                rtr: false,
                dlc: 8,
                data: chunk,
                timestamp: Date.now(),
                interface: 'vcan0'
            });
        }

        return frames;
    }

    /**
     * Encodes text into ISO-TP (ISO 15765-2) Single Frame (SF) or First Frame (FF) + Consecutive Frames (CF).
     */
    static encodeIsoTpFrames(config: TextPayloadConfig): CanFrame[] {
        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(config.text));
        const padding = config.paddingByte !== undefined ? config.paddingByte : 0xAA;
        const frames: CanFrame[] = [];
        const totalLen = bytes.length;

        if (totalLen <= 7) {
            // Single Frame (SF): [0x00 | length, data0, data1, ...]
            const data = [0x00 | (totalLen & 0x0F), ...bytes];
            while (data.length < 8) {
                data.push(padding);
            }
            frames.push({
                id: config.targetId,
                extended: !!config.extended,
                rtr: false,
                dlc: 8,
                data,
                timestamp: Date.now(),
                interface: 'vcan0'
            });
            return frames;
        }

        // Multi-frame: First Frame (FF) + Consecutive Frames (CF)
        // First Frame (FF): [0x10 | (len >> 8), len & 0xFF, data0..data5]
        const ffData = [
            0x10 | ((totalLen >> 8) & 0x0F),
            totalLen & 0xFF,
            ...bytes.slice(0, 6)
        ];
        frames.push({
            id: config.targetId,
            extended: !!config.extended,
            rtr: false,
            dlc: 8,
            data: ffData,
            timestamp: Date.now(),
            interface: 'vcan0'
        });

        let offset = 6;
        let seqNum = 1;

        while (offset < totalLen) {
            // Consecutive Frame (CF): [0x20 | (seqNum & 0x0F), data0..data6]
            const chunk = bytes.slice(offset, offset + 7);
            offset += 7;
            const cfData = [0x20 | (seqNum & 0x0F), ...chunk];
            while (cfData.length < 8) {
                cfData.push(padding);
            }
            frames.push({
                id: config.targetId,
                extended: !!config.extended,
                rtr: false,
                dlc: 8,
                data: cfData,
                timestamp: Date.now(),
                interface: 'vcan0'
            });
            seqNum = (seqNum + 1) & 0x0F;
        }

        return frames;
    }
}
