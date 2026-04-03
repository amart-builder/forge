'use client';

import { useState } from 'react';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  tier: string;
  tags: string;
  last_contact_date: string | null;
}

interface ContactListProps {
  contacts: Contact[];
  selectedId: string | null;
  onSelectContact: (id: string) => void;
  onAddContact: () => void;
  onSearch: (query: string) => void;
  onFilterTier: (tier: string) => void;
  onSort: (sort: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function getInitialsColor(name: string): string {
  const colors = [
    'bg-accent-blue', 'bg-accent-green', 'bg-accent-orange', 'bg-accent-red',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function parseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const tierLabel: Record<string, string> = { A: 'A', B: 'B', C: 'C' };

export default function ContactList({
  contacts,
  selectedId,
  onSelectContact,
  onAddContact,
  onSearch,
  onFilterTier,
  onSort,
}: ContactListProps) {
  const [searchValue, setSearchValue] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [sortValue, setSortValue] = useState('name');

  function handleSearch(value: string) {
    setSearchValue(value);
    onSearch(value);
  }

  function handleTier(value: string) {
    setTierFilter(value);
    onFilterTier(value);
  }

  function handleSort(value: string) {
    setSortValue(value);
    onSort(value);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h2 className="font-semibold text-foreground whitespace-nowrap">Contacts</h2>
        <button
          onClick={onAddContact}
          className="px-3 py-1.5 text-sm font-medium text-white bg-accent-blue rounded-lg hover:opacity-90 transition-opacity duration-150 whitespace-nowrap"
        >
          Add Contact
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2 border-b border-border">
        <input
          type="text"
          placeholder="Search contacts..."
          value={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue transition-all duration-150"
        />
      </div>

      {/* Filters */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <select
          value={tierFilter}
          onChange={(e) => handleTier(e.target.value)}
          className="px-2 py-1 text-sm rounded-lg border border-border bg-background text-foreground"
        >
          <option value="">All Tiers</option>
          {['A', 'B', 'C'].map((t) => (
            <option key={t} value={t}>Tier {tierLabel[t]}</option>
          ))}
        </select>
        <select
          value={sortValue}
          onChange={(e) => handleSort(e.target.value)}
          className="px-2 py-1 text-sm rounded-lg border border-border bg-background text-foreground"
        >
          <option value="name">Name</option>
          <option value="last_contact_date">Last Contact</option>
          <option value="company">Company</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">
            No contacts yet. Add your first contact to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Company</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Last Contact</th>
                <th className="px-4 py-2 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const tags = parseTags(contact.tags);
                const isSelected = contact.id === selectedId;
                return (
                  <tr
                    key={contact.id}
                    onClick={() => onSelectContact(contact.id)}
                    className={`cursor-pointer border-b border-border transition-colors duration-150 ${
                      isSelected
                        ? 'bg-accent-blue/10'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 ${getInitialsColor(contact.name)}`}
                        >
                          {getInitials(contact.name)}
                        </div>
                        <span className="font-medium text-foreground truncate">{contact.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell truncate">
                      {contact.company || '--'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                      {formatDate(contact.last_contact_date)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                        {tags.length > 2 && (
                          <span className="text-xs text-muted-foreground">+{tags.length - 2}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
