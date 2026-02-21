---
description: Debug issues systematically with structured analysis
---

<command-instruction>
Systematic debugging workflow to identify and resolve issues.

## Process

1. **Problem Analysis**: Understand the issue and gather context
2. **Reproduction**: Create minimal reproduction case
3. **Investigation**: Use debugging tools to find root cause
4. **Solution**: Implement and verify the fix
5. **Prevention**: Document learnings to prevent recurrence

## Debugging Steps

### Step 1: Gather Information
- Read error messages and stack traces
- Check recent changes (git log/diff)
- Review relevant code sections

### Step 2: Isolate the Issue
- Identify the minimal reproduction case
- Determine if it's environmental or code-related
- Check for recent dependency changes

### Step 3: Root Cause Analysis
- Use logging/debugging to trace execution
- Check state at key points
- Identify where behavior diverges from expected

### Step 4: Implement Fix
- Make minimal targeted changes
- Verify fix resolves the issue
- Ensure no regressions introduced

## Output Format

## 🐛 Debug Report

### Issue Summary
[Clear description of the problem]

### Root Cause
[What caused the issue]

### Solution Implemented
[What was changed]

### Verification
- ✅ Issue resolved
- ✅ No regressions
- ✅ Tests passing

### Prevention
[How to avoid similar issues in the future]
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
