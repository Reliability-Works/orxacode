---
description: Validate current plan with strategist and reviewer
---

<command-instruction>
Validate the current work plan by delegating to both the strategist and reviewer agents.

## Process

1. **Strategist Analysis**: Delegate to strategist agent for risk analysis
2. **Reviewer Assessment**: Delegate to reviewer agent for plan validation
3. **Compile Results**: Present both analyses to the user

## Delegation Template

For each validation, use the task tool with this format:

task({
  subagent_type: "strategist" | "reviewer",
  description: "**Task**: [specific validation task] **Expected Outcome**: [what to deliver] **Required Tools**: [tools needed] **Must Do**: [requirements] **Must Not Do**: [constraints] **Context**: [background]"
})

## Output Format

Present results in this structure:

## ✅ Validation Complete

### 🔍 Strategist Risk Analysis
[Strategist findings]

---

### 📋 Reviewer Assessment
[Reviewer findings]

---

**Next Steps:**
1. Review the feedback above
2. Address any critical issues
3. Proceed with execution when ready
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
