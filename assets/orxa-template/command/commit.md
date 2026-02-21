---
description: Generate conventional commit messages from changes
---

<command-instruction>
Generate well-formatted conventional commit messages based on changes.

## Process

1. **Change Analysis**: Review git diff to understand changes
2. **Categorization**: Determine commit type (feat, fix, refactor, etc.)
3. **Message Generation**: Create clear, concise commit message
4. **Scope Detection**: Identify affected scope if applicable

## Commit Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, semicolons, etc.)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Test changes
- **chore**: Build/tooling changes

## Message Format

```
<type>(<scope>): <subject>

<body> (optional)

<footer> (optional, for breaking changes or issue refs)
```

## Output Format

## 📝 Suggested Commit Message

```
<type>(<scope>): <clear description>

[Detailed explanation if needed]

[Breaking change notice if applicable]
[Issue references: Fixes #123]
```

### Alternative Options
1. [Alternative 1]
2. [Alternative 2]

**Use the suggested message or ask for alternatives!**
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
