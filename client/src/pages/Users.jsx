import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { errMsg } from '../api';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/auth/users').then((r) => setUsers(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing._id) await api.put(`/auth/users/${editing._id}`, editing);
      else await api.post('/auth/users', editing);
      toast.success('User saved');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const remove = async (u) => {
    if (!confirm(`Delete ${u.name}?`)) return;
    try {
      await api.delete(`/auth/users/${u._id}`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const set = (k) => (e) => setEditing({ ...editing, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div>
      <div className="page-head">
        <h2>Users</h2>
        <button className="btn" onClick={() => setEditing({ name: '', email: '', password: '', role: 'cashier', active: true })}>+ Add user</button>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td><span className={`badge ${u.active ? 'completed' : 'cancelled'}`}>{u.active ? 'active' : 'disabled'}</span></td>
                <td className="right nowrap">
                  <button className="btn ghost sm" onClick={() => setEditing({ ...u, password: '' })}>Edit</button>
                  {u._id !== me._id && <button className="btn ghost sm danger-text" onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing._id ? 'Edit user' : 'New user'} onClose={() => setEditing(null)}>
          <form className="form-grid" onSubmit={save}>
            <label className="span2">Name<input value={editing.name} onChange={set('name')} required /></label>
            <label className="span2">Email<input type="email" value={editing.email} onChange={set('email')} required /></label>
            <label>
              {editing._id ? 'New password (optional)' : 'Password'}
              <input type="password" value={editing.password} onChange={set('password')} minLength={6} required={!editing._id} />
            </label>
            <label>
              Role
              <select value={editing.role} onChange={set('role')}>
                <option value="cashier">Cashier</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="check span2"><input type="checkbox" checked={editing.active} onChange={set('active')} /> Active</label>
            <div className="modal-actions span2">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
