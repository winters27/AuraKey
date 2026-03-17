import * as RadixScrollArea from '@radix-ui/react-scroll-area';
import './ScrollArea.css';

interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function ScrollArea({ children, className = '', style }: ScrollAreaProps) {
  return (
    <RadixScrollArea.Root className={`scroll-area ${className}`} style={style}>
      <RadixScrollArea.Viewport className="scroll-area__viewport">
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar className="scroll-area__scrollbar" orientation="vertical">
        <RadixScrollArea.Thumb className="scroll-area__thumb" />
      </RadixScrollArea.Scrollbar>
    </RadixScrollArea.Root>
  );
}
