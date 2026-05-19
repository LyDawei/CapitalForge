import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAgents, usePrompts, useBasePrompts, type PromptVersion } from '../api/hooks';
import { api, ApiError } from '../api/client';
import PromptDiff from '../components/PromptDiff';
import { dateTime } from '../lib/format';

type Tab = 'base' | 'agents';

export default function Prompts() {
  const [tab, setTab] = useState<Tab>('base');
  return (
    <div>
      <h1 className="page-title">Prompts</h1>
      <p className="page-subtitle">
        The base prompt is the shared discipline framework prepended (as a system prompt) to every
        agent. Agent prompts are split into a user-editable <em>directive</em> and an
        auto-generated <em>output contract</em>: the contract is locked to the Zod schema in code,
        so prompt edits can never silently break the runner.
      </p>
      <div className="tabs">
        <button className={tab === 'base' ? 'active' : ''} onClick={() => setTab('base')}>Base prompt</button>
        <button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}>Agent prompts</button>
      </div>
      {tab === 'base' && <BasePromptsTab />}
      {tab === 'agents' && <AgentPromptsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Base prompt tab
// ---------------------------------------------------------------------------
function BasePromptsTab() {
  const { data, isLoading } = useBasePrompts();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [newChangelog, setNewChangelog] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <div className="empty">Loading…</div>;
  if (!data || data.length === 0)
    return (
      <div className="empty">
        No base prompt yet — seed it from <code>prisma:seed</code>.
      </div>
    );

  const active = data.find((p) => p.isActive) ?? data[0]!;

  async function activate(id: string) {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/base-prompts/${id}/activate`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['base-prompts'] });
      await qc.invalidateQueries({ queryKey: ['base-prompt-active'] });
    } catch (e: any) {
      setError(e.message);
    }
    setSaving(false);
  }

  async function saveNew(force = false) {
    setSaving(true);
    setError(null);
    setPreviewError(null);
    try {
      await api(`/api/base-prompts${force ? '?force=true' : ''}`, {
        method: 'POST',
        body: JSON.stringify({
          version: newVersion,
          template: newTemplate,
          changelog: newChangelog || undefined,
          activate: true,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['base-prompts'] });
      setEditing(false);
      setNewVersion('');
      setNewTemplate('');
      setNewChangelog('');
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 400 && e.body?.error === 'BasePromptPreviewFailed') {
        setPreviewError({
          canaryAgent: e.body.canaryAgent,
          parseError: e.body.parseError,
          renderedPrompt: e.body.renderedPrompt,
          rawResponse: e.body.rawResponse,
        });
      } else {
        setError(e.message);
      }
    }
    setSaving(false);
  }

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--accent)' }}>
        <h2>Active base prompt — v{active.version}</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: 0 }}>
          {active.changelog ?? 'No changelog.'} · created {dateTime(active.createdAt)}
        </p>
        <pre className="prompt">{active.template}</pre>
      </div>

      <div className="card">
        <h2>Version history</h2>
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Active</th>
              <th>Created</th>
              <th>Changelog</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.version}</code>
                </td>
                <td>{p.isActive ? <span className="badge ok">active</span> : ''}</td>
                <td>{dateTime(p.createdAt)}</td>
                <td style={{ color: 'var(--text-dim)' }}>{p.changelog ?? '—'}</td>
                <td>
                  {!p.isActive && (
                    <button
                      onClick={() => activate(p.id)}
                      disabled={saving}
                      style={btnSmallStyle('var(--accent)')}
                    >
                      Activate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Create a new version</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          New versions become active immediately. Submissions go through a preview gate: the
          candidate is used as the system prompt for the <code>momentum</code> canary; if the
          canary's output stops validating, the save is rejected so a broken base prompt can't
          poison every agent.
        </p>
        {!editing ? (
          <button
            onClick={() => {
              setEditing(true);
              setNewTemplate(active.template);
            }}
            style={btnStyle('var(--accent-2)')}
          >
            New version
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Version (semver)">
              <input
                type="text"
                value={newVersion}
                onChange={(e) => setNewVersion(e.target.value)}
                placeholder="0.2.0"
                style={inputStyle}
              />
            </Field>
            <Field label="Changelog">
              <input
                type="text"
                value={newChangelog}
                onChange={(e) => setNewChangelog(e.target.value)}
                placeholder="What changed and why"
                style={inputStyle}
              />
            </Field>
            <Field label="Template">
              <textarea
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value)}
                rows={20}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
              />
            </Field>
            <div>
              <button
                onClick={() => saveNew(false)}
                disabled={saving || !newVersion || !newTemplate}
                style={btnStyle('var(--accent)')}
              >
                {saving ? 'Saving…' : 'Save & activate'}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setPreviewError(null);
                  setError(null);
                }}
                style={{ ...btnStyle('var(--border)'), color: 'var(--text-dim)', marginLeft: 8 }}
              >
                Cancel
              </button>
              {error && <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{error}</span>}
            </div>

            {previewError && (
              <PreviewErrorPanel
                error={previewError}
                onForce={() => saveNew(true)}
                forcing={saving}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agent prompts tab — split-template view + new-version form
// ---------------------------------------------------------------------------
function AgentPromptsTab() {
  const { data: prompts } = usePrompts();
  const { data: agents } = useAgents();
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('');

  // Default the agent selector to the first active agent so the form is usable
  // immediately on mount.
  const defaultAgentName = useMemo(() => agents?.[0]?.name ?? '', [agents]);
  const effectiveAgent = selectedAgent || defaultAgentName;

  const fromPrompt = prompts?.find((p) => p.id === from);
  const toPrompt = prompts?.find((p) => p.id === to);

  // Group prompts by agent so the table reads naturally.
  const promptsByAgent = useMemo(() => {
    const m = new Map<string, PromptVersion[]>();
    for (const p of prompts ?? []) {
      const key = p.agent?.name ?? '(unknown)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return m;
  }, [prompts]);

  const activePromptForSelected = useMemo(() => {
    return prompts?.find((p) => p.agent?.name === effectiveAgent && p.isActive);
  }, [prompts, effectiveAgent]);

  return (
    <>
      <div className="card">
        <h2>All versions</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Version</th>
              <th>Active</th>
              <th>Created</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(promptsByAgent.entries()).flatMap(([_agentName, rows]) =>
              rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.agent?.displayName}</td>
                  <td>
                    <code>{p.version}</code>
                  </td>
                  <td>{p.isActive ? <span className="badge ok">active</span> : ''}</td>
                  <td>{dateTime(p.createdAt)}</td>
                  <td>
                    <input
                      type="radio"
                      name="from"
                      checked={from === p.id}
                      onChange={() => setFrom(p.id)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name="to"
                      checked={to === p.id}
                      onChange={() => setTo(p.id)}
                    />
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {fromPrompt && toPrompt && (
        <div className="card">
          <h2>
            Directive diff: {fromPrompt.agent?.name} {fromPrompt.version} → {toPrompt.version}
          </h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            The output contract is auto-generated and locked to the Zod schema in code — only the
            directive differs between user-edited versions.
          </p>
          <PromptDiff from={fromPrompt.directiveTemplate} to={toPrompt.directiveTemplate} />
        </div>
      )}

      {activePromptForSelected && (
        <div className="card">
          <h2>
            Active prompt: <code>{effectiveAgent}</code> v{activePromptForSelected.version}
          </h2>
          <h3 style={{ fontSize: 13, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Directive (user-editable)
          </h3>
          <pre className="prompt">{activePromptForSelected.directiveTemplate}</pre>
          <h3 style={{ fontSize: 13, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Output contract (locked to Zod schema)
          </h3>
          <pre
            className="prompt"
            style={{ background: 'var(--panel-2)', borderLeft: '3px solid var(--accent-2)' }}
          >
            {activePromptForSelected.outputContract}
          </pre>
        </div>
      )}

      <NewAgentPromptForm
        agents={agents ?? []}
        selectedAgent={effectiveAgent}
        onAgentChange={setSelectedAgent}
        seedDirective={activePromptForSelected?.directiveTemplate ?? ''}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// New agent-prompt form
// ---------------------------------------------------------------------------
function NewAgentPromptForm({
  agents,
  selectedAgent,
  onAgentChange,
  seedDirective,
}: {
  agents: Array<{ name: string; displayName: string }>;
  selectedAgent: string;
  onAgentChange: (name: string) => void;
  seedDirective: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState('');
  const [directive, setDirective] = useState('');
  const [changelog, setChangelog] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);

  function openForm() {
    setEditing(true);
    setDirective(seedDirective);
    setError(null);
    setPreviewError(null);
  }

  async function save(force = false) {
    setSaving(true);
    setError(null);
    setPreviewError(null);
    try {
      await api(`/api/prompts${force ? '?force=true' : ''}`, {
        method: 'POST',
        body: JSON.stringify({
          agentName: selectedAgent,
          version,
          directiveTemplate: directive,
          changelog: changelog || undefined,
          activate: true,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['prompts'] });
      setEditing(false);
      setVersion('');
      setDirective('');
      setChangelog('');
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 400 && e.body?.error === 'PromptPreviewFailed') {
        setPreviewError({
          canaryAgent: e.body.agentName,
          parseError: e.body.parseError,
          renderedPrompt: e.body.renderedPrompt,
          rawResponse: e.body.rawResponse,
        });
      } else {
        setError(e.message);
      }
    }
    setSaving(false);
  }

  return (
    <div className="card">
      <h2>Create a new agent-prompt version</h2>
      <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
        Submissions go through a preview gate: the directive is paired with its locked output
        contract, rendered with synthetic technicals, sent through the smart mock, and validated
        against the agent's Zod schema. A failed preview is a 400 — fix it or force with
        <code>?force=true</code>.
      </p>
      {!editing ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Field label="Agent">
            <select
              value={selectedAgent}
              onChange={(e) => onAgentChange(e.target.value)}
              style={inputStyle}
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.displayName} ({a.name})
                </option>
              ))}
            </select>
          </Field>
          <button onClick={openForm} style={btnStyle('var(--accent-2)')}>
            New version for {selectedAgent || '(pick an agent)'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Agent">
            <select
              value={selectedAgent}
              onChange={(e) => onAgentChange(e.target.value)}
              style={inputStyle}
            >
              {agents.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.displayName} ({a.name})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Version (semver)">
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="0.3.0"
              style={inputStyle}
            />
          </Field>
          <Field label="Changelog">
            <input
              type="text"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="What changed and why"
              style={inputStyle}
            />
          </Field>
          <Field label="Directive">
            <textarea
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              rows={24}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
            />
          </Field>
          <div>
            <button
              onClick={() => save(false)}
              disabled={saving || !version || !directive || !selectedAgent}
              style={btnStyle('var(--accent)')}
            >
              {saving ? 'Saving…' : 'Save & activate'}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
                setPreviewError(null);
              }}
              style={{ ...btnStyle('var(--border)'), color: 'var(--text-dim)', marginLeft: 8 }}
            >
              Cancel
            </button>
            {error && <span style={{ marginLeft: 12, color: 'var(--danger)' }}>{error}</span>}
          </div>

          {previewError && (
            <PreviewErrorPanel error={previewError} onForce={() => save(true)} forcing={saving} />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
interface PreviewError {
  canaryAgent?: string;
  parseError: string;
  renderedPrompt: string;
  rawResponse: string;
}

function PreviewErrorPanel({
  error,
  onForce,
  forcing,
}: {
  error: PreviewError;
  onForce: () => void;
  forcing: boolean;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'rgba(239,107,115,0.08)',
        border: '1px solid var(--danger)',
        borderRadius: 6,
      }}
    >
      <div style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 4 }}>
        Preview failed{error.canaryAgent ? ` (${error.canaryAgent})` : ''}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
        Validation error: <code>{error.parseError}</code>
      </div>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>Rendered prompt</summary>
        <pre className="prompt" style={{ maxHeight: 200, overflow: 'auto' }}>
          {error.renderedPrompt}
        </pre>
      </details>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>Mock LLM raw response</summary>
        <pre className="prompt" style={{ maxHeight: 200, overflow: 'auto' }}>
          {error.rawResponse}
        </pre>
      </details>
      <button
        onClick={onForce}
        disabled={forcing}
        style={{ ...btnSmallStyle('var(--danger)'), marginTop: 8 }}
      >
        {forcing ? 'Saving…' : 'Force save anyway (?force=true)'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '6px 10px',
  color: 'var(--text)',
  fontSize: 14,
  width: '100%',
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
  };
}

function btnSmallStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 12,
  };
}
