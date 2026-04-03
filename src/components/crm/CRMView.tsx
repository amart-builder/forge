'use client';

import { useState, useRef, useCallback } from 'react';
import ContactList from './ContactList';
import ContactDetail from './ContactDetail';
import ImportModal from './ImportModal';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  tier: string;
  tags: string;
  last_contact_date: string | null;
}

async function loadContacts(
  search: string,
  tier: string,
  sort: string
): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (tier) params.set('tier', tier);
  params.set('sort', sort);

  const res = await fetch(`/api/contacts?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.contacts;
}

export default function CRMView() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '' });
  const [initialized, setInitialized] = useState(false);

  const searchRef = useRef('');
  const tierRef = useRef('');
  const sortRef = useRef('name');

  const fetchContacts = useCallback(async () => {
    const results = await loadContacts(searchRef.current, tierRef.current, sortRef.current);
    setContacts(results);
  }, []);

  // Initial data load on first render
  if (!initialized) {
    setInitialized(true);
    loadContacts('', '', 'name').then((results) => setContacts(results));
  }

  function handleSearch(query: string) {
    searchRef.current = query;
    fetchContacts();
  }

  function handleFilterTier(tier: string) {
    tierRef.current = tier;
    fetchContacts();
  }

  function handleSort(sort: string) {
    sortRef.current = sort;
    fetchContacts();
  }

  async function handleAddContact() {
    if (!newContact.name.trim()) return;
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContact),
    });
    if (res.ok) {
      const data = await res.json();
      setNewContact({ name: '', email: '', company: '' });
      setShowAddForm(false);
      fetchContacts();
      setSelectedId(data.contact.id);
    }
  }

  function handleContactDeleted() {
    setSelectedId(null);
    fetchContacts();
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
            onSearch={handleSearch}
            onFilterTier={handleFilterTier}
            onSort={handleSort}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden">
          <ContactDetail
            key={selectedId ?? '__none'}
            contactId={selectedId}
            onContactUpdated={fetchContacts}
            onContactDeleted={handleContactDeleted}
          />
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => fetchContacts()}
        />
      )}
    </div>
  );
}
