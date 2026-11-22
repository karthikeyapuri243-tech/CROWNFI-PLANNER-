import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowUp, 
  Compass, 
  Sliders, 
  CheckSquare, 
  Activity, 
  Clock, 
  Calendar,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type ScrollSpeedMode = 'slow' | 'medium' | 'default';

interface PageSection {
  id: string;
  elementId: string;
  label: string;
  icon: React.ComponentType<any>;
}

const SECTIONS: PageSection[] = [
  { id: 'top', elementId: 'header-brand', label: 'Top / Dashboard', icon: ArrowUp },
  { id: 'tasks', elementId: 'tasks-section', label: 'Tasks Backlog', icon: CheckSquare },
  { id: 'habits', elementId: 'habits-section', label: 'Habits Tracker', icon: Activity },
  { id: 'timeline', elementId: 'timeline-section', label: 'Daily Timetable', icon: Clock },
  { id: 'heatmap', elementId: 'habits-heatmap-section', label: '30-Day Heatmap', icon: Calendar },
];

export default function PageScrollAssistant() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeSection, setActiveSection] = useState<string>('top');
  const [isOpen, setIsOpen] = useState(false);
  const [showSpeedControls, setShowSpeedControls] = useState(false);
  const [speedMode, setSpeedMode] = useState<ScrollSpeedMode>(() => {
    return (localStorage.getItem('aura-scroll-speed') as ScrollSpeedMode) || 'slow';
  });

  // Custom wheel animation refs
  const targetScrollY = useRef(0);
  const isScrolling = useRef(false);
  const animationFrameId = useRef<number | null>(null);

  // Speed Mode parameters
  // speedFactor: interpolation multiplier (lerp) per frame. Lower = slower, smoother.
  // deltaMultiplier: scaling applied to wheel delta to govern distance per scroll.
  const getSpeedParams = (mode: ScrollSpeedMode) => {
    switch (mode) {
      case 'slow':
        return { speedFactor: 0.035, deltaMultiplier: 0.75 }; // Elegant, precise, comfortable pace
      case 'medium':
        return { speedFactor: 0.07, deltaMultiplier: 1.25 }; // Responsive, agile, fast pace
      case 'default':
      default:
        return { speedFactor: 0.12, deltaMultiplier: 1.0 }; // Native browser feel
    }
  };

  // 1. Cancel running button smooth scroll immediately on user manual wheel or touch interaction
  // This restores 100% native wheel/trackpad feel (1x speed) without any custom sliding or drift.
  useEffect(() => {
    const cancelProgrammaticScroll = () => {
      if (isScrolling.current) {
        isScrolling.current = false;
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current);
          animationFrameId.current = null;
        }
      }
    };
    window.addEventListener('wheel', cancelProgrammaticScroll, { passive: true });
    window.addEventListener('touchmove', cancelProgrammaticScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', cancelProgrammaticScroll);
      window.removeEventListener('touchmove', cancelProgrammaticScroll);
    };
  }, []);

  // 2. Window Scroll Listener for Progress and Section Highlighting
  useEffect(() => {
    const handleScroll = () => {
      // Update wheel scroll target if scroll is generated natively (scrollbar drag, keyboard arrows, space)
      if (!isScrolling.current) {
        targetScrollY.current = window.scrollY;
      }

      // Calculate scroll progress percentage
      const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (totalHeight > 0) {
        setScrollProgress((window.scrollY / totalHeight) * 100);
      } else {
        setScrollProgress(0);
      }

      // Detect active section based on viewport position
      const viewportMiddle = window.scrollY + window.innerHeight / 2.5;

      // Find which element is closest to the middle of the screen
      let currentSection = 'top';
      for (const section of SECTIONS) {
        if (section.id === 'top') continue;
        const el = document.getElementById(section.elementId);
        if (el) {
          const rect = el.getBoundingClientRect();
          const elementTopAbsolute = window.scrollY + rect.top;
          if (viewportMiddle >= elementTopAbsolute - 20) {
            currentSection = section.id;
          }
        }
      }
      setActiveSection(currentSection);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Run initial calculation
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const changeSpeedMode = (mode: ScrollSpeedMode) => {
    setSpeedMode(mode);
    localStorage.setItem('aura-scroll-speed', mode);
  };

  // Helper to scroll to a specific target element ID smoothly with tab correction
  const scrollToSection = (id: string, elementId: string) => {
    // Determine the active tab associated with each specific section
    let targetTab: string | null = null;
    if (id === 'tasks') targetTab = 'tasks';
    else if (id === 'habits' || id === 'heatmap') targetTab = 'habits';
    else if (id === 'timeline') targetTab = 'timeline';

    const performScroll = () => {
      // Clear any running animation
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }

      if (id === 'top') {
        if (speedMode === 'default') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          targetScrollY.current = 0;
          isScrolling.current = true;
          const { speedFactor } = getSpeedParams(speedMode);
          const animate = () => {
            if (!isScrolling.current) return;
            const diff = targetScrollY.current - window.scrollY;
            if (Math.abs(diff) < 0.5) {
              window.scrollTo(window.scrollX, 0);
              isScrolling.current = false;
              animationFrameId.current = null;
              return;
            }
            window.scrollTo(window.scrollX, window.scrollY + diff * speedFactor);
            animationFrameId.current = requestAnimationFrame(animate);
          };
          animationFrameId.current = requestAnimationFrame(animate);
        }
        return;
      }

      const el = document.getElementById(elementId);
      if (el) {
        const rect = el.getBoundingClientRect();
        const absoluteTop = window.scrollY + rect.top - 80; // Offset for sticky headers
        
        if (speedMode === 'default') {
          window.scrollTo({ top: absoluteTop, behavior: 'smooth' });
        } else {
          targetScrollY.current = absoluteTop;
          isScrolling.current = true;
          const { speedFactor } = getSpeedParams(speedMode);
          const animate = () => {
            if (!isScrolling.current) return;
            const diff = targetScrollY.current - window.scrollY;
            if (Math.abs(diff) < 1) {
              window.scrollTo(window.scrollX, targetScrollY.current);
              isScrolling.current = false;
              animationFrameId.current = null;
              return;
            }
            window.scrollTo(window.scrollX, window.scrollY + diff * speedFactor);
            animationFrameId.current = requestAnimationFrame(animate);
          };
          animationFrameId.current = requestAnimationFrame(animate);
        }

        // Briefly outline or pulse the target element to orient the user
        el.classList.add('ring-2', 'ring-olive/30', 'transition-all', 'duration-700');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-olive/30');
        }, 1500);
      }
    };

    if (targetTab) {
      // Programmatically dispatch tab transition to ensure the view is active (essential for mobile/tablet screen sizes)
      window.dispatchEvent(new CustomEvent('aura-navigate-tab', { detail: targetTab }));
      
      // Give a tiny window of 180ms for the DOM node to mount/be styled block, then perform our buttery scroll
      setTimeout(performScroll, 180);
    } else {
      performScroll();
    }
  };

  const scrollStep = (direction: 'up' | 'down') => {
    // Clear any running animation
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    const step = 150; // Precise step distance of 150px to read paragraph by paragraph comfortably
    const target = direction === 'up' 
      ? Math.max(0, window.scrollY - step)
      : Math.min(document.documentElement.scrollHeight - window.innerHeight, window.scrollY + step);

    if (speedMode === 'default') {
      window.scrollTo({ top: target, behavior: 'smooth' });
    } else {
      targetScrollY.current = target;
      isScrolling.current = true;
      const { speedFactor } = getSpeedParams(speedMode);
      const animate = () => {
        if (!isScrolling.current) return;
        const diff = targetScrollY.current - window.scrollY;
        if (Math.abs(diff) < 1) {
          window.scrollTo(window.scrollX, targetScrollY.current);
          isScrolling.current = false;
          animationFrameId.current = null;
          return;
        }
        window.scrollTo(window.scrollX, window.scrollY + diff * speedFactor);
        animationFrameId.current = requestAnimationFrame(animate);
      };
      animationFrameId.current = requestAnimationFrame(animate);
    }
  };

  // Don't render anything if the page isn't tall enough to scroll
  const [isScrollable, setIsScrollable] = useState(false);
  useEffect(() => {
    const checkScrollable = () => {
      setIsScrollable(document.documentElement.scrollHeight > window.innerHeight + 50);
    };
    checkScrollable();
    window.addEventListener('resize', checkScrollable);
    
    // Check again after a delay to account for dynamic contents loading
    const timer = setTimeout(checkScrollable, 1000);

    return () => {
      window.removeEventListener('resize', checkScrollable);
      clearTimeout(timer);
    };
  }, []);

  if (!isScrollable) return null;

  // Render variables for circular progress ring around the button
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (scrollProgress / 100) * circumference;

  return (
    <div className="fixed bottom-24 right-4 sm:right-6 z-40 flex flex-col items-center gap-2 select-none" id="page-scroll-assistant">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.9 }}
            className="bg-cardbg border border-natborder rounded-2xl shadow-lg p-3 w-48 space-y-3 backdrop-blur-md"
          >
            {/* Menu Header with navigation quick step controls */}
            <div className="flex items-center justify-between border-b border-natborder/60 pb-1.5">
              <span className="text-[10px] font-bold text-olive uppercase tracking-wider">Scroll Compass</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => scrollStep('up')}
                  className="p-1 rounded-md hover:bg-olive/15 text-natmuted hover:text-olive cursor-pointer"
                  title="Scroll Page Up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => scrollStep('down')}
                  className="p-1 rounded-md hover:bg-olive/15 text-natmuted hover:text-olive cursor-pointer"
                  title="Scroll Page Down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Bookmarks navigation (All sections are listed to always grant comprehensive page access) */}
            <div className="space-y-1">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                
                return (
                  <button
                    key={section.id}
                    onClick={() => {
                      scrollToSection(section.id, section.elementId);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs font-semibold text-left transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-olive text-white shadow-xs font-bold' 
                        : 'text-natmuted hover:text-nattext hover:bg-olive/10'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-olive'}`} />
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Scroll Speed Customizer Section */}
            <div className="border-t border-natborder/60 pt-2 space-y-1.5">
              <button
                onClick={() => setShowSpeedControls(!showSpeedControls)}
                className="w-full flex items-center justify-between text-[10px] font-extrabold text-natmuted hover:text-olive cursor-pointer"
              >
                <span className="flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-clay" />
                  SPEED: {speedMode.toUpperCase()}
                </span>
                <span className="text-[8px] text-clay font-bold underline">
                  {showSpeedControls ? 'Hide' : 'Change'}
                </span>
              </button>

              <AnimatePresence>
                {showSpeedControls && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-1.5"
                  >
                    <div className="grid grid-cols-3 gap-1 bg-subtlebg p-1 rounded-lg border border-natborder/40 text-[9px]">
                      {(['slow', 'medium', 'default'] as ScrollSpeedMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => changeSpeedMode(mode)}
                          className={`py-1 rounded-md font-bold transition-all text-center cursor-pointer ${
                            speedMode === mode
                              ? 'bg-white dark:bg-slate-800 text-olive border border-natborder shadow-3xs'
                              : 'text-natmuted hover:text-nattext'
                          }`}
                        >
                          {mode === 'default' ? 'Default' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[8px] text-natmuted leading-tight text-center px-1">
                      {speedMode === 'slow' && 'Luxurious, buttery slow gliding.'}
                      {speedMode === 'medium' && 'Perfect medium-speed kinetic scroll.'}
                      {speedMode === 'default' && 'Browser default scrolling velocity.'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Main Access Button with Radial Progress Ring */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-cardbg border border-natborder/80 shadow-md flex items-center justify-center relative hover:scale-105 active:scale-95 cursor-pointer hover:border-olive/40 transition-all text-olive"
        id="btn-scroll-compass"
        title="Open Page Scroll Assistant"
      >
        {/* SVG Progress Circle Background */}
        <svg className="w-10 h-10 transform -rotate-90 absolute top-0 left-0">
          <circle 
            cx="20" 
            cy="20" 
            r={radius} 
            className="stroke-natborder/20" 
            strokeWidth="2" 
            fill="transparent" 
          />
          <circle 
            cx="20" 
            cy="20" 
            r={radius} 
            className="stroke-clay dark:stroke-olive transition-all duration-100" 
            strokeWidth="2" 
            fill="transparent" 
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </svg>

        {/* Icon inside circle */}
        <Compass className={`w-4.5 h-4.5 transition-transform duration-350 ${isOpen ? 'rotate-180 text-clay' : ''}`} />
      </button>
    </div>
  );
}
