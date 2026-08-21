// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Branded types for type-safe IDs across the Signal Analyzer framework.
 */
declare const DecoderIdBrand: unique symbol;
export type DecoderId = string & { readonly [DecoderIdBrand]: true };

declare const SignalIdBrand: unique symbol;
export type SignalId = string & { readonly [SignalIdBrand]: true };

declare const ChannelIdBrand: unique symbol;
export type ChannelId = string & { readonly [ChannelIdBrand]: true };

declare const SessionIdBrand: unique symbol;
export type SessionId = string & { readonly [SessionIdBrand]: true };

export function createDecoderId(id: string): DecoderId {
    return id as DecoderId;
}

export function createSignalId(id: string): SignalId {
    return id as SignalId;
}

export function createChannelId(id: string): ChannelId {
    return id as ChannelId;
}

export function createSessionId(id: string): SessionId {
    return id as SessionId;
}

/**
 * Data type of samples stored in a SampleBlock.
 */
export type SampleDataType = 'BIT_PACKED' | 'UINT8' | 'UINT16' | 'FLOAT32';

/**
 * Fundamental block of raw signal samples for high-throughput transfer.
 */
export interface SampleBlock {
    readonly blockId: number;
    readonly channelId: ChannelId | string;
    readonly sampleRate: number;
    readonly startTimeNs: bigint;
    readonly sampleCount: number;
    readonly dataType: SampleDataType;
    readonly data: ArrayBuffer;
}

/**
 * Decoded protocol annotation with hierarchical DAG support.
 */
export interface ProtocolAnnotation {
    readonly id: string;
    readonly parentId: string | null;
    readonly level: number;
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly type: string;
    readonly summary: string;
    readonly payload: Readonly<Record<string, unknown>> | null;
}

/**
 * Logical channel role definition for decoders (e.g. CLK, SDA, TX, RX).
 */
export interface ChannelRole {
    readonly roleName: string;
    readonly required: boolean;
    readonly assignedChannelId?: ChannelId | string;
}

/**
 * Time window containing contiguous blocks of signal samples.
 */
export interface SampleWindow {
    readonly startTimeNs: bigint;
    readonly endTimeNs: bigint;
    readonly blocks: readonly SampleBlock[];
}

/**
 * Contract for protocol decoder providers (DAG nodes).
 */
export interface DecoderProvider {
    readonly id: DecoderId | string;
    readonly displayName: string;
    readonly apiVersion: string;
    readonly inputType: string;
    readonly outputType: string;
    readonly channelRoles: readonly ChannelRole[];
    decode(
        input: SampleWindow | AsyncIterable<ProtocolAnnotation>,
        options: Readonly<Record<string, unknown>>
    ): AsyncIterable<ProtocolAnnotation>;
}

/**
 * Query parameter object for filtering protocol annotations.
 */
export interface AnnotationQuery {
    readonly timeRange?: {
        readonly startNs: bigint;
        readonly endNs: bigint;
    };
    readonly type?: string;
    readonly payloadFilter?: Readonly<Record<string, unknown>>;
    readonly textSearch?: string;
    readonly limit?: number;
}
