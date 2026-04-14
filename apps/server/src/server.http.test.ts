import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { HttpClient } from 'effect/unstable/http'
import * as Http from 'node:http'

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

it.effect('exchanges bootstrap credentials for bearer sessions', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          remoteAccessBootstrapToken: 'bootstrap-token',
          remoteAccessEnvironmentId: 'environment-1',
        },
      })

      const bootstrapUrl = yield* getHttpServerUrl('/api/auth/bootstrap/bearer')
      const bootstrapResponse = yield* Effect.tryPromise(() =>
        fetch(bootstrapUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            credential: 'bootstrap-token',
          }),
        })
      )
      const bootstrapPayload = (yield* Effect.tryPromise(() => bootstrapResponse.json())) as {
        authenticated: boolean
        sessionMethod: string
        sessionToken: string
      }
      assert.equal(bootstrapResponse.status, 200)
      assert.equal(bootstrapPayload.authenticated, true)
      assert.equal(bootstrapPayload.sessionMethod, 'bearer-session-token')
      assert.equal(typeof bootstrapPayload.sessionToken, 'string')
      assert.isAtLeast(bootstrapPayload.sessionToken.length, 1)
    })
  )
)

it.effect(
  'revokes prior client bearer sessions when a new bootstrap bearer session is issued',
  () =>
    provideServerTest(
      Effect.gen(function* () {
        yield* buildAppUnderTest({
          config: {
            remoteAccessBootstrapToken: 'bootstrap-token',
            remoteAccessEnvironmentId: 'environment-1',
          },
        })

        const bootstrapUrl = yield* getHttpServerUrl('/api/auth/bootstrap/bearer')
        const firstBootstrapResponse = yield* Effect.tryPromise(() =>
          fetch(bootstrapUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              credential: 'bootstrap-token',
            }),
          })
        )
        const firstPayload = (yield* Effect.tryPromise(() => firstBootstrapResponse.json())) as {
          sessionToken: string
        }
        const secondBootstrapResponse = yield* Effect.tryPromise(() =>
          fetch(bootstrapUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              credential: 'bootstrap-token',
            }),
          })
        )
        const secondPayload = (yield* Effect.tryPromise(() => secondBootstrapResponse.json())) as {
          sessionToken: string
        }

        assert.equal(firstBootstrapResponse.status, 200)
        assert.equal(secondBootstrapResponse.status, 200)
        assert.notEqual(firstPayload.sessionToken, secondPayload.sessionToken)

        const sessionUrl = yield* getHttpServerUrl('/api/auth/session')
        const firstSessionResponse = yield* Effect.tryPromise(() =>
          fetch(sessionUrl, {
            headers: {
              authorization: `Bearer ${firstPayload.sessionToken}`,
            },
          })
        )
        const firstSessionPayload = (yield* Effect.tryPromise(() =>
          firstSessionResponse.json()
        )) as {
          authenticated: boolean
        }
        const secondSessionResponse = yield* Effect.tryPromise(() =>
          fetch(sessionUrl, {
            headers: {
              authorization: `Bearer ${secondPayload.sessionToken}`,
            },
          })
        )
        const secondSessionPayload = (yield* Effect.tryPromise(() =>
          secondSessionResponse.json()
        )) as {
          authenticated: boolean
        }

        assert.equal(firstSessionResponse.status, 200)
        assert.equal(firstSessionPayload.authenticated, false)
        assert.equal(secondSessionResponse.status, 200)
        assert.equal(secondSessionPayload.authenticated, true)
      })
    )
)

it.effect('serves mobile sync bootstrap snapshots for authenticated client sessions', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          remoteAccessBootstrapToken: 'bootstrap-token',
          remoteAccessEnvironmentId: 'environment-1',
        },
      })

      const bootstrapAuthUrl = yield* getHttpServerUrl('/api/auth/bootstrap/bearer')
      const bootstrapAuthResponse = yield* Effect.tryPromise(() =>
        fetch(bootstrapAuthUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            credential: 'bootstrap-token',
          }),
        })
      )
      const authPayload = (yield* Effect.tryPromise(() => bootstrapAuthResponse.json())) as {
        sessionToken: string
      }

      const bootstrapUrl = yield* getHttpServerUrl('/api/mobile-sync/bootstrap')
      const bootstrapResponse = yield* Effect.tryPromise(() =>
        fetch(bootstrapUrl, {
          headers: {
            authorization: `Bearer ${authPayload.sessionToken}`,
          },
        })
      )
      const bootstrapText = yield* Effect.tryPromise(() => bootstrapResponse.text())
      assert.equal(bootstrapResponse.status, 200)
      assert.notEqual(bootstrapText, '')
      const bootstrapPayload = JSON.parse(bootstrapText) as {
        config: {
          cwd: string
          providers: unknown[]
        }
        readModel: {
          projects: unknown[]
          threads: unknown[]
          snapshotSequence: number
        }
      }

      assert.equal(bootstrapPayload.config.cwd, process.cwd())
      assert.isArray(bootstrapPayload.config.providers)
      assert.isArray(bootstrapPayload.readModel.projects)
      assert.isArray(bootstrapPayload.readModel.threads)
      assert.isAtLeast(bootstrapPayload.readModel.snapshotSequence, 0)
    })
  )
)

it.effect('accepts authenticated mobile sync log relay batches', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          remoteAccessBootstrapToken: 'bootstrap-token',
          remoteAccessEnvironmentId: 'environment-1',
        },
      })

      const bootstrapAuthUrl = yield* getHttpServerUrl('/api/auth/bootstrap/bearer')
      const bootstrapAuthResponse = yield* Effect.tryPromise(() =>
        fetch(bootstrapAuthUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            credential: 'bootstrap-token',
          }),
        })
      )
      const authPayload = (yield* Effect.tryPromise(() => bootstrapAuthResponse.json())) as {
        sessionToken: string
      }

      const logUrl = yield* getHttpServerUrl('/api/mobile-sync/log')
      const logResponse = yield* Effect.tryPromise(() =>
        fetch(logUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${authPayload.sessionToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            entries: [
              {
                level: 'info',
                text: '[mobile-sync] relay smoke test',
                timestamp: '2026-04-13T09:37:52.632Z',
              },
            ],
          }),
        })
      )
      const logPayload = (yield* Effect.tryPromise(() => logResponse.json())) as {
        accepted: number
      }

      assert.equal(logResponse.status, 200)
      assert.equal(logPayload.accepted, 1)
    })
  )
)

it.effect(
  'answers auth bootstrap preflight requests for desktop dev cross-origin auth bootstrap',
  () =>
    provideServerTest(
      Effect.gen(function* () {
        yield* buildAppUnderTest({
          config: {
            remoteAccessBootstrapToken: 'bootstrap-token',
          },
        })

        const bootstrapUrl = yield* getHttpServerUrl('/api/auth/bootstrap')
        const response = yield* Effect.tryPromise(() =>
          fetch(bootstrapUrl, {
            method: 'OPTIONS',
            headers: {
              origin: 'http://localhost:5733',
              'access-control-request-method': 'POST',
              'access-control-request-headers': 'content-type',
            },
          })
        )

        assert.equal(response.status, 204)
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5733')
        assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
        assert.include(response.headers.get('access-control-allow-methods') ?? '', 'POST')
      })
    )
)

it.effect('serves the well-known environment descriptor', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        config: {
          remoteAccessEnvironmentId: 'environment-1',
        },
      })

      const url = yield* getHttpServerUrl('/.well-known/orxa/environment')
      const response = yield* Effect.tryPromise(() => fetch(url))
      const payload = (yield* Effect.tryPromise(() => response.json())) as {
        environmentId: string
        label: string
        kind: string
      }

      assert.equal(response.status, 200)
      assert.equal(payload.environmentId, 'environment-1')
      assert.equal(payload.label, 'Orxa Code (Desktop)')
      assert.equal(payload.kind, 'local-desktop')
    })
  )
)
