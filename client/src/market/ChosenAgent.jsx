// The shopping agent a buyer booked on a market's page ("Book this agent"). Kept on this device for a day and filled
// in by itself at the checkout and on Shop & ride; "Change agent" goes back to the market's agents to pick another.
// The server checks the agent again and gives them the job first (10 minutes), then to any agent near.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { prettyPhone } from '../shop/shopApi';

const KEY = 'kapu_chosen_agent';
const DAY = 24 * 3600 * 1000;
const EVENT = 'kapu:chosen-agent';

export function getChosenAgent() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved && Date.now() - saved.at < DAY ? saved : null;
  } catch {
    return null;
  }
}
export function setChosenAgent(agent, market) {
  const value = { _id: agent._id, name: agent.name, rating: agent.rating || null, market: { name: market.name, slug: market.slug }, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode: this visit only */ }
  window.dispatchEvent(new Event(EVENT));
  return value;
}
export function clearChosenAgent() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}
// the chosen agent, kept up to date (another tab, "Any agent" …)
export function useChosenAgent() {
  const [agent, setAgent] = useState(getChosenAgent);
  useEffect(() => {
    const update = () => setAgent(getChosenAgent());
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', update); };
  }, []);
  return agent;
}

// "Your shopping agent: Atieno Kilonzo · Gikomba Market ★ 4.8   [Change agent] [Any agent]"
// back: the page to come back to after choosing another agent (this checkout)
export function ChosenAgentCard({ agent, back, note, auto = false }) {
  if (!agent) return null;
  const change = agent.market.slug ? `/markets/${agent.market.slug}?back=${encodeURIComponent(back)}#agents` : '/markets-near-me';
  return (
    <div className="mk-chosen-agent" role="status">
      <span className="mk-agent-face" aria-hidden="true">{agent.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
      <div className="mk-chosen-agent-text">
        <small>{auto ? 'Your inspection agent' : 'Your shopping agent'}</small>
        <b>{agent.name}</b>
        <span>{agent.market.name}{agent.rating ? ` · ★ ${Number(agent.rating.avg).toFixed(1)}` : ''}</span>
        {agent.phone && (
          <span className="mk-agent-contact">
            <a href={`tel:+${agent.phone}`} aria-label={`Call ${agent.name}`}>📞 {prettyPhone(agent.phone)}</a>
            <a href={`https://wa.me/${agent.phone}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${agent.name}`}>💬 WhatsApp</a>
          </span>
        )}
        {note && <em>{note}</em>}
      </div>
      <div className="mk-chosen-agent-actions">
        <Link className="os-btn os-btn-ghost" to={change}>Change agent</Link>
        {!auto && <button type="button" className="mk-linkbtn" onClick={clearChosenAgent}>Any agent</button>}
      </div>
    </div>
  );
}
