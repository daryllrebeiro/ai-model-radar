'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';

interface CompareContextType {
  selectedModels: string[];
  addModel: (id: string) => boolean;
  removeModel: (id: string) => void;
  toggleModel: (id: string) => void;
  clearModels: () => void;
  isSelected: (id: string) => boolean;
}

const CompareContext = createContext<CompareContextType>({
  selectedModels: [],
  addModel: () => false,
  removeModel: () => {},
  toggleModel: () => {},
  clearModels: () => {},
  isSelected: () => false,
});

const STORAGE_KEY = 'amr_compare_models';
const MAX_COMPARE_MODELS = 4;

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSelectedModels(parsed.slice(0, MAX_COMPARE_MODELS));
        }
      }
    } catch {
      // Ignore local storage parse issues
    }
    setMounted(true);
  }, []);

  const saveModels = (models: string[]) => {
    setSelectedModels(models);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
    } catch {
      // Ignore storage quota
    }
  };

  const addModel = (id: string): boolean => {
    if (selectedModels.includes(id)) return true;
    if (selectedModels.length >= MAX_COMPARE_MODELS) {
      alert(`You can compare up to ${MAX_COMPARE_MODELS} models at a time.`);
      return false;
    }
    const next = [...selectedModels, id];
    saveModels(next);
    trackEvent('compare_add', { modelId: id, totalCount: next.length });
    return true;
  };

  const removeModel = (id: string) => {
    const next = selectedModels.filter((m) => m !== id);
    saveModels(next);
    trackEvent('compare_remove', { modelId: id, totalCount: next.length });
  };

  const toggleModel = (id: string) => {
    if (selectedModels.includes(id)) {
      removeModel(id);
    } else {
      addModel(id);
    }
  };

  const clearModels = () => {
    saveModels([]);
  };

  const isSelected = (id: string) => selectedModels.includes(id);

  return (
    <CompareContext.Provider
      value={{
        selectedModels: mounted ? selectedModels : [],
        addModel,
        removeModel,
        toggleModel,
        clearModels,
        isSelected,
      }}
    >
      {children}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  return useContext(CompareContext);
}
