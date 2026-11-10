import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { providersApi } from '../../api/providers'
import { useSettingsStore } from '../../stores/settingsStore'
import { ProviderHealthPanel } from './ProviderHealthPanel'
import type { SavedProvider } from '../../types/provider'

const provider: SavedProvider = {
  id: 'p1',
  presetId: 'custom',
  name: 'Gateway',
  baseUrl: 'http://127.0.0.1:3425/v1',
  apiKey: 'magpie',
  apiFormat: 'anthropic',
  models: { main: 'model-dead', haiku: 'model-dead', sonnet: 'model-dead', opus: 'model-dead' },
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useSettingsStore.setState({ locale: 'en' })
})

describe('ProviderHealthPanel', () => {
  it('shows one row per model with its latency and failure reason', async () => {
    vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: true,
      endpoint: 'http://127.0.0.1:3425/v1/models',
      models: [{ id: 'model-dead' }, { id: 'model-alive' }],
    })
    vi.spyOn(providersApi, 'test').mockImplementation(async (_id, overrides) => ({
      result: {
        connectivity: overrides?.modelId === 'model-alive'
          ? { success: true, latencyMs: 88, httpStatus: 200 }
          : { success: false, latencyMs: 0, error: 'HTTP 429', httpStatus: 429 },
      },
    }))

    render(<ProviderHealthPanel provider={provider} onUseModel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Health check/i }))

    const alive = await screen.findByTestId('provider-health-row-model-alive')
    expect(alive).toHaveTextContent('88ms')
    const dead = screen.getByTestId('provider-health-row-model-dead')
    expect(dead).toHaveTextContent('429')
    expect(screen.getByText(/1 working, 1 failing/)).toBeInTheDocument()
  })

  it('offers the healthy model as the new main model', async () => {
    vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: true,
      endpoint: 'http://127.0.0.1:3425/v1/models',
      models: [{ id: 'model-alive' }],
    })
    vi.spyOn(providersApi, 'test').mockResolvedValue({
      result: { connectivity: { success: true, latencyMs: 88, httpStatus: 200 } },
    })
    const onUseModel = vi.fn()

    render(<ProviderHealthPanel provider={provider} onUseModel={onUseModel} />)
    fireEvent.click(screen.getByRole('button', { name: /Health check/i }))
    fireEvent.click(await screen.findByRole('button', { name: /Use as main/i }))

    await waitFor(() => expect(onUseModel).toHaveBeenCalledWith('p1', 'model-alive'))
  })

  it('keeps probing the slot models when the upstream catalog cannot be read', async () => {
    vi.spyOn(providersApi, 'fetchModels').mockResolvedValue({
      ok: false,
      errorCode: 'auth-failed',
      message: '401 unauthorized',
      endpointsTried: [],
    })
    vi.spyOn(providersApi, 'test').mockResolvedValue({
      result: { connectivity: { success: true, latencyMs: 12, httpStatus: 200 } },
    })

    render(<ProviderHealthPanel provider={provider} onUseModel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Health check/i }))

    expect(await screen.findByText(/401 unauthorized/)).toBeInTheDocument()
    expect(await screen.findByTestId('provider-health-row-model-dead')).toBeInTheDocument()
  })
})
