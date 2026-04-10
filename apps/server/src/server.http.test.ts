import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { HttpClient } from 'effect/unstable/http'
import * as Http from 'node:http'

import { buildAppUnderTest, provideServerTest } from './server.test.helpers.ts'

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

it.effect('proxies to the dev URL when configured', () =>
  provideServerTest(
    Effect.gen(function* () {
      const upstream = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<{ server: Http.Server; baseUrl: URL }>((resolve, reject) => {
              const server = Http.createServer((request, response) => {
                response.statusCode = 200
                response.setHeader('content-type', 'text/html; charset=utf-8')
                response.end(`<html>dev-proxy-ok ${request.url ?? '/'}</html>`)
              })

              server.listen(0, '127.0.0.1', () => {
                const address = server.address()
                if (!address || typeof address === 'string') {
                  reject(new Error('Failed to resolve upstream server address.'))
                  return
                }
                resolve({
                  server,
                  baseUrl: new URL(`http://127.0.0.1:${address.port}`),
                })
              })

              server.on('error', reject)
            })
        ),
        ({ server }) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve, reject) => {
                server.close(error => {
                  if (error) {
                    reject(error)
                    return
                  }
                  resolve()
                })
              })
          )
      )

      yield* buildAppUnderTest({
        config: { devUrl: upstream.baseUrl },
      })

      const response = yield* HttpClient.get('/foo/bar?x=1')

      assert.equal(response.status, 200)
      assert.include(yield* response.text, 'dev-proxy-ok /foo/bar?x=1')
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
