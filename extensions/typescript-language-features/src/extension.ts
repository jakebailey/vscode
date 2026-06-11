/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VsCodeTelemetryReporter from '@vscode/extension-telemetry';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { Api, getExtensionApi } from './api';
import { CommandManager } from './commands/commandManager';
import { SelectTypeScriptVersionCommand } from './commands/selectTypeScriptVersion';
import { DisableTsgoCommand } from './commands/useTsgo';
import { registerBaseCommands } from './commands/index';
import { ElectronServiceConfigurationProvider } from './configuration/configuration.electron';
import { ExperimentationTelemetryReporter, IExperimentationTelemetryReporter } from './experimentTelemetryReporter';
import { ExperimentationService } from './experimentationService';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { Logger } from './logging/logger';
import { nodeRequestCancellerFactory } from './tsServer/cancellation.electron';
import { NodeLogDirectoryProvider } from './tsServer/logDirectoryProvider.electron';
import { PluginManager } from './tsServer/plugins';
import { ElectronServiceProcessFactory } from './tsServer/serverProcess.electron';
import { DiskTypeScriptVersionProvider } from './tsServer/versionProvider.electron';
import { ActiveJsTsEditorTracker } from './ui/activeJsTsEditorTracker';
import { suggestNativePreview } from './ui/suggestNativePreview';
import { onCaseInsensitiveFileSystem } from './utils/fs.electron';
import { Lazy } from './utils/lazy';
import { getPackageInfo } from './utils/packageInfo';
import * as temp from './utils/temp.electron';
import { Condition, conditionalRegistration } from './languageFeatures/util/dependentRegistration';
import { DisposableStore } from './utils/dispose';
import { JsTsServerSelectionService } from './tsServer/serverSelection';
import { JsTsServerKind } from './tsServer/serverSelectionTypes';

export function activate(
	context: vscode.ExtensionContext
): Api {
	const pluginManager = new PluginManager();
	context.subscriptions.push(pluginManager);

	const onCompletionAccepted = new vscode.EventEmitter<vscode.CompletionItem>();
	context.subscriptions.push(onCompletionAccepted);

	const logDirectoryProvider = new NodeLogDirectoryProvider(context);
	const versionProvider = new DiskTypeScriptVersionProvider();
	let autoServerKind: JsTsServerKind = 'tsserver';
	const serverSelectionService = new JsTsServerSelectionService(context.workspaceState, () => autoServerKind);
	context.subscriptions.push(serverSelectionService);

	let experimentTelemetryReporter: IExperimentationTelemetryReporter | undefined;
	const packageInfo = getPackageInfo(context);
	if (packageInfo) {
		const { name: id, version, aiKey } = packageInfo;
		const vscTelemetryReporter = new VsCodeTelemetryReporter(aiKey);
		experimentTelemetryReporter = new ExperimentationTelemetryReporter(vscTelemetryReporter);
		context.subscriptions.push(experimentTelemetryReporter);

		const experimentationService = new ExperimentationService(experimentTelemetryReporter, id, version, context.globalState);
		suggestNativePreview(context, experimentationService);
		void experimentationService.getTreatmentVariable('useNativePreviewByDefault', false).then(useNativePreviewByDefault => {
			autoServerKind = useNativePreviewByDefault ? 'lsp' : 'tsserver';
			serverSelectionService.update();
		});
	}

	// Register features that work in both TSGO and non-TSGO modes
	import('./languageFeatures/tsconfig').then(module => {
		context.subscriptions.push(module.register());
	});

	// Conditionally register features based on the resolved JS/TS language server.
	context.subscriptions.push(conditionalRegistration([
		new Condition(
			() => serverSelectionService.selection.kind === 'lsp',
			handler => serverSelectionService.onDidChangeSelection(handler)
		),
	], () => {
		// Native LSP. Only register a small set of features that don't use TS Server.
		const disposables = new DisposableStore();

		const commandManager = disposables.add(new CommandManager());
		commandManager.register(new SelectTypeScriptVersionCommand(undefined, serverSelectionService));
		commandManager.register(new DisableTsgoCommand());

		return disposables;
	}, () => {
		// Normal registration path
		const disposables = new DisposableStore();

		const commandManager = disposables.add(new CommandManager());
		const activeJsTsEditorTracker = disposables.add(new ActiveJsTsEditorTracker());

		const lazyClientHost = createLazyClientHost(context, onCaseInsensitiveFileSystem(), {
			pluginManager,
			commandManager,
			logDirectoryProvider,
			cancellerFactory: nodeRequestCancellerFactory,
			versionProvider,
			processFactory: new ElectronServiceProcessFactory(),
			activeJsTsEditorTracker,
			serviceConfigurationProvider: new ElectronServiceConfigurationProvider(),
			serverSelectionService,
			experimentTelemetryReporter,
			logger: new Logger(),
		}, item => {
			onCompletionAccepted.fire(item);
		}).map(clientHost => {
			return disposables.add(clientHost);
		});

		// Register features
		registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker, serverSelectionService);

		import('./task/taskProvider').then(module => {
			disposables.add(module.register(new Lazy(() => lazyClientHost.value.serviceClient)));
		});

		disposables.add(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));

		return disposables;
	},));

	return getExtensionApi(onCompletionAccepted.event, pluginManager, serverSelectionService);
}

export function deactivate() {
	fs.rmSync(temp.instanceTempDir.value, { recursive: true, force: true });
}
