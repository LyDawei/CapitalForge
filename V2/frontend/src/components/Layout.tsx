import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>CapitalForge V2</h1>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/agents">Agents</NavLink>
          <NavLink to="/cycles">Cycles</NavLink>
          <NavLink to="/trades">Trades</NavLink>
          <NavLink to="/wallet">Wallet</NavLink>
          <NavLink to="/feeds">Feeds</NavLink>
          <NavLink to="/prompts">Prompts</NavLink>
          <NavLink to="/audit">Audit</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
