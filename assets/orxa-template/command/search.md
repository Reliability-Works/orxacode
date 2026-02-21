---
description: Search codebase for patterns, symbols, or references
---

<command-instruction>
Search the codebase using grep, glob, and other search tools.

## Search Types

### Pattern Search
Find code patterns, function calls, or specific syntax.

### Symbol Search
Find where variables, functions, or classes are defined/used.

### Reference Search
Find all references to a specific file, module, or component.

## Search Tools

- **grep**: Content-based search (regex supported)
- **glob**: File pattern matching
- **read**: Examine file contents

## Output Format

## 🔍 Search Results

### Query
[What was searched for]

### Matches Found: [N]

#### File: `path/to/file.ts`
```typescript
[Matching code snippet with context]
```

#### File: `path/to/another.ts`
```typescript
[Matching code snippet with context]
```

### Summary
- **Total files**: [N]
- **Total occurrences**: [N]

### Next Steps
- Use /explain to understand specific matches
- Use /refactor to modify found code
- Refine search with more specific patterns
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
