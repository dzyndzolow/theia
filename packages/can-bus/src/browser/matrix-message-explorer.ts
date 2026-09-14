// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from '../common/can-protocol';
import { CAN_MATRIX_MAX_ROWS } from '../common/can-retention-policy';

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
    public static readonly DEFAULT_MAX_MESSAGES = CAN_MATRIX_MAX_ROWS;
    protected readonly messages = new Map<string, MutableMatrixMessage>();
    public readonly maxMessages: number;

    constructor(maxMessages: number = MatrixMessageExplorer.DEFAULT_MAX_MESSAGES) {
        if (!Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > CAN_MATRIX_MAX_ROWS) {
            throw new RangeError(`maxMessages must be a safe integer between 1 and ${CAN_MATRIX_MAX_ROWS}. Received: ${maxMessages}`);
        }
        this.maxMessages = maxMessages;
    }

    public addFrame(frame: CanFrame, receivedAt = Date.now()): MatrixMessage {
        const key = MatrixMessageExplorer.createKey(frame);
        const existing = this.messages.get(key);
        if (!existing) {
            while (this.messages.size >= this.maxMessages) {
                const oldest = this.messages.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                this.messages.delete(oldest);
            }
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

        this.messages.delete(key);
        const periodMs = Number(Math.max(0, receivedAt - existing.lastReceivedAt).toFixed(3));
        existing.frame = frame;
        existing.count++;
        existing.periodMs = periodMs;
        if (periodMs > 0) {
            existing.frequencyHz = 1000 / periodMs;
        }
        existing.lastReceivedAt = receivedAt;
        this.messages.set(key, existing);
        return existing;
    }

    public delete(key: string): boolean {
        return this.messages.delete(key);
    }

    public has(key: string): boolean {
        return this.messages.has(key);
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
