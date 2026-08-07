// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { WidgetFactory, bindViewContribution, OpenHandler } from '@theia/core/lib/browser';
import { CanViewContribution } from './can-view-contribution';
import { CanWidget } from './can-widget';
import { CanBusWidget } from '../common/can-protocol';
import { CanMatrixWidget, CAN_MATRIX_WIDGET_ID } from './can-matrix-widget';
import { CanMatrixViewContribution } from './can-matrix-view-contribution';
import { WidgetInstanceNumbers } from './widget-instance-numbers';
import { CanInterfaceReservation } from './can-interface-reservation';
import { CanRpcClient } from './can-rpc-client';

const canWidgetNumbers = new WidgetInstanceNumbers();
const canMatrixNumbers = new WidgetInstanceNumbers();

export default new ContainerModule(bind => {
    bind(CanRpcClient).toSelf().inSingletonScope();
    bind(CanInterfaceReservation).toSelf().inSingletonScope();
    bind(CanWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: CanBusWidget.ID,
        createWidget: (options?: { id?: string }) => {
            const widget = context.container.get<CanWidget>(CanWidget);
            if (options && options.id) {
                widget.id = options.id;
            }
            const instanceNumber = canWidgetNumbers.allocate();
            widget.title.label = `${CanBusWidget.LABEL} #${instanceNumber}`;
            widget.onDidDispose(() => canWidgetNumbers.release(instanceNumber));
            return widget;
        }
    }));
    bindViewContribution(bind, CanViewContribution);
    bind(OpenHandler).to(CanViewContribution).inSingletonScope();

    bind(CanMatrixWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: CAN_MATRIX_WIDGET_ID,
        createWidget: (options?: { id?: string }) => {
            const widget = context.container.get<CanMatrixWidget>(CanMatrixWidget);
            if (options && options.id) {
                widget.id = options.id;
            }
            const instanceNumber = canMatrixNumbers.allocate();
            widget.title.label = `CAN ID Matrix #${instanceNumber}`;
            widget.onDidDispose(() => canMatrixNumbers.release(instanceNumber));
            return widget;
        }
    }));
    bindViewContribution(bind, CanMatrixViewContribution);
    bind(OpenHandler).to(CanMatrixViewContribution).inSingletonScope();
});
