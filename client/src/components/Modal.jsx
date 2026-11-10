export default function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head no-print">
          <h3>{title}</h3>
          {onClose && (
            <button className="btn ghost sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
