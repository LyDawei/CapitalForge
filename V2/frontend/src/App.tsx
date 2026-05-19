import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './routes/Dashboard';
import Agents from './routes/Agents';
import AgentDetail from './routes/AgentDetail';
import Cycles from './routes/Cycles';
import CycleDetail from './routes/CycleDetail';
import Prompts from './routes/Prompts';
import Audit from './routes/Audit';
import Trades from './routes/Trades';
import Settings from './routes/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="agents" element={<Agents />} />
        <Route path="agents/:name" element={<AgentDetail />} />
        <Route path="cycles" element={<Cycles />} />
        <Route path="cycles/:id" element={<CycleDetail />} />
        <Route path="prompts" element={<Prompts />} />
        <Route path="trades" element={<Trades />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
