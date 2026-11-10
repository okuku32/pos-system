const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { verifyGoogleCredential, googleClientId } = require('../utils/oauth');

const sign = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, active: u.active });

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+password');
  if (!user || !user.active || !(await user.matchPassword(password || '')))
    return res.status(401).json({ message: 'Invalid email or password' });
  res.json({ token: sign(user._id), user: publicUser(user) });
});

exports.me = (req, res) => res.json(publicUser(req.user));

// GET /api/auth/oauth-config: which sign-in providers the browser should show
exports.oauthConfig = (req, res) => res.json({ google: googleClientId() });

// POST /api/auth/oauth/google { credential }: staff sign in with Google.
// Only works for an email an admin has already added under Users: Google can't create staff accounts.
exports.google = asyncHandler(async (req, res) => {
  const g = await verifyGoogleCredential(req.body.credential);
  const user = await User.findOne({ email: g.email });
  if (!user || !user.active) {
    return res.status(403).json({ message: `${g.email} is not a staff account. Ask an admin to add you under Users.` });
  }
  res.json({ token: sign(user._id), user: publicUser(user) });
});

// First-run setup: allowed only when no users exist yet
exports.setupStatus = asyncHandler(async (req, res) => {
  res.json({ needsSetup: (await User.countDocuments()) === 0 });
});

exports.setup = asyncHandler(async (req, res) => {
  if (await User.countDocuments()) return res.status(400).json({ message: 'Setup already completed' });
  const { name, email, password } = req.body;
  const user = await User.create({ name, email, password, role: 'admin' });
  res.status(201).json({ token: sign(user._id), user: publicUser(user) });
});

// ---- Admin user management ----
exports.listUsers = asyncHandler(async (req, res) => {
  res.json((await User.find().sort('-createdAt')).map(publicUser));
});

exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  const user = await User.create({ name, email, password, role });
  res.status(201).json(publicUser(user));
});

exports.updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const { name, email, role, active, password } = req.body;
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (role !== undefined) user.role = role;
  if (active !== undefined) user.active = active;
  if (password) user.password = password;
  await user.save();
  res.json(publicUser(user));
});

exports.deleteUser = asyncHandler(async (req, res) => {
  if (String(req.user._id) === req.params.id) return res.status(400).json({ message: 'You cannot delete yourself' });
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: 'User deleted' });
});
