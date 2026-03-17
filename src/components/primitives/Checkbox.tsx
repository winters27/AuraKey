import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import './Checkbox.css';

interface CheckboxProps {
  id?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Checkbox({ id, checked, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <RadixCheckbox.Root
      className="checkbox"
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      {...props}
    >
      <RadixCheckbox.Indicator className="checkbox__indicator">
        <Check size={12} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
