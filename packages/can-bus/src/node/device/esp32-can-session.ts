// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core';
import {
    CanDeviceDescriptor,
    CanDeviceEndpoint,
    CanDeviceEvent,
    CanDeviceSession
} from '../../common/can-device';
import {
    TcanCodec,
    TcanMessage,
    TcanMessageType,
    TCAN_FLAG_URGENT,
    TCAN_HEADER_LENGTH,
    TCAN_MAX_PAYLOAD_LENGTH
} from '../../common/esp32-can-device-protocol';
import { CanFrame } from '../../common/can-protocol';
import { CanExperimentSessionConfig } from '../../common/can-experiment-protocol';

export interface IByteTransport {
    send(data: Uint8Array): Promise<void> | void;
    onData(callback: (chunk: Uint8Array) => void): void;
    close(): Promise<void> | void;
}

export class Esp32CanSession implements CanDeviceSession {
    private static readonly MAX_STREAM_BUFFER = 2 * (TCAN_HEADER_LENGTH + TCAN_MAX_PAYLOAD_LENGTH + 4);
    private readonly onFramesReceivedEmitter = new Emitter<readonly CanFrame[]>();
    readonly onFramesReceived: Event<readonly CanFrame[]> = this.onFramesReceivedEmitter.event;

    private readonly onDeviceEventEmitter = new Emitter<CanDeviceEvent>();
    readonly onDeviceEvent: Event<CanDeviceEvent> = this.onDeviceEventEmitter.event;

    private connected = true;
    private sessionId = 0;
    private sequence = 0;
    private rxBuffer = new Uint8Array(0);
    private heartbeatTimer?: NodeJS.Timeout;

    constructor(
        readonly descriptor: CanDeviceDescriptor,
        readonly endpoint: CanDeviceEndpoint,
        private readonly transport: IByteTransport
    ) {
        this.transport.onData(chunk => this.handleIncomingBytes(chunk));
        this.sessionId = Math.floor(Math.random() * 0xFFFFFF) + 1;
    }

    async initHandshake(): Promise<boolean> {
        // Send HELLO envelope
        const helloMsg = TcanCodec.encodeMessage(TcanMessageType.HELLO, new Uint8Array(0), {
            sessionId: this.sessionId,
            sequence: ++this.sequence
        });
        await this.transport.send(helloMsg);

        // Start heartbeat loop (every 1000ms)
        this.heartbeatTimer = setInterval(async () => {
            if (this.connected) {
                const hb = TcanCodec.encodeMessage(TcanMessageType.HEARTBEAT, new Uint8Array(0), {
                    sessionId: this.sessionId,
                    sequence: ++this.sequence
                });
                await this.transport.send(hb);
            }
        }, 1000);

        return true;
    }

    async configure(config: CanExperimentSessionConfig): Promise<boolean> {
        if (!this.connected) {
            return false;
        }

        // Payload: bitrate (u32 LE), mode (u8: 0=2.0), maxFps (u16 LE)
        const payload = new Uint8Array(8);
        const view = new DataView(payload.buffer);
        view.setUint32(0, config.bitrate, true);
        view.setUint8(4, config.mode === 'CAN_FD' ? 1 : 0);
        view.setUint16(5, config.maxFps, true);

        const msg = TcanCodec.encodeMessage(TcanMessageType.CONFIGURE_CAN, payload, {
            sessionId: this.sessionId,
            sequence: ++this.sequence
        });
        await this.transport.send(msg);
        return true;
    }

    async startCapture(): Promise<boolean> {
        if (!this.connected) {
            return false;
        }
        const msg = TcanCodec.encodeMessage(TcanMessageType.START_CAPTURE, new Uint8Array(0), {
            sessionId: this.sessionId,
            sequence: ++this.sequence
        });
        await this.transport.send(msg);
        return true;
    }

    async stopCapture(): Promise<void> {
        if (!this.connected) {
            return;
        }
        const msg = TcanCodec.encodeMessage(TcanMessageType.STOP_CAPTURE, new Uint8Array(0), {
            sessionId: this.sessionId,
            sequence: ++this.sequence
        });
        await this.transport.send(msg);
    }

    async transmitFrame(frame: CanFrame): Promise<boolean> {
        if (!this.connected) {
            return false;
        }
        // A device TX request requires a response-validated SET_TX_POLICY and
        // ARM_TX token.  That negotiation is not yet implemented by this
        // session, so physical TX must fail closed instead of reporting that a
        // socket/serial write means the CAN frame was transmitted.
        return false;
    }

    async emergencyStop(): Promise<void> {
        if (!this.connected) {
            return;
        }
        const msg = TcanCodec.encodeMessage(TcanMessageType.EMERGENCY_STOP, new Uint8Array(0), {
            sessionId: this.sessionId,
            sequence: ++this.sequence,
            flags: TCAN_FLAG_URGENT
        });
        await this.transport.send(msg);
    }

    isConnected(): boolean {
        return this.connected;
    }

    handleIncomingBytes(chunk: Uint8Array): void {
        if (chunk.length === 0) {
            return;
        }
        if (this.rxBuffer.length + chunk.length > Esp32CanSession.MAX_STREAM_BUFFER) {
            this.rxBuffer = new Uint8Array(0);
            this.onDeviceEventEmitter.fire({
                type: 'GAP',
                timestampNs: process.hrtime.bigint(),
                gap: {
                    droppedFramesEstimate: 0,
                    reason: 'TCAN stream buffer limit exceeded; buffered bytes discarded'
                }
            });
            return;
        }
        const merged = new Uint8Array(this.rxBuffer.length + chunk.length);
        merged.set(this.rxBuffer);
        merged.set(chunk, this.rxBuffer.length);
        this.rxBuffer = merged;

        while (this.rxBuffer.length >= TCAN_HEADER_LENGTH) {
            let totalMsgLen: number;
            try {
                totalMsgLen = TcanCodec.validatedEnvelopeLength(this.rxBuffer.subarray(0, TCAN_HEADER_LENGTH));
            } catch (err) {
                const nextMagic = this.findNextMagic(this.rxBuffer, 1);
                this.rxBuffer = nextMagic >= 0
                    ? this.rxBuffer.subarray(nextMagic)
                    : this.rxBuffer.subarray(Math.max(0, this.rxBuffer.length - 3));
                this.onDeviceEventEmitter.fire({
                    type: 'ERROR',
                    timestampNs: process.hrtime.bigint(),
                    error: `Rejected TCAN stream header before payload allocation: ${err}`
                });
                if (nextMagic < 0) {
                    break;
                }
                continue;
            }

            if (this.rxBuffer.length < totalMsgLen) {
                break; // Incomplete message, wait for more chunks
            }

            const msgSlice = this.rxBuffer.subarray(0, totalMsgLen);
            this.rxBuffer = this.rxBuffer.subarray(totalMsgLen);

            try {
                const message = TcanCodec.decodeMessage(msgSlice);
                this.processTcanMessage(message);
            } catch (err) {
                this.onDeviceEventEmitter.fire({
                    type: 'ERROR',
                    timestampNs: process.hrtime.bigint(),
                    error: `Failed to decode TCAN message: ${err}`
                });
            }
        }
    }

    private findNextMagic(buffer: Uint8Array, start: number): number {
        for (let index = start; index <= buffer.length - 4; index++) {
            if (buffer[index] === 0x54 && buffer[index + 1] === 0x43
                && buffer[index + 2] === 0x41 && buffer[index + 3] === 0x4E) {
                return index;
            }
        }
        return -1;
    }

    private processTcanMessage(message: TcanMessage): void {
        switch (message.header.messageType) {
            case TcanMessageType.RX_BATCH: {
                const frames = TcanCodec.decodeRxBatch(message.payload, this.endpoint.endpointId);
                if (frames.length > 0) {
                    this.onFramesReceivedEmitter.fire(frames);
                }
                break;
            }

            case TcanMessageType.BUS_STATE: {
                this.onDeviceEventEmitter.fire({
                    type: 'BUS_STATE',
                    timestampNs: process.hrtime.bigint(),
                    busState: {
                        state: 'ERROR_ACTIVE',
                        txErrorCount: 0,
                        rxErrorCount: 0,
                        isBusOff: false
                    }
                });
                break;
            }

            case TcanMessageType.GAP_EVENT: {
                this.onDeviceEventEmitter.fire({
                    type: 'GAP',
                    timestampNs: process.hrtime.bigint(),
                    gap: {
                        droppedFramesEstimate: 1,
                        reason: 'Hardware buffer overrun'
                    }
                });
                break;
            }
        }
    }

    async close(): Promise<void> {
        this.connected = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        await this.transport.close();
        this.onDeviceEventEmitter.fire({
            type: 'DISCONNECTED',
            timestampNs: process.hrtime.bigint()
        });
    }

    dispose(): void {
        this.close();
        this.onFramesReceivedEmitter.dispose();
        this.onDeviceEventEmitter.dispose();
    }
}
