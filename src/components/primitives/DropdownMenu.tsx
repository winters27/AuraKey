import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import './DropdownMenu.css';

export function DropdownMenu({ children, ...props }: RadixDropdown.DropdownMenuProps) {
  return <RadixDropdown.Root {...props}>{children}</RadixDropdown.Root>;
}

export function DropdownMenuTrigger({ children, ...props }: RadixDropdown.DropdownMenuTriggerProps) {
  return <RadixDropdown.Trigger {...props}>{children}</RadixDropdown.Trigger>;
}

export function DropdownMenuContent({ children, className = '', ...props }: RadixDropdown.DropdownMenuContentProps) {
  return (
    <RadixDropdown.Portal>
      <RadixDropdown.Content className={`dropdown-content ${className}`} sideOffset={4} {...props}>
        {children}
      </RadixDropdown.Content>
    </RadixDropdown.Portal>
  );
}

export function DropdownMenuItem({ children, className = '', ...props }: RadixDropdown.DropdownMenuItemProps) {
  return (
    <RadixDropdown.Item className={`dropdown-item ${className}`} {...props}>
      {children}
    </RadixDropdown.Item>
  );
}
