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
    CanGeneratorWidget,
    CAN_GENERATOR_WIDGET_ID,
    CAN_GENERATOR_WIDGET_LABEL
} from './can-generator-widget';

export const CanGeneratorCommands = {
    TOGGLE: 'can-bus:toggle-generator',
    OPEN: 'can-bus:open-generator'
} as const;

@injectable()
export class CanGeneratorViewContribution extends AbstractViewContribution<CanGeneratorWidget> {

    constructor() {
        super({
            widgetId: CAN_GENERATOR_WIDGET_ID,
            widgetName: CAN_GENERATOR_WIDGET_LABEL,
            defaultWidgetOptions: {
                area: 'main'
            },
            toggleCommandId: CanGeneratorCommands.TOGGLE,
            toggleKeybinding: 'CtrlCmd+Shift+G'
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand({ id: CanGeneratorCommands.OPEN, label: 'Open CAN Frame & Wave Generator' }, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        const canMenuPath = [...MAIN_MENU_BAR, 'sample-menu'];
        menus.registerMenuAction(canMenuPath, {
            commandId: CanGeneratorCommands.OPEN,
            order: '1'
        });
    }
}
