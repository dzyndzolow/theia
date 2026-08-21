// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ProtocolAnnotation } from './contracts';

export class AnnotationValidator {

    /**
     * Validates if an annotation complies with system immutability & timeline rules.
     */
    public static isValid(ann: ProtocolAnnotation): boolean {
        if (!ann || typeof ann.id !== 'string' || ann.id.length === 0) {
            return false;
        }
        if (typeof ann.startTimeNs !== 'bigint' || typeof ann.endTimeNs !== 'bigint') {
            return false;
        }
        if (ann.startTimeNs > ann.endTimeNs) {
            return false;
        }
        if (typeof ann.type !== 'string' || typeof ann.summary !== 'string') {
            return false;
        }
        return true;
    }

    /**
     * Constructs a first-class GAP annotation representing missing or dropped sample window.
     */
    public static createGapAnnotation(
        startTimeNs: bigint,
        endTimeNs: bigint,
        reason: string = 'Sample gap detected'
    ): ProtocolAnnotation {
        return {
            id: `gap-${startTimeNs}-${endTimeNs}`,
            // Root annotations use null by contract.
            // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
            parentId: null,
            level: 0,
            startTimeNs,
            endTimeNs,
            type: 'GAP',
            summary: `GAP: ${reason}`,
            payload: { reason }
        };
    }

    /**
     * Constructs a first-class RESYNC annotation representing protocol resynchronization.
     */
    public static createResyncAnnotation(
        timestampNs: bigint,
        reason: string = 'Stream resynchronized'
    ): ProtocolAnnotation {
        return {
            id: `resync-${timestampNs}`,
            // Root annotations use null by contract.
            // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
            parentId: null,
            level: 0,
            startTimeNs: timestampNs,
            endTimeNs: timestampNs,
            type: 'RESYNC',
            summary: `RESYNC: ${reason}`,
            payload: { reason }
        };
    }

    /**
     * Constructs a first-class DECODER_FAULT annotation representing a decoder failure,
     * containing a memory-safe limited stack trace.
     */
    public static createDecoderFaultAnnotation(
        decoderId: string,
        startTimeNs: bigint,
        endTimeNs: bigint,
        error: Error | string
    ): ProtocolAnnotation {
        const fullMessage = typeof error === 'string' ? error : (error.stack || error.message || 'Unknown error');
        // Limit stack trace to 300 characters to prevent memory exhaustion in console/UI
        const truncatedError = fullMessage.length > 300 ? fullMessage.substring(0, 300) + '...' : fullMessage;

        return {
            id: `fault-${decoderId}-${startTimeNs}`,
            // Root annotations use null by contract.
            // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
            parentId: null,
            level: 0,
            startTimeNs,
            endTimeNs,
            type: 'DECODER_FAULT',
            summary: `FAULT [${decoderId}]: ${typeof error === 'string' ? error : error.message}`,
            payload: {
                decoderId,
                errorTrace: truncatedError
            }
        };
    }
}
