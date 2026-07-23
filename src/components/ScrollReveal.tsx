import { ReactNode } from 'react';
import { useInView } from '../hooks/useInView';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  threshold?: number;
}

/**
 * Scroll-triggered reveal animation.
 * Wraps children and animates them in when they enter the viewport.
 * Uses existing CSS animation classes from index.css.
 */
export function ScrollReveal({
  children,
  className = '',
  delay = 0,
  direction = 'up',
  threshold,
}: ScrollRevealProps) {
  const { ref, inView } = useInView({ threshold });

  const transforms: Record<string, string> = {
    up: 'translateY(30px)',
    down: 'translateY(-30px)',
    left: 'translateX(30px)',
    right: 'translateX(-30px)',
  };

  const style: React.CSSProperties = {
    opacity: inView ? 1 : 0,
    transform: inView ? 'translate(0, 0)' : transforms[direction],
    transition: `opacity 0.6s ease-out, transform 0.6s ease-out`,
    transitionDelay: `${delay}ms`,
    willChange: 'opacity, transform',
  };

  return (
    <div ref={ref} style={style} className={className}>
      {children}
    </div>
  );
}
