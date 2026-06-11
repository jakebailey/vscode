/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { hasModifiedUnifiedConfig, readUnifiedConfig, unifiedConfigSection } from '../utils/configuration';
import { Disposable } from '../utils/dispose';
import { RelativeWorkspacePathResolver } from '../utils/relativePathResolver';
import { IJsTsServerSelectionService, JsTsServerKind, JsTsServerSelection, LanguageServerPreference, languageServerPreferenceConfig, tsNativeExtensionId } from './serverSelectionTypes';

export const useWorkspaceTsdkStorageKey = 'typescript.useWorkspaceTsdk';

interface TsdkCandidate {
	readonly source: 'user' | 'workspace';
	readonly path: string;
}

export class JsTsServerSelectionService extends Disposable implements IJsTsServerSelectionService {
	private _selection: JsTsServerSelection;

	private readonly _onDidChangeSelection = this._register(new vscode.EventEmitter<JsTsServerSelection>());
	public readonly onDidChangeSelection = this._onDidChangeSelection.event;

	public constructor(
		private readonly workspaceState: vscode.Memento,
		private readonly defaultServerKind: () => JsTsServerKind = () => 'tsserver',
	) {
		super();

		this._selection = resolveJsTsServerSelection(this.workspaceState, this.defaultServerKind);
		this.updateContext();

		this._register(vscode.workspace.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(`${unifiedConfigSection}.${languageServerPreferenceConfig}`)
				|| e.affectsConfiguration(`${unifiedConfigSection}.tsdk.path`)
				|| e.affectsConfiguration('typescript.tsdk')
				|| e.affectsConfiguration(`${unifiedConfigSection}.experimental.useTsgo`)
				|| e.affectsConfiguration('typescript.experimental.useTsgo')
			) {
				this.update();
			}
		}));
		this._register(vscode.workspace.onDidGrantWorkspaceTrust(() => this.update()));
		this._register(vscode.extensions.onDidChange(() => this.update()));
	}

	public get selection(): JsTsServerSelection {
		return this._selection;
	}

	public update(): void {
		const next = resolveJsTsServerSelection(this.workspaceState, this.defaultServerKind);
		if (serverSelectionsEqual(this._selection, next)) {
			return;
		}
		this._selection = next;
		this.updateContext();
		this._onDidChangeSelection.fire(next);
	}

	public async setPreference(preference: LanguageServerPreference): Promise<void> {
		await vscode.workspace.getConfiguration(unifiedConfigSection).update(languageServerPreferenceConfig, preference, vscode.ConfigurationTarget.Global);
	}

	private updateContext(): void {
		void vscode.commands.executeCommand('setContext', 'typescript.serverKind', this._selection.kind);
	}
}

function serverSelectionsEqual(a: JsTsServerSelection, b: JsTsServerSelection): boolean {
	return a.kind === b.kind
		&& a.source === b.source
		&& a.tsdk === b.tsdk
		&& a.preference === b.preference
		&& a.reason === b.reason;
}

export function resolveJsTsServerSelection(
	workspaceState: vscode.Memento,
	defaultServerKind: () => JsTsServerKind = () => 'tsserver',
): JsTsServerSelection {
	const preference = readLanguageServerPreference();
	const tsdk = readTsdkCandidate(workspaceState);

	if (tsdk) {
		const kind = classifyTsdk(tsdk.path);
		if (kind) {
			return {
				kind,
				source: tsdk.source,
				tsdk: tsdk.path,
				preference,
				reason: `${tsdk.source} tsdk`,
			};
		}
	}

	const kind = resolveBundledServerKind(preference, defaultServerKind);
	return {
		kind,
		source: 'bundled',
		tsdk: undefined,
		preference,
		reason: preference === 'auto' ? 'auto' : preference,
	};
}

export function readLanguageServerPreference(): LanguageServerPreference {
	const preference = readUnifiedConfig<LanguageServerPreference>(languageServerPreferenceConfig, 'auto', { fallbackSection: 'typescript' });
	if (preference === 'auto' || preference === 'preferTsserver' || preference === 'preferLsp') {
		return preference;
	}
	return 'auto';
}

function resolveBundledServerKind(
	preference: LanguageServerPreference,
	defaultServerKind: () => JsTsServerKind,
): JsTsServerKind {
	switch (preference) {
		case 'preferTsserver':
			return 'tsserver';
		case 'preferLsp':
			return hasNativePreviewExtension() ? 'lsp' : 'tsserver';
		case 'auto': {
			const legacyUseTsgo = readLegacyUseTsgo();
			if (legacyUseTsgo !== undefined) {
				return legacyUseTsgo && hasNativePreviewExtension() ? 'lsp' : 'tsserver';
			}
			return defaultServerKind() === 'lsp' && hasNativePreviewExtension() ? 'lsp' : 'tsserver';
		}
	}
}

function hasNativePreviewExtension(): boolean {
	return !!vscode.extensions.getExtension(tsNativeExtensionId);
}

function readLegacyUseTsgo(): boolean | undefined {
	if (!hasModifiedUnifiedConfig('experimental.useTsgo', { fallbackSection: 'typescript' })) {
		return undefined;
	}
	return readUnifiedConfig<boolean>('experimental.useTsgo', false, { fallbackSection: 'typescript' });
}

function readTsdkCandidate(workspaceState: vscode.Memento): TsdkCandidate | undefined {
	const config = vscode.workspace.getConfiguration();
	const workspaceTsdk = readWorkspaceTsdk(config);
	if (workspaceTsdk && vscode.workspace.isTrusted && workspaceState.get<boolean>(useWorkspaceTsdkStorageKey, false)) {
		return { source: 'workspace', path: workspaceTsdk };
	}

	const userTsdk = readUserTsdk(config);
	if (userTsdk) {
		return { source: 'user', path: userTsdk };
	}

	return undefined;
}

function readWorkspaceTsdk(configuration: vscode.WorkspaceConfiguration): string | undefined {
	const unifiedInspect = configuration.inspect<string>('js/ts.tsdk.path');
	if (typeof unifiedInspect?.workspaceValue === 'string') {
		return fixPathPrefixes(unifiedInspect.workspaceValue);
	}

	const legacyInspect = configuration.inspect<string>('typescript.tsdk');
	if (typeof legacyInspect?.workspaceValue === 'string') {
		return fixPathPrefixes(legacyInspect.workspaceValue);
	}

	return undefined;
}

function readUserTsdk(configuration: vscode.WorkspaceConfiguration): string | undefined {
	const unifiedInspect = configuration.inspect<string>('js/ts.tsdk.path');
	if (typeof unifiedInspect?.globalValue === 'string') {
		return fixPathPrefixes(unifiedInspect.globalValue);
	}

	const legacyInspect = configuration.inspect<string>('typescript.tsdk');
	if (typeof legacyInspect?.globalValue === 'string') {
		return fixPathPrefixes(legacyInspect.globalValue);
	}

	return undefined;
}

function fixPathPrefixes(inspectValue: string): string {
	const pathPrefix = '~' + path.sep;
	if (inspectValue.startsWith(pathPrefix)) {
		return path.join(os.homedir(), inspectValue.slice(pathPrefix.length));
	}
	return inspectValue;
}

export function classifyTsdk(tsdkPath: string): JsTsServerKind | undefined {
	const absolutePath = resolveTsdkPath(tsdkPath);

	if (fs.existsSync(path.join(absolutePath, 'tsserver.js'))) {
		return 'tsserver';
	}

	const packageJson = readPackageJson(absolutePath);
	if (packageJson?.name === 'typescript' && fs.existsSync(path.join(absolutePath, 'lib', 'tsserver.js'))) {
		return 'tsserver';
	}

	if (resolveTsgoPath(absolutePath)) {
		return 'lsp';
	}

	if (fs.existsSync(path.join(absolutePath, 'lib', 'tsserver.js'))) {
		return 'lsp';
	}

	return undefined;
}

export function resolveTsdkPath(tsdkPath: string): string {
	if (path.isAbsolute(tsdkPath)) {
		return path.normalize(tsdkPath);
	}

	const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(tsdkPath);
	if (workspacePath !== undefined) {
		return path.normalize(workspacePath);
	}

	return path.normalize(tsdkPath);
}

function resolveTsgoPath(tsdkPath: string): string | undefined {
	const executableName = `tsgo${process.platform === 'win32' ? '.exe' : ''}`;
	const directExecutable = path.join(tsdkPath, executableName);
	if (fs.existsSync(directExecutable)) {
		return directExecutable;
	}

	if (isNativePreviewPackage(tsdkPath)) {
		const platformPackage = `native-preview-${process.platform}-${process.arch}`;
		const packageExecutable = path.join(tsdkPath, '..', platformPackage, 'lib', executableName);
		if (fs.existsSync(packageExecutable)) {
			return packageExecutable;
		}
	}

	return undefined;
}

function isNativePreviewPackage(tsdkPath: string): boolean {
	return readPackageJson(tsdkPath)?.name === '@typescript/native-preview';
}

function readPackageJson(packagePath: string): { name?: string } | undefined {
	try {
		return JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8')) as { name?: string };
	} catch {
		return undefined;
	}
}
