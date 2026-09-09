import React from 'react';

export default function Button({ children, variant = 'primary', size = 'md', disabled, onClick, className = '' }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';

  const variants = {
    primary: 'bg-repyr-600 hover:bg-repyr-700 text-white focus:ring-repyr-500',
    danger:  'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
    ghost:   'bg-white/10 hover:bg-white/20 text-white focus:ring-white/30',
    success: 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500',
    outline: 'border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white focus:ring-slate-500',
  };

  const sizes = {
    sm:  'px-4 py-2 text-sm',
    md:  'px-6 py-3 text-sm',
    lg:  'px-8 py-4 text-base',
    xl:  'px-10 py-5 text-lg',
  };

  return (
    <button
      className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
