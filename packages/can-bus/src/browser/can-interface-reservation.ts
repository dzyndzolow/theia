// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';

/** Coordinates exclusive demo-interface selections between CAN Analyzer widgets. */
@injectable()
export class CanInterfaceReservation {
    protected readonly reservations = new Map<string, string>();
    protected readonly changedEmitter = new Emitter<void>();

    readonly onDidChange: Event<void> = this.changedEmitter.event;

    public reserve(widgetId: string, interfaceName: string): boolean {
        const owner = this.reservations.get(interfaceName);
        if (owner !== undefined && owner !== widgetId) {
            return false;
        }
        this.release(widgetId, false);
        this.reservations.set(interfaceName, widgetId);
        this.changedEmitter.fire();
        return true;
    }

    public release(widgetId: string, notify = true): void {
        let changed = false;
        for (const [interfaceName, owner] of this.reservations) {
            if (owner === widgetId) {
                this.reservations.delete(interfaceName);
                changed = true;
            }
        }
        if (changed && notify) {
            this.changedEmitter.fire();
        }
    }

    public isReservedByOther(widgetId: string, interfaceName: string): boolean {
        const owner = this.reservations.get(interfaceName);
        return owner !== undefined && owner !== widgetId;
    }
}
