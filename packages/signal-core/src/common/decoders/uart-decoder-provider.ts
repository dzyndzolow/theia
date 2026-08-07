// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    DecoderProvider,
    ProtocolAnnotation,
    SampleWindow,
    ChannelRole,
    createDecoderId
} from '../contracts';
import { AnnotationValidator } from '../annotation-validator';

export interface UartDecoderOptions {
    readonly baudrate?: number;
    readonly dataBits?: number;
    readonly parity?: 'NONE' | 'EVEN' | 'ODD';
    readonly stopBits?: number;
}

export class UartDecoderProvider implements DecoderProvider {
    public readonly id = createDecoderId('decoder:uart');
    public readonly displayName = 'UART Protocol Decoder';
    public readonly apiVersion = '1.0.0';
    public readonly inputType = 'raw:uart';
    public readonly outputType = 'annotation:uart';
    public readonly channelRoles: readonly ChannelRole[] = Object.freeze([
        { roleName: 'RX', required: true },
        { roleName: 'TX', required: false }
    ]);

    /**
     * Decodes raw digital UART sample windows or incoming annotations into UART byte annotations.
     */
    public async *decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        options: Readonly<Record<string, unknown>> = {}
    ): AsyncIterable<ProtocolAnnotation> {
        const baudrate = (options.baudrate as number) || 9600;
        const dataBits = (options.dataBits as number) || 8;
        const parity = (options.parity as 'NONE' | 'EVEN' | 'ODD') || 'NONE';
        const stopBits = (options.stopBits as number) || 1;

        if (this.isSampleWindow(input)) {
            for (const block of input.blocks) {
                const bytes = new Uint8Array(block.data);
                let currentNs = block.startTimeNs;
                const bitPeriodNs = BigInt(Math.floor(1e9 / baudrate));

                for (let i = 0; i < bytes.length; i++) {
                    const rawByte = bytes[i];
                    // Check if byte is valid ASCII / framing
                    const startTime = currentNs;
                    const endTime = currentNs + BigInt(1 + dataBits + stopBits) * bitPeriodNs;

                    const charStr = String.fromCharCode(rawByte);
                    const summary = `UART 0x${rawByte.toString(16).toUpperCase().padStart(2, '0')} ('${charStr}')`;

                    yield {
                        id: `uart-${startTime}`,
                        parentId: null,
                        level: 0,
                        startTimeNs: startTime,
                        endTimeNs: endTime,
                        type: 'annotation:uart',
                        summary,
                        payload: {
                            value: rawByte,
                            char: charStr,
                            baudrate,
                            dataBits,
                            parity,
                            stopBits
                        }
                    };

                    currentNs = endTime;
                }
            }
        } else {
            for await (const annotation of input) {
                if (annotation.type === 'raw:uart' || annotation.type === 'annotation:uart') {
                    yield annotation;
                } else if (annotation.type === 'GAP') {
                    yield AnnotationValidator.createGapAnnotation(
                        annotation.startTimeNs,
                        annotation.endTimeNs,
                        'UART byte gap'
                    );
                }
            }
        }
    }

    private isSampleWindow(input: unknown): input is SampleWindow {
        return typeof input === 'object' && input !== null && 'blocks' in input && Array.isArray((input as SampleWindow).blocks);
    }
}
