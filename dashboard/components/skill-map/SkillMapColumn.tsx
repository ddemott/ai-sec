import React from 'react';

interface SkillMapColumnProps {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  iconStyle?: React.CSSProperties;
  count: number;
  children: React.ReactNode;
}

export default function SkillMapColumn({
  title,
  icon: Icon,
  iconColor,
  iconStyle,
  count,
  children,
}: SkillMapColumnProps) {
  return (
    <div
      className="flex-1 flex flex-col min-w-[200px]"
      data-testid={`column-${title.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={`p-1.5 rounded-lg ${iconColor}`} style={iconStyle}>
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">{title}</h3>
        <span className="ml-auto text-xs font-bold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
