import { expect, it } from 'vitest'
import {
  filterHiddenModelOptions,
  listAgentOptions,
  listConfiguredProviderIDs,
  listModelOptionsFromConfig,
  listModelOptionsFromConfigReferences,
  mergeDiscoverableModelOptions,
} from './models'

export function registerConfigParsingTests() {
  it('extracts model options from global config providers', () => {
    const options = listModelOptionsFromConfig({
      provider: {
        openai: {
          name: 'OpenAI',
          models: {
            'gpt-5.2': {
              id: 'gpt-5.2',
              name: 'GPT-5.2',
            },
          },
        },
        custom: {
          models: {
            'alpha-1': {
              variants: {
                fast: {},
                precise: {},
              },
            },
          },
        },
      },
    })

    expect(options.map(item => item.key)).toEqual(['custom/alpha-1', 'openai/gpt-5.2'])
    expect(options.find(item => item.key === 'custom/alpha-1')?.variants).toEqual([
      'fast',
      'precise',
    ])
  })

  it('supports shorthand provider model formats in config', () => {
    const options = listModelOptionsFromConfig({
      providers: {
        openrouter: {
          name: 'OpenRouter',
          models: {
            'anthropic/claude-3.5-sonnet': 'Claude 3.5 Sonnet',
            'openai/gpt-4.1': true,
            'old-model': {
              status: 'deprecated',
            },
          },
        },
        anthropic: {
          models: [
            'claude-3-7-sonnet',
            {
              id: 'claude-opus-4-1',
              name: 'Claude Opus 4.1',
            },
          ],
        },
      },
    })

    expect(options.map(item => item.key)).toEqual([
      'anthropic/claude-3-7-sonnet',
      'anthropic/claude-opus-4-1',
      'openrouter/anthropic/claude-3.5-sonnet',
      'openrouter/openai/gpt-4.1',
    ])
    expect(
      options.find(item => item.key === 'openrouter/anthropic/claude-3.5-sonnet')?.modelName
    ).toBe('Claude 3.5 Sonnet')
  })
}

export function registerVisibilityTests() {
  it('composer options match settings options exactly when no models are hidden', () => {
    const settingsOptions = mergeDiscoverableModelOptions(
      [
        {
          key: 'openai/gpt-5.2',
          providerID: 'openai',
          modelID: 'gpt-5.2',
          providerName: 'OpenAI',
          modelName: 'GPT-5.2',
          variants: [],
        },
      ],
      [
        {
          key: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
          providerID: 'cloudflare',
          modelID: '@cf/meta/llama-3.1-8b-instruct',
          providerName: 'Cloudflare AI',
          modelName: 'Llama 3.1 8B Instruct',
          variants: [],
        },
      ]
    )

    expect(filterHiddenModelOptions(settingsOptions, []).map(item => item.key)).toEqual(
      settingsOptions.map(item => item.key)
    )
  })

  it('filters hidden models from composer options while retaining settings discoverability', () => {
    const settingsOptions = [
      {
        key: 'openai/gpt-5.2',
        providerID: 'openai',
        modelID: 'gpt-5.2',
        providerName: 'OpenAI',
        modelName: 'GPT-5.2',
        variants: [],
      },
      {
        key: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
        providerID: 'cloudflare',
        modelID: '@cf/meta/llama-3.1-8b-instruct',
        providerName: 'Cloudflare AI',
        modelName: 'Llama 3.1 8B Instruct',
        variants: [],
      },
    ]

    expect(
      filterHiddenModelOptions(settingsOptions, ['cloudflare/@cf/meta/llama-3.1-8b-instruct']).map(
        item => item.key
      )
    ).toEqual(['openai/gpt-5.2'])
    expect(settingsOptions.map(item => item.key)).toEqual([
      'openai/gpt-5.2',
      'cloudflare/@cf/meta/llama-3.1-8b-instruct',
    ])
  })

  it('filters hidden and subagent definitions from agent list', () => {
    const options = listAgentOptions([
      {
        name: 'orxa',
        mode: 'all',
        model: { providerID: 'openai', modelID: 'gpt-5' },
      },
      {
        name: 'hidden',
        mode: 'all',
        model: 'openai/gpt-4.1',
        hidden: true,
      },
      {
        name: 'sub',
        mode: 'subagent',
        model: 'openai/gpt-4.1',
      },
    ] as never)

    expect(options).toEqual([
      {
        name: 'orxa',
        model: 'openai/gpt-5',
        description: undefined,
      },
    ])
  })
}

export function registerConfigReferenceTests() {
  it('handles invalid model configuration shapes safely', () => {
    expect(listModelOptionsFromConfig(null)).toEqual([])
    expect(listModelOptionsFromConfig([])).toEqual([])
    expect(listModelOptionsFromConfig({ providers: { one: { models: false } } })).toEqual([])
    expect(listConfiguredProviderIDs({ model: 'invalid' })).toEqual([])
  })

  it('extracts only explicit model references from config', () => {
    const options = listModelOptionsFromConfigReferences({
      model: 'openai/gpt-5.2',
      small_model: 'openai/gpt-5.2-codex',
      provider: {
        openai: {
          models: {
            'gpt-5.2': true,
            'gpt-5.2-codex': true,
          },
        },
        alibaba: {
          models: {
            'qwen-max': true,
          },
        },
      },
      agent: {
        reviewer: {
          model: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
        },
      },
    })

    expect(options.map(item => item.key)).toEqual([
      'cloudflare/@cf/meta/llama-3.1-8b-instruct',
      'openai/gpt-5.2',
      'openai/gpt-5.2-codex',
    ])
  })
}
