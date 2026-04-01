import { describe } from 'vitest'
import {
  registerConfigParsingTests,
  registerConfigReferenceTests,
  registerVisibilityTests,
} from './models.config.test-helpers'
import {
  registerDiscoverabilityMergeTests,
  registerProviderCatalogTests,
  registerProviderFilteringTests,
  registerProviderRegistrySafetyTests,
} from './models.registry.test-helpers'

describe('model discovery', () => {
  registerProviderFilteringTests()
  registerProviderCatalogTests()
  registerProviderRegistrySafetyTests()
  registerDiscoverabilityMergeTests()
  registerConfigParsingTests()
  registerVisibilityTests()
  registerConfigReferenceTests()
})
