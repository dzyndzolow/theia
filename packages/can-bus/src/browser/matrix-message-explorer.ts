// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';

export interface MatrixMessage {
    readonly key: string;
    readonly frame: CanFrame;
    readonly count: number;
    readonly frequencyHz: number;
    readonly periodMs: number;
    readonly lastReceivedAt: number;
}

interface MutableMatrixMessage {
    key: string;
    frame: CanFrame;
    count: number;
    frequencyHz: number;
    periodMs: number;
    lastReceivedAt: number;
}

/**
 * Groups incoming CAN frames by the complete message identity and calculates
 * the occurrence frequency used by the Matrix Message Explorer.
 */
export class MatrixMessageExplorer {
    protected readonly messages = new Map<string, MutableMatrixMessage>();

    public addFrame(frame: CanFrame, receivedAt = Date.now()): MatrixMessage {
        const key = MatrixMessageExplorer.createKey(frame);
        const existing = this.messages.get(key);
        if (!existing) {
            const message: MutableMatrixMessage = {
                key,
                frame,
                count: 1,
                frequencyHz: 0,
                periodMs: 0,
                lastReceivedAt: receivedAt
            };
            this.messages.set(key, message);
            return message;
        }

        const periodMs = Math.max(0, receivedAt - existing.lastReceivedAt);
        existing.frame = frame;
        existing.count++;
        existing.periodMs = periodMs;
        if (periodMs > 0) {
            existing.frequencyHz = 1000 / periodMs;
        }
        existing.lastReceivedAt = receivedAt;
        return existing;
    }

    public getMessages(): readonly MatrixMessage[] {
        return Array.from(this.messages.values());
    }

    public clear(): void {
        this.messages.clear();
    }

    public get size(): number {
        return this.messages.size;
    }

    public static createKey(frame: CanFrame): string {
        return `${frame.interface}:${frame.extended ? 'extended' : 'standard'}:${frame.id}:${frame.dlc}`;
    }
}
