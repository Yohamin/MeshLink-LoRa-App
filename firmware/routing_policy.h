#pragma once

// Final recipients can use a frame overheard before relay forwarding.
// Relays must still obey an explicitly selected next hop.
inline bool meshNextHopAllows(bool finalRecipient, bool hasNextHop, bool nextHopIsSelf) {
  return finalRecipient || !hasNextHop || nextHopIsSelf;
}

inline bool meshAckAllows(bool finalRecipient, bool matchingPendingSender,
                          bool hasNextHop, bool nextHopIsSelf) {
  return finalRecipient ? matchingPendingSender
                        : meshNextHopAllows(false, hasNextHop, nextHopIsSelf);
}
