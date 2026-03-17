import * as RadixSwitch from '@radix-ui/react-switch';
import './Switch.css';

interface SwitchProps extends Omit<RadixSwitch.SwitchProps, 'className'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function Switch({ checked, onCheckedChange, className = '', ...props }: SwitchProps) {
  return (
    <RadixSwitch.Root
      className={`switch ${className}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      {...props}
    >
      <RadixSwitch.Thumb className="switch__thumb" />
    </RadixSwitch.Root>
  );
}
