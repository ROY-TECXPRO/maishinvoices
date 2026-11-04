import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ModalTone = 'brand' | 'danger' | 'success';

const ICON: Record<ModalTone, ReactNode> = {
  brand: <Info size={22} aria-hidden />,
  danger: <AlertTriangle size={22} aria-hidden />,
  success: <CheckCircle2 size={22} aria-hidden />,
};

/**
 * The one popup used everywhere. The card is positioned above the blurred backdrop (a plain
 * unpositioned card used to sit UNDER the backdrop, which made its buttons unclickable).
 * Esc or a click outside closes it.
 */
export function Modal({
  label,
  title,
  tone = 'brand',
  icon,
  onClose,
  children,
  footer,
}: {
  label: string;
  title: string;
  tone?: ModalTone;
  icon?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal-backdrop" onClick={onClose} />
      <div className={`modal-card modal-${tone}`}>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}><X size={16} /></button>
        <div className="modal-head">
          <span className="modal-medal" aria-hidden>{icon ?? ICON[tone]}</span>
          <h2 className="modal-title">{title}</h2>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
