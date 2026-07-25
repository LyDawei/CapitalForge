import { Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { CyclesList } from './routes/CyclesList';
import { CycleDetail } from './routes/CycleDetail';
import { CycleReplay } from './routes/CycleReplay';
import { SymbolCycles } from './routes/SymbolCycles';
import { Agents } from './routes/Agents';
import { AgentDetail } from './routes/AgentDetail';
import { useGuestMode } from './lib/useGuestMode';

export function App() {
  const isGuest = useGuestMode();

  return (
    <div className="app-shell">
      {isGuest && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            background: '#1e40af',
            color: 'white',
            padding: '8px 16px',
            fontSize: 13,
            zIndex: 1000,
            textAlign: 'center',
          }}
        >
          📊 <strong>Demo Mode</strong> — You are viewing with read-only access. This is simulated paper trading data.
        </div>
      )}
      <aside className="app-sidebar" style={isGuest ? { marginTop: 36 } : {}}>
        <h1>
          CapitalForge <span className="badge">V2</span>
        </h1>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          <NavLink to="/cycles" className={({ isActive }) => (isActive ? 'active' : '')}>
            Cycles
          </NavLink>
          <NavLink to="/agents" className={({ isActive }) => (isActive ? 'active' : '')}>
            Agents
          </NavLink>
        </nav>
      </aside>
      <main className="app-main" style={isGuest ? { marginTop: 36 } : {}}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cycles" element={<CyclesList />} />
          <Route path="/cycles/symbol/:symbol" element={<SymbolCycles />} />
          <Route path="/cycles/:id/replay" element={<CycleReplay />} />
          <Route path="/cycles/:id" element={<CycleDetail />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/agents/:name" element={<AgentDetail />} />
        </Routes>
      </main>
    </div>
  );
}
