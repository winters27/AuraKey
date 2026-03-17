import { forwardRef } from 'react';
import './Input.css';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`input ${className}`} {...props} />
  )
);
