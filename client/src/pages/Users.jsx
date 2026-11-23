import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';

const AREAS = [
  ['ads', 'Ads', 'Review reported ads, hide or remove ads'],
  ['sellers', 'Sellers', 'Verify or suspend sellers'],
  ['orders', 'Orders & payouts', 'Orders, refunds, payouts, Lipa Pole Pole'],
  ['support', 'Support', 'Answer customer support chats'],
];
const ACTIONS = {
  login: '✅ Signed in', login_failed: '⚠️ Wrong password', locked: '🔒 Locked (too many wrong passwords)', password_changed: '🔑 Changed password',
  user_created: '➕ Account created', user_updated: '✏️ Account changed', user_deleted: '🗑️ Account deleted', signed_out: '🚪 Signed out everywhere', link_changed: '🔗 Staff login link changed',
};
const when = (date) => (date ? new Date(date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
// a readable temporary password, e.g. "kima-4821-zeta"
const tempPassword = () => {
  const width = ['jua', 'mvua', 'simba', 'tembo', 'kima', 'nyota', 'mto', 'zeta', 'kilele', 'pwani', 'ziwa', 'mlima'];
  const pick = () => width[crypto.getRandomValues(new Uint32Array(1))[0] % width.length];
  return `${pick()}-${1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)}-${pick()}`;
};

// what each role may do (shown under each person)
const ROLE_INFO = {
  owner: ['👑 owner', 'Everything, incl. admins and money settings (commission, fares, payments)'],
  admin: ['🛡️ admin', 'Everything except admins, owners and money settings'],
  moderator: ['🧭 moderator', ''],
};

// Admin → Team: staff accounts (owners, admins and moderators), what each moderator may open, the sign-in log,
// and the private staff login link. Owners manage everyone; admins manage moderators only.
export default function Users() {
  const { user: me, isOwner } = useAuth();
  // may I change this person? the owner: anyone · an admin: moderators (and themselves)
  const mayManage = (person) => isOwner || person.role === 'moderator' || person._id === me._id;
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [link, setLink] = useState('');
  const [editing, setEditing] = useState(null);
  const [handover, setHandover] = useState(null); // { name, email, password } to pass on to a new moderator

  const load = () => {
    api.get('/auth/users').then((response) => setUsers(response.data)).catch((error) => toast.error(errMsg(error)));
    api.get('/auth/events').then((response) => setEvents(response.data)).catch(() => {});
  };
  useEffect(() => {
    load();
    api.get('/auth/staff-link').then((response) => setLink(window.location.origin + response.data.path)).catch(() => {});
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const { _id, name, email, role, perms, active, password } = editing;
    try {
      if (_id) await api.put(`/auth/users/${_id}`, { name, email, role, perms, active, ...(password ? { password } : {}) });
      else await api.post('/auth/users', { name, email, role, perms, password });
      if (password) setHandover({ name, email, password, isNew: !_id });
      else toast.success('Saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const act = async (fn, ok) => {
    try {
      const response = await fn();
      toast.success(response.data?.message || ok);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const remove = (url) => confirm(`Delete ${url.name}’s staff account? They won’t be able to sign in again.`) && act(() => api.delete(`/auth/users/${url._id}`), 'Deleted');
  const toggle = (url) => act(() => api.put(`/auth/users/${url._id}`, { active: !url.active }), url.active ? `${url.name} can no longer sign in` : `${url.name} can sign in again`);
  const signOut = (url) => act(() => api.post(`/auth/users/${url._id}/signout`), 'Signed out');
  const unlock = (url) => act(() => api.put(`/auth/users/${url._id}`, { unlock: true }), `${url.name} is unlocked`);
  const resetPassword = (url) => setEditing({ ...url, password: tempPassword(), resetOnly: true });
  const newLink = async () => {
    if (!confirm('Create a new staff login link? The current link stops working straight away, for everyone. Staff stay signed in, but must use the new link next time.')) return;
    try {
      const response = await api.post('/auth/staff-link');
      setLink(window.location.origin + response.data.path);
      toast.success(response.data.message);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };
  const copy = (text, what) => navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copied`), () => toast.error('Copy failed: select and copy it by hand'));
  const set = (key) => (event) => setEditing({ ...editing, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value });
  const togglePerm = (value) => setEditing({ ...editing, perms: editing.perms.includes(value) ? editing.perms.filter((perm) => perm !== value) : [...editing.perms, value] });

  return (
    <div>
      <div className="page-head">
        <h2>Team</h2>
        <button className="btn" onClick={() => setEditing({ name: '', email: '', password: tempPassword(), role: 'moderator', perms: AREAS.map((area) => area[0]), active: true })}>+ Add staff member</button>
      </div>

      <div className="card staff-link-card">
        <div>
          <b>🔒 Private staff login link</b>
          <p className="muted">The only way to sign in to this admin panel. It isn’t linked anywhere on the website. Share it only with your staff, privately.</p>
          <div className="staff-link-row">
            <code>{link || '…'}</code>
            <button className="btn sm" onClick={() => copy(link, 'Link')} disabled={!link}>Copy</button>
            <button className="btn ghost sm" onClick={newLink}>Change link</button>
          </div>
          <small className="muted">If the link leaks or someone leaves the team, change it (and disable their account).</small>
        </div>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Role &amp; access</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id}>
                <td><b>{user.name}</b>{user._id === me._id && <small className="muted"> (you)</small>}<div className="muted" style={{ fontSize: 12 }}>{user.email}</div></td>
                <td>
                  <span className={`role-badge role-${user.role}`}>{(ROLE_INFO[user.role] || ROLE_INFO.moderator)[0]}</span>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{user.role !== 'moderator' ? ROLE_INFO[user.role]?.[1] : user.perms.length ? AREAS.filter((area) => user.perms.includes(area[0])).map((item) => item[1]).join(', ') : 'No areas yet'}</div>
                </td>
                <td>
                  <span className={`badge ${user.active ? 'completed' : 'cancelled'}`}>{user.active ? 'active' : 'disabled'}</span>
                  {user.locked && <span className="badge failed" style={{ marginLeft: 4 }}>locked</span>}
                  {user.mustChangePassword && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>must set a new password</div>}
                </td>
                <td className="nowrap">{when(user.lastLoginAt)}{user.lastLoginIp && <div className="muted" style={{ fontSize: 12 }}>{user.lastLoginIp}</div>}</td>
                <td className="right staff-actions">
                  {!mayManage(user) && <small className="muted">Only an owner can change this account</small>}
                  {mayManage(user) && <button className="btn ghost sm" onClick={() => setEditing({ ...user, password: '' })}>Edit</button>}
                  {user._id !== me._id && mayManage(user) && (
                    <>
                      {user.locked && <button className="btn ghost sm" onClick={() => unlock(user)}>Unlock</button>}
                      <button className="btn ghost sm" onClick={() => resetPassword(user)}>Reset password</button>
                      <button className="btn ghost sm" onClick={() => signOut(user)}>Sign out</button>
                      <button className="btn ghost sm" onClick={() => toggle(user)}>{user.active ? 'Disable' : 'Enable'}</button>
                      <button className="btn ghost sm danger-text" onClick={() => remove(user)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap" style={{ marginTop: 14 }}>
        <b>Recent sign-ins &amp; changes</b>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Network</th></tr></thead>
          <tbody>
            {events.slice(0, 40).map((item) => (
              <tr key={item._id}>
                <td className="nowrap">{when(item.at)}</td>
                <td>{item.name || item.email || '–'}{item.name && item.email && <div className="muted" style={{ fontSize: 12 }}>{item.email}</div>}</td>
                <td>{ACTIONS[item.action] || item.action}{item.by && <span className="muted"> by {item.by}</span>}{item.detail && <div className="muted" style={{ fontSize: 12 }}>{item.detail}</div>}</td>
                <td className="muted">{item.ip || '–'}</td>
              </tr>
            ))}
            {!events.length && <tr><td colSpan={4} className="muted">Nothing yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.resetOnly ? `Reset ${editing.name}’s password` : editing._id ? `Edit ${editing.name}` : 'New staff member'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            {!editing.resetOnly && (
              <>
                <label className="span2">Name<input value={editing.name} onChange={set('name')} required minLength={2} maxLength={60} /></label>
                <label className="span2">Email<input type="email" value={editing.email} onChange={set('email')} required /></label>
              </>
            )}
            <label className="span2">
              {editing._id && !editing.resetOnly ? 'New password (leave empty to keep it)' : 'Temporary password'}
              <div className="staff-pass-row">
                <input value={editing.password} onChange={set('password')} minLength={8} required={!editing._id || editing.resetOnly} autoComplete="off" spellCheck={false} />
                <button type="button" className="btn ghost sm" onClick={() => setEditing({ ...editing, password: tempPassword() })}>New</button>
              </div>
              <small className="muted">{editing._id === me._id ? 'Your own new password.' : 'They’ll be asked to choose their own password the first time they sign in.'}</small>
            </label>
            {!editing.resetOnly && editing._id !== me._id && (
              <label className="span2">
                Role
                <select value={editing.role} onChange={set('role')} disabled={!isOwner}>
                  <option value="moderator">🧭 Moderator: only the areas you tick below</option>
                  {isOwner && <option value="admin">🛡️ Admin: everything except admins and money settings</option>}
                  {isOwner && <option value="owner">👑 Owner: everything, incl. admins and money settings</option>}
                </select>
                {!isOwner && <small className="muted">Admins add moderators. Only an owner can add admins or owners.</small>}
              </label>
            )}
            {!editing.resetOnly && editing.role === 'moderator' && (
              <fieldset className="span2 staff-perms">
                <legend>What can they open?</legend>
                {AREAS.map(([key, label, hint]) => (
                  <label key={key} className="check">
                    <input type="checkbox" checked={editing.perms.includes(key)} onChange={() => togglePerm(key)} />
                    <span><b>{label}</b> <small className="muted">{hint}</small></span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="modal-actions span2">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn">{editing.resetOnly ? 'Reset password' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {handover && (
        <Modal title={handover.isNew ? `${handover.name} can now sign in` : 'Password reset'} onClose={() => setHandover(null)}>
          <p>Send these to <b>{handover.name}</b> privately (e.g. WhatsApp). They’ll choose their own password when they sign in.</p>
          <pre className="staff-handover">{`Kapu staff login\nLink: ${link}\nEmail: ${handover.email}\nTemporary password: ${handover.password}`}</pre>
          <div className="modal-actions">
            <button className="btn" onClick={() => copy(`Kapu staff login\nLink: ${link}\nEmail: ${handover.email}\nTemporary password: ${handover.password}`, 'Login details')}>Copy all</button>
            <button className="btn ghost" onClick={() => setHandover(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
