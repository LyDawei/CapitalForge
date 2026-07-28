import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useAgent,
  useAgentSummary,
  useAgentRuns,
  useCalibration,
  useDrift,
  useInfluence,
  useStability,
  useAgentPredictionScore,
} from '../api/hooks';
import MetricCard from '../components/MetricCard';
import AgentBadge from '../components/AgentBadge';
import CalibrationChart from '../components/CalibrationChart';
import DriftChart from '../components/DriftChart';
import StabilityScatterChart from '../components/StabilityScatterChart';
import InfoTooltip from '../components/InfoTooltip';
import { PredictionInline } from '../components/PredictionBadge';
import { pct, ms, usd, num, dateTime } from '../lib/format';

type Tab = 'overview' | 'prompts' | 'runs' | 'performance' | 'audit';

export default function AgentDetail() {
  const { name } = useParams<{ name: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const agent = useAgent(name);
  const summary = useAgentSummary(name, '30d');
  const prediction = useAgentPredictionScore(name);

  if (agent.isLoading) return <div className="empty">Loading…</div>;
  if (!agent.data) return <div className="empty">Agent not found.</div>;

  const a = agent.data;

  return (
    <div>
      <h1 className="page-title">
        {a.displayName} <AgentBadge kind={a.kind} />
      </h1>
      <p className="page-subtitle">{a.role}</p>

      {prediction.data && (
        <div className="card" style={{ borderColor: prediction.data.needsReview ? 'var(--warn)' : undefined }}>
          <h2>Prediction quality</h2>
          <PredictionInline score={prediction.data} />
          {prediction.data.needsReview && (
            <p style={{ color: 'var(--warn)', marginTop: 12, fontSize: 13 }}>
              <strong>Needs review:</strong> {prediction.data.reviewReasons.join(' · ')}
            </p>
          )}
        </div>
      )}

      <div className="grid cols-4">
        <MetricCard label="Runs (30d)" value={`${summary.data?.sampleSize ?? '—'}`} />
        <MetricCard
          label={<>Schema fail rate <InfoTooltip text="% of this agent's LLM responses that failed to parse into the expected JSON structure. This is a software reliability metric, not a trading one — high values mean the prompt/model is producing malformed output, unrelated to whether its trading calls are any good." /></>}
          value={pct(summary.data?.schemaFailRate)}
        />
        <MetricCard label="Avg latency" value={ms(summary.data?.avgLatencyMs)} />
        <MetricCard label="Total cost (30d)" value={usd(summary.data?.totalCostUsd, 4)} />
      </div>

      <div className="tabs">
        {(['overview', 'prompts', 'runs', 'performance', 'audit'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview agent={a} />}
      {tab === 'prompts' && <Prompts agent={a} />}
      {tab === 'runs' && <Runs name={name!} />}
      {tab === 'performance' && <Performance name={name!} />}
      {tab === 'audit' && <Audit name={name!} />}
    </div>
  );
}

function Overview({ agent }: { agent: any }) {
  return (
    <div className="card">
      <h2>Description</h2>
      <p>{agent.description}</p>
      <h2>Inputs</h2>
      <ul>{(agent.metadata?.inputs ?? []).map((i: string) => <li key={i}>{i}</li>)}</ul>
      {agent.metadata?.extras && (
        <>
          <h2>Structured extras</h2>
          <ul>
            {agent.metadata.extras.map((e: { key: string; description: string }) => (
              <li key={e.key}><strong>{e.key}</strong> — {e.description}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Prompts({ agent }: { agent: any }) {
  return (
    <div className="card">
      <h2>Prompt versions</h2>
      <table>
        <thead><tr><th>Version</th><th>Active</th><th>Created</th><th>Changelog</th></tr></thead>
        <tbody>
          {agent.promptVersions?.map((p: any) => (
            <tr key={p.id}>
              <td><code>{p.version}</code></td>
              <td>{p.id === agent.activePromptVersionId ? <span className="badge ok">active</span> : ''}</td>
              <td>{dateTime(p.createdAt)}</td>
              <td>{p.changelog ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {agent.promptVersions?.[0] && (
        <>
          <h2 style={{ marginTop: 24 }}>Latest template</h2>
          <pre className="prompt">{agent.promptVersions[0].template}</pre>
        </>
      )}
    </div>
  );
}

function Runs({ name }: { name: string }) {
  const runs = useAgentRuns(name, 50, 0);
  return (
    <div className="card">
      <h2>Runs ({runs.data?.total ?? 0})</h2>
      <table>
        <thead>
          <tr><th>When</th><th>Cycle</th><th>Model</th><th>Latency</th><th>Tokens</th><th>Valid</th><th>Cost</th></tr>
        </thead>
        <tbody>
          {runs.data?.runs.map((r: any) => (
            <tr key={r.id}>
              <td>{dateTime(r.createdAt)}</td>
              <td>{r.cycle ? <Link to={`/cycles/${r.cycle?.id ?? ''}`}>{r.cycle.symbol} {r.cycle.date}</Link> : '—'}</td>
              <td>{r.modelName}</td>
              <td>{ms(r.latencyMs)}</td>
              <td>{(r.tokensIn ?? 0) + (r.tokensOut ?? 0)}</td>
              <td>{r.schemaValid ? <span className="badge ok">ok</span> : <span className="badge danger">fail</span>}</td>
              <td>{usd(r.costUsd, 4)}</td>
            </tr>
          ))}
          {runs.data?.runs.length === 0 && <tr><td colSpan={7} className="empty">No runs yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Performance({ name }: { name: string }) {
  const cal = useCalibration(name);
  const drift = useDrift(name);
  return (
    <>
      <div className="card">
        <h2>
          Calibration — confidence vs. observed win rate
          <InfoTooltip text="Is this agent's stated confidence trustworthy? If it says 80% confident, does it actually win ~80% of the time? Points on the dashed diagonal line are well-calibrated; points below it mean the agent is overconfident." />
        </h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Brier score: {num(cal.data?.brierScore, 3)}{' '}
          <InfoTooltip text="A standard score (0 to 1) for how well confidence matches outcomes, combining calibration and accuracy into one number. 0 = perfect, 1 = worst possible. Lower is better." />
          . Sample size: {cal.data?.sampleSize ?? 0}.
        </p>
        {cal.data && <CalibrationChart data={cal.data} />}
      </div>
      <div className="card">
        <h2>Drift — rolling hit rate per prompt version</h2>
        {drift.data && <DriftChart series={drift.data.series} />}
        {drift.data?.series?.length ? (
          drift.data.series.map((s) => (
            <div key={s.promptVersionId} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 12, color: 'var(--text-dim)' }}>v{s.version} — {s.points.length} pts</h3>
              <table>
                <thead><tr><th>Date</th><th>Rolling hit rate</th><th>Sample</th></tr></thead>
                <tbody>
                  {s.points.slice(-10).map((p, i) => (
                    <tr key={i}><td>{p.date}</td><td>{pct(p.hitRate)}</td><td>{p.sampleSize}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        ) : null}
      </div>
    </>
  );
}

function Audit({ name }: { name: string }) {
  const inf = useInfluence(name);
  const stab = useStability(name);
  return (
    <>
      <div className="card">
        <h2>
          Influence on the head trader
          <InfoTooltip text="Did the final trading decision agree with this agent's own directional lean? This measures whether the head trader listens to this agent, not whether either of them was right." />
        </h2>
        <div className="grid cols-4">
          <MetricCard label="Aligned" value={`${inf.data?.aligned ?? 0}`} sub="head trader sided with us" />
          <MetricCard label="Opposed" value={`${inf.data?.opposed ?? 0}`} sub="head trader overruled us" />
          <MetricCard label="Abstained" value={`${inf.data?.abstained ?? 0}`} sub="we offered no opinion" />
          <MetricCard
            label={<>Alignment rate <InfoTooltip text="aligned / (aligned + opposed) — how often the head trader's final call matched this agent's lean, when the agent had a lean at all." /></>}
            value={pct(inf.data?.alignmentRate)}
          />
        </div>
      </div>
      <div className="card">
        <h2>
          Stability — output variance under replay
          <InfoTooltip text="Given the exact same input twice, does this agent give the same answer? Low variance = consistent/reliable. High variance = the same input produces meaningfully different scores, which is a red flag for a model that should be deterministic-ish." />
        </h2>
        <div className="grid cols-3">
          <MetricCard
            label={<>Replay groups <InfoTooltip text="Sets of runs made on identical inputs, used to test consistency — each group is the same input run more than once." /></>}
            value={`${stab.data?.sampleSize ?? 0}`}
          />
          <MetricCard
            label={<>Avg score stdev <InfoTooltip text="Standard deviation of the bullish/bearish score across repeated runs on the same input. Lower = the agent gives a more consistent answer each time." /></>}
            value={num(stab.data?.avgScoreStdev, 3)}
            sub="lower = more stable"
          />
          <MetricCard
            label={<>Avg confidence stdev <InfoTooltip text="Same idea as score stdev, but for the agent's stated confidence rather than its directional score." /></>}
            value={num(stab.data?.avgConfidenceStdev, 3)}
          />
        </div>
        {stab.data && (
          <div style={{ marginTop: 16 }}>
            <StabilityScatterChart
              points={stab.data.points}
              avgScoreStdev={stab.data.avgScoreStdev}
              avgConfidenceStdev={stab.data.avgConfidenceStdev}
            />
          </div>
        )}
      </div>
    </>
  );
}
