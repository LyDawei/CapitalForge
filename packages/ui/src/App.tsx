import { Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { CyclesList } from './routes/CyclesList';
import { CycleDetail } from './routes/CycleDetail';
import { CycleReplay } from './routes/CycleReplay';
import { SymbolCycles } from './routes/SymbolCycles';
import { Agents } from './routes/Agents';
import { AgentDetail } from './routes/AgentDetail';

export function App() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
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
      <main className="app-main">
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
