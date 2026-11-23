// The password rules, shown live while someone types (sign-up, reset, change). The server checks the same rules
// (server/security/validate.js → newPassword); this only helps people get it right first time.
export function passwordChecks(password, who = {}) {
  const lower = password.toLowerCase();
  const parts = [String(who.email || '').split('@')[0], ...String(who.name || '').split(/\s+/)].map((part) => part.toLowerCase()).filter((part) => part.length >= 4);
  return [
    ['length', 'At least 10 characters', password.length >= 10],
    ['upper', 'An uppercase letter (A–Z)', /[A-Z]/.test(password)],
    ['lower', 'A lowercase letter (a–z)', /[a-z]/.test(password)],
    ['number', 'A number (0–9)', /\d/.test(password)],
    ['personal', 'Not your name or email', !parts.some((part) => lower.includes(part))],
  ];
}
export const passwordOk = (password, who) => passwordChecks(password, who).every(([, , ok]) => ok);

export default function PasswordRules({ password, who }) {
  if (!password) return null;
  return (
    <ul className="os-pass-rules" aria-live="polite">
      {passwordChecks(password, who).map(([key, label, ok]) => (
        <li key={key} className={ok ? 'ok' : ''}><span aria-hidden="true">{ok ? '✓' : '•'}</span> {label}</li>
      ))}
    </ul>
  );
}
