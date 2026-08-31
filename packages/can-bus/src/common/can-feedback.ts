// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FeedbackKind, FeedbackType } from './can-experiment-protocol';

export interface ManualFeedbackInput {
    readonly kind: FeedbackKind;
    readonly feedbackType: FeedbackType;
    readonly confidence?: number;
    readonly deltaValue?: number;
    readonly comment?: string;
    readonly timestampMonotonicNs?: bigint;
}

export interface IdTrafficStats {
    readonly id: number;
    readonly count: number;
    readonly firstSeenNs: bigint;
    readonly lastSeenNs: bigint;
    readonly lastPayload: readonly number[];
    readonly estimatedFrequencyHz: number;
}

export interface RxDeltaEventSummary {
    readonly type: 'NEW_ID' | 'FREQUENCY_CHANGE' | 'PAYLOAD_CHANGE';
    readonly id: number;
    readonly details: string;
}
