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
} from '@theia/signal-core';
import { CanFrame, CanBinaryDecoder, canFrameToAnnotation } from './can-protocol';

export class CanDecoderProvider implements DecoderProvider {
    public readonly id = createDecoderId('decoder:can');
    public readonly displayName = 'CAN Protocol Decoder';
    public readonly apiVersion = '1.0.0';
    public readonly inputType = 'raw:can';
    public readonly outputType = 'annotation:can';
    public readonly channelRoles: readonly ChannelRole[] = Object.freeze([
        { roleName: 'can_bus', required: true }
    ]);

    /**
     * Decodes raw CAN sample windows or incoming annotations stream into CAN annotations.
     */
    public async *decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        _options: Readonly<Record<string, unknown>> = {}
    ): AsyncIterable<ProtocolAnnotation> {
        if (this.isSampleWindow(input)) {
            for (const block of input.blocks) {
                const decodedFrames: CanFrame[] = [];
                CanBinaryDecoder.decodeBatch(block.data, frame => decodedFrames.push(frame));
                for (const frame of decodedFrames) {
                    yield canFrameToAnnotation(frame);
                }
            }
        } else {
            for await (const annotation of input) {
                if (annotation.type === 'raw:can' || annotation.type === 'annotation:can') {
                    yield annotation;
                }
            }
        }
    }

    private isSampleWindow(input: unknown): input is SampleWindow {
        return typeof input === 'object' && input !== null && 'blocks' in input && Array.isArray((input as SampleWindow).blocks);
    }
}
