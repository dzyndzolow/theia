/* eslint-disable @typescript-eslint/tslint/config */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { CanSocketServiceImpl, CanSocketService, CanRpcService } from './can-socket-service';
import { CanRpcServiceImpl } from './can-rpc-service';
import { CanRpcClient, canServicePath } from '../common/can-protocol';

const canConnectionModule = ConnectionContainerModule.create(({ bind }) => {
    bind(CanRpcServiceImpl).toSelf().inSingletonScope();
    bind(CanRpcService).toService(CanRpcServiceImpl);

    bind(ConnectionHandler)
        .toDynamicValue(
            ({ container }) =>
                new RpcConnectionHandler<CanRpcClient>(
                    canServicePath,
                    client => {
                        const service = container.get<CanRpcServiceImpl>(CanRpcServiceImpl);
                        service.setClient(client);
                        // The shared service owns per-client cleanup; disposing it on a single
                        // client disconnect would stop all active interfaces for every other widget.
                        // setClient already wires the close handler, so no extra action is needed here.
                        return service;
                    }
                )
        )
        .inSingletonScope();
});

export default new ContainerModule(bind => {
    bind(CanSocketService).to(CanSocketServiceImpl).inSingletonScope();
    bind(ConnectionContainerModule).toConstantValue(canConnectionModule);
});
