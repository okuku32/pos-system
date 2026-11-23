// Swipe left or right to remove (finger or mouse), plus a ✕ button for anyone who'd rather tap.
// Vertical scrolling still works: the swipe only starts once the drag is clearly sideways.
import { useRef, useState } from 'react';

export default function Swipeable({ onDismiss, children, className = '', label = 'Remove', as: Tag = 'div', closeButton = true, disabled = false }) {
  const start = useRef(null);
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(0); // -1 or 1 while it slides off the screen

  const dismiss = (direction) => {
    if (leaving) return;
    setLeaving(direction || 1);
    setTimeout(onDismiss, 180);
  };
  if (disabled) return <Tag className={className}>{children}</Tag>;

  const down = (event) => {
    if (event.button > 0 || event.target.closest('.os-swipe-x')) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId, at: Date.now(), axis: null };
    dragged.current = false;
  };
  const move = (event) => {
    const drag = start.current;
    if (!drag || event.pointerId !== drag.id) return;
    const x = event.clientX - drag.x;
    const y = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      drag.axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y';
      if (drag.axis === 'x') event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (drag.axis !== 'x') return;
    dragged.current = true;
    setDx(x);
  };
  const up = (event) => {
    const drag = start.current;
    start.current = null;
    if (!drag || drag.axis !== 'x') return;
    const x = event.clientX - drag.x;
    const width = event.currentTarget.offsetWidth || 300;
    const flick = Math.abs(x) / Math.max(1, Date.now() - drag.at) > 0.6 && Math.abs(x) > 40;
    if (Math.abs(x) > width * 0.35 || flick) dismiss(Math.sign(x));
    else setDx(0);
  };
  const cancel = () => {
    start.current = null;
    setDx(0);
  };
  // a swipe isn't a tap: don't open the link underneath
  const clickCapture = (event) => {
    if (!dragged.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragged.current = false;
  };

  const style = leaving
    ? { transform: `translateX(${leaving * 110}%)`, opacity: 0 }
    : { transform: dx ? `translateX(${dx}px)` : undefined, opacity: dx ? 1 - Math.min(Math.abs(dx) / 400, 0.6) : undefined, transition: dx ? 'none' : undefined };

  return (
    <Tag
      className={`os-swipe ${leaving ? 'leaving' : ''} ${className}`}
      style={style}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClickCapture={clickCapture}
      onDragStart={(event) => event.preventDefault()}
    >
      {children}
      {closeButton && (
        <button type="button" className="os-swipe-x" aria-label={label} title={label} onClick={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(1); }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </Tag>
  );
}
