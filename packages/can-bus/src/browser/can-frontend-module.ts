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
import { ValueAnalyzerWidget, VALUE_ANALYZER_WIDGET_ID, ValueAnalyzerOptions } from './value-analyzer-widget';
import { CanValueViewContribution } from './value-analyzer-view-contribution';
import { GlobalVariablesWidget, GLOBAL_VARIABLES_WIDGET_ID } from './global-variables-widget';
import { GlobalVariablesViewContribution } from './global-variables-view-contribution';
import { CanGeneratorWidget, CAN_GENERATOR_WIDGET_ID } from './can-generator-widget';
import { CanGeneratorViewContribution } from './can-generator-view-contribution';
import { WidgetInstanceNumbers } from './widget-instance-numbers';
import { CanInterfaceReservation } from './can-interface-reservation';
import { CanRpcClient } from './can-rpc-client';
import { GlobalVariableRegistry } from '@theia/signal-core';
import { CanVariableBridge } from './can-variable-bridge';

const canWidgetNumbers = new WidgetInstanceNumbers();
const canMatrixNumbers = new WidgetInstanceNumbers();
const canValueNumbers = new WidgetInstanceNumbers();

export default new ContainerModule(bind => {
    bind(GlobalVariableRegistry).toSelf().inSingletonScope();
    bind(CanVariableBridge).toSelf().inSingletonScope();
    bind(CanRpcClient).toSelf().inSingletonScope();
    bind(CanInterfaceReservation).toSelf().inSingletonScope();

    // 1. CAN Bus Analyzer
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

    // 2. CAN Matrix Widget
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

    // 3. Value Analyzer Widget
    bind(ValueAnalyzerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: VALUE_ANALYZER_WIDGET_ID,
        createWidget: (options?: ValueAnalyzerOptions) => {
            const widget = context.container.get<ValueAnalyzerWidget>(ValueAnalyzerWidget);
            if (options && options.id) {
                widget.id = options.id;
            }
            const instanceNumber = canValueNumbers.allocate();
            widget.title.label = `${ValueAnalyzerWidget.LABEL} #${instanceNumber}`;
            widget.onDidDispose(() => canValueNumbers.release(instanceNumber));
            if (options) {
                widget.configure(options);
            }
            return widget;
        }
    }));
    bindViewContribution(bind, CanValueViewContribution);
    bind(OpenHandler).to(CanValueViewContribution).inSingletonScope();

    // 4. Global Variables Widget
    bind(GlobalVariablesWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: GLOBAL_VARIABLES_WIDGET_ID,
        createWidget: () => context.container.get<GlobalVariablesWidget>(GlobalVariablesWidget)
    }));
    bindViewContribution(bind, GlobalVariablesViewContribution);
    bind(OpenHandler).to(GlobalVariablesViewContribution).inSingletonScope();

    // 5. CAN Generator & Transmitter Widget
    bind(CanGeneratorWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: CAN_GENERATOR_WIDGET_ID,
        createWidget: () => context.container.get<CanGeneratorWidget>(CanGeneratorWidget)
    }));
    bindViewContribution(bind, CanGeneratorViewContribution);
    bind(OpenHandler).to(CanGeneratorViewContribution).inSingletonScope();
});
