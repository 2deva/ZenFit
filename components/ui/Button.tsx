import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}) => {
  const baseStyles = `
    inline-flex items-center justify-center font-display font-semibold 
    transition-all duration-300 ease-out
    active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none
    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-sand-50
  `;

  const variants = {
    primary: `
      bg-gradient-to-br from-claude-500 to-claude-600 text-white 
      shadow-lg shadow-claude-500/20 
      hover:shadow-xl hover:shadow-claude-500/30 hover:from-claude-600 hover:to-claude-700
      focus:ring-claude-400
      rounded-2xl
    `,
    teal: `
      bg-gradient-to-br from-accent-teal to-teal-600 text-white 
      shadow-lg shadow-teal-500/20 
      hover:shadow-xl hover:shadow-teal-500/30 hover:from-teal-500 hover:to-teal-600
      focus:ring-teal-400
      rounded-2xl
    `,
    secondary: `
      bg-white text-ink-700 
      shadow-soft border border-sand-300
      hover:bg-sand-50 hover:border-claude-300/50
      focus:ring-claude-400
      rounded-2xl
    `,
    outline: `
      bg-transparent text-claude-600 
      border-2 border-claude-400/40
      hover:bg-claude-50 hover:border-claude-500
      focus:ring-claude-400
      rounded-2xl
    `,
    ghost: `
      bg-transparent text-ink-500 
      hover:text-claude-600 hover:bg-claude-50
      focus:ring-claude-400
      rounded-xl
    `,
    danger: `
      bg-red-50 text-red-600 
      border border-red-200
      hover:bg-red-100 hover:border-red-300
      focus:ring-red-400
      rounded-2xl
    `,
  };

  const sizes = {
    sm: "h-9 px-4 text-xs gap-1.5",
    md: "h-12 px-6 text-sm gap-2",
    lg: "h-14 px-8 text-base gap-2.5",
    icon: "h-12 w-12 p-0",
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};