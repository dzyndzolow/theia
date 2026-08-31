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
import { FeedbackKind, FeedbackType } from './can-experiment-protocol';

export type ScriptToHostMessage =
    | { type: 'SEND_FRAME'; frame: CanFrame; sequenceIndex?: number }
    | { type: 'SUBSCRIBE_RX'; ids?: readonly number[] }
    | { type: 'SET_VARIABLE'; name: string; value: number }
    | { type: 'GET_VARIABLE'; name: string }
    | { type: 'EMIT_FEEDBACK'; feedbackType: FeedbackType; kind: FeedbackKind; comment?: string }
    | { type: 'LOG_MESSAGE'; level: 'info' | 'warn' | 'error'; message: string }
    | { type: 'STOP_EXPERIMENT'; reason?: string }
    | { type: 'HEARTBEAT' };

export type HostToScriptMessage =
    | { type: 'ON_RX_FRAME'; frame: CanFrame }
    | { type: 'ON_VARIABLE_CHANGED'; name: string; value: number }
    | { type: 'ON_VARIABLE_VALUE'; name: string; value?: number }
    | { type: 'ON_STOP_SIGNAL'; reason?: string }
    | { type: 'HEARTBEAT_ACK' };
