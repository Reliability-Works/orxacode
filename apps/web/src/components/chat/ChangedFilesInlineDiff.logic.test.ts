import { describe, expect, it } from 'vitest'

import { findChangedFileDiff } from './ChangedFilesInlineDiff.logic'

const SAMPLE_PATCH = `
diff --git a/opencode_test.md b/opencode_test.md
index 1111111..2222222 100644
--- a/opencode_test.md
+++ b/opencode_test.md
@@ -1,2 +1,3 @@
-old line
+new line
+another line
 unchanged
diff --git a/apps/web/src/components/chat/useChatSendAction.ts b/apps/web/src/components/chat/useChatSendAction.ts
index 3333333..4444444 100644
--- a/apps/web/src/components/chat/useChatSendAction.ts
+++ b/apps/web/src/components/chat/useChatSendAction.ts
@@ -10,1 +10,1 @@
-before
+after
`.trim()

describe('findChangedFileDiff', () => {
  it('returns the matching file diff metadata for a selected path', () => {
    const fileDiff = findChangedFileDiff(SAMPLE_PATCH, 'opencode_test.md')

    expect(fileDiff?.name).toBe('opencode_test.md')
  })

  it('returns null when the selected path is not present in the patch', () => {
    const fileDiff = findChangedFileDiff(SAMPLE_PATCH, 'missing.md')

    expect(fileDiff).toBeNull()
  })
})
