'use client';

import { useState, useCallback } from 'react';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  linkedin: string | null;
  location: string | null;
  tier: string;
  tags: string;
  how_we_met: string | null;
  notes: string;
  last_contact_date: string | null;
  created_at: string;
  updated_at: string;
}

interface Activity {
  id: string;
  contact_id: string;
  activity_type: string;
  title: string;
  content: string | null;
  metadata: string;
  created_at: string;
}

interface ContactDetailProps {
  contactId: string | null;
  onContactUpdated: () => void;
  onContactDeleted: () => void;
}

const activityIcons: Record<string, string> = {
  email_sent: '\u2197',
  email_received: '\u2199',
  meeting: '\uD83D\uDCC5',
  note: '\uD83D\uDCDD',
  call: '\uD83D\uDCDE',
};

const activityLabels: Record<string, string> = {
  email_sent: 'Email Sent',
  email_received: 'Email Received',
  meeting: 'Meeting',
  note: 'Note',
  call: 'Call',
};

const tierColors: Record<string, string> = {
  A: 'bg-accent-green text-white',
  B: 'bg-accent-blue text-white',
  C: 'bg-muted text-muted-foreground',
};

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

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function loadContactData(
  id: string,
  setContact: (c: Contact) => void,
  setActivities: (a: Activity[]) => void
) {
  const [contactRes, activitiesRes] = await Promise.all([
    fetch(`/api/contacts/${id}`),
    fetch(`/api/contacts/${id}/activities`),
  ]);
  if (contactRes.ok) {
    const data = await contactRes.json();
    setContact(data.contact);
  }
  if (activitiesRes.ok) {
    const data = await activitiesRes.json();
    setActivities(data.activities);
  }
}

export default function ContactDetail({
  contactId,
  onContactUpdated,
  onContactDeleted,
}: ContactDetailProps) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Contact>>({});
  const [tagInput, setTagInput] = useState('');
  const [showActivities, setShowActivities] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [newActivity, setNewActivity] = useState({
    activity_type: 'note',
    title: '',
    content: '',
  });
  const [loaded, setLoaded] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}`);
    if (res.ok) {
      const data = await res.json();
      setContact(data.contact);
    }
  }, [contactId]);

  const fetchActivities = useCallback(async () => {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}/activities`);
    if (res.ok) {
      const data = await res.json();
      setActivities(data.activities);
    }
  }, [contactId]);

  // Load data on first render (parent remounts via key={contactId})
  if (!loaded && contactId) {
    setLoaded(true);
    loadContactData(contactId, setContact, setActivities);
  }

  function startEdit() {
    if (!contact) return;
    setEditForm({
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      role: contact.role,
      linkedin: contact.linkedin,
      location: contact.location,
      how_we_met: contact.how_we_met,
      notes: contact.notes,
      tier: contact.tier,
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      setEditing(false);
      fetchContact();
      onContactUpdated();
    }
  }

  async function updateTier(newTier: string) {
    if (!contactId) return;
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: newTier }),
    });
    fetchContact();
    onContactUpdated();
  }

  async function addTag(tag: string) {
    if (!contact || !contactId || !tag.trim()) return;
    const currentTags = parseTags(contact.tags);
    if (currentTags.includes(tag.trim())) return;
    const newTags = [...currentTags, tag.trim()];
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    });
    setTagInput('');
    fetchContact();
    onContactUpdated();
  }

  async function removeTag(tag: string) {
    if (!contact || !contactId) return;
    const currentTags = parseTags(contact.tags);
    const newTags = currentTags.filter((t) => t !== tag);
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    });
    fetchContact();
    onContactUpdated();
  }

  async function deleteContact() {
    if (!contactId) return;
    const res = await fetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
    if (res.ok) {
      onContactDeleted();
    }
  }

  async function addActivity() {
    if (!contactId || !newActivity.title.trim()) return;
    const res = await fetch(`/api/contacts/${contactId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newActivity),
    });
    if (res.ok) {
      setNewActivity({ activity_type: 'note', title: '', content: '' });
      setShowAddActivity(false);
      fetchActivities();
    }
  }

  if (!contactId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a contact to view details.
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  const tags = parseTags(contact.tags);
  const tiers = ['A', 'B', 'C'];

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className={`w-14 h-14 rounded-xl flex items-center justify-center text-white text-lg font-semibold shrink-0 ${getInitialsColor(contact.name)}`}
          >
            {getInitials(contact.name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{contact.name}</h2>
            {(contact.company || contact.role) && (
              <p className="text-sm text-muted-foreground">
                {contact.role}{contact.role && contact.company ? ' at ' : ''}{contact.company}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editing && (
              <button
                onClick={startEdit}
                className="px-3 py-1.5 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-border transition-colors duration-150"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Quick Info Grid */}
        {!editing && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {contact.email && (
              <div>
                <span className="text-muted-foreground">Email</span>
                <a
                  href={`mailto:${contact.email}`}
                  className="block text-accent-blue hover:underline truncate"
                >
                  {contact.email}
                </a>
              </div>
            )}
            {contact.phone && (
              <div>
                <span className="text-muted-foreground">Phone</span>
                <p className="text-foreground">{contact.phone}</p>
              </div>
            )}
            {contact.linkedin && (
              <div>
                <span className="text-muted-foreground">LinkedIn</span>
                <p className="text-foreground">{contact.linkedin}</p>
              </div>
            )}
            {contact.location && (
              <div>
                <span className="text-muted-foreground">Location</span>
                <p className="text-foreground">{contact.location}</p>
              </div>
            )}
          </div>
        )}

        {/* Tier Badge */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tier:</span>
          {tiers.map((t) => (
            <button
              key={t}
              onClick={() => updateTier(t)}
              className={`px-2.5 py-0.5 text-xs font-semibold rounded-full transition-all duration-150 ${
                contact.tier === t
                  ? tierColors[t]
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tags */}
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="text-muted-foreground hover:text-foreground ml-0.5"
                >
                  x
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTag(tagInput);
              }}
              className="inline-flex"
            >
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="+ tag"
                className="w-16 px-1.5 py-0.5 text-xs rounded border border-transparent focus:border-border focus:outline-none bg-transparent text-muted-foreground"
              />
            </form>
          </div>
        </div>

        {/* How We Met */}
        {!editing && contact.how_we_met && (
          <div className="text-sm">
            <span className="text-muted-foreground">How we know each other:</span>
            <p className="text-foreground mt-0.5">{contact.how_we_met}</p>
          </div>
        )}

        {/* Edit Form */}
        {editing && (
          <div className="space-y-3 p-4 bg-muted/50 rounded-xl">
            {([
              ['name', 'Name'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['company', 'Company'],
              ['role', 'Role'],
              ['linkedin', 'LinkedIn'],
              ['location', 'Location'],
              ['how_we_met', 'How we met'],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <label className="text-xs text-muted-foreground">{label}</label>
                <input
                  type="text"
                  value={(editForm as Record<string, string | null>)[field] ?? ''}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <textarea
                value={editForm.notes ?? ''}
                onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent-blue/30 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                className="px-4 py-1.5 text-sm font-medium text-white bg-accent-blue rounded-lg hover:opacity-90 transition-opacity duration-150"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-4 py-1.5 text-sm font-medium text-foreground bg-muted rounded-lg hover:bg-border transition-colors duration-150"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Activity Timeline */}
        <div className="border border-border rounded-xl">
          <button
            onClick={() => setShowActivities(!showActivities)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-semibold text-foreground hover:bg-muted/50 rounded-t-xl transition-colors duration-150"
          >
            <span>Activity Timeline ({activities.length})</span>
            <span className="text-muted-foreground">{showActivities ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showActivities && (
            <div className="border-t border-border">
              <div className="px-4 py-2 border-b border-border">
                {!showAddActivity ? (
                  <button
                    onClick={() => setShowAddActivity(true)}
                    className="text-sm text-accent-blue hover:underline"
                  >
                    + Add Activity
                  </button>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={newActivity.activity_type}
                      onChange={(e) =>
                        setNewActivity((prev) => ({ ...prev, activity_type: e.target.value }))
                      }
                      className="px-2 py-1 text-sm rounded border border-border bg-background"
                    >
                      {Object.entries(activityLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Title"
                      value={newActivity.title}
                      onChange={(e) =>
                        setNewActivity((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="w-full px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent-blue/30"
                    />
                    <textarea
                      placeholder="Content (optional)"
                      value={newActivity.content}
                      onChange={(e) =>
                        setNewActivity((prev) => ({ ...prev, content: e.target.value }))
                      }
                      rows={2}
                      className="w-full px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-accent-blue/30 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={addActivity}
                        className="px-3 py-1 text-sm font-medium text-white bg-accent-blue rounded-lg hover:opacity-90 transition-opacity duration-150"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setShowAddActivity(false);
                          setNewActivity({ activity_type: 'note', title: '', content: '' });
                        }}
                        className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {activities.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No activities recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {activities.map((act) => (
                    <div key={act.id} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5" title={activityLabels[act.activity_type] || act.activity_type}>
                        {activityIcons[act.activity_type] || '\u2022'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{act.title}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(act.created_at)}
                          </span>
                        </div>
                        {act.content && (
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                            {act.content}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="border border-border rounded-xl">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-semibold text-foreground hover:bg-muted/50 rounded-t-xl transition-colors duration-150"
          >
            <span>Notes</span>
            <span className="text-muted-foreground">{showNotes ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showNotes && (
            <div className="border-t border-border px-4 py-3">
              {contact.notes ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{contact.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No notes.</p>
              )}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="border border-border rounded-xl">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-sm font-semibold text-foreground hover:bg-muted/50 rounded-t-xl transition-colors duration-150"
          >
            <span>Details</span>
            <span className="text-muted-foreground">{showDetails ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showDetails && (
            <div className="border-t border-border px-4 py-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Created</span>
                  <p className="text-foreground">{formatTimestamp(contact.created_at)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Updated</span>
                  <p className="text-foreground">{formatTimestamp(contact.updated_at)}</p>
                </div>
                {contact.last_contact_date && (
                  <div>
                    <span className="text-muted-foreground">Last Contact</span>
                    <p className="text-foreground">{contact.last_contact_date}</p>
                  </div>
                )}
                {contact.email && (
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="text-foreground">{contact.email}</p>
                  </div>
                )}
                {contact.phone && (
                  <div>
                    <span className="text-muted-foreground">Phone</span>
                    <p className="text-foreground">{contact.phone}</p>
                  </div>
                )}
                {contact.linkedin && (
                  <div>
                    <span className="text-muted-foreground">LinkedIn</span>
                    <p className="text-foreground">{contact.linkedin}</p>
                  </div>
                )}
                {contact.location && (
                  <div>
                    <span className="text-muted-foreground">Location</span>
                    <p className="text-foreground">{contact.location}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Delete */}
        <div className="pt-2 border-t border-border">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-sm text-accent-red hover:underline"
            >
              Delete Contact
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground">Delete this contact and all data?</span>
              <button
                onClick={deleteContact}
                className="px-3 py-1 text-sm font-medium text-white bg-accent-red rounded-lg hover:opacity-90 transition-opacity duration-150"
              >
                Yes, Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
