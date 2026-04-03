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
      {/* CRM Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-background transition-colors duration-200">
        <h1 className="font-semibold text-foreground">CRM</h1>
        <button
          onClick={() => setShowImport(true)}
          className="px-3 py-1.5 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-border transition-colors duration-150"
        >
          Import CSV
        </button>
      </div>

      {/* Add Contact Form */}
      {showAddForm && (
        <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-end gap-3 transition-colors duration-200">
          <div className="flex-1 grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <input
                type="text"
                value={newContact.name}
                onChange={(e) => setNewContact((p) => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Email</label>
              <input
                type="email"
                value={newContact.email}
                onChange={(e) => setNewContact((p) => ({ ...p, email: e.target.value }))}
                placeholder="Email"
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Company</label>
              <input
                type="text"
                value={newContact.company}
                onChange={(e) => setNewContact((p) => ({ ...p, company: e.target.value }))}
                placeholder="Company"
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
              />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={handleAddContact}
              className="px-3 py-1.5 text-sm font-medium text-white bg-accent-blue rounded-lg hover:opacity-90 transition-opacity duration-150"
            >
              Save
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setNewContact({ name: '', email: '', company: '' });
              }}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Two-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel */}
        <div className="w-[400px] border-r border-border flex-shrink-0 overflow-hidden">
          <ContactList
            contacts={contacts}
            selectedId={selectedId}
            onSelectContact={setSelectedId}
            onAddContact={() => setShowAddForm(true)}
            onSearch={setSearch}
            onFilterTier={setTier}
            onSort={setSort}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden">
          <ContactDetail
            key={selectedId ?? '__none'}
            contactId={selectedId}
            onContactDeleted={handleContactDeleted}
          />
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} />
      )}
    </div>
  );
}
