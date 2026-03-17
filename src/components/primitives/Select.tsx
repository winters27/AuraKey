import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import './Select.css';

/* ── Re-export with styled wrappers ── */

export function Select({ children, ...props }: RadixSelect.SelectProps) {
  return <RadixSelect.Root {...props}>{children}</RadixSelect.Root>;
}

export function SelectTrigger({ children, className = '', ...props }: RadixSelect.SelectTriggerProps) {
  return (
    <RadixSelect.Trigger className={`select-trigger ${className}`} {...props}>
      {children}
      <RadixSelect.Icon className="select-trigger__icon">
        <ChevronDown size={12} />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
}

export function SelectContent({ children, ...props }: RadixSelect.SelectContentProps) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content className="select-content" position="popper" sideOffset={4} {...props}>
        <RadixSelect.Viewport>{children}</RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
}

export function SelectItem({ children, className = '', ...props }: RadixSelect.SelectItemProps) {
  return (
    <RadixSelect.Item className={`select-item ${className}`} {...props}>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}

export const SelectValue = RadixSelect.Value;
