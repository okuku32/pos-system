// Our social media pages (shown on the Contact us page). Links come from Admin → Settings.
import { STORE_INFO } from './storeInfo';

const ICONS = {
  tiktok: ['TikTok', 'M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.6c.27 0 .53.04.77.12V9.77a5.7 5.7 0 0 0-.77-.05 5.69 5.69 0 1 0 5.69 5.68V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.28 4.28 0 0 1-3.25-1.48Z'],
  instagram: ['Instagram', 'M12 7.38A4.62 4.62 0 1 0 16.62 12 4.62 4.62 0 0 0 12 7.38Zm0 7.62a3 3 0 1 1 3-3 3 3 0 0 1-3 3Zm4.8-8.88a1.08 1.08 0 1 0 1.08 1.08 1.08 1.08 0 0 0-1.08-1.08ZM21.94 7.1a5.33 5.33 0 0 0-1.46-3.58A5.36 5.36 0 0 0 16.9 2.06C15.5 2 8.5 2 7.1 2.06a5.35 5.35 0 0 0-3.58 1.45A5.34 5.34 0 0 0 2.06 7.1C2 8.5 2 15.5 2.06 16.9a5.33 5.33 0 0 0 1.46 3.58 5.37 5.37 0 0 0 3.58 1.46c1.4.08 8.4.08 9.8 0a5.33 5.33 0 0 0 3.58-1.46 5.36 5.36 0 0 0 1.46-3.58c.08-1.4.08-8.4 0-9.8Zm-2.06 11.97a3.27 3.27 0 0 1-1.84 1.84c-1.27.5-4.3.39-5.04.39s-3.77.11-5.04-.39a3.27 3.27 0 0 1-1.84-1.84c-.5-1.27-.39-4.3-.39-5.04s-.11-3.77.39-5.04a3.27 3.27 0 0 1 1.84-1.84c1.27-.5 4.3-.39 5.04-.39s3.77-.11 5.04.39a3.27 3.27 0 0 1 1.84 1.84c.5 1.27.39 4.3.39 5.04s.11 3.77-.39 5.04Z'],
  facebook: ['Facebook', 'M22 12.06A10 10 0 1 0 10.44 22v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9a15.4 15.4 0 0 1 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.87h2.78l-.44 2.91h-2.34V22A10 10 0 0 0 22 12.06Z'],
  x: ['X (Twitter)', 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.78L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z'],
  youtube: ['YouTube', 'M21.58 7.19a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42a2.5 2.5 0 0 0-1.76 1.77A26.2 26.2 0 0 0 2 12a26.2 26.2 0 0 0 .42 4.81 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 0 0 1.76-1.77A26.2 26.2 0 0 0 22 12a26.2 26.2 0 0 0-.42-4.81ZM10 15V9l5.2 3L10 15Z'],
};
export const SOCIAL_KEYS = Object.keys(ICONS);
export const SOCIAL_NAMES = Object.fromEntries(Object.entries(ICONS).map(([key, [item]]) => [key, item]));
export function SocialIcon({ name, size = 20 }) {
  if (!ICONS[name]) return null;
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={ICONS[name][1]} /></svg>;
}

export default function Social({ label = true }) {
  const links = SOCIAL_KEYS.filter((socialKey) => STORE_INFO.social?.[socialKey]);
  if (!links.length) return null;
  return (
    <div className="os-social">
      {label && <span className="os-social-label">Follow {STORE_INFO.name}</span>}
      <div className="os-social-icons">
        {links.map((link) => (
          <a key={link} href={STORE_INFO.social[link]} target="_blank" rel="noopener noreferrer" className={`os-social-${link}`} aria-label={`${STORE_INFO.name} on ${ICONS[link][0]}`} title={ICONS[link][0]}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={ICONS[link][1]} /></svg>
          </a>
        ))}
      </div>
    </div>
  );
}
