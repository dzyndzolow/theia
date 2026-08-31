// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommandRegistry, MenuModelRegistry, MAIN_MENU_BAR } from '@theia/core/lib/common';
import { CanMatrixWidget, CAN_MATRIX_WIDGET_ID, CAN_MATRIX_WIDGET_LABEL } from './can-matrix-widget';

export const CanMatrixCommands = {
    OPEN_MATRIX: 'can-bus:open-matrix',
    NEW_MATRIX: 'can-bus:new-matrix'
} as const;

@injectable()
export class CanMatrixViewContribution extends AbstractViewContribution<CanMatrixWidget> {

    constructor() {
        super({
            widgetId: CAN_MATRIX_WIDGET_ID,
            widgetName: CAN_MATRIX_WIDGET_LABEL,
            defaultWidgetOptions: {
                area: 'main'
            },
            toggleCommandId: CanMatrixCommands.OPEN_MATRIX
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        // `super.registerCommands` already registers the toggle command (`can-bus:open-matrix`).
        super.registerCommands(registry);
        registry.registerCommand({ id: CanMatrixCommands.NEW_MATRIX, label: 'New CAN ID Matrix' }, {
            execute: () => this.openNewMatrix()
        });
    }

    protected async openNewMatrix(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<CanMatrixWidget>(CAN_MATRIX_WIDGET_ID, {
            id: `${CAN_MATRIX_WIDGET_ID}:${Date.now()}`
        });
        await this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        const analyzerMenuPath = [...MAIN_MENU_BAR, 'sample-menu'];
        menus.registerMenuAction(analyzerMenuPath, {
            commandId: CanMatrixCommands.NEW_MATRIX,
            order: '2'
        });
    }
}
