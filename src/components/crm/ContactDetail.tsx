'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Id } from '../../../convex/_generated/dataModel';

interface ContactDetailProps {
  contactId: string | null;
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

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ContactDetail({
  contactId,
  onContactDeleted,
}: ContactDetailProps) {
  const typedId = contactId as Id<"contacts"> | null;

  const contact = useQuery(
    api.contacts.get,
    typedId ? { id: typedId } : "skip",
  );
  const activities = useQuery(
    api.contactActivities.listByContact,
    typedId ? { contactId: typedId } : "skip",
  ) ?? [];

  const updateContact = useMutation(api.contacts.update);
  const removeContact = useMutation(api.contacts.remove);
  const createActivity = useMutation(api.contactActivities.create);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string | undefined>>({});
  const [tagInput, setTagInput] = useState('');
  const [showActivities, setShowActivities] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [newActivity, setNewActivity] = useState({
    activityType: 'note',
    title: '',
    content: '',
  });

  function startEdit() {
    if (!contact) return;
    setEditForm({
      name: contact.name,
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      company: contact.company ?? '',
      role: contact.role ?? '',
      linkedin: contact.linkedin ?? '',
      location: contact.location ?? '',
      howWeMet: contact.howWeMet ?? '',
      notes: contact.notes ?? '',
      tier: contact.tier,
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!typedId) return;
    await updateContact({
      id: typedId,
      name: editForm.name || undefined,
      email: editForm.email || undefined,
      phone: editForm.phone || undefined,
      company: editForm.company || undefined,
      role: editForm.role || undefined,
      linkedin: editForm.linkedin || undefined,
      location: editForm.location || undefined,
      howWeMet: editForm.howWeMet || undefined,
      notes: editForm.notes || undefined,
      tier: editForm.tier || undefined,
    });
    setEditing(false);
  }

  async function updateTier(newTier: string) {
    if (!typedId) return;
    await updateContact({ id: typedId, tier: newTier });
  }

  async function addTag(tag: string) {
    if (!contact || !typedId || !tag.trim()) return;
    if (contact.tags.includes(tag.trim())) return;
    const newTags = [...contact.tags, tag.trim()];
    await updateContact({ id: typedId, tags: newTags });
    setTagInput('');
  }

  async function removeTag(tag: string) {
    if (!contact || !typedId) return;
    const newTags = contact.tags.filter((t) => t !== tag);
    await updateContact({ id: typedId, tags: newTags });
  }

  async function deleteContact() {
    if (!typedId) return;
    await removeContact({ id: typedId });
    onContactDeleted();
  }

  async function addActivity() {
    if (!typedId || !newActivity.title.trim()) return;
    await createActivity({
      contactId: typedId,
      activityType: newActivity.activityType,
      title: newActivity.title,
      content: newActivity.content || undefined,
    });
    setNewActivity({ activityType: 'note', title: '', content: '' });
    setShowAddActivity(false);
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
            {contact.tags.map((tag) => (
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
        {!editing && contact.howWeMet && (
          <div className="text-sm">
            <span className="text-muted-foreground">How we know each other:</span>
            <p className="text-foreground mt-0.5">{contact.howWeMet}</p>
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
              ['howWeMet', 'How we met'],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <label className="text-xs text-muted-foreground">{label}</label>
                <input
                  type="text"
                  value={editForm[field] ?? ''}
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
                      value={newActivity.activityType}
                      onChange={(e) =>
                        setNewActivity((prev) => ({ ...prev, activityType: e.target.value }))
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
                          setNewActivity({ activityType: 'note', title: '', content: '' });
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
                    <div key={act._id} className="px-4 py-3 flex items-start gap-3">
                      <span className="text-base shrink-0 mt-0.5" title={activityLabels[act.activityType] || act.activityType}>
                        {activityIcons[act.activityType] || '\u2022'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{act.title}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(act.createdAt)}
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
                  <p className="text-foreground">{formatTimestamp(contact.createdAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Updated</span>
                  <p className="text-foreground">{formatTimestamp(contact.updatedAt)}</p>
                </div>
                {contact.lastContactDate && (
                  <div>
                    <span className="text-muted-foreground">Last Contact</span>
                    <p className="text-foreground">{contact.lastContactDate}</p>
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
