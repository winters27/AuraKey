import * as RadixPopover from '@radix-ui/react-popover';
import './Popover.css';

export function Popover({ children, ...props }: RadixPopover.PopoverProps) {
  return <RadixPopover.Root {...props}>{children}</RadixPopover.Root>;
}

export function PopoverTrigger({ children, ...props }: RadixPopover.PopoverTriggerProps) {
  return <RadixPopover.Trigger {...props}>{children}</RadixPopover.Trigger>;
}

export function PopoverContent({ children, className = '', ...props }: RadixPopover.PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content className={`popover-content ${className}`} sideOffset={4} {...props}>
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}
