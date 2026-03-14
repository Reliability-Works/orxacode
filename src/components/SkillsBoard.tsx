import { BrainCircuit, RefreshCw, Sparkles } from "lucide-react";
import type { SkillEntry } from "@shared/ipc";

type Props = {
  skills: SkillEntry[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onUseSkill: (skill: SkillEntry) => void;
};

export function SkillsBoard({ skills, loading, error, onRefresh, onUseSkill }: Props) {
  return (
    <section className="skills-board">
      <header className="skills-board-header">
        <div>
          <h1>Skills</h1>
          <p>Reusable capabilities discovered from your OpenCode skill directories.</p>
        </div>
        <button type="button" className="skills-refresh" onClick={onRefresh}>
          <RefreshCw size={14} aria-hidden="true" />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

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
          <span>No skills found in ~/.config/opencode/skill.</span>
        </div>
      ) : null}

      {!loading && skills.length > 0 ? (
        <footer className="skills-board-footer">
          <span>{skills.length} skill{skills.length === 1 ? "" : "s"} found</span>
          <span>~/.config/opencode/skill</span>
        </footer>
      ) : null}
    </section>
  );
}
