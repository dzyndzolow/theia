// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core';
import { FeedbackEvent, FeedbackSource } from './can-experiment-protocol';

export const CanFeedbackSensorProvider = Symbol('CanFeedbackSensorProvider');

export interface CanFeedbackSensorProvider extends Disposable {
    readonly id: string;
    readonly name: string;
    readonly source: FeedbackSource;
    startMonitoring(sessionId: string, onFeedback: (fb: FeedbackEvent) => void): Promise<void>;
    stopMonitoring(): Promise<void>;
}
