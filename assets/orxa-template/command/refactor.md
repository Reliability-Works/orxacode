---
description: Intelligent refactoring with LSP and architecture analysis
---

<command-instruction>
Execute intelligent refactoring workflow with safety checks and quality gates.

## Process

1. **Architecture Analysis**: Delegate to architect for refactoring strategy
2. **Impact Analysis**: Use explorer to find all references and dependencies
3. **Execution**: Delegate to build agent for LSP-powered refactoring
4. **Quality Gates**: Run lint, type-check, and tests
5. **Review**: Delegate to reviewer for final validation

## Delegation Template

task({
  subagent_type: "architect" | "explorer" | "build" | "reviewer",
  description: "**Task**: [specific refactoring task] **Expected Outcome**: [deliverable] **Required Tools**: [tools] **Must Do**: [requirements] **Must Not Do**: [constraints] **Context**: [background]"
})

## Safety Rules

- Always analyze before refactoring
- Use LSP rename for symbol changes
- Run all quality gates after changes
- Never refactor without tests passing first

## Output Format

## 🔧 Refactoring Complete

### Changes Made
[Summary of changes]

### Quality Gate Results
- ✅ Lint: [pass/fail]
- ✅ Type Check: [pass/fail]
- ✅ Tests: [pass/fail]

### Next Steps
1. Review the changes
2. Run manual testing if needed
3. Commit when satisfied
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
