import { forwardRef } from 'react';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'icon' | 'icon-xs' | 'xs';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'ghost', size = 'md', className = '', children, ...props }, ref) => (
    <button ref={ref} className={`btn btn--${variant} btn--${size} ${className}`} {...props}>
      {children}
    </button>
  )
);
