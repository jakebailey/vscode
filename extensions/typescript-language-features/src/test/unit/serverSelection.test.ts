/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import 'mocha';
import { classifyTsdk } from '../../tsServer/serverSelection';

suite('serverSelection', () => {
	let testDir: string;

	setup(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-selection-'));
	});

	teardown(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	test('classifies a tsserver sdk', () => {
		fs.writeFileSync(path.join(testDir, 'tsserver.js'), '');

		assert.strictEqual(classifyTsdk(testDir), 'tsserver');
	});

	test('classifies a native-preview package sdk', () => {
		fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: '@typescript/native-preview' }));
		const platformPackageDir = path.join(path.dirname(testDir), `native-preview-${process.platform}-${process.arch}`, 'lib');
		fs.mkdirSync(platformPackageDir, { recursive: true });
		fs.writeFileSync(path.join(platformPackageDir, `tsgo${process.platform === 'win32' ? '.exe' : ''}`), '');

		assert.strictEqual(classifyTsdk(testDir), 'lsp');
	});

	test('does not classify an invalid sdk', () => {
		assert.strictEqual(classifyTsdk(testDir), undefined);
	});
});
