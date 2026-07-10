export function realTimeLabel(dueAt: string | undefined): string | undefined {
  if (!dueAt) return undefined;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return undefined;

  const encodedClock = dueAt.match(/T(\d{2}):(\d{2})/);
  const encodedMidnight = encodedClock?.[1] === '00' && encodedClock[2] === '00';
  const localMidnight = due.getHours() === 0 && due.getMinutes() === 0;
  if (encodedMidnight || localMidnight) return undefined;

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(due);
}
