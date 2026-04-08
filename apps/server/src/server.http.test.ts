import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { HttpClient } from 'effect/unstable/http'

import { buildAppUnderTest, getHttpServerUrl, provideServerTest } from './server.test.helpers.ts'

it.effect('serves static index content for GET / when staticDir is configured', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const staticDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'orxa-router-static-' })
      const indexPath = path.join(staticDir, 'index.html')
      yield* fileSystem.writeFileString(indexPath, '<html>router-static-ok</html>')

      yield* buildAppUnderTest({ config: { staticDir } })

      const response = yield* HttpClient.get('/')
      assert.equal(response.status, 200)
      assert.include(yield* response.text, 'router-static-ok')
    })
  )
)

it.effect('redirects to dev URL when configured', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: { devUrl: new URL('http://127.0.0.1:5173') },
      })

      const url = yield* getHttpServerUrl('/foo/bar')
      const response = yield* Effect.promise(() => fetch(url, { redirect: 'manual' }))

      assert.equal(response.status, 302)
      assert.equal(response.headers.get('location'), 'http://127.0.0.1:5173/')
    })
  )
)

it.effect('serves project favicon requests before the dev URL redirect', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const projectDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: 'orxa-router-project-favicon-',
      })
      yield* fileSystem.writeFileString(
        path.join(projectDir, 'favicon.svg'),
        '<svg>router-project-favicon</svg>'
      )

      yield* buildAppUnderTest({
        config: { devUrl: new URL('http://127.0.0.1:5173') },
      })

      const response = yield* HttpClient.get(
        `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`
      )

      assert.equal(response.status, 200)
      assert.equal(yield* response.text, '<svg>router-project-favicon</svg>')
    })
  )
)

it.effect('serves the fallback project favicon when no icon exists', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const projectDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: 'orxa-router-project-favicon-fallback-',
      })

      yield* buildAppUnderTest({
        config: { devUrl: new URL('http://127.0.0.1:5173') },
      })

      const response = yield* HttpClient.get(
        `/api/project-favicon?cwd=${encodeURIComponent(projectDir)}`
      )

      assert.equal(response.status, 200)
      assert.include(yield* response.text, 'data-fallback="project-favicon"')
    })
  )
)
