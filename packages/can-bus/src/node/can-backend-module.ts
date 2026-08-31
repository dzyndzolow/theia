/* eslint-disable @typescript-eslint/tslint/config */

import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { CanSocketServiceImpl, CanSocketService, CanRpcService } from './can-socket-service';
import { CanRpcServiceImpl } from './can-rpc-service';
import { CanRpcClient, canServicePath } from '../common/can-protocol';
import { CanTransmitService, CanTransmitServiceImpl } from './can-transmit-service';
import { CanPlayerService, CanPlayerServiceImpl } from './can-player-service';
import { CanRecorderService, CanRecorderServiceImpl } from './can-recorder-service';
import { CanCampaignEngine, CanCampaignEngineImpl } from './can-campaign-engine';
import { CanFeedbackService, CanFeedbackServiceImpl } from './can-feedback-service';
import { CanAdaptiveReplayService, CanAdaptiveReplayServiceImpl } from './can-adaptive-replay';
import { CanPythonRunner, CanPythonRunnerImpl } from './can-python-runner';
import { CanExperimentReportService, CanExperimentReportServiceImpl } from './can-experiment-report-service';
import { CanDeviceProvider } from '../common/can-device';
import { CanDeviceRegistry, CanDeviceRegistryImpl } from './device/can-device-registry';
import { Esp32CanDeviceProvider } from './device/esp32-can-device-provider';
import { PcanBasicDeviceProvider } from './device/pcan-basic-provider';
import { SlcanDeviceProvider } from './device/slcan-device-provider';

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
    bind(CanTransmitService).to(CanTransmitServiceImpl).inSingletonScope();
    bind(CanPlayerService).to(CanPlayerServiceImpl).inSingletonScope();
    bind(CanRecorderService).to(CanRecorderServiceImpl).inSingletonScope();
    bind(CanCampaignEngine).to(CanCampaignEngineImpl).inSingletonScope();
    bind(CanFeedbackService).to(CanFeedbackServiceImpl).inSingletonScope();
    bind(CanAdaptiveReplayService).to(CanAdaptiveReplayServiceImpl).inSingletonScope();
    bind(CanPythonRunner).to(CanPythonRunnerImpl).inSingletonScope();
    bind(CanExperimentReportService).to(CanExperimentReportServiceImpl).inSingletonScope();

    // Hardware Layer bindings
    bind(Esp32CanDeviceProvider).toSelf().inSingletonScope();
    bind(CanDeviceProvider).toService(Esp32CanDeviceProvider);
    bind(PcanBasicDeviceProvider).toSelf().inSingletonScope();
    bind(CanDeviceProvider).toService(PcanBasicDeviceProvider);
    bind(SlcanDeviceProvider).toSelf().inSingletonScope();
    bind(CanDeviceProvider).toService(SlcanDeviceProvider);
    bind(CanDeviceRegistry).to(CanDeviceRegistryImpl).inSingletonScope();

    bind(ConnectionContainerModule).toConstantValue(canConnectionModule);
});
