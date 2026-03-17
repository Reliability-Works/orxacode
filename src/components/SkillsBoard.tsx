import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, RefreshCw, Sparkles } from "lucide-react";
import type { SkillEntry } from "@shared/ipc";

type SkillsTab = "opencode" | "codex" | "claude";

const SKILL_DIRS: Record<SkillsTab, string> = {
  opencode: "~/.config/opencode/skill",
  codex: "~/.codex/skills",
  claude: "~/.claude/skills",
};

type Props = {
  /** Initial opencode skills (loaded by parent on sidebar switch) */
  skills: SkillEntry[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onUseSkill: (skill: SkillEntry) => void;
};

export function SkillsBoard({ skills: opencodeSkills, loading: opencodeLoading, error: opencodeError, onRefresh: onRefreshOpencode, onUseSkill }: Props) {
  const [activeTab, setActiveTab] = useState<SkillsTab>("opencode");

  const [codexSkills, setCodexSkills] = useState<SkillEntry[]>([]);
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexError, setCodexError] = useState<string | undefined>();

  const [claudeSkills, setClaudeSkills] = useState<SkillEntry[]>([]);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [claudeError, setClaudeError] = useState<string | undefined>();

  const loadFromDir = useCallback(async (dir: string) => {
    if (!window.orxa?.app?.listSkillsFromDir) return [];
    return window.orxa.app.listSkillsFromDir(dir);
  }, []);

  const loadCodex = useCallback(async () => {
    setCodexLoading(true);
    setCodexError(undefined);
    try {
      const entries = await loadFromDir(SKILL_DIRS.codex);
      setCodexSkills(entries);
    } catch (err) {
      setCodexError(err instanceof Error ? err.message : String(err));
    } finally {
      setCodexLoading(false);
    }
  }, [loadFromDir]);

  const loadClaude = useCallback(async () => {
    setClaudeLoading(true);
    setClaudeError(undefined);
    try {
      const entries = await loadFromDir(SKILL_DIRS.claude);
      setClaudeSkills(entries);
    } catch (err) {
      setClaudeError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaudeLoading(false);
    }
  }, [loadFromDir]);

  // Lazy-load codex/claude skills on first tab switch
  useEffect(() => {
    if (activeTab === "codex" && codexSkills.length === 0 && !codexLoading) {
      void loadCodex();
    }
    if (activeTab === "claude" && claudeSkills.length === 0 && !claudeLoading) {
      void loadClaude();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const skills = activeTab === "opencode" ? opencodeSkills : activeTab === "codex" ? codexSkills : claudeSkills;
  const loading = activeTab === "opencode" ? opencodeLoading : activeTab === "codex" ? codexLoading : claudeLoading;
  const error = activeTab === "opencode" ? opencodeError : activeTab === "codex" ? codexError : claudeError;
  const dir = SKILL_DIRS[activeTab];

  const handleRefresh = () => {
    if (activeTab === "opencode") {
      onRefreshOpencode();
    } else if (activeTab === "codex") {
      void loadCodex();
    } else {
      void loadClaude();
    }
  };

  return (
    <section className="skills-board">
      <header className="skills-board-header">
        <div>
          <h1>Skills</h1>
          <p>Reusable capabilities discovered from your skill directories.</p>
        </div>
        <button type="button" className="skills-refresh" onClick={handleRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="dashboard-tabs">
        <button
          type="button"
          className={`dashboard-tab${activeTab === "opencode" ? " active" : ""}`}
          onClick={() => setActiveTab("opencode")}
        >
          OpenCode
        </button>
        <button
          type="button"
          className={`dashboard-tab${activeTab === "codex" ? " active" : ""}`}
          onClick={() => setActiveTab("codex")}
        >
          Codex
        </button>
        <button
          type="button"
          className={`dashboard-tab${activeTab === "claude" ? " active" : ""}`}
          onClick={() => setActiveTab("claude")}
        >
          Claude
        </button>
      </div>

      {error ? <p className="skills-error">{error}</p> : null}

      <div className="skills-grid-section">
        <p className="skills-grid-label">// available skills</p>
        <section className="skills-grid">
          {skills.map((skill) => (
            <article key={skill.id} className="skills-card">
              <header>
                <span className="skills-card-icon">
                  <BrainCircuit size={16} aria-hidden="true" />
                </span>
                <strong>{skill.name}</strong>
              </header>
              <p>{skill.description}</p>
              <small>{skill.path}</small>
              <button type="button" onClick={() => onUseSkill(skill)}>
                <Sparkles size={13} aria-hidden="true" />
                Use skill
              </button>
            </article>
          ))}
        </section>
      </div>

      {!loading && skills.length === 0 ? (
        <div className="skills-empty">
          <BrainCircuit size={16} aria-hidden="true" />
          <span>No skills found in {dir}.</span>
        </div>
      ) : null}

      {!loading && skills.length > 0 ? (
        <footer className="skills-board-footer">
          <span>{skills.length} skill{skills.length === 1 ? "" : "s"} found</span>
          <span>{dir}</span>
        </footer>
      ) : null}
    </section>
  );
}
