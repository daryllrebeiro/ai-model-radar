'use client';

import React from 'react';
import { useCompare } from './compare-context';
import { Scale, Check } from 'lucide-react';

interface CompareButtonProps {
  modelId: string;
  className?: string;
  variant?: 'compact' | 'standard' | 'icon';
}

export function CompareButton({
  modelId,
  className = '',
  variant = 'compact',
}: CompareButtonProps) {
  const { isSelected, toggleModel } = useCompare();
  const selected = isSelected(modelId);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleModel(modelId);
  };

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        title={selected ? 'Remove from comparison' : 'Add to comparison'}
        className={`p-1.5 rounded-lg border transition-all ${
          selected
            ? 'bg-cyan-950/80 border-cyan-500 text-cyan-400'
            : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
        } ${className}`}
      >
        {selected ? <Check className="w-3.5 h-3.5" /> : <Scale className="w-3.5 h-3.5" />}
      </button>
    );
  }

  if (variant === 'standard') {
    return (
      <button
        onClick={handleClick}
        className={`px-3.5 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all flex items-center gap-2 ${
          selected
            ? 'bg-cyan-950/80 border-cyan-500 text-cyan-400 shadow-sm shadow-cyan-950'
            : 'bg-gray-800/80 hover:bg-gray-700/80 border-gray-700 text-gray-300 hover:text-white'
        } ${className}`}
      >
        {selected ? (
          <>
            <Check className="w-4 h-4 text-cyan-400" />
            <span>In Comparison</span>
          </>
        ) : (
          <>
            <Scale className="w-4 h-4 text-gray-400" />
            <span>Add to Compare</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-all flex items-center gap-1.5 ${
        selected
          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-400'
          : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-700'
      } ${className}`}
    >
      {selected ? (
        <>
          <Check className="w-3 h-3 text-cyan-400" />
          <span>Comparing</span>
        </>
      ) : (
        <>
          <Scale className="w-3 h-3 text-gray-400" />
          <span>Compare</span>
        </>
      )}
    </button>
  );
}
