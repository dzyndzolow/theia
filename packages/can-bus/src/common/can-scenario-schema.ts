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

export interface ScenarioFrameDefinition {
    readonly id: number;
    readonly extended?: boolean;
    readonly rtr?: boolean;
    readonly dlc?: number;
    readonly data: readonly number[];
    readonly delayBeforeMs?: number;
    readonly comment?: string;
}

export interface CanScenarioPackage {
    readonly schemaVersion: '1.0';
    readonly name: string;
    readonly description?: string;
    readonly author?: string;
    readonly targetDevice?: string;
    readonly frames: readonly ScenarioFrameDefinition[];
    readonly safetyConstraints?: {
        readonly maxFps?: number;
        readonly allowedIds?: readonly number[];
    };
}

export function scenarioFrameToCanFrame(def: ScenarioFrameDefinition, iface = 'vcan0', timestamp = 0): CanFrame {
    return {
        id: def.id,
        extended: !!def.extended,
        rtr: !!def.rtr,
        dlc: def.dlc !== undefined ? def.dlc : def.data.length,
        data: [...def.data],
        timestamp,
        interface: iface
    };
}
