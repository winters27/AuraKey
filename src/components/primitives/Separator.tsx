import './Separator.css';

interface SeparatorProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}

export function Separator({ className = '', orientation = 'horizontal' }: SeparatorProps) {
  return (
    <div
      className={`separator separator--${orientation} ${className}`}
      role="separator"
      aria-orientation={orientation}
    />
  );
}
