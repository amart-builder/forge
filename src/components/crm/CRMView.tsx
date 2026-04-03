'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import ContactList from './ContactList';
import ContactDetail from './ContactDetail';
import ImportModal from './ImportModal';

export default function CRMView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '' });

  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [sort, setSort] = useState('name');

  const contacts = useQuery(api.contacts.list, {
    search: search || undefined,
    tier: tier || undefined,
    sort,
  }) ?? [];

  const createContact = useMutation(api.contacts.create);

  async function handleAddContact() {
    if (!newContact.name.trim()) return;
    const id = await createContact({
      name: newContact.name,
      email: newContact.email || undefined,
      company: newContact.company || undefined,
    });
    setNewContact({ name: '', email: '', company: '' });
    setShowAddForm(false);
    setSelectedId(id);
  }

  function handleContactDeleted() {
    setSelectedId(null);
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="px-5 py-2.5 border-b flex items-center gap-3 transition-colors duration-200">
        <h1 className="text-sm font-semibold text-foreground">Contacts</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {contacts.length} {contacts.length === 1 ? 'entry' : 'entries'}
        </span>

        <div className="ml-4 relative max-w-[220px] flex-1">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
          />
        </div>

        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="px-2 py-1.5 text-xs rounded-md border bg-background text-foreground"
        >
          <option value="">All Tiers</option>
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border rounded-md hover:bg-muted transition-colors duration-150"
          >
            Import
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-md hover:opacity-90 transition-opacity duration-150"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Quick add form */}
      {showAddForm && (
        <div className="px-5 py-3 border-b bg-muted/30 flex items-end gap-3 transition-colors duration-200">
          <div className="flex-1 grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Name *</label>
              <input
                type="text"
                value={newContact.name}
                onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Email</label>
              <input
                type="email"
                value={newContact.email}
                onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
                placeholder="Email"
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Company</label>
              <input
                type="text"
                value={newContact.company}
                onChange={(e) => setNewContact((p) => ({ ...p, company: e.target.value }))}
                placeholder="Company"
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-accent-blue/40"
              />
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={handleAddContact}
              className="px-3 py-1.5 text-xs font-medium text-white bg-accent-blue rounded-md hover:opacity-90 transition-opacity duration-150"
            >
              Save
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewContact({ name: '', email: '', company: '' });
              }}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main content: table + detail panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Table panel */}
        <div className={`flex-1 overflow-hidden transition-all duration-200 ${selectedId ? 'min-w-0' : ''}`}>
          <ContactList
            contacts={contacts}
            selectedId={selectedId}
            onSelectContact={setSelectedId}
            sort={sort}
            onSort={setSort}
          />
        </div>

        {/* Detail panel (slide-in) */}
        {selectedId && (
          <div className="w-[380px] border-l flex-shrink-0 overflow-hidden bg-card transition-colors duration-200">
            <ContactDetail
              key={selectedId}
              contactId={selectedId}
              onContactDeleted={handleContactDeleted}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
