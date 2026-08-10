export interface ContactParticipant {
  name?: string | null;
  address: string;
}

export function uniqueContactParticipants(
  sender: ContactParticipant,
  to: readonly ContactParticipant[],
  cc: readonly ContactParticipant[],
): ContactParticipant[] {
  const seen = new Set<string>();
  const participants: ContactParticipant[] = [];
  for (const participant of [sender, ...to, ...cc]) {
    const address = participant.address.trim();
    const normalizedAddress = address.toLowerCase();
    if (!normalizedAddress || seen.has(normalizedAddress)) continue;
    seen.add(normalizedAddress);
    participants.push({ name: participant.name, address });
  }
  return participants;
}
