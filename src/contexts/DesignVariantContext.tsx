import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type DesignVariant = 'default' | 'premium';

interface DesignVariantContextType {
  variant: DesignVariant;
  setVariant: (variant: DesignVariant) => void;
  toggle: () => void;
}

const DesignVariantContext = createContext<DesignVariantContextType | undefined>(undefined);

const STORAGE_KEY = 'bizzauto_design_variant';

export const DesignVariantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [variant, setVariantState] = useState<DesignVariant>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return (stored === 'premium' ? 'premium' : 'default') as DesignVariant;
    } catch {
      return 'default';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, variant);
      if (variant === 'premium') {
        document.documentElement.classList.add('design-premium');
      } else {
        document.documentElement.classList.remove('design-premium');
      }
    } catch {
      // localStorage unavailable
    }
  }, [variant]);

  const setVariant = useCallback((newVariant: DesignVariant) => setVariantState(newVariant), []);
  const toggle = useCallback(() => setVariantState((v) => (v === 'default' ? 'premium' : 'default')), []);

  return (
    <DesignVariantContext.Provider value={{ variant, setVariant, toggle }}>
      {children}
    </DesignVariantContext.Provider>
  );
};

export const useDesignVariant = (): DesignVariantContextType => {
  const ctx = useContext(DesignVariantContext);
  if (!ctx) {
    return { variant: 'default', setVariant: () => {}, toggle: () => {} };
  }
  return ctx;
};
