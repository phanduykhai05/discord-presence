import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { presenceDir, configPath, statePath, settingsPath, claudeDir } from '../src/core/paths';

test('presence paths live under the presence dir', () => {
  assert.equal(configPath(), path.join(presenceDir(), 'config.json'));
  assert.equal(statePath(), path.join(presenceDir(), 'state.json'));
});

test('settings.json sits in the claude dir', () => {
  assert.equal(settingsPath(), path.join(claudeDir(), 'settings.json'));
});

test('CLAUDE_CONFIG_DIR overrides the claude dir', () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join('tmp', 'cc');
  try {
    assert.equal(claudeDir(), path.join('tmp', 'cc'));
    assert.equal(presenceDir(), path.join('tmp', 'cc', 'discord-presence'));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
});
