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
import { DisposableStore } from './utils/dispose';
import { JsTsServerSelectionService } from './tsServer/serverSelection';
import { ITypeScriptNativeServerApi, JsTsServerKind, tsNativeExtensionId } from './tsServer/serverSelectionTypes';

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

	const serverRegistration = new JsTsServerRegistrationManager(
		context,
		serverSelectionService,
		() => createTsServerRegistration(
			context,
			pluginManager,
			logDirectoryProvider,
			versionProvider,
			experimentTelemetryReporter,
			onCompletionAccepted,
			serverSelectionService,
		),
		() => createNativeServerRegistration(serverSelectionService),
	);
	context.subscriptions.push(serverRegistration);

	return getExtensionApi(onCompletionAccepted.event, pluginManager, serverSelectionService);
}

export function deactivate() {
	fs.rmSync(temp.instanceTempDir.value, { recursive: true, force: true });
}

class JsTsServerRegistrationManager implements vscode.Disposable {
	private currentKind: JsTsServerKind | undefined;
	private currentRegistration: vscode.Disposable | undefined;
	private transition = Promise.resolve();
	private disposed = false;

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly serverSelectionService: JsTsServerSelectionService,
		private readonly createTsServerRegistration: () => vscode.Disposable,
		private readonly createNativeServerRegistration: () => vscode.Disposable,
	) {
		this.context.subscriptions.push(this.serverSelectionService.onDidChangeSelection(() => this.update()));
		this.update();
	}

	public dispose(): void {
		this.disposed = true;
		this.currentRegistration?.dispose();
		this.currentRegistration = undefined;
		void this.stopNativeServer();
	}

	private update(): void {
		this.transition = this.transition.then(() => this.updateWorker(), () => this.updateWorker());
	}

	private async updateWorker(): Promise<void> {
		if (this.disposed) {
			return;
		}

		const nextKind = this.serverSelectionService.selection.kind;
		if (this.currentKind === nextKind) {
			return;
		}

		this.currentRegistration?.dispose();
		this.currentRegistration = undefined;
		this.currentKind = undefined;

		if (nextKind === 'lsp') {
			this.currentRegistration = this.createNativeServerRegistration();
			await this.startNativeServer();
		} else {
			await this.stopNativeServer();
			this.currentRegistration = this.createTsServerRegistration();
		}

		this.currentKind = nextKind;
	}

	private async startNativeServer(): Promise<void> {
		const nativeApi = await getNativeServerApi();
		await nativeApi?.start(this.serverSelectionService.selection);
	}

	private async stopNativeServer(): Promise<void> {
		const extension = vscode.extensions.getExtension(tsNativeExtensionId);
		if (!extension?.isActive) {
			return;
		}
		const nativeApi = getNativeServerApiFromExports(extension.exports);
		await nativeApi?.stop();
	}
}

function createNativeServerRegistration(serverSelectionService: JsTsServerSelectionService): vscode.Disposable {
	const disposables = new DisposableStore();
	const commandManager = disposables.add(new CommandManager());
	commandManager.register(new SelectTypeScriptVersionCommand(undefined, serverSelectionService));
	commandManager.register(new DisableTsgoCommand());
	return disposables;
}

function createTsServerRegistration(
	context: vscode.ExtensionContext,
	pluginManager: PluginManager,
	logDirectoryProvider: NodeLogDirectoryProvider,
	versionProvider: DiskTypeScriptVersionProvider,
	experimentTelemetryReporter: IExperimentationTelemetryReporter | undefined,
	onCompletionAccepted: vscode.EventEmitter<vscode.CompletionItem>,
	serverSelectionService: JsTsServerSelectionService,
): vscode.Disposable {
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

	registerBaseCommands(commandManager, lazyClientHost, pluginManager, activeJsTsEditorTracker, serverSelectionService);

	import('./task/taskProvider').then(module => {
		disposables.add(module.register(new Lazy(() => lazyClientHost.value.serviceClient)));
	});

	disposables.add(lazilyActivateClient(lazyClientHost, pluginManager, activeJsTsEditorTracker));

	return disposables;
}

async function getNativeServerApi(): Promise<ITypeScriptNativeServerApi | undefined> {
	const extension = vscode.extensions.getExtension(tsNativeExtensionId);
	if (!extension) {
		return undefined;
	}
	const exports = await extension.activate();
	return getNativeServerApiFromExports(exports);
}

function getNativeServerApiFromExports(exports: unknown): ITypeScriptNativeServerApi | undefined {
	if (!exports || typeof exports !== 'object') {
		return undefined;
	}
	const candidate = exports as Partial<ITypeScriptNativeServerApi>;
	return typeof candidate.start === 'function' && typeof candidate.stop === 'function' ? candidate as ITypeScriptNativeServerApi : undefined;
}
