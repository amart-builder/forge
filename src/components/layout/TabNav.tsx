'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { name: 'Tasks', href: '/tasks' },
  { name: 'Email', href: '/email' },
  { name: 'CRM', href: '/crm' },
];

export default function TabNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 px-4 py-2.5 bg-white border-b border-border" aria-label="Main navigation">
      <span className="text-base font-semibold tracking-tight mr-4 text-foreground">Forge</span>
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-foreground text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
