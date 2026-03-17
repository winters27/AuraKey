import * as RadixTooltip from '@radix-ui/react-tooltip';
import './Tooltip.css';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({ children, ...props }: RadixTooltip.TooltipProps) {
  return <RadixTooltip.Root {...props}>{children}</RadixTooltip.Root>;
}

export function TooltipTrigger({ children, ...props }: RadixTooltip.TooltipTriggerProps) {
  return <RadixTooltip.Trigger {...props}>{children}</RadixTooltip.Trigger>;
}

export function TooltipContent({ children, className = '', ...props }: RadixTooltip.TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content className={`tooltip-content ${className}`} sideOffset={4} {...props}>
        {children}
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  );
}
