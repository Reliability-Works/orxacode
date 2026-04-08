import { assert, it } from '@effect/vitest'
import { Effect, FileSystem, Path } from 'effect'
import { HttpClient } from 'effect/unstable/http'

import { resolveAttachmentRelativePath } from './attachmentPaths.ts'
import { buildAppUnderTest, provideServerTest } from './server.test.helpers.ts'

it.effect('serves attachment files from state dir', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const attachmentId = 'thread-11111111-1111-4111-8111-111111111111'

      const config = yield* buildAppUnderTest()
      const attachmentPath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${attachmentId}.bin`,
      })
      assert.isNotNull(attachmentPath, 'Attachment path should be resolvable')

      yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true })
      yield* fileSystem.writeFileString(attachmentPath, 'attachment-ok')

      const response = yield* HttpClient.get(`/attachments/${attachmentId}`)
      assert.equal(response.status, 200)
      assert.equal(yield* response.text, 'attachment-ok')
    })
  )
)

it.effect('serves attachment files for URL-encoded paths', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const config = yield* buildAppUnderTest()
      const attachmentPath = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: 'thread%20folder/message%20folder/file%20name.png',
      })
      assert.isNotNull(attachmentPath, 'Attachment path should be resolvable')

      yield* fileSystem.makeDirectory(path.dirname(attachmentPath), { recursive: true })
      yield* fileSystem.writeFileString(attachmentPath, 'attachment-encoded-ok')

      const response = yield* HttpClient.get(
        '/attachments/thread%20folder/message%20folder/file%20name.png'
      )
      assert.equal(response.status, 200)
      assert.equal(yield* response.text, 'attachment-encoded-ok')
    })
  )
)

it.effect('returns 404 for missing attachment id lookups', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest()

      const response = yield* HttpClient.get(
        '/attachments/missing-11111111-1111-4111-8111-111111111111'
      )
      assert.equal(response.status, 404)
    })
  )
)
