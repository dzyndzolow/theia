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
import {
    GLOBAL_VARIABLES_WIDGET_ID,
    GLOBAL_VARIABLES_WIDGET_LABEL,
    type GlobalVariablesWidget
} from './global-variables-widget';

export const GlobalVariableCommands = {
    OPEN_GLOBAL_VARIABLES: 'signal:open-global-variables'
} as const;

@injectable()
export class GlobalVariablesViewContribution extends AbstractViewContribution<GlobalVariablesWidget> {

    constructor() {
        super({
            widgetId: GLOBAL_VARIABLES_WIDGET_ID,
            widgetName: GLOBAL_VARIABLES_WIDGET_LABEL,
            defaultWidgetOptions: {
                area: 'main'
            },
            toggleCommandId: GlobalVariableCommands.OPEN_GLOBAL_VARIABLES
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand({
            id: GlobalVariableCommands.OPEN_GLOBAL_VARIABLES,
            label: 'Open Global Variables Table'
        }, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        const analyzerMenuPath = [...MAIN_MENU_BAR, 'sample-menu'];
        menus.registerMenuAction(analyzerMenuPath, {
            commandId: GlobalVariableCommands.OPEN_GLOBAL_VARIABLES,
            order: '3'
        });
    }
}
