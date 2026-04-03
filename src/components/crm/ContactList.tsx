'use client';

import { useState } from 'react';

interface Contact {
  _id: string;
  name: string;
  email?: string;
  company?: string;
  linkedin?: string;
  notes?: string;
  tier: string;
  tags: string[];
  lastContactDate?: string;
}

interface ContactListProps {
  contacts: Contact[];
  selectedId: string | null;
  onSelectContact: (id: string) => void;
  sort: string;
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

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const tierColors: Record<string, string> = {
  A: 'bg-accent-green/10 text-accent-green',
  B: 'bg-accent-blue/10 text-accent-blue',
  C: 'bg-muted text-muted-foreground',
};

type ColumnKey = 'name' | 'company' | 'email' | 'linkedin' | 'notes' | 'tier' | 'tags' | 'lastContactDate';

const ALL_COLUMNS: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: 'name', label: 'Name', defaultVisible: true },
  { key: 'company', label: 'Company', defaultVisible: true },
  { key: 'email', label: 'Email', defaultVisible: true },
  { key: 'linkedin', label: 'LinkedIn', defaultVisible: true },
  { key: 'notes', label: 'Notes', defaultVisible: true },
  { key: 'tier', label: 'Tier', defaultVisible: true },
  { key: 'tags', label: 'Tags', defaultVisible: true },
  { key: 'lastContactDate', label: 'Last Contact', defaultVisible: true },
];

export default function ContactList({
  contacts,
  selectedId,
  onSelectContact,
  sort,
  onSort,
}: ContactListProps) {
  const [visibleCols, setVisibleCols] = useState<Set<ColumnKey>>(
    new Set(ALL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key))
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set());

  function toggleColumn(key: ColumnKey) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRow(id: string) {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checkedRows.size === contacts.length) {
      setCheckedRows(new Set());
    } else {
      setCheckedRows(new Set(contacts.map((c) => c._id)));
    }
  }

  const columns = ALL_COLUMNS.filter((c) => visibleCols.has(c.key));

  function handleSort(key: string) {
    if (key === 'name') onSort('name');
    else if (key === 'company') onSort('company');
    else if (key === 'lastContactDate') onSort('last_contact_date');
  }

  function getSortArrow(key: string) {
    const mapping: Record<string, string> = { name: 'name', company: 'company', lastContactDate: 'last_contact_date' };
    return sort === mapping[key] ? ' \u2193' : '';
  }

  return (
    <div className="flex flex-col h-full">
      {/* Column visibility toggle */}
      <div className="px-4 py-1.5 border-b flex items-center justify-end">
        <div className="relative">
          <button
            onClick={() => setShowColMenu(!showColMenu)}
            className="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground border rounded-md hover:bg-muted transition-colors duration-150"
          >
            Columns
          </button>
          {showColMenu && (
            <div className="absolute right-0 top-full mt-1 bg-card border rounded-lg shadow-lg py-1.5 z-10 min-w-[140px]">
              {ALL_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={visibleCols.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded border-border"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {contacts.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">
            No contacts yet. Add your first contact to get started.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b bg-muted/30 sticky top-0">
                <th className="pl-4 pr-2 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={checkedRows.size === contacts.length && contacts.length > 0}
                    onChange={toggleAll}
                    className="rounded border-border"
                  />
                </th>
                {columns.map((col) => {
                  const sortable = ['name', 'company', 'lastContactDate'].includes(col.key);
                  return (
                    <th
                      key={col.key}
                      className={`px-3 py-2 font-medium ${sortable ? 'cursor-pointer hover:text-foreground' : ''}`}
                      onClick={sortable ? () => handleSort(col.key) : undefined}
                    >
                      {col.label}{getSortArrow(col.key)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => {
                const isSelected = contact._id === selectedId;
                const isChecked = checkedRows.has(contact._id);
                return (
                  <tr
                    key={contact._id}
                    onClick={() => onSelectContact(contact._id)}
                    className={`cursor-pointer border-b transition-colors duration-100 ${
                      isSelected
                        ? 'bg-accent-blue/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <td className="pl-4 pr-2 py-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleRow(contact._id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-border"
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        {col.key === 'name' && (
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0 ${getInitialsColor(contact.name)}`}
                            >
                              {getInitials(contact.name)}
                            </div>
                            <span className="font-medium text-foreground truncate max-w-[160px]">{contact.name}</span>
                          </div>
                        )}
                        {col.key === 'company' && (
                          <span className={contact.company ? 'text-accent-blue' : 'text-muted-foreground'}>
                            {contact.company || '--'}
                          </span>
                        )}
                        {col.key === 'email' && (
                          <span className="text-muted-foreground truncate max-w-[180px] block">
                            {contact.email || '--'}
                          </span>
                        )}
                        {col.key === 'linkedin' && (
                          <span className="text-muted-foreground truncate max-w-[140px] block text-[11px]">
                            {contact.linkedin || '--'}
                          </span>
                        )}
                        {col.key === 'notes' && (
                          <span className="text-muted-foreground truncate max-w-[120px] block text-[11px]">
                            {contact.notes || '--'}
                          </span>
                        )}
                        {col.key === 'tier' && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tierColors[contact.tier] ?? tierColors.C}`}>
                            {contact.tier}
                          </span>
                        )}
                        {col.key === 'tags' && (
                          <div className="flex flex-wrap gap-1">
                            {contact.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                            {contact.tags.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">+{contact.tags.length - 2}</span>
                            )}
                          </div>
                        )}
                        {col.key === 'lastContactDate' && (
                          <span className="text-muted-foreground text-[11px]">
                            {formatDate(contact.lastContactDate)}
                          </span>
                        )}
                      </td>
                    ))}
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
