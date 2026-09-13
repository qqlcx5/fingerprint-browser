import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveEngineDefaultModel } from './ipc/settings'

test('resolveEngineDefaultModel reads from ~/.pi/agent/settings.json', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engine-settings-test-'))
  try {
    const dir = join(home, '.pi', 'agent')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'anthropic-proxy',
        defaultModel: 'glm-5.3-flash',
      }),
      'utf-8'
    )

    const resolved = resolveEngineDefaultModel(home)
    assert.equal(resolved.provider, 'anthropic-proxy')
    assert.equal(resolved.model, 'glm-5.3-flash')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('resolveEngineDefaultModel falls back to ~/.pi/agent/models.json first provider model', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engine-models-test-'))
  try {
    const dir = join(home, '.pi', 'agent')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'models.json'),
      JSON.stringify({
        providers: {
          'custom-provider': {
            models: [{ id: 'my-custom-model', name: 'My Model' }],
          },
        },
      }),
      'utf-8'
    )

    const resolved = resolveEngineDefaultModel(home)
    assert.equal(resolved.provider, 'custom-provider')
    assert.equal(resolved.model, 'my-custom-model')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('resolveEngineDefaultModel returns nulls if nothing found', async () => {
  const home = await mkdtemp(join(tmpdir(), 'engine-empty-test-'))
  try {
    const resolved = resolveEngineDefaultModel(home)
    assert.equal(resolved.provider, null)
    assert.equal(resolved.model, null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
